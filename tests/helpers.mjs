// Shared setup for the access-control suite.
//
// These tests run against a LIVE Supabase project using a fake fixture roster.
// They mutate rows and restore them afterwards. A guard below refuses to run
// unless the known fake fixtures are present, so the suite can never be pointed
// at a database holding real resident records.
//
// Since the person/occupancy split, a fixture "resident" is a `people` row plus
// an `occupancies` row, and every event and inspection keys on the OCCUPANCY id.
// These helpers hide that: pass a student ID, get back the active stay.
//
// Apply supabase/seed-fixtures.sql to a dedicated fixture project first — see
// docs/SETUP.md.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const STAFF_PASSWORD =
  process.env.SEED_STAFF_PASSWORD ?? "tudor-dev-only-2026";

if (!url || !anonKey || !serviceKey || url.includes("your-project-ref")) {
  throw new Error(
    "Missing Supabase env. Run via `npm test` so .env.local is loaded, and see docs/SETUP.md.",
  );
}

/** Service-role client: bypasses RLS. Used only for fixtures and restoring state. */
export function adminClient() {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Anonymous client — what an unauthenticated caller gets. */
export function anonClient() {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Signed-in staff client. Runs under that user's RLS policies. */
export async function staffClient(email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: STAFF_PASSWORD,
  });
  if (error) {
    throw new Error(
      `Could not sign in as ${email}: ${error.message}. Run \`npm run seed:staff\`.`,
    );
  }
  return { client, userId: data.user.id };
}

export const RA_EMAIL = "ra1@tudor.test";
export const RA2_EMAIL = "ra2@tudor.test";
export const RD_EMAIL = "rd@tudor.test";

/**
 * Refuse to run against anything but the fake fixtures. "Testy McTestface" is
 * unmistakably fixture data; if it's absent, this may be a database with real
 * student records and these destructive tests must not touch it.
 */
export async function assertSeededDevDatabase() {
  const admin = adminClient();
  const { data, error } = await admin
    .from("people")
    .select("full_name, occupancies ( id )")
    .eq("student_id", "S1000101")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not reach the database: ${error.message}`);
  }
  if (!data || data.full_name !== "Testy McTestface") {
    throw new Error(
      "Fixture roster not found. These tests mutate data and must only run " +
        "against a fixture database — never one holding real resident " +
        "records. Apply supabase/seed-fixtures.sql; see docs/SETUP.md.",
    );
  }
  if ((data.occupancies ?? []).length === 0) {
    throw new Error(
      "Fixture person S1000101 has no occupancy. Re-apply supabase/seed-fixtures.sql.",
    );
  }
}

/** The term the fixtures' active stays live in. */
export async function currentTerm() {
  const admin = adminClient();
  const { data, error } = await admin
    .from("app_settings")
    .select("current_term")
    .single();
  if (error) throw new Error(`Could not read app_settings: ${error.message}`);
  return data.current_term;
}

/**
 * The active stay for a fixture student ID: current term, not archived. A person
 * may have several occupancies, so this picks the live one deliberately rather
 * than assuming there is only ever one.
 */
export async function occupancyByStudentId(studentId) {
  const admin = adminClient();
  const term = await currentTerm();
  const { data, error } = await admin
    .from("occupancies")
    .select(
      `id, person_id, room_id, term, occupancy_status, is_present,
       people!inner ( full_name, student_id )`,
    )
    .eq("people.student_id", studentId)
    .eq("term", term)
    .eq("is_archived", false)
    .single();
  if (error) throw new Error(`Fixture ${studentId} missing: ${error.message}`);
  return {
    id: data.id, // the OCCUPANCY id — what every RPC and event row keys on
    person_id: data.person_id,
    full_name: data.people.full_name,
    room_id: data.room_id,
    term: data.term,
    occupancy_status: data.occupancy_status,
    is_present: data.is_present,
  };
}

/** Look up a fixture person by student ID. */
export async function personByStudentId(studentId) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("people")
    .select("id, full_name, student_id, phone, emergency_contact")
    .eq("student_id", studentId)
    .single();
  if (error) {
    throw new Error(`Fixture person ${studentId} missing: ${error.message}`);
  }
  return data;
}

/** Look up a seeded hallway by name. */
export async function hallwayByName(name) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("hallways")
    .select("id, name")
    .eq("name", name)
    .single();
  if (error) throw new Error(`Hallway "${name}" missing: ${error.message}`);
  return data;
}

/**
 * Restore an active stay's mutable state (service role bypasses the RD-only
 * RLS). The events written along the way are append-only by design and remain.
 */
export async function restoreOccupancy(studentId, fields) {
  const admin = adminClient();
  const stay = await occupancyByStudentId(studentId);
  const { error } = await admin
    .from("occupancies")
    .update(fields)
    .eq("id", stay.id);
  if (error) throw new Error(`Restore failed for ${studentId}: ${error.message}`);
}

/** A real 1x1 PNG. Signature rows must name an object the caller uploaded. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Where signature images live and the only path shape the RLS accepts. */
export function signaturePath(inspectionId, role) {
  return `signatures/${inspectionId}/${role}-${crypto.randomUUID()}.png`;
}

/**
 * Upload a signature image as `client` and return its path, ready for an
 * inspection_signatures row. The policy requires the object to exist under
 * the inspection's own prefix and to have been uploaded by the signer, so a
 * made-up path no longer satisfies the gate.
 */
export async function uploadSignature(client, inspectionId, role) {
  const path = signaturePath(inspectionId, role);
  const { error } = await client.storage
    .from("inspection-photos")
    .upload(path, TINY_PNG, { contentType: "image/png" });
  if (error) throw new Error(`signature upload failed: ${error.message}`);
  return path;
}

/** Count rows in an append-only event table for one stay. */
export async function eventCount(table, occupancyId) {
  const admin = adminClient();
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("occupancy_id", occupancyId);
  if (error) throw new Error(`Count failed on ${table}: ${error.message}`);
  return count ?? 0;
}
