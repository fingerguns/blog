/** Anthropic Messages API helper (Worker + scripts). */

export const ANTHROPIC_OPUS_MODEL = "claude-opus-5";
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
      model: opts.model || ANTHROPIC_OPUS_MODEL,
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
