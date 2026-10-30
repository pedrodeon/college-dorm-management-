import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import { StatCard } from "@/components/ui/stat-card";
import { ActionTile } from "@/components/ui/action-tile";
import { Card, CardLink } from "@/components/ui/card";
import { CardTitle } from "@/components/ui/typography";
import { HighlightMark, SquareBadge } from "@/components/ui/badge";
import type { Hallway } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { ResidentSearch } from "@/components/resident-search";
import { hallwayAbbrev } from "@/lib/hallway-label";

// Nested shape returned by the dashboard query below.
type HallwayWithCounts = Hallway & {
  rooms: {
    current_residents: { occupancy_status: string; is_present: boolean }[];
  }[];
  hallway_assignments: { users: { name: string } | null }[];
};

function countsFor(hallway: HallwayWithCounts) {
  const residents = hallway.rooms.flatMap((room) => room.current_residents);
  return {
    checkedIn: residents.filter((r) => r.occupancy_status === "checked_in")
      .length,
    expected: residents.filter((r) => r.occupancy_status === "expected").length,
    away: residents.filter(
      (r) => r.occupancy_status === "checked_in" && !r.is_present,
    ).length,
  };
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function Dashboard() {
  const supabase = await createClient();
  const staff = await getStaffContext();
  // current_residents, not occupancies: the view already limits this to the
  // current term's non-archived stays, so past semesters can't inflate a count.
  const { data: hallways, error } = await supabase
    .from("hallways")
    .select(
      `id, name, wing, floor, section, sort_order,
       rooms ( current_residents ( occupancy_status, is_present ) ),
       hallway_assignments ( users ( name ) )`,
    )
    .order("sort_order")
    .overrideTypes<HallwayWithCounts[]>();

  const firstName = staff?.name.trim().split(/\s+/)[0] ?? "there";

  if (error || !hallways || hallways.length === 0) {
    return (
      <Greeting lead={`${greeting()}, ${firstName}`}>
        <Card variant="glassQuiet" className="text-sm text-white/70">
          No hallways found. Apply the schema and seed data first — see
          docs/SETUP.md.
        </Card>
      </Greeting>
    );
  }

  // Building-wide totals for the hero stat — aggregated from the rows already
  // fetched, no extra query. "In the building" is checked in MINUS away, the
  // same arithmetic the hallway tiles use: during a break the headline must
  // not read 100% with half the hall gone. The roster is everyone expected
  // this term plus everyone checked in; a completed stay is nobody to count.
  const totals = hallways.reduce(
    (acc, h) => {
      const c = countsFor(h);
      acc.checkedIn += c.checkedIn;
      acc.expected += c.expected;
      acc.away += c.away;
      return acc;
    },
    { checkedIn: 0, expected: 0, away: 0 },
  );
  const inBuilding = totals.checkedIn - totals.away;
  const roster = totals.checkedIn + totals.expected;
  const pct = roster > 0 ? Math.round((inBuilding / roster) * 100) : 0;

  return (
    <Greeting lead={`${greeting()}, ${firstName}`}>
      {/* Hero stat */}
      <StatCard
        label="In the building"
        value={inBuilding}
        max={roster}
        pct={pct}
        caption={
          <>
            {pct}% of the roster is in the building
            {totals.away > 0 && ` · ${totals.away} away`}
            {totals.expected > 0 && ` · ${totals.expected} not yet arrived`}
          </>
        }
      />

      {/* Quick actions — four identical tiles: one even row on wide screens,
          a clean 2x2 on phones. Check-in/out is deliberately NOT here:
          occupancy actions start from the resident (room -> resident), not
          from a building-wide shortcut. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ActionTile href="/front-desk" label="Front Desk">
          <CalendarClockIcon />
        </ActionTile>
        <ActionTile href="/room-checks" label="Room checks">
          <ChecklistIcon />
        </ActionTile>
        <ActionTile href="/reports/incident" label="Incident report">
          <AlertTriangleIcon />
        </ActionTile>
        <ActionTile href="/maintenance/new" label="Maintenance">
          <WrenchIcon />
        </ActionTile>
      </div>

      {/* Hallways card */}
      <Card variant="panel">
        <CardTitle>Hallways</CardTitle>
        <ul className="mt-3 flex flex-col gap-2.5">
          {hallways.map((hallway) => {
            const counts = countsFor(hallway);
            const coveredBy = hallway.hallway_assignments
              .map((a) => a.users?.name)
              .filter(Boolean);
            return (
              <li key={hallway.id}>
                <CardLink variant="row" href={`/hallways/${hallway.id}`}>
                  <SquareBadge>{hallwayAbbrev(hallway)}</SquareBadge>
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{hallway.name}</p>
                    <p className="mt-0.5 truncate text-sm text-gray-500">
                      {counts.checkedIn} in · {counts.expected} expected
                      {counts.away > 0 && (
                        <span className="font-medium text-ink">
                          {" · "}
                          <HighlightMark>{counts.away} away</HighlightMark>
                        </span>
                      )}
                      {coveredBy.length > 0 && ` · ${coveredBy.join(", ")}`}
                    </p>
                  </div>
                </CardLink>
              </li>
            );
          })}
        </ul>
      </Card>
    </Greeting>
  );
}

/** The dashboard's canvas-zone lead line + gap-5 stack (ex-NavyShell). */
function Greeting({
  lead,
  children,
}: {
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <PageHeader />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-white/70">{lead}</p>
        <ResidentSearch />
      </div>
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </section>
  );
}

function CalendarClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M16 2v4M8 2v4M3 10h18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="17" r="4.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M17 15.2V17l1.4 1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 9v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h1.5M4 12h1.5M4 18h1.5M9 6h11M9 12h11M9 18h11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
