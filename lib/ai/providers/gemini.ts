// Gemini via generateContent (raw HTTP). JSON output mode; the caller validates the shape.
import { AIProviderError, httpError, REQUEST_TIMEOUT_MS, type ProviderClient, type ProviderOptions } from "@/lib/ai/types";

const API = "https://generativelanguage.googleapis.com/v1beta";

type GenerateBody = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

export function geminiClient({ apiKey, model, fetch: fetchImpl = fetch }: ProviderOptions): ProviderClient {
  const modelPath = `models/${encodeURIComponent(model.replace(/^models\//, ""))}`;
  const call = async (path: string, init: RequestInit = {}) => {
    try {
      return await fetchImpl(`${API}/${path}`, {
        ...init,
        // Header, not a query parameter, so the key never lands in URLs or logs.
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json", ...init.headers },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new AIProviderError("Couldn't reach Gemini. Check the server's network and try again.");
    }
  };
  return {
    kind: "GEMINI",
    model,
    async completeJSON(req) {
      const res = await call(`${modelPath}:generateContent`, {
        method: "POST",
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `${req.system}\n\nRespond with JSON matching this JSON Schema:\n${JSON.stringify(req.jsonSchema)}` }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: req.maxOutputTokens },
        }),
      });
      if (!res.ok) throw await httpError("GEMINI", model, res);
      const body = (await res.json()) as GenerateBody;
      if (body.promptFeedback?.blockReason) throw new AIProviderError(`Gemini blocked the request (${body.promptFeedback.blockReason}).`);
      const cand = body.candidates?.[0];
      if (cand?.finishReason && !["STOP", "MAX_TOKENS"].includes(cand.finishReason)) {
        throw new AIProviderError(`Gemini stopped early (${cand.finishReason}).`);
      }
      const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      return { text, inputTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0 };
    },
    async testKey() {
      const res = await call(modelPath);
      if (!res.ok) throw await httpError("GEMINI", model, res);
    },
  };
}
