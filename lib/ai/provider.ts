// The single seam for AI features. Everything AI goes through getAIProvider(ctx), so
// swapping the mock for a real model (using the workspace's own key, once AI settings
// exist) changes this file only. Callers must work when it returns null (no AI): AI only
// ever suggests, and the UI labels its output "AI Insight" with its evidence.
import type { WorkspaceContext } from "@/lib/auth/access";
import { mockProvider } from "@/lib/ai/mock";

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
  /** Shown next to suggestions, e.g. "Mock AI" or a model name. */
  readonly name: string;
  suggestColumnMapping(input: { recordType: string; columns: ColumnSample[]; fields: MappingField[] }): Promise<ColumnSuggestion[]>;
}

/**
 * The AI provider for this workspace, or null when AI isn't available.
 * Today: the built-in mock. Later: a real provider when the workspace has an AI key
 * (AI settings), and null when it has none.
 */
export async function getAIProvider(_ctx: WorkspaceContext): Promise<AIProvider | null> {
  if (process.env.CC_AI === "off") return null;
  return mockProvider;
}
