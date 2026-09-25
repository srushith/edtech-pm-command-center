// Per-workspace AI usage: logging and the monthly request count (UTC calendar month).
import { db } from "@/lib/db";

export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export type UsageRecord = {
  workspaceId: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  ok: boolean;
  error?: string | null;
  isTest?: boolean;
  at?: Date;
};

export async function logUsage(r: UsageRecord): Promise<void> {
  await db.aIUsageEvent.create({
    data: {
      workspaceId: r.workspaceId, feature: r.feature, provider: r.provider, model: r.model,
      inputTokens: r.inputTokens ?? 0, outputTokens: r.outputTokens ?? 0, ok: r.ok,
      error: r.error?.slice(0, 300) ?? null, isTest: r.isTest ?? false, ...(r.at ? { createdAt: r.at } : {}),
    },
  });
}

/** Requests that count toward the monthly limit: real-provider calls this month, excluding key tests. */
export async function billableRequestsThisMonth(workspaceId: string, now = new Date()): Promise<number> {
  return db.aIUsageEvent.count({ where: { workspaceId, isTest: false, createdAt: { gte: monthStart(now) } } });
}
