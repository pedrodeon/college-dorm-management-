import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import { getCurrentTerm } from "@/lib/current-term";
import { StatusChip } from "@/components/ui/status-chip";
import { OccupancyGate } from "@/components/occupancy-gate";
import { ReassignRoom, type RoomOption } from "@/components/reassign-room";
import { gateProgress, type GateInspection } from "@/lib/occupancy-gate";
import type { OccupancyStatus } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageTitle, SectionLabel } from "@/components/ui/typography";
import { PageHeader } from "@/components/ui/page-header";
import { staffName } from "@/lib/staff-name";

// The route id is an OCCUPANCY id — one stay. Read from the occupancies table
// rather than the current_residents view: a past or archived stay must stay
// reachable, because that's where dispute history lives.
type StayDetail = {
  id: string;
  term: string;
  occupancy_status: OccupancyStatus;
  is_present: boolean;
  is_archived: boolean;
  room_id: string;
  people: {
    id: string;
    full_name: string;
    student_id: string;
    phone: string | null;
    emergency_contact: string | null;
    // Every stay this person has had, this one included.
    occupancies: {
      id: string;
      term: string;
      occupancy_status: OccupancyStatus;
      is_archived: boolean;
      rooms: { room_number: string; hallways: { name: string } | null } | null;
    }[];
  } | null;
  rooms: {
    id: string;
    room_number: string;
    hallways: { id: string; name: string } | null;
  } | null;
  inspections: (GateInspection & { timestamp: string })[];
};

type OccupancyRow = {
  id: string;
  type: string;
  timestamp: string;
  note: string | null;
  users: { name: string } | null;
};
type PresenceRow = {
  id: string;
  status: string;
  timestamp: string;
  note: string | null;
  users: { name: string } | null;
};
type RoomChangeRow = {
  id: string;
  timestamp: string;
  reason: string | null;
  from_room: { room_number: string } | null;
  to_room: { room_number: string } | null;
  users: { name: string } | null;
};

const STATUS_LABEL: Record<OccupancyStatus, string> = {
  expected: "expected",
  checked_in: "checked in",
  checked_out: "checked out",
};

function fmt(ts: string) {
  return new Date(ts).toLocaleString();
}

