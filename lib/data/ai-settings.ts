// Workspace AI settings and usage. Every member can see the mode, provider, model and
// usage; only owners see the masked key and change anything. The API key is encrypted on
// save and never included in anything returned from here.
import "server-only";
import { requireRole, type WorkspaceContext } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/roles";
import { describeAIMode, getAIMode, providerClient, type AIMode } from "@/lib/ai/provider";
import { AIProviderError, DEFAULT_MODELS, PROVIDER_KINDS, PROVIDER_LABELS, type ProviderKind } from "@/lib/ai/types";
import { billableRequestsThisMonth, logUsage, monthStart } from "@/lib/ai/usage";
import { decryptSecret, encryptSecret, EncryptionConfigError, hasEncryptionKey, maskSecret } from "@/lib/crypto";
import { db } from "@/lib/db";

export type UsageMonth = { month: string; requests: number; inputTokens: number; outputTokens: number };

export type AISettingsView = {
  mode: AIMode;
  modeLabel: string;
  modeDetail: string;
  provider: ProviderKind;
  model: string;
  hasKey: boolean;
  /** "••••a1b2", owners only; null for everyone else. */
  keyMasked: string | null;
  monthlyRequestLimit: number | null;
  lastTest: { at: Date; ok: boolean; message: string | null } | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  canEdit: boolean;
  encryptionReady: boolean;
  usage: {
    thisMonth: UsageMonth & { billable: number; errors: number; tests: number };
    byFeature: { feature: string; requests: number; tokens: number }[];
    history: UsageMonth[];
  };
  defaults: Record<ProviderKind, string>;
};

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export async function getAISettingsView(ctx: WorkspaceContext, now = new Date()): Promise<AISettingsView> {
  const workspaceId = ctx.workspace.id;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const [s, mode, events, billable] = await Promise.all([
    db.workspaceAISettings.findUnique({
      where: { workspaceId },
      select: {
        provider: true, model: true, keyLast4: true, encryptedKey: true, monthlyRequestLimit: true,
        lastTestedAt: true, lastTestOk: true, lastTestMessage: true, updatedAt: true,
        updatedBy: { select: { name: true, email: true } },
      },
    }),
    getAIMode(ctx),
    db.aIUsageEvent.findMany({
      where: { workspaceId, createdAt: { gte: since } },
      select: { feature: true, inputTokens: true, outputTokens: true, ok: true, isTest: true, createdAt: true },
    }),
    billableRequestsThisMonth(workspaceId, now),
  ]);
  const isOwner = ctx.role === "OWNER";
  const current = monthKey(monthStart(now));
  const history = new Map<string, UsageMonth>();
  for (let i = 5; i >= 0; i--) {
    const m = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
    history.set(m, { month: m, requests: 0, inputTokens: 0, outputTokens: 0 });
  }
  const byFeature = new Map<string, { feature: string; requests: number; tokens: number }>();
  let errors = 0;
  let tests = 0;
  for (const e of events) {
    const h = history.get(monthKey(e.createdAt));
    if (h) {
      h.requests++;
      h.inputTokens += e.inputTokens;
      h.outputTokens += e.outputTokens;
    }
    if (monthKey(e.createdAt) === current) {
      if (!e.ok) errors++;
      if (e.isTest) tests++;
      const f = byFeature.get(e.feature) ?? { feature: e.feature, requests: 0, tokens: 0 };
      f.requests++;
      f.tokens += e.inputTokens + e.outputTokens;
      byFeature.set(e.feature, f);
    }
  }
  const described = describeAIMode(mode);
  const provider = s?.provider ?? "OPENAI";
  return {
    mode,
    modeLabel: described.label,
    modeDetail: described.detail,
    provider,
    model: s?.model ?? DEFAULT_MODELS[provider],
    hasKey: !!s?.encryptedKey,
    keyMasked: isOwner && s?.encryptedKey ? maskSecret(s.keyLast4) : null,
    monthlyRequestLimit: s?.monthlyRequestLimit ?? null,
    lastTest: s?.lastTestedAt ? { at: s.lastTestedAt, ok: !!s.lastTestOk, message: s.lastTestMessage } : null,
    updatedBy: s?.updatedBy ? (s.updatedBy.name ?? s.updatedBy.email) : null,
    updatedAt: s?.updatedAt ?? null,
    canEdit: isOwner,
    encryptionReady: hasEncryptionKey(),
    usage: {
      thisMonth: { ...history.get(current)!, billable, errors, tests },
      byFeature: [...byFeature.values()].sort((a, b) => b.requests - a.requests),
      history: [...history.values()],
    },
    defaults: DEFAULT_MODELS,
  };
}

export type AISettingsInput = {
  provider: string;
  model: string;
  /** Blank keeps the saved key. */
  apiKey: string;
  /** Blank means no limit. */
  monthlyRequestLimit: string;
};

