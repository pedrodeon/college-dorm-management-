import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Rating } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { LocalTime } from "@/components/ui/local-time";
import { PageTitle, SectionLabel } from "@/components/ui/typography";
import { PageHeader } from "@/components/ui/page-header";
import { staffName } from "@/lib/staff-name";

type CheckDetail = {
  id: string;
  timestamp: string;
  floor_cleanliness: Rating;
  trash: Rating;
  laundry: Rating;
  overall: Rating;
  notes: string | null;
  prohibited_items: string | null;
  rooms: { id: string; room_number: string; hallways: { id: string; name: string } | null } | null;
  users: { name: string } | null;
};

const RATING_LABELS: [keyof Pick<CheckDetail, "floor_cleanliness" | "trash" | "laundry" | "overall">, string][] = [
  ["floor_cleanliness", "Floor cleanliness"],
  ["trash", "Trash"],
  ["laundry", "Laundry"],
  ["overall", "Overall"],
];

export default async function RoomCheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: check, error } = await supabase
    .from("room_checks")
    .select(
      `id, timestamp, floor_cleanliness, trash, laundry, overall, notes,
       prohibited_items,
       rooms ( id, room_number, hallways ( id, name ) ),
       users:checked_by ( name )`,
    )
    .eq("id", id)
    .single()
    .overrideTypes<CheckDetail>();

  if (error || !check || !check.rooms) notFound();
  const room = check.rooms;

  return (
    <section>
      <PageHeader back={{ href: `/rooms/${room.id}`, label: `Room ${room.room_number}` }} />

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <PageTitle>Room check</PageTitle>
        {/* Viewer's clock, hydrated client-side — no server-timezone stamp. */}
        <LocalTime iso={check.timestamp} className="text-sm text-white/60" />
      </div>
      <p className="mt-1 text-sm text-white/60">
        Room {room.room_number}
        {` · by ${staffName(check.users)}`}
      </p>

      <Card variant="sheet" className="mt-6">
      <Card as="ul" variant="list">
        {RATING_LABELS.map(([key, label]) => (
          <li key={key} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-sm font-semibold text-navy">
              {check[key]} / 5
            </span>
          </li>
        ))}
      </Card>

      {check.notes && (
        <div className="mt-4">
          <SectionLabel>Notes</SectionLabel>
          <Card as="p" variant="note" className="mt-1 whitespace-pre-wrap">
            {check.notes}
          </Card>
        </div>
      )}

      {check.prohibited_items && (
        <div className="mt-4">
          <SectionLabel>Prohibited items</SectionLabel>
          <Alert tone="attention" className="mt-1 whitespace-pre-wrap">
            {check.prohibited_items}
          </Alert>
        </div>
      )}
      </Card>
    </section>
  );
}
