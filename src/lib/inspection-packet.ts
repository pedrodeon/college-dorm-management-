import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadInspectionRecord,
  recordComplete,
  sortedItems,
  type InspectionRecord,
} from "@/lib/inspection-record";
import { PHOTO_BUCKET } from "@/lib/photos";
import { staffName } from "@/lib/staff-name";
import type {
  InspectionPdfData,
  PdfPhoto,
  PdfSignature,
} from "@/lib/inspection-pdf";
import { checkedInInRoomOrder } from "@/lib/packet-format";
import { gateProgress, type GateInspection } from "@/lib/occupancy-gate";

/*
 * Turning stored records into printable ones.
 *
 * `toPdfData` is what the single-resident export has always done, lifted out
 * of its route so the hallway packet feeds the renderer through exactly the
 * same function. One loader, one mapper, one template: a packet page and a
 * single-resident page are produced by identical code, which is the only way
 * "identical to the individual export" stays true as this changes.
 *
 * Everything here reads through the CALLER'S client — rows under their RLS,
 * blobs under their storage policies. There is no service-role path: a
 * packet can only ever contain records its requester could already open one
 * at a time.
 */

/** How many images are fetched from storage at once for one record. */
const DOWNLOAD_CONCURRENCY = 4;

/** `Promise.all` with at most `limit` tasks in flight; results keep order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** One stored record, resolved into the renderer's input (images included). */
export async function toPdfData(
  supabase: SupabaseClient,
  inspection: InspectionRecord & {
    rooms: NonNullable<InspectionRecord["rooms"]>;
    occupancies: NonNullable<InspectionRecord["occupancies"]>;
  },
): Promise<InspectionPdfData> {
  const download = async (path: string): Promise<Buffer | null> => {
    const { data } = await supabase.storage.from(PHOTO_BUCKET).download(path);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  };

  const resident = inspection.occupancies.people;
  const items = sortedItems(inspection);
  const waiver = inspection.inspection_signature_waivers;

  const signatures: PdfSignature[] = await mapLimit(
    inspection.inspection_signatures,
    DOWNLOAD_CONCURRENCY,
    async (s) => ({
      role: s.role,
      signedAt: s.signed_at,
      signerName:
        s.role === "resident"
          ? (resident?.full_name ?? "Resident")
          : staffName(s.captured),
      png: await download(s.storage_path),
    }),
  );

  const photos: PdfPhoto[] = await mapLimit(
    items.flatMap((item) =>
      item.inspection_photos.map((p) => ({ itemName: item.item_name, path: p.storage_path })),
    ),
    DOWNLOAD_CONCURRENCY,
    async (p) => ({ itemName: p.itemName, jpeg: await download(p.path) }),
  );

  return {
    // `periodic` never reaches here: both routes refuse it before calling.
    type: inspection.type as "move_in" | "move_out",
    residentName: resident?.full_name ?? "—",
    studentId: resident?.student_id ?? "—",
    roomNumber: inspection.rooms.room_number,
    hallwayName: inspection.rooms.hallways?.name ?? "—",
    term: inspection.occupancies.term,
    inspectedAt: inspection.timestamp,
    inspectorName: staffName(inspection.users),
    items: items.map((i) => ({
      name: i.item_name,
      condition: i.condition,
      note: i.note,
    })),
    inspectionNote: inspection.notes,
    photos,
    signatures,
    // Everything recorded prints, including a waiver beside a signature the
    // resident gave later; the renderer decides where each goes.
    waiver: waiver
      ? {
          reason: waiver.reason,
          recordedBy: staffName(waiver.users),
          recordedAt: waiver.created_at,
        }
      : null,
  };
}

export type HallwayCheckins =
  | {
      kind: "found";
      hallwayName: string;
      /** Ordered by room number. One per stay that is `checked_in` right now
          and has a complete, signed move-in. */
      inspectionIds: string[];
    }
  /** No such hallway (or none the caller may see). */
  | { kind: "not_found" }
  /** A query failed. Distinct from an empty hallway: "nothing to print" and
      "couldn't look" must never read the same. */
  | { kind: "error" };

