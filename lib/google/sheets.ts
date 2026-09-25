// Read-only Google Sheets access with the signed-in user's own Google grant.
// The Sheets permission is requested only when someone chooses "Google Sheet"
// (see grantSheetsAccessAction); everyone else keeps the plain sign-in scopes.
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, EncryptionConfigError } from "@/lib/crypto";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_ROWS = 2000;

export type Fetch = typeof fetch;

/** A user-facing failure: shown as-is, with what to do next. */
export class SheetsError extends Error {
  constructor(
    message: string,
    readonly code: "needs-grant" | "no-access" | "not-found" | "bad-link" | "too-large" | "failed",
  ) {
    super(message);
    this.name = "SheetsError";
  }
}

// ---------- Links ----------

export type SheetRef = { spreadsheetId: string; sheetId: number | null };

/** Accepts a full Google Sheets URL (any tab, with or without #gid) or a bare spreadsheet id. */
export function parseSheetLink(input: string): SheetRef | null {
  const s = input.trim();
  const m = s.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  const id = m?.[1] ?? (/^[a-zA-Z0-9_-]{30,}$/.test(s) ? s : null);
  if (!id) return null;
  const gid = s.match(/[#?&]gid=(\d+)/);
  return { spreadsheetId: id, sheetId: gid ? Number(gid[1]) : null };
}

// ---------- Tokens ----------

type GoogleAccount = { provider: string; providerAccountId: string; access_token?: string | null; refresh_token?: string | null; expires_at?: number | null; scope?: string | null };

/**
 * Called on every Google sign-in: Auth.js doesn't update an existing Account's tokens,
 * so a later grant (e.g. adding Sheets access) would otherwise be lost.
 * The refresh token is encrypted; a sign-in without one keeps the stored one. Without
 * ENCRYPTION_KEY the refresh token is dropped (never stored in plain text) and sign-in
 * still succeeds; Sheets access then asks to be granted again once the key is set.
 */
export async function saveGoogleGrant(account: GoogleAccount): Promise<void> {
  if (account.provider !== "google") return;
  let refresh: { refresh_token: string | null } | object = {};
  if (account.refresh_token) {
    try {
      refresh = { refresh_token: encryptSecret(account.refresh_token, "google-refresh-token") };
    } catch (e) {
      if (!(e instanceof EncryptionConfigError)) throw e;
      console.warn(`Google refresh token not stored: ${e.message}`);
      refresh = { refresh_token: null };
    }
  }
  await db.account.updateMany({
    where: { provider: "google", providerAccountId: account.providerAccountId },
    data: {
      access_token: account.access_token ?? null,
      expires_at: account.expires_at ?? null,
      scope: account.scope ?? null,
      ...refresh,
    },
  });
}

export async function hasSheetsGrant(userId: string): Promise<boolean> {
  const acc = await db.account.findFirst({ where: { userId, provider: "google", scope: { contains: SHEETS_SCOPE } } });
  return !!acc && !!(acc.refresh_token || acc.access_token);
}

/** A valid access token with Sheets scope for this user, refreshing it if needed. */
export async function sheetsAccessToken(userId: string, fetchImpl: Fetch = fetch, now = Date.now()): Promise<string> {
  const acc = await db.account.findFirst({ where: { userId, provider: "google", scope: { contains: SHEETS_SCOPE } } });
  const needsGrant = () => new SheetsError("Grant Google Sheets access to import from a sheet.", "needs-grant");
  if (!acc) throw needsGrant();
  if (acc.access_token && acc.expires_at && acc.expires_at * 1000 > now + 60_000) return acc.access_token;

  let secret: { value: string | null; stale: boolean };
  try {
    secret = decryptSecret(acc.refresh_token, "google-refresh-token");
  } catch (e) {
    if (e instanceof EncryptionConfigError) throw new SheetsError(`The server can't read stored Google access. ${e.message}`, "failed");
    throw e;
  }
  const refresh = secret.value;
  if (!refresh) throw needsGrant();
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
  });
  if (!res.ok) {
    // Revoked or expired grant: forget it so the UI asks again.
    await db.account.update({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: acc.providerAccountId } },
      data: { refresh_token: null, access_token: null, expires_at: null },
    });
    throw needsGrant();
  }
  const t = (await res.json()) as { access_token: string; expires_in: number };
  await db.account.update({
    where: { provider_providerAccountId: { provider: "google", providerAccountId: acc.providerAccountId } },
    data: {
      access_token: t.access_token,
      expires_at: Math.floor(now / 1000) + t.expires_in,
      // Tokens from before ENCRYPTION_KEY (or stored in plain text) are re-encrypted on first use.
      ...(secret.stale ? { refresh_token: encryptSecret(refresh, "google-refresh-token") } : {}),
    },
  });
  return t.access_token;
}

// ---------- Reading ----------

async function call<T>(url: string, token: string, fetchImpl: Fetch): Promise<T> {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) return (await res.json()) as T;
  if (res.status === 401) throw new SheetsError("Your Google access expired. Grant Sheets access again.", "needs-grant");
  if (res.status === 403) throw new SheetsError("Your Google account can't open this sheet. Ask its owner to share it with you, or check you're signed in with the right account.", "no-access");
  if (res.status === 404) throw new SheetsError("That spreadsheet doesn't exist or the link is wrong.", "not-found");
  throw new SheetsError(`Google Sheets returned an error (${res.status}). Try again.`, "failed");
}

export type SheetTab = { sheetId: number; title: string };

export async function listTabs(token: string, spreadsheetId: string, fetchImpl: Fetch = fetch): Promise<{ title: string; tabs: SheetTab[] }> {
  const r = await call<{ properties: { title: string }; sheets: { properties: { sheetId: number; title: string } }[] }>(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(sheetId,title)`,
    token,
    fetchImpl,
  );
  return { title: r.properties.title, tabs: r.sheets.map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title })) };
}

export type SheetData = { spreadsheetTitle: string; tabTitle: string; headers: string[]; rows: (string | number | boolean | null)[][] };

/** The tab's first row as headers, then data rows. Dates arrive as serial numbers (see lib/import/normalize). */
export async function readSheet(token: string, ref: { spreadsheetId: string; sheetId: number }, fetchImpl: Fetch = fetch): Promise<SheetData> {
  const { title, tabs } = await listTabs(token, ref.spreadsheetId, fetchImpl);
  const tab = tabs.find((t) => t.sheetId === ref.sheetId);
  if (!tab) throw new SheetsError("That tab no longer exists in the spreadsheet.", "not-found");
  const range = encodeURIComponent(`'${tab.title.replace(/'/g, "''")}'`);
  const r = await call<{ values?: (string | number | boolean)[][] }>(
    `${SHEETS_API}/${encodeURIComponent(ref.spreadsheetId)}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`,
    token,
    fetchImpl,
  );
  const [head = [], ...body] = r.values ?? [];
  const rows = body.filter((row) => row.some((c) => c !== "" && c != null));
  if (rows.length > MAX_ROWS) throw new SheetsError(`This tab has ${rows.length} rows; imports are limited to ${MAX_ROWS}.`, "too-large");
  const headers = head.map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
  return { spreadsheetTitle: title, tabTitle: tab.title, headers, rows: rows.map((row) => headers.map((_, i) => row[i] ?? null)) };
}
