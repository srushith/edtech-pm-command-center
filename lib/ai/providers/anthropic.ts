// Anthropic via the official SDK (@anthropic-ai/sdk): JSON-schema structured output.
import Anthropic from "@anthropic-ai/sdk";
import { AIProviderError, REQUEST_TIMEOUT_MS, type ProviderClient, type ProviderOptions } from "@/lib/ai/types";

// Server-side refusal fallback (reroutes a declined request inside the same call) is
// available for these models; see the Anthropic docs on refusals and fallbacks.
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1"]);
// Effort is accepted by current Opus/Sonnet/Fable models; older ones (e.g. Haiku 4.5) reject it.
const supportsEffort = (model: string) => /^claude-(opus|sonnet|fable|mythos)-(5|4-[6-9])/.test(model);

function toProviderError(e: unknown, model: string): AIProviderError {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new AIProviderError(`Anthropic rejected the API key: ${e.message}`, e.status);
  }
  if (e instanceof Anthropic.NotFoundError) return new AIProviderError(`Anthropic has no model "${model}" for this key.`, 404);
  if (e instanceof Anthropic.RateLimitError) return new AIProviderError("Anthropic rate limit or quota reached. Try again later.", 429);
  if (e instanceof Anthropic.APIConnectionError) return new AIProviderError("Couldn't reach Anthropic. Check the server's network and try again.");
  if (e instanceof Anthropic.APIError) return new AIProviderError(`Anthropic returned an error (${e.status}): ${e.message.slice(0, 200)}`, e.status);
  return new AIProviderError("Anthropic request failed.");
}

export function anthropicClient({ apiKey, model, fetch: fetchImpl }: ProviderOptions): ProviderClient {
  const client = new Anthropic({ apiKey, fetch: fetchImpl, maxRetries: 1, timeout: REQUEST_TIMEOUT_MS });
  return {
    kind: "ANTHROPIC",
    model,
    async completeJSON(req) {
      try {
        const fallback = FALLBACK_MODELS.has(model);
        const response = await client.beta.messages.create({
          model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: {
            format: { type: "json_schema", schema: req.jsonSchema },
            // A short matching task: low effort keeps it fast without changing the model.
            ...(supportsEffort(model) ? { effort: "low" as const } : {}),
          },
          ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        });
        if (response.stop_reason === "refusal") throw new AIProviderError("Anthropic declined the request.");
        const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      } catch (e) {
        throw e instanceof AIProviderError ? e : toProviderError(e, model);
      }
    },
    async testKey() {
      try {
        await client.models.retrieve(model);
      } catch (e) {
        throw toProviderError(e, model);
      }
    },
  };
}
