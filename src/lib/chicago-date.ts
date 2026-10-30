/*
 * The building's clock. Tudor Hall runs on America/Chicago wherever the
 * server or the browser happens to be, so every "today", "now" and
 * wall-clock → instant conversion goes through here. Plain module on
 * purpose (no `server-only`): the desk calendar, the forms and the RA report
 * all read it, and tests import it straight into node.
 *
 * Dates are "YYYY-MM-DD" strings. They are never built with
 * `new Date("YYYY-MM-DD")`, which parses as UTC midnight and slips a day in
 * Chicago; calendar math stays on UTC-constructed dates, which is
 * timezone-free.
 */

export const CHICAGO_TZ = "America/Chicago";

export type ChicagoClock = {
  /** YYYY-MM-DD on the Chicago calendar. */
  date: string;
  /** 0–23. */
  hour: number;
  /** 0–59. */
  minute: number;
};

/** The Chicago date and time of an instant (default: now). */
export function chicagoNow(at: Date = new Date()): ChicagoClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** Today's YYYY-MM-DD on the building's clock. */
export function chicagoToday(at: Date = new Date()): string {
  return chicagoNow(at).date;
}

/**
 * A Chicago wall-clock time on a date, as a real instant. Chicago is only
 * ever UTC-5 or UTC-6: try both and keep the one that round-trips, which is
 * DST-correct without a timezone library. Mirrors `desk_shift_start()` in
 * SQL (make_timestamptz ... 'America/Chicago').
 */
export function chicagoInstant(date: string, hour = 0, minute = 0): Date {
  const hh = pad2(hour);
  const mm = pad2(minute);
  for (const offset of ["-05:00", "-06:00"]) {
    const candidate = new Date(`${date}T${hh}:${mm}:00${offset}`);
    const seen = chicagoNow(candidate);
    if (seen.date === date && seen.hour === hour && seen.minute === minute) {
      return candidate;
    }
  }
  // Unreachable for America/Chicago outside the one skipped spring-forward
  // hour (2–3 AM); fail loud rather than mis-window.
  throw new Error(`Could not resolve ${date} ${hh}:${mm} in ${CHICAGO_TZ}`);
}

/** Midnight Chicago on a date, as an instant. */
export function chicagoMidnight(date: string): Date {
  return chicagoInstant(date, 0, 0);
}

// ---------------------------------------------------------------------------
// Pure calendar math — strings and UTC-constructed dates only
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" from parts — string math, no timezone conversion. */
export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** "HH:MM" from parts. */
export function timeKey(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** Add days to a YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Normalize any date to its week's Monday (weekday of a date is TZ-free). */
export function weekStartOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // getUTCDay(): 0 = Sunday … 6 = Saturday. Shift so Monday is 0 and Sunday
  // is 6, which puts Sunday at the END of its week rather than the start.
  const dayFromMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -dayFromMonday);
}

/** Shift a { year, month } (month 1–12) by +1 / -1 months. */
export function addMonths(year: number, month: number, delta: 1 | -1) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Number of days in a month (month 1–12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const MONTH_NAME = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

/** "2026-08-20" → "Aug 20". */
export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
