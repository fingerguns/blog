import {
  ANTHROPIC_OPUS_MODEL,
  extractAnthropicUsage,
} from "../scripts/lib/anthropic.mjs";
import { getAnthropicUsageSummary } from "../scripts/lib/anthropic-usage.mjs";

export { getAnthropicUsageSummary };

export async function logAnthropicUsage(db, { feature, context, result, model }) {
  if (!db || !feature || !result) return null;

  const usage = extractAnthropicUsage(result);
  const modelId = model || result.model || ANTHROPIC_OPUS_MODEL;
  const contextLabel = context ? String(context) : null;

  console.log(
    `anthropic usage ${feature}${contextLabel ? ` (${contextLabel})` : ""}: ` +
      `in=${usage.input_tokens} out=${usage.output_tokens} model=${modelId}`
  );

  try {
    await db
      .prepare(
        `INSERT INTO anthropic_usage (
          created_at, feature, context, model,
          input_tokens, output_tokens,
          cache_creation_input_tokens, cache_read_input_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        new Date().toISOString(),
        feature,
        contextLabel,
        modelId,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_creation_input_tokens,
        usage.cache_read_input_tokens
      )
      .run();
  } catch (err) {
    console.error("anthropic usage log failed:", err?.message || err);
  }

  return usage;
}
