/** Anthropic Messages API helper (Worker + scripts). */

export const ANTHROPIC_MODEL = "claude-fable-5";
export const ANTHROPIC_API_VERSION = "2023-06-01";

export function anthropicConfigured(env) {
  return Boolean(env?.ANTHROPIC_API_KEY);
}

export function extractAnthropicText(result) {
  if (!result || typeof result !== "object") return "";
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

/** Rough Fable list rates (USD per million tokens) for estimates only. */
export const ANTHROPIC_MODEL_RATES = {
  inputPerM: 10,
  outputPerM: 50,
};

export function estimateAnthropicCostUsd(usage, rates = ANTHROPIC_MODEL_RATES) {
  const input =
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  const output = usage.output_tokens || 0;
  return (input * rates.inputPerM + output * rates.outputPerM) / 1_000_000;
}

export function extractAnthropicUsage(result) {
  const usage = result?.usage;
  if (!usage || typeof usage !== "object") {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
  }
  return {
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
    cache_creation_input_tokens: Number(usage.cache_creation_input_tokens) || 0,
    cache_read_input_tokens: Number(usage.cache_read_input_tokens) || 0,
  };
}

/**
 * @param {object} env Worker env with ANTHROPIC_API_KEY
 * @param {{ system?: string, user: string, maxTokens?: number, model?: string }} opts
 */
export async function runAnthropicText(env, opts) {
  const apiKey = env?.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model: opts.model || ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system || "",
      messages: [{ role: "user", content: opts.user }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      `Anthropic API error (${res.status})`;
    throw new Error(msg);
  }

  return data;
}