function parseProvider(v: string): ProviderKind {
  if (!(PROVIDER_KINDS as string[]).includes(v)) throw new AccessError("Choose OpenAI, Gemini or Anthropic.");
  return v as ProviderKind;
}

function parseModel(v: string): string {
  const m = v.trim();
  if (!m) throw new AccessError("Enter a model name.");
  if (m.length > 100 || !/^[\w.\-:/]+$/.test(m)) throw new AccessError("That doesn't look like a model name (letters, digits, . - _ : / only).");
  return m;
}

function parseKey(v: string): string | null {
  const k = v.trim();
  if (!k) return null;
  if (k.length < 8 || k.length > 500 || /\s/.test(k)) throw new AccessError("That doesn't look like an API key.");
  return k;
}

function parseLimit(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new AccessError("The monthly limit must be a whole number from 1 to 1,000,000, or blank for no limit.");
  return n;
}

export async function saveAISettings(ctx: WorkspaceContext, input: AISettingsInput): Promise<void> {
  requireRole(ctx, "OWNER", "Changing AI settings");
  const provider = parseProvider(input.provider);
  const model = parseModel(input.model);
  const apiKey = parseKey(input.apiKey);
  const monthlyRequestLimit = parseLimit(input.monthlyRequestLimit);
  const existing = await db.workspaceAISettings.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if (existing?.encryptedKey && existing.provider !== provider && !apiKey) {
    throw new AccessError(`Enter the ${PROVIDER_LABELS[provider]} API key: the saved key is for ${PROVIDER_LABELS[existing.provider]}.`);
  }
  let keyFields = {};
  if (apiKey) {
    try {
      keyFields = { encryptedKey: encryptSecret(apiKey, "ai-key"), keyLast4: apiKey.slice(-4), lastTestedAt: null, lastTestOk: null, lastTestMessage: null };
    } catch (e) {
      if (e instanceof EncryptionConfigError) throw new AccessError(e.message);
      throw e;
    }
  }
  const data = { provider, model, monthlyRequestLimit, updatedById: ctx.user.id, ...keyFields };
  await db.workspaceAISettings.upsert({ where: { workspaceId: ctx.workspace.id }, create: { workspaceId: ctx.workspace.id, ...data }, update: data });
}

export async function removeAIKey(ctx: WorkspaceContext): Promise<void> {
  requireRole(ctx, "OWNER", "Removing the AI key");
  await db.workspaceAISettings.updateMany({
    where: { workspaceId: ctx.workspace.id },
    data: { encryptedKey: null, keyLast4: null, lastTestedAt: null, lastTestOk: null, lastTestMessage: null, updatedById: ctx.user.id },
  });
}

/**
 * Check a key (the one just typed, or the saved one) can use the model. Uses no tokens;
 * logged as a test and never counted toward the monthly limit. Records the result when
 * the saved key was tested.
 */
export async function testAIKey(
  ctx: WorkspaceContext,
  input: { provider: string; model: string; apiKey: string },
  deps: { fetch?: typeof fetch; now?: Date } = {},
): Promise<{ ok: boolean; message: string }> {
  requireRole(ctx, "OWNER", "Testing the AI key");
  const provider = parseProvider(input.provider);
  const model = parseModel(input.model);
  const typed = parseKey(input.apiKey);
  let key = typed;
  const saved = await db.workspaceAISettings.findUnique({ where: { workspaceId: ctx.workspace.id } });
  if (!key) {
    if (!saved?.encryptedKey) throw new AccessError("Enter an API key to test.");
    if (saved.provider !== provider) throw new AccessError(`The saved key is for ${PROVIDER_LABELS[saved.provider]}. Enter a ${PROVIDER_LABELS[provider]} key to test it.`);
    try {
      key = decryptSecret(saved.encryptedKey, "ai-key").value;
    } catch (e) {
      if (e instanceof EncryptionConfigError) throw new AccessError(e.message);
      throw e;
    }
    if (!key) throw new AccessError("The saved key can't be read (ENCRYPTION_KEY changed). Enter it again.");
  }

  let result: { ok: boolean; message: string };
  try {
    await providerClient(provider, { apiKey: key, model, fetch: deps.fetch }).testKey();
    result = { ok: true, message: `Key works: ${PROVIDER_LABELS[provider]} can use ${model}.` };
  } catch (e) {
    if (!(e instanceof AIProviderError)) throw e;
    result = { ok: false, message: e.message };
  }
  await logUsage({
    workspaceId: ctx.workspace.id, feature: "settings.test-key", provider, model,
    ok: result.ok, error: result.ok ? null : result.message, isTest: true, at: deps.now,
  });
  if (!typed && saved) {
    await db.workspaceAISettings.update({
      where: { workspaceId: ctx.workspace.id },
      data: { lastTestedAt: deps.now ?? new Date(), lastTestOk: result.ok, lastTestMessage: result.message },
    });
  }
  return result;
}
