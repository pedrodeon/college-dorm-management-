import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  addDays,
  chicagoInstant,
  chicagoMidnight,
  chicagoToday,
  shortDate,
  weekStartOf,
} from "@/lib/chicago-date";
import { slotStartHour } from "@/lib/desk-shifts";

/*
 * The RA weekly report: per-RA counts of room checks and front-desk shifts
 * for one calendar week (Monday–Sunday, America/Chicago — the building's
 * clock, same as desk_shift_start()). Staff names and counts ONLY; no
 * resident data ever enters this report.
 *
 * On-demand only. The RD opens Admin → Reports and picks a week; nothing is
 * sent, scheduled, or emailed anywhere.
 *
 * Reads use the service-role key, so the ONE caller — the reports page —
 * verifies role === 'rd' before rendering. This module is `server-only`, so
 * the key cannot leak into client bundles.
 */

export type RaReportRow = {
  id: string;
  name: string;
  roomChecks: number;
  /** Shifts whose start has passed — actually worked. */
  deskShifts: number;
  /** Shifts held later this week that haven't started yet (current week
      only; always 0 for a finished week). Not counted as worked. */
  deskShiftsScheduled: number;
};

export type RaReport = {
  /** Monday, YYYY-MM-DD (Chicago calendar). */
  weekStart: string;
  /** Sunday, YYYY-MM-DD. */
  weekEnd: string;
  rows: RaReportRow[];
  totals: { roomChecks: number; deskShifts: number };
};

/** The current Chicago week's Monday — the default report week. */
export function currentChicagoWeekStart(): string {
  return weekStartOf(chicagoToday());
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

// Staff data only (room checks and desk shifts per RA); the shared admin
// client keeps the service key behind `server-only` and off any session.
const serviceClient = createAdminClient;

export async function buildRaWeeklyReport(
  weekStart: string,
  now: Date = new Date(),
): Promise<RaReport> {
  const start = weekStartOf(weekStart); // tolerate any day of the week
  const end = addDays(start, 6);
  const supabase = serviceClient();

  // Room checks are timestamptz — window on real Chicago instants.
  const fromInstant = chicagoMidnight(start).toISOString();
  const toInstant = chicagoMidnight(addDays(start, 7)).toISOString();

  const [ras, checks, shifts] = await Promise.all([
    supabase.from("users").select("id, name").eq("role", "ra").order("name"),
    supabase
      .from("room_checks")
      .select("checked_by")
      .gte("timestamp", fromInstant)
      .lt("timestamp", toInstant),
    supabase
      .from("desk_shifts")
      .select("claimed_by, shift_date, slot")
      .gte("shift_date", start)
      .lte("shift_date", end)
      .not("claimed_by", "is", null),
  ]);
  const firstError = ras.error ?? checks.error ?? shifts.error;
  if (firstError) throw new Error(`Report query failed: ${firstError.message}`);

  const countBy = (rows: Record<string, unknown>[], key: string) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const id = row[key] as string | null;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };
  const checkCounts = countBy(checks.data ?? [], "checked_by");
  // A shift claimed for later in the week is a plan, not work done — split
  // on its real start so the current week never over-reports.
  const hasStarted = (s: { shift_date: string; slot: number }) =>
    chicagoInstant(s.shift_date, slotStartHour(s.slot)) <= now;
  const started = (shifts.data ?? []).filter(hasStarted);
  const upcoming = (shifts.data ?? []).filter((s) => !hasStarted(s));
  const shiftCounts = countBy(started, "claimed_by");
  const scheduledCounts = countBy(upcoming, "claimed_by");

  // Every RA appears — zeros are the report's point as much as the numbers.
  const rows: RaReportRow[] = (ras.data ?? []).map((ra) => ({
    id: ra.id,
    name: ra.name,
    roomChecks: checkCounts.get(ra.id) ?? 0,
    deskShifts: shiftCounts.get(ra.id) ?? 0,
    deskShiftsScheduled: scheduledCounts.get(ra.id) ?? 0,
  }));

  return {
    weekStart: start,
    weekEnd: end,
    rows,
    totals: {
      roomChecks: rows.reduce((n, r) => n + r.roomChecks, 0),
      deskShifts: rows.reduce((n, r) => n + r.deskShifts, 0),
    },
  };
}

/** "Aug 16 – Aug 22, 2026" */
export function weekLabel(report: Pick<RaReport, "weekStart" | "weekEnd">): string {
  return `${shortDate(report.weekStart)} – ${shortDate(report.weekEnd)}, ${report.weekEnd.slice(0, 4)}`;
}
