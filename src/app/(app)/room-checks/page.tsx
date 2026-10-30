import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CHICAGO_TZ } from "@/lib/chicago-date";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { PageTitle, SectionLabel } from "@/components/ui/typography";
import { PageHeader } from "@/components/ui/page-header";

// The weekly room-check workflow's front door (linked from the dashboard
// tile): every room grouped by hallway, with its most recent check and a
// direct link to start this week's. Kept deliberately plain — no orange
// here, or on week one all 84 rooms would scream "never checked".

type RoomRow = {
  id: string;
  room_number: string;
  hallways: { id: string; name: string; sort_order: number } | null;
  /** At most one row: the latest check, asked for as such in the query. */
  room_checks: { timestamp: string }[];
};

export const metadata = { title: "Room checks — Tudor Hall" };

/** Server-rendered, so the building's clock — never the server's. */
function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: CHICAGO_TZ,
    dateStyle: "medium",
  });
}

export default async function RoomChecksIndexPage() {
  const supabase = await createClient();
  // Rooms first, with ONLY the newest check embedded — not every check ever
  // taken, which grows by 84 rows a week forever.
  const { data: rooms, error } = await supabase
    .from("rooms")
    .select(
      `id, room_number, hallways ( id, name, sort_order ),
       room_checks ( timestamp )`,
    )
    .order("timestamp", { referencedTable: "room_checks", ascending: false })
    .limit(1, { referencedTable: "room_checks" })
    .overrideTypes<RoomRow[]>();

  if (error || !rooms || rooms.length === 0) {
    return (
      <section>
        <PageTitle>Room checks</PageTitle>
        <Card variant="sheet" className="mt-6">
          <Card as="p" variant="note">
            No rooms found. Apply the schema and seed data first — see
            docs/SETUP.md.
          </Card>
        </Card>
      </section>
    );
  }

  // Group by hallway in sort order, rooms in natural number order.
  const hallways = new Map<
    string,
    { id: string; name: string; sort_order: number; rooms: RoomRow[] }
  >();
  for (const room of rooms) {
    if (!room.hallways) continue;
    const entry = hallways.get(room.hallways.id) ?? { ...room.hallways, rooms: [] };
    entry.rooms.push(room);
    hallways.set(room.hallways.id, entry);
  }
  const grouped = [...hallways.values()].sort((a, b) => a.sort_order - b.sort_order);
  for (const hallway of grouped) {
    hallway.rooms.sort((a, b) =>
      a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
    );
  }

  return (
    <section>
      <PageHeader back={{ href: "/", label: "TUDOR HALL" }} />

      <PageTitle>Room checks</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        Weekly condition checks. Pick a room to record this week&rsquo;s.
      </p>

<Card variant="sheet" className="mt-6">
      {grouped.map((hallway) => (
        <div key={hallway.id} className="mt-8 first:mt-0">
          <SectionLabel>
            <Link
              href={`/hallways/${hallway.id}`}
              className="hover:text-navy hover:underline"
            >
              {hallway.name}
            </Link>
          </SectionLabel>
          <Card as="ul" variant="list" className="mt-2">
            {hallway.rooms.map((room) => {
              const lastCheck = room.room_checks[0]?.timestamp;
              return (
                <li
                  key={room.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="flex items-baseline gap-3">
                    <Link
                      href={`/rooms/${room.id}`}
                      className="text-sm font-medium hover:text-navy hover:underline"
                    >
                      Room {room.room_number}
                    </Link>
                    <span className="text-xs text-gray-500">
                      {lastCheck
                        ? `last checked ${dateOf(lastCheck)}`
                        : "never checked"}
                    </span>
                  </div>
                  <LinkButton
                    variant="outline"
                    size="sm"
                    href={`/rooms/${room.id}/checks/new`}
                  >
                    Room check
                  </LinkButton>
                </li>
              );
            })}
          </Card>
        </div>
      ))}
      </Card>
    </section>
  );
}
