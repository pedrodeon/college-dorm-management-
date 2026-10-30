import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth";
import { addDays, weekStartOf } from "@/lib/chicago-date";
import {
  buildRaWeeklyReport,
  currentChicagoWeekStart,
  weekLabel,
} from "@/lib/ra-report";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageTitle, SectionLabel } from "@/components/ui/typography";

export const metadata = { title: "RA reports — Tudor Hall" };

/**
 * RD-only. An on-demand screen and nothing else: open it, pick a week, read
 * the counts. The app sends no email and runs no schedule.
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // The admin layout hides this area from RAs, but this page reads with the
  // service key, so it gates itself too — the report must never even render
  // into the payload for a non-RD session.
  const staff = await getStaffContext();
  if (!staff || staff.role !== "rd") redirect("/");

  const { week } = await searchParams;
  const thisWeek = currentChicagoWeekStart();
  const weekStart =
    week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStartOf(week) : thisWeek;

  const report = await buildRaWeeklyReport(weekStart);
  const isCurrentWeek = report.weekStart === thisWeek;
  // Weeks that haven't happened yet can only report zeros, so the walk stops
  // at the current one — but a hand-typed future ?week= still renders, and
  // says what it is rather than calling itself "this week".
  const isFutureWeek = report.weekStart > thisWeek;
  const atOrPastCurrent = isCurrentWeek || isFutureWeek;

  return (
    <section>
      <PageHeader back={{ href: "/admin", label: "Admin" }} />

      <PageTitle>RA weekly report</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        Room checks and front-desk shifts per RA, Monday–Sunday. Staff counts
        only — no resident data.
      </p>

      <Card variant="sheet" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <SectionLabel>
            Week of {weekLabel(report)}
            {isCurrentWeek ? " (this week)" : isFutureWeek ? " (upcoming)" : ""}
          </SectionLabel>
          <div className="flex flex-wrap gap-2">
            <LinkButton
              variant="subtle"
              size="sm"
              href={`/admin/reports?week=${addDays(report.weekStart, -7)}`}
            >
              ‹ Prev
            </LinkButton>
            {atOrPastCurrent ? (
              <span
                className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-faint"
                aria-disabled="true"
              >
                Next ›
              </span>
            ) : (
              <LinkButton
                variant="subtle"
                size="sm"
                href={`/admin/reports?week=${addDays(report.weekStart, 7)}`}
              >
                Next ›
              </LinkButton>
            )}
            {!isCurrentWeek && (
              <LinkButton variant="outline" size="sm" href="/admin/reports">
                This week
              </LinkButton>
            )}
          </div>
        </div>

        <Card as="div" variant="list" className="mt-4">
          <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <span>RA</span>
            {/* Narrow columns on phones: at 320 the wide pair pushed the
                labels out past the card's own edge. */}
            <span className="flex gap-3 sm:gap-6">
              <span className="w-14 text-right sm:w-24">Room checks</span>
              <span className="w-14 text-right sm:w-24">Desk shifts</span>
            </span>
          </div>
          {report.rows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">
              No RA accounts yet.
            </p>
          ) : (
            report.rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {row.name}
                  </span>
                  {/* The empty row is the point of the report — mark it so a
                      week of nothing reads at a glance. */}
                  {row.roomChecks === 0 && row.deskShifts === 0 && (
                    <Badge tone="attention">no activity</Badge>
                  )}
                </span>
                {/* ml-auto keeps the counts under their headings when a long
                    name + chip wraps them onto their own line. */}
                <span className="ml-auto flex gap-3 text-sm text-ink sm:gap-6">
                  <span className="w-14 text-right sm:w-24">
                    {row.roomChecks}
                  </span>
                  <span className="w-14 text-right sm:w-24">
                    {row.deskShifts}
                    {/* Held but not yet started — a plan, not work done. */}
                    {row.deskShiftsScheduled > 0 && (
                      <span className="block text-[11px] font-normal leading-tight text-faint">
                        +{row.deskShiftsScheduled} scheduled
                      </span>
                    )}
                  </span>
                </span>
              </div>
            ))
          )}
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <span className="text-sm font-bold text-navy">Total</span>
            <span className="flex gap-3 text-sm font-bold text-navy sm:gap-6">
              <span className="w-14 text-right sm:w-24">
                {report.totals.roomChecks}
              </span>
              <span className="w-14 text-right sm:w-24">
                {report.totals.deskShifts}
              </span>
            </span>
          </div>
        </Card>
      </Card>
    </section>
  );
}
