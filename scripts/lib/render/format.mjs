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

// ── Dates as readers see them (ET). Each section has its own form:
//   Thinking  27 Nov 2026 // 21:10   (formatMbDate)
//   Writing   21 Nov 2026       (formatDayMonthYear)
//   Sharing   27 Nov 2026       (formatDayMonthYear)
//   Reading   Nov 2026          (formatMonthYear)
// Machine-readable dates (datetime attributes, sorting, URLs) stay ISO.
// Month names are spelled out here rather than taken from Intl, whose en-GB
// short form for September is "Sept" in current ICU and "Sep" in older ones.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const etDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "2026-11-27" → "27 Nov 2026" (a date string, no time zone shift). */
export function dayMonthYearFromIsoDay(isoDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDay || ""));
  if (!m) return String(isoDay || "");
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "2026-10" (or "2026-10-…") → "Oct 2026". */
export function formatMonthYear(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ""));
  if (!m) return String(ym || "");
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** A Writing post or Sharing link → "21 Nov 2026", its ET day. */
export const formatDayMonthYear = (p) => dayMonthYearFromIsoDay(toETDate(p));

/** A Thinking note's time → "27 Nov 2026 // 21:10" in ET. */
export const formatMbDate = (iso) => {
  const d = new Date(iso);
  return `${dayMonthYearFromIsoDay(etDateFmt.format(d))} // ${etTimeFmt.format(d)}`;
};

export function readingMins(bodyHtml) {
  const words = String(bodyHtml || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
