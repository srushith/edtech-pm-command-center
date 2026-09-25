// Shared shapes for the real AI providers (lib/ai/providers/*). Only lib/ai uses these.

export type ProviderKind = "OPENAI" | "GEMINI" | "ANTHROPIC";
export const PROVIDER_KINDS: ProviderKind[] = ["OPENAI", "GEMINI", "ANTHROPIC"];

export const PROVIDER_LABELS: Record<ProviderKind, string> = { OPENAI: "OpenAI", GEMINI: "Gemini", ANTHROPIC: "Anthropic" };

/** Pre-filled when an owner picks a provider; they can type any model their key can use. */
export const DEFAULT_MODELS: Record<ProviderKind, string> = {
  OPENAI: "gpt-6-luna",
  GEMINI: "gemini-3.8-flash",
  ANTHROPIC: "claude-opus-5",
};

/** One request for a JSON answer. The schema is enforced by providers that support it and checked again by the caller. */
export type JsonRequest = {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
};

export type JsonResult = { text: string; inputTokens: number; outputTokens: number };

export interface ProviderClient {
  readonly kind: ProviderKind;
  readonly model: string;
  completeJSON(req: JsonRequest): Promise<JsonResult>;
  /** Cheapest check that the key works and can use the model. Uses no tokens. */
  testKey(): Promise<void>;
}

export type ProviderOptions = { apiKey: string; model: string; fetch?: typeof fetch };

/** A provider call failed. `message` is safe to show (never contains the key). */
export class AIProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AIProviderError";
  }
}

export const REQUEST_TIMEOUT_MS = 30_000;

/** A readable error for a failed provider HTTP response. */
export async function httpError(provider: ProviderKind, model: string, res: Response): Promise<AIProviderError> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    detail = typeof body.error === "string" ? body.error : (body.error?.message ?? "");
  } catch {
    // not JSON
  }
  const name = PROVIDER_LABELS[provider];
  const why =
    res.status === 401 || res.status === 403 ? `${name} rejected the API key`
    : res.status === 404 ? `${name} has no model "${model}" for this key`
    : res.status === 429 ? `${name} rate limit or quota reached`
    : `${name} returned an error (${res.status})`;
  return new AIProviderError(detail ? `${why}: ${detail.slice(0, 200)}` : `${why}.`, res.status);
}
