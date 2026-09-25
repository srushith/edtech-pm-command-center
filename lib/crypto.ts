// Encryption for stored secrets: workspace AI keys and Google refresh tokens.
//
// AES-256-GCM with ENCRYPTION_KEY (32 random bytes, base64) from .env.local. Each secret
// is bound to its purpose (GCM additional data), so a ciphertext copied into another
// column won't decrypt. Server-only: the "server-only" import makes `next build` fail if
// client code imports this (a node:crypto import alone doesn't; Next stubs it), and
// tests/ai.test.ts checks client components too.
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type SecretPurpose = "ai-key" | "google-refresh-token";

const V2 = "enc:v2:";
const V1 = "enc:v1:"; // before ENCRYPTION_KEY: Google tokens with a key derived from AUTH_SECRET

export const ENCRYPTION_KEY_HELP =
  "Set ENCRYPTION_KEY in .env.local (generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\") and restart the server.";

/** The server can't encrypt or decrypt: ENCRYPTION_KEY is missing or malformed. Safe to show to owners. */
export class EncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionConfigError";
  }
}

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) throw new EncryptionConfigError(`ENCRYPTION_KEY is not set. ${ENCRYPTION_KEY_HELP}`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new EncryptionConfigError(`ENCRYPTION_KEY must be 32 bytes, base64-encoded. ${ENCRYPTION_KEY_HELP}`);
  return key;
}

export function hasEncryptionKey(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string, purpose: SecretPurpose): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  c.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return V2 + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

function open(raw: Buffer, key: Buffer, aad: string | null): string {
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/**
 * The secret, or null if it can't be read (tampered, wrong purpose, key changed).
 * `stale` means it was stored in an older format and should be re-encrypted.
 * Throws EncryptionConfigError when ENCRYPTION_KEY itself is missing.
 */
export function decryptSecret(stored: string | null | undefined, purpose: SecretPurpose): { value: string | null; stale: boolean } {
  if (!stored) return { value: null, stale: false };
  if (stored.startsWith(V2)) {
    try {
      return { value: open(Buffer.from(stored.slice(V2.length), "base64url"), masterKey(), purpose), stale: false };
    } catch (e) {
      if (e instanceof EncryptionConfigError) throw e;
      return { value: null, stale: false };
    }
  }
  if (purpose !== "google-refresh-token") return { value: null, stale: false };
  if (stored.startsWith(V1)) {
    try {
      const secret = process.env.AUTH_SECRET ?? "";
      const legacy = createHash("sha256").update(`cc-google-token:${secret}`).digest();
      return { value: open(Buffer.from(stored.slice(V1.length), "base64url"), legacy, null), stale: true };
    } catch {
      return { value: null, stale: false };
    }
  }
  // A plain token stored by Auth.js before our sign-in hook ran.
  return { value: stored, stale: true };
}

/** "••••a1b2" for display. Never more than the last 4 characters. */
export const maskSecret = (last4: string | null | undefined) => (last4 ? `••••${last4}` : null);
