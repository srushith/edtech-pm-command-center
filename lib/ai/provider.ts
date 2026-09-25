// The single seam for AI features. Everything AI goes through getAIProvider(ctx):
//   - the workspace has a key  -> its real provider (OpenAI, Gemini or Anthropic), with
//     every request logged (requests and tokens) and the monthly limit enforced;
//   - no key                   -> the built-in mock;
//   - limit reached, AI disabled (CC_AI=off) or the key can't be read -> null: AI is off
//     and callers fall back to manual work.
// Callers must work when it returns null. AI only ever suggests; the UI labels its output
// "AI Insight" with its evidence. A test fails if code outside lib/ai reaches a provider directly.
import "server-only";
import type { WorkspaceContext } from "@/lib/auth/access";
import { decryptSecret, EncryptionConfigError } from "@/lib/crypto";
import { db } from "@/lib/db";
import { columnMappingRequest, parseColumnMapping } from "@/lib/ai/column-mapping";
import { mockProvider } from "@/lib/ai/mock";
import { anthropicClient } from "@/lib/ai/providers/anthropic";
import { geminiClient } from "@/lib/ai/providers/gemini";
import { openaiClient } from "@/lib/ai/providers/openai";
import { AIProviderError, PROVIDER_LABELS, type ProviderClient, type ProviderKind, type ProviderOptions } from "@/lib/ai/types";
import { billableRequestsThisMonth, logUsage } from "@/lib/ai/usage";

export type MappingField = {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  options?: string[];
};

export type ColumnSample = { header: string; samples: string[] };

export type ColumnSuggestion = {
  header: string;
  field: string;
  /** 0–1. */
  confidence: number;
  /** Why, in plain words: shown as the suggestion's evidence. */
  reason: string;
};

export interface AIProvider {
  /** Shown next to suggestions, e.g. "Mock AI" or "OpenAI · gpt-6-luna". */
  readonly name: string;
  /** Throws AIUnavailableError when a real provider fails (bad key, network, bad answer). */
  suggestColumnMapping(input: { recordType: string; columns: ColumnSample[]; fields: MappingField[] }): Promise<ColumnSuggestion[]>;
}

/** A real provider call failed; the feature should carry on without AI. Message is safe to show. */
export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIUnavailableError";
  }
}

export type AIMode =
  | { kind: "mock" }
  | { kind: "live"; provider: ProviderKind; model: string }
  | { kind: "off"; reason: "disabled" | "limit" | "config" | "unreadable-key"; detail: string };

const CLIENTS: Record<ProviderKind, (o: ProviderOptions) => ProviderClient> = {
  OPENAI: openaiClient,
  GEMINI: geminiClient,
  ANTHROPIC: anthropicClient,
};

/** A client for a provider + key. Used by getAIProvider and by the Settings "Test key" button. */
export function providerClient(kind: ProviderKind, options: ProviderOptions): ProviderClient {
  return CLIENTS[kind](options);
}

type Resolved = { mode: AIMode; client?: ProviderClient };

async function resolve(ctx: WorkspaceContext, deps: { fetch?: typeof fetch; now?: Date }): Promise<Resolved> {
  if (process.env.CC_AI === "off") return { mode: { kind: "off", reason: "disabled", detail: "AI is turned off on this server." } };
  const s = await db.workspaceAISettings.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if (!s?.encryptedKey) return { mode: { kind: "mock" } };

  let key: string | null;
  try {
    key = decryptSecret(s.encryptedKey, "ai-key").value;
  } catch (e) {
    if (e instanceof EncryptionConfigError) return { mode: { kind: "off", reason: "config", detail: "The server's ENCRYPTION_KEY is missing, so the saved AI key can't be used." } };
    throw e;
  }
  if (!key) return { mode: { kind: "off", reason: "unreadable-key", detail: "The saved AI key can't be read (the server's ENCRYPTION_KEY changed). An owner needs to enter it again." } };

  if (s.monthlyRequestLimit != null) {
    const used = await billableRequestsThisMonth(ctx.workspace.id, deps.now);
    if (used >= s.monthlyRequestLimit) {
      return { mode: { kind: "off", reason: "limit", detail: `Monthly AI limit reached (${used}/${s.monthlyRequestLimit} requests). AI is off until next month.` } };
    }
  }
  return {
    mode: { kind: "live", provider: s.provider, model: s.model },
    client: providerClient(s.provider, { apiKey: key, model: s.model, fetch: deps.fetch }),
  };
}

/** What AI does in this workspace right now (for the header chip and Settings). Makes no provider calls. */
export async function getAIMode(ctx: WorkspaceContext): Promise<AIMode> {
  return (await resolve(ctx, {})).mode;
}

/** A real provider wrapped so every request is logged against the workspace. */
function live(ctx: WorkspaceContext, client: ProviderClient, now?: Date): AIProvider {
  const name = `${PROVIDER_LABELS[client.kind]} · ${client.model}`;
  const base = { workspaceId: ctx.workspace.id, provider: client.kind, model: client.model, at: now };
  return {
    name,
    async suggestColumnMapping(input) {
      const feature = "import.column-mapping";
      let result;
      try {
        result = await client.completeJSON(columnMappingRequest(input));
      } catch (e) {
        const message = e instanceof AIProviderError ? e.message : `${name} request failed.`;
        await logUsage({ ...base, feature, ok: false, error: message });
        throw new AIUnavailableError(message);
      }
      const tokens = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
      try {
        const suggestions = parseColumnMapping(result.text, input);
        await logUsage({ ...base, feature, ok: true, ...tokens });
        return suggestions;
      } catch (e) {
        await logUsage({ ...base, feature, ok: false, error: (e as Error).message, ...tokens });
        throw new AIUnavailableError(`${name}: ${(e as Error).message}`);
      }
    },
  };
}

/**
 * The AI provider for this workspace, or null when AI is off. Pass `fetch` only in tests.
 * `mode` explains the choice (e.g. why AI is off) for the UI.
 */
export async function getAIProvider(
  ctx: WorkspaceContext,
  deps: { fetch?: typeof fetch; now?: Date } = {},
): Promise<{ provider: AIProvider | null; mode: AIMode }> {
  const { mode, client } = await resolve(ctx, deps);
  if (mode.kind === "mock") return { provider: mockProvider, mode };
  if (mode.kind === "live" && client) return { provider: live(ctx, client, deps.now), mode };
  return { provider: null, mode };
}

export function describeAIMode(mode: AIMode): { label: string; detail: string } {
  switch (mode.kind) {
    case "mock": return { label: "AI: Mock", detail: "No AI key set: suggestions come from the built-in mock. An owner can add a key in Settings." };
    case "live": return { label: `AI: ${PROVIDER_LABELS[mode.provider]}`, detail: `${PROVIDER_LABELS[mode.provider]} · ${mode.model}, using this workspace's key.` };
    case "off": return { label: mode.reason === "limit" ? "AI: Limit reached" : "AI: Off", detail: mode.detail };
  }
}
