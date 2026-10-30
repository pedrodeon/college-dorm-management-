// Hand-written row types mirroring the tables in supabase/migrations/.
// They could be replaced by generated types (`npx supabase gen types
// typescript`) — keep all DB row shapes in this file so that swap stays a
// one-file change. Columns that became nullable when staff removal switched
// to SET NULL (20260806040634) are typed `string | null` here.

export type StaffRole = "rd" | "ra";
export type Wing = "holiday" | "lebanon";
export type OccupancyStatus = "expected" | "checked_in" | "checked_out";
export type OccupancyEventType = "check_in" | "check_out";
export type PresenceStatus = "away" | "returned";
/** Mirrors the DB enum. `periodic` is legacy: existing records still render, but
 * new ones are never created — routine weekly checks are room_checks now. */
export type InspectionType = "move_in" | "move_out" | "periodic";

/** The types a new inspection may be created as. Both are resident-bound. */
export type CreatableInspectionType = Exclude<InspectionType, "periodic">;
export type ItemCondition = "good" | "fair" | "damaged" | "missing";

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  /** Still on a temporary password: not staff yet as far as RLS is concerned. */
  must_change_password: boolean;
};

export type Hallway = {
  id: string;
  name: string;
  wing: Wing;
  floor: number;
  section: string | null;
  sort_order: number;
};

export type Room = {
  id: string;
  hallway_id: string;
  room_number: string;
  capacity: number;
};

/** The person, once, across every stay. */
export type Person = {
  id: string;
  full_name: string;
  student_id: string;
  phone: string | null;
  emergency_contact: string | null;
};

/**
 * One person in one room for one term. A returning student gets a NEW
 * occupancy; old ones are never reused or reset, only archived.
 */
export type Occupancy = {
  id: string;
  person_id: string;
  room_id: string;
  term: string;
  occupancy_status: OccupancyStatus;
  is_present: boolean;
  is_archived: boolean;
};

/**
 * A row of the `current_residents` view: a current-term, non-archived occupancy
 * joined to its person. `id` is the OCCUPANCY id — that is what every RPC and
 * event row keys on.
 */
export type CurrentResident = Person &
  Pick<Occupancy, "person_id" | "room_id" | "term" | "occupancy_status" | "is_present">;

export type PresenceEvent = {
  id: string;
  occupancy_id: string;
  status: PresenceStatus;
  timestamp: string;
  recorded_by: string | null;
  note: string | null;
};

export type OccupancyEvent = {
  id: string;
  occupancy_id: string;
  type: OccupancyEventType;
  timestamp: string;
  recorded_by: string | null;
  note: string | null;
};

export type RoomChangeEvent = {
  id: string;
  occupancy_id: string;
  from_room_id: string | null;
  to_room_id: string;
  timestamp: string;
  changed_by: string | null;
  reason: string | null;
};

export type InventoryItem = {
  id: string;
  name: string;
  sort_order: number;
};

export type Inspection = {
  id: string;
  room_id: string;
  /** The stay this snapshot brackets. Null only on legacy periodic rows. */
  occupancy_id: string | null;
  type: InspectionType;
  timestamp: string;
  inspected_by: string | null;
  notes: string | null;
};

export type InspectionItem = {
  id: string;
  inspection_id: string;
  inventory_item_id: string;
  condition: ItemCondition;
  note: string | null;
};

/** Room-check rating: 1 = poor … 5 = excellent. */
export type Rating = 1 | 2 | 3 | 4 | 5;

export type RoomCheck = {
  id: string;
  room_id: string;
  /** Null once that staff member has been removed. */
  checked_by: string | null;
  timestamp: string;
  floor_cleanliness: Rating;
  trash: Rating;
  laundry: Rating;
  overall: Rating;
  notes: string | null;
  prohibited_items: string | null;
};

export type SignatureRole = "resident" | "ra";

export type InspectionSignature = {
  id: string;
  inspection_id: string;
  role: SignatureRole;
  storage_path: string;
  signed_at: string;
  /** Null once that staff member has been removed. */
  captured_by: string | null;
};

/** "Resident unavailable / declined to sign" on a move-out inspection. */
export type SignatureWaiver = {
  id: string;
  inspection_id: string;
  reason: string;
  /** Null once that staff member has been removed. */
  waived_by: string | null;
  created_at: string;
};

/** Single-row settings table. `current_term` scopes every everyday screen. */
export type AppSettings = {
  id: true;
  current_term: string;
  updated_at: string;
};

export type InspectionPhoto = {
  id: string;
  inspection_id: string;
  inspection_item_id: string;
  storage_path: string;
  created_at: string;
};
