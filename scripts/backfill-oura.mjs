/**
 * Backfill Oura history into D1: the daily step counts /now/ reads (~2 years),
 * then every kind the admin Health tab draws (activity, sleep, readiness,
 * stress, SpO2, sleep sessions), 60 days a request — two years of every kind
 * in one request would outrun the Worker's CPU budget. Safe to rerun: every
 * write is an upsert.
 *
 * Run from project root: node --env-file=.env scripts/backfill-oura.mjs
 * Optional: OURA_BACKFILL_FROM=2025-06-01 to start later than the default.
 */
const API_URL = process.env.ADMIN_API_URL || "https://rommy.blog/api/admin";
const adminPassword = process.env.ADMIN_PASSWORD;
// The ring's first day in D1 is 2024-12-04; a little before it is harmless.
const FROM = process.env.OURA_BACKFILL_FROM || "2024-12-01";
const WINDOW_DAYS = 60;

if (!adminPassword) {
  console.error("Set ADMIN_PASSWORD in .env at the repo root.");
  process.exit(1);
}

async function call(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword, action: "sync-oura", ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

const steps = await call({ backfill: true });
console.log(
  `Steps: ${steps.mode} sync upserted ${steps.upserted} day(s) (${steps.start_date} → ${steps.end_date}).`
);

const totals = {};
for (let start = FROM; start <= today; start = addDays(start, WINDOW_DAYS)) {
  const end = addDays(start, WINDOW_DAYS - 1) < today ? addDays(start, WINDOW_DAYS - 1) : addDays(today, 1);
  const { counts } = await call({ start, end });
  for (const [kind, n] of Object.entries(counts || {})) totals[kind] = (totals[kind] || 0) + n;
  console.log(`${start} → ${end}: ${Object.entries(counts || {}).map(([k, n]) => `${k} ${n}`).join(", ")}`);
}
console.log(`Done. ${Object.entries(totals).map(([k, n]) => `${k} ${n}`).join(", ")}`);
