import { createClient } from "@/lib/supabase/server";
import { DeskConsole, type DeskResident } from "@/components/desk-console";
import { gateProgress } from "@/lib/occupancy-gate";
import type { OccupancyStatus } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/typography";
import { PageHeader } from "@/components/ui/page-header";

// A row of the current_residents view: `id` is the occupancy id, which is also
// what the inspections embed and every RPC key on.
type ResidentRow = {
  id: string;
  full_name: string;
  student_id: string;
  room_id: string;
  occupancy_status: OccupancyStatus;
  rooms: {
    room_number: string;
    hallways: { id: string; name: string } | null;
  } | null;
  inspections: {
    id: string;
    type: string;
    timestamp: string;
    inspection_signatures: { role: string }[];
    inspection_signature_waivers: { id: string } | null;
  }[];
};

export const metadata = { title: "Check in / out — Tudor Hall" };

export default async function DeskPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("current_residents")
    .select(
      `id, full_name, student_id, room_id, occupancy_status,
       rooms ( room_number, hallways ( id, name ) ),
       inspections ( id, type, timestamp, inspection_signatures ( role ),
                     inspection_signature_waivers ( id ) )`,
    )
    .order("full_name")
    .overrideTypes<ResidentRow[]>();

  const residents: DeskResident[] = (data ?? [])
    .filter((r) => r.rooms?.hallways)
    .map((r) => ({
      id: r.id,
      full_name: r.full_name,
      student_id: r.student_id,
      room_id: r.room_id,
      room_number: r.rooms!.room_number,
      hallway_id: r.rooms!.hallways!.id,
      hallway_name: r.rooms!.hallways!.name,
      occupancy_status: r.occupancy_status,
      // Shared with the resident screen — see src/lib/occupancy-gate.ts.
      move_in: gateProgress(r.inspections, "move_in"),
      move_out: gateProgress(r.inspections, "move_out"),
    }));

  return (
    <section>
      <PageHeader back={{ href: "/", label: "TUDOR HALL" }} />

      <PageTitle>Check in / out</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        Search any resident to record a check-in or check-out.
      </p>

      <Card variant="sheet" className="mt-6">
      {error ? (
        <Card as="p" variant="note">
          Couldn’t load residents. Apply the schema and seed data — see
          docs/SETUP.md.
        </Card>
      ) : (
        <DeskConsole residents={residents} />
      )}
      </Card>
    </section>
  );
}
