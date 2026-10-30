import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import {
  ResidentsManager,
  type AdminOccupancy,
  type RoomChoice,
} from "@/components/admin/residents-manager";
import { getCurrentTerm } from "@/lib/current-term";
import { compareTermsNewestFirst } from "@/lib/terms";
import type { OccupancyStatus } from "@/lib/types";
import { PageTitle } from "@/components/ui/typography";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

// Reads `occupancies` directly, not the current_residents view: this is the one
// screen that must show archived and past-term stays, since it's where they get
// archived and un-archived.
type OccupancyRow = {
  id: string;
  term: string;
  occupancy_status: OccupancyStatus;
  is_archived: boolean;
  room_id: string;
  people: {
    id: string;
    full_name: string;
    student_id: string;
    phone: string | null;
    emergency_contact: string | null;
  } | null;
  rooms: { room_number: string; hallways: { name: string } | null } | null;
  /** PostgREST aggregate: how many inspections hang off this stay. */
  inspections: { count: number }[];
};

type RoomRow = {
  id: string;
  room_number: string;
  hallways: { name: string } | null;
};

export default async function AdminResidentsPage() {
  // The admin layout hides this area from RAs, but a layout that renders a
  // refusal does not stop this page from running: its props — every
  // resident's name, student ID, phone and emergency contact — are still
  // serialised into the payload an RA receives. Gate the page itself, the
  // same way /admin/reports and /admin/submissions do.
  const staff = await getStaffContext();
  if (!staff || staff.role !== "rd") redirect("/");

  const supabase = await createClient();
  const [{ data: occupancies }, { data: rooms }, term] = await Promise.all([
    supabase
      .from("occupancies")
      .select(
        `id, term, occupancy_status, is_archived, room_id,
         people ( id, full_name, student_id, phone, emergency_contact ),
         rooms ( room_number, hallways ( name ) ),
         inspections ( count )`,
      )
      .order("term", { ascending: false })
      .overrideTypes<OccupancyRow[]>(),
    supabase
      .from("rooms")
      .select(`id, room_number, hallways ( name )`)
      .order("room_number")
      .overrideTypes<RoomRow[]>(),
    getCurrentTerm(),
  ]);

  const roomChoices: RoomChoice[] = (rooms ?? []).map((r) => ({
    id: r.id,
    label: `${r.hallways?.name ?? "?"} · Room ${r.room_number}`,
  }));

  const stays: AdminOccupancy[] = (occupancies ?? [])
    .filter((o) => o.people !== null)
    .map((o) => ({
      id: o.id,
      person_id: o.people!.id,
      full_name: o.people!.full_name,
      student_id: o.people!.student_id,
      room_id: o.room_id,
      phone: o.people!.phone ?? "",
      emergency_contact: o.people!.emergency_contact ?? "",
      term: o.term,
      occupancy_status: o.occupancy_status,
      is_archived: o.is_archived,
      // Inspections are the one dependent that blocks deletion — they are
      // deliberately NOT cascaded, so the list needs to know before it offers
      // a Delete button that the database would refuse.
      inspection_count: o.inspections?.[0]?.count ?? 0,
      room_label: `${o.rooms?.hallways?.name ?? "?"} · Room ${o.rooms?.room_number ?? "?"}`,
    }))
    // Newest term first (by year and season, not alphabetically — Spring
    // would otherwise sit above Fall), then by name.
    .sort(
      (a, b) =>
        compareTermsNewestFirst(a.term, b.term) ||
        a.full_name.localeCompare(b.full_name),
    );

  return (
    <section>
      <PageHeader back={{ href: "/admin", label: "Admin" }} />

      <PageTitle>Residents</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        A resident is a <strong>person</strong> plus a <strong>stay</strong>. A
        returning student keeps their person record and gets a new stay — their
        old one is never reused or reset.
      </p>
      <Card variant="sheet" className="mt-6">
      <div>
        <ResidentsManager
          stays={stays}
          rooms={roomChoices}
          currentTerm={term ?? ""}
        />
      </div>
      </Card>
    </section>
  );
}
