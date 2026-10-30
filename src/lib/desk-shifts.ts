/*
 * Front-desk shift slots — the app-side mirror of desk_shift_start() in the
 * database (supabase/migrations/20260802164833_desk_shifts.sql). Two fixed
 * evening shifts, one RA each. If these windows ever change, change both
 * places together.
 */

// This module imports nothing on purpose: tests/desk-schedule.test.mjs loads
// it straight into node, which resolves neither the "@/" alias nor an
// extensionless relative import. Instant math lives in lib/chicago-date.ts;
// callers compose the two: chicagoInstant(date, slotStartHour(slot)).

export type ShiftSlot = 1 | 2;

export const SHIFT_SLOTS = [
  { slot: 1 as ShiftSlot, label: "6–8 PM", short: "6–8", startHour: 18 },
  { slot: 2 as ShiftSlot, label: "8–10 PM", short: "8–10", startHour: 20 },
] as const;

/** The Chicago wall-clock hour a slot starts (18 or 20). Pair it with
    chicagoInstant() for the real start — the same instant as
    desk_shift_start() in SQL. */
export function slotStartHour(slot: number): number {
  return SHIFT_SLOTS.find((s) => s.slot === slot)?.startHour ?? 18;
}

/*
 * WHICH NIGHTS THE DESK IS STAFFED — the single source for that rule.
 *
 * The calendar renders from this and the server actions refuse from it, so
 * there is exactly one place to edit when the schedule changes. Keys are
 * JavaScript weekdays (0 = Sunday … 6 = Saturday).
 *
 * This governs what can be NEWLY claimed or assigned. It deliberately does
 * NOT govern what displays: a shift someone already holds keeps rendering
 * and stays releasable, coverable and clearable even after its night leaves
 * the schedule. Dropping Wednesday must not erase who worked last Wednesday.
 */
export const DESK_SCHEDULE: Readonly<Record<number, readonly ShiftSlot[]>> = {
  0: [], // Sunday
  1: [1, 2], // Monday
  2: [2], // Tuesday — late shift only
  3: [], // Wednesday
  4: [1, 2], // Thursday
  5: [1, 2], // Friday
  6: [], // Saturday
};

/** Weekday of a "YYYY-MM-DD" date. Local construction — never `new
    Date(string)`, which parses as UTC and slips a day in Chicago. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** The slots that can be claimed on this date — empty on an off night. */
export function slotsOn(date: string): readonly ShiftSlot[] {
  return DESK_SCHEDULE[weekdayOf(date)] ?? [];
}

/** Can this date/slot be newly claimed or assigned at all? */
export function isShiftAllowed(date: string, slot: number): boolean {
  return slotsOn(date).some((s) => s === slot);
}

/** The refusal both the server actions and the tests speak. */
export function scheduleRefusal(date: string, slot: number): string {
  const label =
    SHIFT_SLOTS.find((s) => s.slot === slot)?.label ?? `slot ${slot}`;
  return `The desk isn't staffed ${WEEKDAY_SHORT[weekdayOf(date)]} at ${label}. ${scheduleSummary()}.`;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The schedule as one sentence, grouped by nights that share the same slots:
 * "Mon, Thu, Fri: 6–8 PM and 8–10 PM · Tue: 8–10 PM · no shifts Wed, Sat,
 * Sun". Derived rather than written out, so the header can't drift from
 * DESK_SCHEDULE.
 */
export function scheduleSummary(): string {
  const byNightPattern = new Map<string, number[]>();
  // Monday first — the way a week's schedule is read.
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const key = (DESK_SCHEDULE[day] ?? []).join(",");
    const existing = byNightPattern.get(key);
    if (existing) existing.push(day);
    else byNightPattern.set(key, [day]);
  }

  const parts: string[] = [];
  let offNights: number[] = [];
  for (const [key, days] of byNightPattern) {
    const names = days.map((d) => WEEKDAY_SHORT[d]).join(", ");
    if (key === "") {
      offNights = days;
      continue;
    }
    const labels = key
      .split(",")
      .map((s) => SHIFT_SLOTS.find((x) => x.slot === Number(s))?.label ?? s);
    parts.push(`${names}: ${labels.join(" and ")}`);
  }
  if (offNights.length > 0) {
    parts.push(
      `no shifts ${offNights.map((d) => WEEKDAY_SHORT[d]).join(", ")}`,
    );
  }
  return parts.join(" · ");
}

/** "2026-08" → { year, month } (month 1–12), or null if malformed. */
export function parseMonthParam(
  value: string | undefined,
): { year: number; month: number } | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

export function monthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-08-20" + slot → "Aug 20 · 8–10 PM". String parsing on purpose:
 * `new Date("2026-08-20")` is UTC midnight and shifts a day in Chicago.
 */
export function shiftLabel(date: string, slot: number): string {
  const [, m, d] = date.split("-").map(Number);
  const slotLabel = SHIFT_SLOTS.find((s) => s.slot === slot)?.label ?? `slot ${slot}`;
  return `${MONTH_SHORT[m - 1]} ${d} · ${slotLabel}`;
}
