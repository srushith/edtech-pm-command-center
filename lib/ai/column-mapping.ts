// Column mapping as a JSON request any provider can answer, plus strict checking of the
// answer: unknown columns/fields are dropped and each field is used at most once.
import { z } from "zod";
import type { ColumnSample, ColumnSuggestion, MappingField } from "@/lib/ai/provider";
import type { JsonRequest } from "@/lib/ai/types";

const Answer = z.object({
  suggestions: z.array(
    z.object({
      header: z.string(),
      field: z.string(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

// Written out by hand: OpenAI's strict mode needs every property required and no extras.
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["header", "field", "confidence", "reason"],
        properties: {
          header: { type: "string", description: "A column header exactly as given" },
          field: { type: "string", description: "A field name exactly as given" },
          confidence: { type: "number", description: "0 to 1" },
          reason: { type: "string", description: "One short sentence citing the header and sample values" },
        },
      },
    },
  },
};

export function columnMappingRequest(input: { recordType: string; columns: ColumnSample[]; fields: MappingField[] }): JsonRequest {
  return {
    system:
      `You map spreadsheet columns to the fields of a "${input.recordType}" record in an education program management app. ` +
      "Suggest a field for a column only when its header and sample values clearly fit; leave other columns out. " +
      "Use each field at most once. Use header and field names exactly as given. A person will review every suggestion.",
    user: JSON.stringify({
      columns: input.columns.map((c) => ({ header: c.header, samples: c.samples.slice(0, 3) })),
      fields: input.fields.map((f) => ({ name: f.name, label: f.label, kind: f.kind, required: f.required, ...(f.options ? { options: f.options } : {}) })),
    }),
    schemaName: "column_mapping",
    jsonSchema: JSON_SCHEMA,
    maxOutputTokens: 4096,
  };
}

/** Parse and sanitize a provider's answer. Throws if it isn't the expected JSON. */
export function parseColumnMapping(text: string, input: { columns: ColumnSample[]; fields: MappingField[] }): ColumnSuggestion[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The model's answer wasn't valid JSON.");
  }
  const parsed = Answer.safeParse(raw);
  if (!parsed.success) throw new Error("The model's answer didn't match the expected shape.");
  const headers = new Set(input.columns.map((c) => c.header));
  const fields = new Set(input.fields.map((f) => f.name));
  const usedHeaders = new Set<string>();
  const usedFields = new Set<string>();
  return parsed.data.suggestions
    .filter((s) => headers.has(s.header) && fields.has(s.field))
    .map((s) => ({ ...s, confidence: Math.min(1, Math.max(0, s.confidence)), reason: s.reason.slice(0, 300) }))
    .sort((a, b) => b.confidence - a.confidence)
    .filter((s) => {
      if (usedHeaders.has(s.header) || usedFields.has(s.field)) return false;
      usedHeaders.add(s.header);
      usedFields.add(s.field);
      return true;
    });
}
