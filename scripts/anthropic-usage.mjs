/**
 * Print Anthropic API usage logged by the Worker (D1 anthropic_usage table).
 * Run from project root: node --env-file=.env scripts/anthropic-usage.mjs
 *
 * Optional days argument (default 30): node --env-file=.env scripts/anthropic-usage.mjs 7
 */
import { d1Configured, d1Query } from "./d1-client.mjs";
import { getAnthropicUsageSummary } from "./lib/anthropic-usage.mjs";

const API_URL = process.env.ADMIN_API_URL || "https://rommy.blog/api/admin";
const adminPassword = process.env.ADMIN_PASSWORD;
const daysArg = Number(process.argv[2]);
const days = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 30;

function fmtUsd(n) {
  return `$${Number(n || 0).toFixed(4)}`;
}

function fmtTokens(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function printSummary(data) {
  const { totals, byFeature, recent } = data;

  console.log(`Anthropic usage (last ${days} days, since ${data.since})\n`);
  console.log(
    `Total: ${totals.calls} call(s), ${fmtTokens(totals.input_tokens)} input + ${fmtTokens(totals.output_tokens)} output tokens`
  );
  console.log(`Estimated cost: ${fmtUsd(totals.estimated_cost_usd)} (Opus list rates, approximate)\n`);

  if (byFeature.length) {
    console.log("By feature:");
    for (const row of byFeature) {
      console.log(
        `  ${row.feature}: ${row.calls} call(s), ${fmtTokens(row.input_tokens)} in / ${fmtTokens(row.output_tokens)} out, ~${fmtUsd(row.estimated_cost_usd)}`
      );
    }
    console.log("");
  }

  if (recent.length) {
    console.log("Recent calls:");
    for (const row of recent) {
      const ctx = row.context ? ` (${row.context})` : "";
      console.log(
        `  ${row.created_at}  ${row.feature}${ctx}  ${fmtTokens(row.input_tokens)} in / ${fmtTokens(row.output_tokens)} out`
      );
    }
  } else {
    console.log("No logged calls in this window yet.");
    console.log("Past calls before logging was enabled are not included.");
  }
}

let data;

if (d1Configured()) {
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async all() {
              const results = await d1Query(sql, params);
              return { results };
            },
          };
        },
      };
    },
  };
  data = await getAnthropicUsageSummary(db, { days });
} else {
  if (!adminPassword) {
    console.error("Set ADMIN_PASSWORD in .env, or CF_ACCOUNT_ID / CF_API_TOKEN / CF_D1_DATABASE_ID for direct D1 access.");
    process.exit(1);
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: adminPassword,
      action: "anthropic-usage-summary",
      days,
    }),
  });

  data = await res.json();
  if (!res.ok) {
    console.error(data.error || `Request failed (${res.status})`);
    process.exit(1);
  }
}

printSummary(data);
