/**
 * Small formatting helpers shared by the build and the live overlay. Pure,
 * and free of Node built-ins, so the Worker can bundle them.
 */

export function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const safeSlug = (s) => String(s).replace(/[^a-zA-Z0-9-_]/g, "");

export const stripHashtags = (s) => String(s).replace(/\s*#\S+/g, "").trim();

export function linkDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// YYYY-MM-DD in ET, derived from p.datetime when available
export function toETDate(p) {
  const d = p.datetime ? new Date(p.datetime) : new Date(`${p.date}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

// Microblog dates/times shown in ET
const etDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const formatMbDate = (iso) => {
  const d = new Date(iso);
  return `${etDateFmt.format(d)} // ${etTimeFmt.format(d)}`;
};

export function readingMins(bodyHtml) {
  const words = String(bodyHtml || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
