import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * The ONE loader for a full inspection record. Both consumers — the
 * read-only record view (/inspections/[id]) and the PDF export
 * (/api/inspections/[id]/pdf) — read through this, so the screen and the
 * document can never disagree about what the record contains. Read-only by
 * nature: it only ever runs SELECTs through the caller's RLS-scoped client.
 */

export type InspectionRecord = {
  id: string;
  type: "move_in" | "move_out" | "periodic";
  timestamp: string;
  notes: string | null;
  rooms: {
    id: string;
    room_number: string;
    hallways: { id: string; name: string } | null;
  } | null;
  // The occupancies TABLE, not the current_residents view: a dispute may be
  // read years later, when that stay is archived or from a past term, and
  // the record must still name who it was about.
  occupancies: {
    id: string;
    occupancy_status: string;
    term: string;
    people: { full_name: string; student_id: string } | null;
  } | null;
  /** Who conducted it — the only staff member who may sign the RA half. */
  inspected_by: string | null;
  users: { name: string } | null;
  inspection_signatures: {
    role: "resident" | "ra";
    storage_path: string;
    signed_at: string;
    captured: { name: string } | null;
  }[];
  inspection_signature_waivers: {
    reason: string;
    created_at: string;
    users: { name: string } | null;
  } | null;
  inspection_items: {
    id: string;
    /** The template item's name AS OF the inspection: renaming the template
        later never relabels a signed snapshot. */
    item_name: string;
    condition: "good" | "fair" | "damaged" | "missing";
    note: string | null;
    inventory_items: { name: string; sort_order: number } | null;
    inspection_photos: { id: string; storage_path: string }[];
  }[];
};

export async function loadInspectionRecord(
  supabase: SupabaseClient,
  id: string,
): Promise<InspectionRecord | null> {
  const { data, error } = await supabase
    .from("inspections")
    .select(
      `id, type, timestamp, notes, inspected_by,
       rooms ( id, room_number, hallways ( id, name ) ),
       occupancies ( id, occupancy_status, term, people ( full_name, student_id ) ),
       users:inspected_by ( name ),
       inspection_signatures ( role, storage_path, signed_at, captured:captured_by ( name ) ),
       inspection_signature_waivers ( reason, created_at, users:waived_by ( name ) ),
       inspection_items ( id, item_name, condition, note,
                          inventory_items ( name, sort_order ),
                          inspection_photos ( id, storage_path ) )`,
    )
    .eq("id", id)
    .single()
    .overrideTypes<InspectionRecord>();

  return error ? null : (data as InspectionRecord);
}

/** Items in template order — the order the sheet and the PDF both print. */
export function sortedItems(record: InspectionRecord) {
  return [...record.inspection_items].sort(
    (a, b) =>
      (a.inventory_items?.sort_order ?? 0) - (b.inventory_items?.sort_order ?? 0),
  );
}

/**
 * The completeness gate for a loaded record: RA signature AND (resident
 * signature OR a move-out waiver) — the same rule record_occupancy enforces
 * in the database. This is the only exported "is it complete" helper; the
 * gate screens read the same rule through `gateProgress` (occupancy-gate.ts),
 * which works on the lighter per-stay rows the desk queries.
 */
export function recordComplete(record: InspectionRecord): boolean {
  const roles = new Set(record.inspection_signatures.map((s) => s.role));
  return (
    roles.has("ra") &&
    (roles.has("resident") || record.inspection_signature_waivers !== null)
  );
}