export default async function ResidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const staff = await getStaffContext();
  const isRd = staff?.role === "rd";

  const [
    { data: stay, error },
    { data: occupancy },
    { data: presence },
    { data: roomChanges },
    { data: rooms },
    currentTerm,
  ] = await Promise.all([
    supabase
      .from("occupancies")
      .select(
        `id, term, occupancy_status, is_present, is_archived, room_id,
         people ( id, full_name, student_id, phone, emergency_contact,
                  occupancies ( id, term, occupancy_status, is_archived,
                                rooms ( room_number, hallways ( name ) ) ) ),
         rooms ( id, room_number, hallways ( id, name ) ),
         inspections ( id, type, timestamp, inspection_signatures ( role ),
                       inspection_signature_waivers ( id ) )`,
      )
      .eq("id", id)
      .single()
      .overrideTypes<StayDetail>(),
    supabase
      .from("occupancy_events")
      .select(`id, type, timestamp, note, users:recorded_by ( name )`)
      .eq("occupancy_id", id)
      .order("timestamp", { ascending: false })
      .overrideTypes<OccupancyRow[]>(),
    supabase
      .from("presence_events")
      .select(`id, status, timestamp, note, users:recorded_by ( name )`)
      .eq("occupancy_id", id)
      .order("timestamp", { ascending: false })
      .overrideTypes<PresenceRow[]>(),
    supabase
      .from("room_change_events")
      .select(
        `id, timestamp, reason,
         from_room:from_room_id ( room_number ),
         to_room:to_room_id ( room_number ),
         users:changed_by ( name )`,
      )
      .eq("occupancy_id", id)
      .order("timestamp", { ascending: false })
      .overrideTypes<RoomChangeRow[]>(),
    // Room list for reassignment (RD only needs it, but cheap to always load).
    isRd
      ? supabase
          .from("rooms")
          .select(`id, room_number, hallways ( name )`)
          .order("room_number")
      : Promise.resolve({ data: null }),
    getCurrentTerm(),
  ]);

  if (error || !stay || !stay.rooms || !stay.people) notFound();

  const room = stay.rooms;
  const person = stay.people;
  const otherStays = person.occupancies
    .filter((o) => o.id !== stay.id)
    .sort((a, b) => b.term.localeCompare(a.term));

  // A stay outside the current term, or archived, is read-only history: the
  // occupancy action would be meaningless, and set_presence refuses archived
  // stays anyway.
  const isHistoric =
    stay.is_archived || (currentTerm !== null && stay.term !== currentTerm);

  const gateResident = {
    id: stay.id,
    full_name: person.full_name,
    room_id: stay.room_id,
    hallway_id: room.hallways?.id ?? null,
  };
  const lastCheckOut = (occupancy ?? []).find((e) => e.type === "check_out")
    ?.timestamp;
  const moveOutInspectionId = gateProgress(
    stay.inspections,
    "move_out",
  )?.inspectionId;

  // The stay's move-in / move-out records, oldest first. "Complete" mirrors
  // record_occupancy's signature gate: RA half plus resident half or waiver.
  const inspectionRecords = stay.inspections
    .filter((i) => i.type === "move_in" || i.type === "move_out")
    .map((i) => {
      const roles = new Set(i.inspection_signatures.map((sig) => sig.role));
      return {
        id: i.id,
        type: i.type,
        timestamp: i.timestamp,
        complete:
          roles.has("ra") &&
          (roles.has("resident") || i.inspection_signature_waivers !== null),
      };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const roomOptions: RoomOption[] = (
    (rooms as { id: string; room_number: string; hallways: { name: string } | null }[] | null) ?? []
  ).map((r) => ({
    id: r.id,
    label: `${r.hallways?.name ?? "?"} · Room ${r.room_number}`,
  }));

  return (
    <section>
      <PageHeader back={{ href: `/rooms/${room.id}`, label: `Room ${room.room_number}` }} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <PageTitle>{person.full_name}</PageTitle>
        <StatusChip status={stay.occupancy_status} isPresent={stay.is_present} />
        <span className="text-sm text-white/60">{stay.term}</span>
      </div>

<Card variant="sheet" className="mt-6">
      {isHistoric && (
        <Alert tone="attention" className="mt-3">
          {stay.is_archived
            ? "This stay is archived."
            : `This stay is from ${stay.term}, not the current term.`}{" "}
          It&rsquo;s kept for history and can&rsquo;t be acted on.
        </Alert>
      )}

      {/* Record — contacts belong to the person, room and status to the stay. */}
      <Card as="dl" variant="box" className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Student ID</dt>
          <dd className="font-mono">{person.student_id}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Room</dt>
          <dd>
            {room.hallways?.name} · {room.room_number}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Phone</dt>
          <dd>{person.phone ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Emergency contact</dt>
          <dd>{person.emergency_contact ?? "—"}</dd>
        </div>
      </Card>

      {/* Occupancy — the per-stay check-in / check-out action, driven by this
          stay's status. It also owns the move-in / move-out inspections, since
          each brackets one stay; weekly room checks stay on the room screen. */}
      {!isHistoric && (
        <div className="mt-6">
          <SectionLabel>Occupancy</SectionLabel>
          <Card variant="box" className="mt-2">
            {stay.occupancy_status === "expected" && (
              <OccupancyGate
                variant="primary"
                flow="move_in"
                progress={gateProgress(stay.inspections, "move_in")}
                resident={gateResident}
              />
            )}
            {stay.occupancy_status === "checked_in" && (
              <OccupancyGate
                variant="primary"
                flow="move_out"
                progress={gateProgress(stay.inspections, "move_out")}
                resident={gateResident}
              />
            )}
            {stay.occupancy_status === "checked_out" && (
              <div className="text-sm">
                <p className="font-medium text-gray-700">
                  Checked out
                  {lastCheckOut ? ` ${fmt(lastCheckOut)}` : ""}.
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  This stay is complete. If they come back, the RD opens a new
                  stay for the new term — this one is never reopened.
                </p>
                {moveOutInspectionId && (
                  <Link
                    href={`/inspections/${moveOutInspectionId}`}
                    className="mt-2 inline-block text-xs font-medium text-navy hover:underline"
                  >
                    View move-out inspection →
                  </Link>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* A completed stay keeps its room: moving it would rewrite where
          the resident lived, and reassign_room refuses it anyway. */}
      {isRd && !isHistoric && stay.occupancy_status !== "checked_out" && (
        <div className="mt-4">
          <ReassignRoom
            occupancyId={stay.id}
            currentRoomId={stay.room_id}
            rooms={roomOptions}
          />
        </div>
      )}

      {/* Inspections — the stay's move-in / move-out records. A COMPLETE one
          (both signature halves, or the move-out waiver) exports as the PDF
          liability document; the API route re-checks the same gate. */}
      {inspectionRecords.length > 0 && (
        // The anchor Admin -> Residents links to when it explains why a stay
        // with inspections can't be deleted.
        <div className="mt-8 scroll-mt-4" id="inspections">
          <SectionLabel>Inspections</SectionLabel>
          <Card as="ul" variant="list" className="mt-2">
            {inspectionRecords.map((rec) => (
              <li
                key={rec.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {rec.type === "move_in" ? "Move-in" : "Move-out"} inspection
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {fmt(rec.timestamp)}
                    {rec.complete ? "" : " · awaiting signatures"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/inspections/${rec.id}`}
                    className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-chip"
                  >
                    View full record
                  </Link>
                  {rec.complete && (
                    <a
                      href={`/api/inspections/${rec.id}/pdf`}
                      className="rounded-full border border-navy px-3.5 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-navy hover:text-white"
                    >
                      Download PDF
                    </a>
                  )}
                </div>
              </li>
            ))}
          </Card>
        </div>
      )}

      {/* Other stays — the payoff of the split: the same person's other terms,
          each with its own inspections and events still intact. */}
      <div className="mt-8">
        <SectionLabel>Other stays</SectionLabel>
        {otherStays.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            This is {person.full_name}&rsquo;s only stay on record.
          </p>
        ) : (
          <Card as="ul" variant="list" className="mt-2">
            {otherStays.map((other) => (
              <li key={other.id}>
                <Link
                  href={`/residents/${other.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5 hover:bg-gray-50"
                >
                  <span className="text-sm font-medium">{other.term}</span>
                  <span className="text-xs text-gray-500">
                    {other.rooms?.hallways?.name ?? "?"} · Room{" "}
                    {other.rooms?.room_number ?? "?"} ·{" "}
                    {STATUS_LABEL[other.occupancy_status]}
                    {other.is_archived ? " · archived" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </Card>
        )}
      </div>

      {/* Histories — all three scoped to THIS stay. */}
      <History
        title="Occupancy history"
        empty="No check-in / check-out yet."
        rows={(occupancy ?? []).map((e) => ({
          id: e.id,
          label: e.type === "check_in" ? "Checked in" : "Checked out",
          when: fmt(e.timestamp),
          by: staffName(e.users),
          note: e.note,
        }))}
      />
      <History
        title="Presence history"
        empty="No presence changes recorded."
        rows={(presence ?? []).map((e) => ({
          id: e.id,
          label: e.status === "away" ? "Marked away" : "Marked returned",
          when: fmt(e.timestamp),
          by: staffName(e.users),
          note: e.note,
        }))}
      />
      <History
        title="Room-change history"
        empty="No room changes."
        rows={(roomChanges ?? []).map((e) => ({
          id: e.id,
          label: `Moved ${e.from_room ? `from ${e.from_room.room_number} ` : ""}to ${e.to_room?.room_number}`,
          when: fmt(e.timestamp),
          by: staffName(e.users),
          note: e.reason,
        }))}
      />
      </Card>
    </section>
  );
}

type HistoryRow = {
  id: string;
  label: string;
  when: string;
  by: string | null;
  note: string | null;
};

function History({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: HistoryRow[];
}) {
  return (
    <div className="mt-8">
      <SectionLabel>{title}</SectionLabel>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{empty}</p>
      ) : (
        <Card as="ul" variant="list" className="mt-2">
          {rows.map((row) => (
            <li key={row.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-xs text-gray-500">
                  {row.when}
                  {row.by ? ` · ${row.by}` : ""}
                </span>
              </div>
              {row.note && (
                <p className="mt-0.5 text-xs text-gray-500">{row.note}</p>
              )}
            </li>
          ))}
        </Card>
      )}
    </div>
  );
}
