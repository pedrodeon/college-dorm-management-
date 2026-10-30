import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import { DeskShiftCalendar } from "@/components/desk-shift-calendar";
import {
  addMonths,
  chicagoToday,
  daysInMonth,
  MONTH_NAME,
} from "@/lib/chicago-date";
import {
  monthParam,
  parseMonthParam,
  scheduleSummary,
} from "@/lib/desk-shifts";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageTitle, SectionLabel } from "@/components/ui/typography";

export const metadata = { title: "Front Desk — Tudor Hall" };

type ShiftRow = {
  shift_date: string;
  slot: number;
  claimed_by: string | null;
  coverage_requested_at: string | null;
};
type StaffRow = { id: string; name: string; role: string };

export default async function FrontDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthQuery } = await searchParams;
  // The building's clock, not the server's: "today" and the default month
  // must not roll over at 7 PM Chicago because the host runs on UTC.
  const now = new Date();
  const todayKey = chicagoToday(now);
  const { year, month } = parseMonthParam(monthQuery) ?? {
    year: Number(todayKey.slice(0, 4)),
    month: Number(todayKey.slice(5, 7)),
  };

  const staffContext = await getStaffContext();
  const supabase = await createClient();
  const first = `${monthParam(year, month)}-01`;
  const last = `${monthParam(year, month)}-${daysInMonth(year, month)}`;

  const [{ data: shifts }, { data: staff }] = await Promise.all([
    supabase
      .from("desk_shifts")
      .select("shift_date, slot, claimed_by, coverage_requested_at")
      .gte("shift_date", first)
      .lte("shift_date", last)
      .overrideTypes<ShiftRow[]>(),
    supabase
      .from("users")
      .select("id, name, role")
      .order("name")
      .overrideTypes<StaffRow[]>(),
  ]);

  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);

  return (
    <section>
      <PageHeader back={{ href: "/", label: "TUDOR HALL" }} />

      <PageTitle>Front Desk</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        {scheduleSummary()}. Tap an open slot to claim it; shifts lock 24 hours
        before they start.
      </p>

      <Card variant="sheet" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <SectionLabel>
            {MONTH_NAME[month - 1]} {year}
          </SectionLabel>
          <div className="flex gap-2">
            <LinkButton
              variant="subtle"
              size="sm"
              href={`/front-desk?month=${monthParam(prev.year, prev.month)}`}
              aria-label="Previous month"
            >
              ‹ Prev
            </LinkButton>
            <LinkButton
              variant="subtle"
              size="sm"
              href={`/front-desk?month=${monthParam(next.year, next.month)}`}
              aria-label="Next month"
            >
              Next ›
            </LinkButton>
          </div>
        </div>

        <DeskShiftCalendar
          year={year}
          month={month}
          shifts={shifts ?? []}
          staff={staff ?? []}
          meId={staffContext?.id ?? null}
          isRd={staffContext?.role === "rd"}
          nowMs={now.getTime()}
          todayKey={todayKey}
        />
      </Card>
    </section>
  );
}
