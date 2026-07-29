import { estimateAnthropicCostUsd } from "./anthropic.mjs";

export async function getAnthropicUsageSummary(db, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { results: totals } = await db
    .prepare(
      `SELECT
         COUNT(*) AS calls,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
         COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens
       FROM anthropic_usage
       WHERE created_at >= ?`
    )
    .bind(since)
    .all();

  const { results: byFeature } = await db
    .prepare(
      `SELECT
         feature,
         COUNT(*) AS calls,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM anthropic_usage
       WHERE created_at >= ?
       GROUP BY feature
       ORDER BY calls DESC, feature ASC`
    )
    .bind(since)
    .all();

  const { results: recent } = await db
    .prepare(
      `SELECT created_at, feature, context, model, input_tokens, output_tokens
       FROM anthropic_usage
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .bind(since)
    .all();

  const totalUsage = totals?.[0] || {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  return {
    days,
    since,
    totals: {
      calls: Number(totalUsage.calls) || 0,
      input_tokens: Number(totalUsage.input_tokens) || 0,
      output_tokens: Number(totalUsage.output_tokens) || 0,
      cache_creation_input_tokens: Number(totalUsage.cache_creation_input_tokens) || 0,
      cache_read_input_tokens: Number(totalUsage.cache_read_input_tokens) || 0,
      estimated_cost_usd: estimateAnthropicCostUsd(totalUsage),
    },
    byFeature: (byFeature || []).map((row) => ({
      feature: row.feature,
      calls: Number(row.calls) || 0,
      input_tokens: Number(row.input_tokens) || 0,
      output_tokens: Number(row.output_tokens) || 0,
      estimated_cost_usd: estimateAnthropicCostUsd(row),
    })),
    recent: recent || [],
  };
}
