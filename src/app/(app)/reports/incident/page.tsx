import { createClient } from "@/lib/supabase/server";
import { chicagoNow, timeKey } from "@/lib/chicago-date";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageTitle } from "@/components/ui/typography";
import { IncidentForm, type RoomOption } from "@/components/incident-form";

export const metadata = { title: "Incident report — Tudor Hall" };

type RoomRow = {
  id: string;
  room_number: string;
  hallways: { name: string; sort_order: number } | null;
};

export default async function IncidentReportPage() {
  const supabase = await createClient();
  const { data: rooms } = await supabase
    .from("rooms")
    .select(`id, room_number, hallways ( name, sort_order )`)
    .overrideTypes<RoomRow[]>();

  const now = chicagoNow();
  const defaults = { date: now.date, time: timeKey(now.hour, now.minute) };

  const roomOptions: RoomOption[] = (rooms ?? [])
    .sort(
      (a, b) =>
        (a.hallways?.sort_order ?? 0) - (b.hallways?.sort_order ?? 0) ||
        a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
    )
    .map((r) => ({
      id: r.id,
      label: `${r.hallways?.name ?? "?"} · Room ${r.room_number}`,
    }));

  return (
    <section>
      <PageHeader back={{ href: "/", label: "TUDOR HALL" }} />

      <PageTitle>Incident report</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        Stored in the app and readable only by the Resident Director.
      </p>

      <Card variant="sheet" className="mt-6">
        <IncidentForm rooms={roomOptions} defaults={defaults} />
      </Card>
    </section>
  );
}
