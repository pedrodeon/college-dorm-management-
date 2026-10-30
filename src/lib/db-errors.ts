/*
 * Postgres errors, said in English.
 *
 * A raw driver message on screen — "update or delete on table
 * \"occupancies\" violates foreign key constraint
 * \"inspections_occupancy_id_fkey\"" — tells the RD nothing about what to do
 * next, and leaks table names into a screen students' records live on.
 * Everything the admin screens surface goes through here first.
 *
 * The mapping is by error CODE plus the constraint named in the message,
 * never by matching prose: Postgres wording changes between versions, but
 * 23503 has meant "foreign key violation" for twenty years.
 */

export type DbErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

/** Constraints the admin screens can actually run into, and what they mean
    to the person who hit them. */
const BY_CONSTRAINT: Record<string, string> = {
  inspections_occupancy_id_fkey:
    "This stay has inspection records attached, so it can't be deleted. Archive it instead — that keeps the history and hides the stay from everyday screens.",
  occupancies_one_active_per_person:
    "That person already has another active stay. Check that one out, or archive it, first.",
  people_student_id_key:
    "That student ID is already on record. Search for the student and open a new stay for them instead.",
  // Rooms (Admin → Rooms).
  rooms_hallway_id_room_number_key:
    "That room number is already used in this hallway.",
  rooms_capacity_check: "Capacity must be a whole number from 1 to 8.",
  occupancies_room_id_fkey:
    "Stays are attached to this room — including past or archived ones — so it can't be deleted.",
  inspections_room_id_fkey:
    "This room has inspection records, so it can't be deleted.",
  room_checks_room_id_fkey:
    "This room has room-check records, so it can't be deleted.",
  room_change_events_from_room_id_fkey:
    "Room-change history refers to this room, so it can't be deleted.",
  room_change_events_to_room_id_fkey:
    "Room-change history refers to this room, so it can't be deleted.",
  incident_reports_room_id_fkey:
    "An incident report names this room, so it can't be deleted.",
  // Inventory template (Admin → Inventory).
  inventory_items_sort_order_key:
    "Another item already has that position. Pick a position no other item uses.",
  inspection_items_inventory_item_id_fkey:
    "This item appears on past inspections, so it can't be removed. Rename it instead.",
  // Staff (Admin → Staff).
  users_email_key: "A staff account with that email already exists.",
  hallway_assignments_user_id_hallway_id_key:
    "That hallway coverage is already recorded.",
};

const BY_CODE: Record<string, string> = {
  // Neutral on purpose: a 23503 is raised by a delete something still points
  // at AND by an insert pointing at something gone. Callers that know which
  // pass a specific fallback; this is for the ones that don't.
  "23503":
    "This change conflicts with a related record that has been changed or removed. Refresh the page and try again.",
  "23505": "That record already exists.",
  "23514": "Those values aren't allowed together.",
  "42501":
    "You don't have permission to do that. Some records are deliberately permanent and can't be changed by anyone.",
  PGRST116: "That record no longer exists — the list may be out of date.",
};

/**
 * A sentence for the RD. `fallback` is what to say when the error is one we
 * have never seen: deliberately vague about the database and specific about
 * what to do, rather than pasting the driver's text.
 */
export function humanDbError(
  error: DbErrorLike | null | undefined,
  fallback = "That didn't work. Refresh the page and try again.",
): string {
  if (!error) return fallback;

  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  for (const [constraint, sentence] of Object.entries(BY_CONSTRAINT)) {
    if (text.includes(constraint)) return sentence;
  }
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code];
  return fallback;
}
