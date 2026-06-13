/** Thinking permalink slug: YYYY-MM-DD-HHMM in US Eastern time. */
const TZ = "America/New_York";

export function thinkingSlugFromDate(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}-${get("hour")}${get("minute")}`;
}

export function thinkingSlugFromIso(iso) {
  return thinkingSlugFromDate(new Date(iso));
}
