import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import { OpenStayFlow, type PersonOption, type RoomChoice } from "@/components/admin/open-stay-flow";
import { getCurrentTerm } from "@/lib/current-term";
import { compareTermsNewestFirst } from "@/lib/terms";
import type { OccupancyStatus } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { PageTitle } from "@/components/ui/typography";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

// Every person plus every stay they've had — the picker has to show the RD that
// this is the same student who lived here last year, which is the whole point of
// searching people rather than typing a name in blind.
type PersonRow = {
  id: string;
  full_name: string;
  student_id: string;
  phone: string | null;
  emergency_contact: string | null;
  occupancies: {
    id: string;
    term: string;
    occupancy_status: OccupancyStatus;
    is_archived: boolean;
    rooms: { room_number: string; hallways: { name: string } | null } | null;
  }[];
};

type RoomRow = {
  id: string;
  room_number: string;
  capacity: number;
  hallways: { name: string; sort_order: number } | null;
  // Current-term, non-archived stays only, so an archived past occupant never
  // makes a room look full.
  current_residents: { id: string }[];
};

export default async function NewStayPage() {
  // Same reason as /admin/residents: the layout's refusal does not stop this
  // page running, and its props carry every person's name and student ID.
  const staff = await getStaffContext();
  if (!staff || staff.role !== "rd") redirect("/");

  const supabase = await createClient();
  const [{ data: people }, { data: rooms }, term] = await Promise.all([
    supabase
      .from("people")
      .select(
        `id, full_name, student_id, phone, emergency_contact,
         occupancies ( id, term, occupancy_status, is_archived,
                       rooms ( room_number, hallways ( name ) ) )`,
      )
      .order("full_name")
      .overrideTypes<PersonRow[]>(),
    supabase
      .from("rooms")
      .select(
        `id, room_number, capacity,
         hallways ( name, sort_order ),
         current_residents ( id )`,
      )
      .overrideTypes<RoomRow[]>(),
    getCurrentTerm(),
  ]);

  const personOptions: PersonOption[] = (people ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    student_id: p.student_id,
    phone: p.phone ?? "",
    emergency_contact: p.emergency_contact ?? "",
    stays: [...p.occupancies]
      .sort((a, b) => compareTermsNewestFirst(a.term, b.term))
      .map((o) => ({
        id: o.id,
        term: o.term,
        occupancy_status: o.occupancy_status,
        is_archived: o.is_archived,
        room_label: `${o.rooms?.hallways?.name ?? "?"} · Room ${o.rooms?.room_number ?? "?"}`,
      })),
  }));

  const roomChoices: RoomChoice[] = (rooms ?? [])
    .sort(
      (a, b) =>
        (a.hallways?.sort_order ?? 0) - (b.hallways?.sort_order ?? 0) ||
        a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
    )
    .map((r) => ({
      id: r.id,
      label: `${r.hallways?.name ?? "?"} · Room ${r.room_number}`,
      occupants: r.current_residents.length,
      capacity: r.capacity,
    }));

  return (
    <section>
      <PageHeader back={{ href: "/admin/residents", label: "Residents" }} />

      <PageTitle>New or returning student</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        Find the student first. If they&rsquo;ve lived here before, their record
        is reused and this becomes a new, separate stay — their old one keeps its
        room, status, and inspections exactly as recorded.
      </p>

<Card variant="sheet" className="mt-6">
      {term === null && (
        <Alert tone="attention">
          No current term is set. Set one on the Residents screen first, so a new
          stay lands in the right semester.
        </Alert>
      )}

      <div className="mt-4 first:mt-0">
        <OpenStayFlow
          people={personOptions}
          rooms={roomChoices}
          currentTerm={term ?? ""}
        />
      </div>
      </Card>
    </section>
  );
}