/**
 * Which move-in records belong in a hallway's packet.
 *
 * The packet answers "who is living here right now", so a stay qualifies
 * only while its status is `checked_in` at the moment of generation.
 * `expected` never arrived; `checked_out` has left, whether at the end of
 * term or by moving to another building, and printing their move-in record
 * alongside the current residents misrepresents who the hallway holds.
 *
 * `current_residents` supplies the other two halves of "right now" — it is
 * already scoped to the current term and to stays that are not archived — so
 * status is the only filter this has to apply itself.
 *
 * That also settles the awkward case by itself: someone who checked out of
 * one room and into another in this same hallway has two non-archived stays
 * this term (the partial unique index allows it, since only one of them is
 * active), and exactly one of them is `checked_in`. They appear once, under
 * the room they actually live in.
 *
 * A `checked_in` stay whose move-in inspection is somehow unsigned is
 * skipped rather than printed half-formed — record_occupancy makes that
 * impossible going forward, so it would only ever be legacy data. A stay
 * with several move-in inspections (an abandoned first attempt plus the
 * signed one) contributes the one the gate would pick: fully signed, then
 * newest. The probe count is therefore exactly the number of records the
 * packet will contain.
 */
export async function collectHallwayCheckins(
  supabase: SupabaseClient,
  hallwayId: string,
): Promise<HallwayCheckins> {
  const { data: hallway, error: hallwayError } = await supabase
    .from("hallways")
    .select("id, name")
    .eq("id", hallwayId)
    .maybeSingle();
  if (hallwayError) return { kind: "error" };
  if (!hallway) return { kind: "not_found" };

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("room_number, current_residents ( id, occupancy_status )")
    .eq("hallway_id", hallwayId)
    .overrideTypes<
      {
        room_number: string;
        current_residents: { id: string; occupancy_status: string }[];
      }[]
    >();
  if (roomsError) return { kind: "error" };

  const checkedIn = checkedInInRoomOrder(rooms ?? []);

  if (checkedIn.length === 0) {
    return { kind: "found", hallwayName: hallway.name, inspectionIds: [] };
  }

  const { data: inspections, error: inspectionsError } = await supabase
    .from("inspections")
    .select(
      `id, occupancy_id, type, timestamp,
       inspection_signatures ( role ), inspection_signature_waivers ( id )`,
    )
    .eq("type", "move_in")
    .in(
      "occupancy_id",
      checkedIn.map((c) => c.occupancyId),
    )
    .overrideTypes<(GateInspection & { occupancy_id: string })[]>();
  if (inspectionsError) return { kind: "error" };

  const byStay = new Map<string, GateInspection[]>();
  for (const i of inspections ?? []) {
    const list = byStay.get(i.occupancy_id) ?? [];
    list.push(i);
    byStay.set(i.occupancy_id, list);
  }

  const inspectionIds = checkedIn
    .map((c) => gateProgress(byStay.get(c.occupancyId) ?? [], "move_in"))
    .filter((p): p is NonNullable<typeof p> => p !== null && p.signatures === 2)
    .map((p) => p.inspectionId);

  return { kind: "found", hallwayName: hallway.name, inspectionIds };
}

/** Load and resolve one record, or null if it isn't a printable one. */
export async function loadPrintableRecord(
  supabase: SupabaseClient,
  inspectionId: string,
): Promise<InspectionPdfData | null> {
  const record = await loadInspectionRecord(supabase, inspectionId);
  if (
    !record ||
    !record.rooms ||
    !record.occupancies ||
    record.type === "periodic" ||
    !recordComplete(record)
  ) {
    return null;
  }
  return toPdfData(
    supabase,
    record as InspectionRecord & {
      rooms: NonNullable<InspectionRecord["rooms"]>;
      occupancies: NonNullable<InspectionRecord["occupancies"]>;
    },
  );
}

/**
 * The packet's records, one at a time: each is loaded (images included)
 * only when the renderer asks for it, so a hallway of twenty rooms never
 * holds twenty rooms' photos in memory at once. Unprintable ids are skipped,
 * exactly as `loadPrintableRecord` would answer for them individually.
 */
export async function* printableRecords(
  supabase: SupabaseClient,
  inspectionIds: string[],
): AsyncGenerator<InspectionPdfData> {
  for (const id of inspectionIds) {
    const record = await loadPrintableRecord(supabase, id);
    if (record) yield record;
  }
}
