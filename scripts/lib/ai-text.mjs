/** Extract plain text from a Workers AI run() result. */
export const WORKERS_AI_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export function extractAiText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result?.response === "string") return result.result.response;
  if (typeof result?.text === "string") return result.text;
  if (Array.isArray(result?.choices)?.[0]?.message?.content) {
    return result.choices[0].message.content;
  }
  return "";
}

export function stripCodeFences(text) {
  return String(text || "")
    .replace(/^```(?:html|markdown|text)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}
