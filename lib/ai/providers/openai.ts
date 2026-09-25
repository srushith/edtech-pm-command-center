// OpenAI via the Responses API (raw HTTP): JSON-schema structured output.
import { AIProviderError, httpError, REQUEST_TIMEOUT_MS, type ProviderClient, type ProviderOptions } from "@/lib/ai/types";

const API = "https://api.openai.com/v1";

type ResponsesBody = {
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function openaiClient({ apiKey, model, fetch: fetchImpl = fetch }: ProviderOptions): ProviderClient {
  const call = async (path: string, init: RequestInit = {}) => {
    try {
      return await fetchImpl(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new AIProviderError("Couldn't reach OpenAI. Check the server's network and try again.");
    }
  };
  return {
    kind: "OPENAI",
    model,
    async completeJSON(req) {
      const res = await call("/responses", {
        method: "POST",
        body: JSON.stringify({
          model,
          input: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          text: { format: { type: "json_schema", name: req.schemaName, schema: req.jsonSchema, strict: true } },
          max_output_tokens: req.maxOutputTokens,
        }),
      });
      if (!res.ok) throw await httpError("OPENAI", model, res);
      const body = (await res.json()) as ResponsesBody;
      const parts = (body.output ?? []).flatMap((o) => o.content ?? []);
      const refusal = parts.find((p) => p.type === "refusal");
      if (refusal) throw new AIProviderError(`OpenAI declined the request: ${refusal.refusal ?? "no reason given"}`);
      const text = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");
      return { text, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
    },
    async testKey() {
      const res = await call(`/models/${encodeURIComponent(model)}`);
      if (!res.ok) throw await httpError("OPENAI", model, res);
    },
  };
}
