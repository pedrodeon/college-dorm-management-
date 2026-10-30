// Move-in / move-out (step 5). Occupancy is the one roster write ANY staff may
// record, and one STAY follows a one-way lifecycle: checked in once, out once.
// A returning student gets a new occupancy rather than reopening this one.
// occupancies.occupancy_status is only a cache of the event log.
//
// Since the two-signature step landed, check_in additionally requires a
// move-in inspection signed by BOTH the resident and the RA — covered below
// and in move-in-signatures.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  staffClient,
  assertSeededDevDatabase,
  occupancyByStudentId,
  eventCount,
  restoreOccupancy,
  uploadSignature,
  RA_EMAIL,
} from "./helpers.mjs";

const PETIT = "S1000104"; // seeded `expected`
const TESTY = "S1000101"; // seeded `checked_in`

let ra, raId, admin, petit;

before(async () => {
  await assertSeededDevDatabase();
  admin = adminClient();
  ({ client: ra, userId: raId } = await staffClient(RA_EMAIL));
  petit = await occupancyByStudentId(PETIT);
});

after(async () => {
  await restoreOccupancy(PETIT, { occupancy_status: "expected", is_present: true });
});

// Check-in and check-out are each gated on a fully-signed inspection of the
// matching type; build one so the lifecycle tests can proceed past the gates.
async function createSignedInspection(client, userId, occupancyId, roomId, type) {
  const { data: item } = await adminClient()
    .from("inventory_items")
    .select("id")
    .order("sort_order")
    .limit(1)
    .single();
  const { data: inspectionId, error } = await client.rpc("create_inspection", {
    target_room: roomId,
    target_occupancy: occupancyId,
    inspection_type: type,
    inspection_notes: `suite: signed ${type}`,
    items: [{ item_id: item.id, condition: "good", note: null }],
  });
  if (error) throw new Error(`setup inspection failed: ${error.message}`);
  for (const role of ["resident", "ra"]) {
    const { error: sigErr } = await client.from("inspection_signatures").insert({
      inspection_id: inspectionId,
      role,
      storage_path: await uploadSignature(client, inspectionId, role),
      captured_by: userId,
    });
    if (sigErr) throw new Error(`setup signature failed: ${sigErr.message}`);
  }
  return inspectionId;
}

describe("record_occupancy", () => {
  test("check_in is rejected while the move-in inspection is unsigned", async () => {
    // No move-in inspection at all yet.
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: petit.id,
      event_type: "check_in",
    });
    assert.ok(error, "checked in without any move-in inspection");
    assert.match(error.message, /signed/i, "error should explain the gate");
  });

  test("check_in is rejected when only one of two signatures exists", async () => {
    // A move-in snapshot needs at least one item (an empty "before" is no
    // record at all), so give it the first template item.
    const { data: item } = await admin
      .from("inventory_items")
      .select("id")
      .order("sort_order")
      .limit(1)
      .single();
    const { data: inspectionId, error: createErr } = await ra.rpc("create_inspection", {
      target_room: petit.room_id,
      target_occupancy: petit.id,
      inspection_type: "move_in",
      inspection_notes: "suite: half-signed",
      items: [{ item_id: item.id, condition: "good", note: null }],
    });
    assert.equal(createErr, null, createErr?.message);
    const { data: raUser } = await ra.auth.getUser();
    await ra.from("inspection_signatures").insert({
      inspection_id: inspectionId,
      role: "resident",
      storage_path: await uploadSignature(ra, inspectionId, "resident"),
      captured_by: raUser.user.id,
    });

    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: petit.id,
      event_type: "check_in",
    });
    assert.ok(error, "checked in with a half-signed inspection");
  });

  test("an RA can check in an expected resident once both have signed", async () => {
    await createSignedInspection(ra, raId, petit.id, petit.room_id, "move_in");
    const before = await eventCount("occupancy_events", petit.id);

    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: petit.id,
      event_type: "check_in",
    });
    assert.equal(error, null, error?.message);

    const { data: after } = await admin
      .from("occupancies")
      .select("occupancy_status, is_present")
      .eq("id", petit.id)
      .single();
    assert.equal(after.occupancy_status, "checked_in");
    assert.equal(after.is_present, true, "check-in should put them in the building");

    const delta = (await eventCount("occupancy_events", petit.id)) - before;
    assert.equal(delta, 1, `wrote ${delta} events, expected exactly 1`);
  });

  test("the event records the type and who did it", async () => {
    const { data: event } = await admin
      .from("occupancy_events")
      .select("type, recorded_by")
      .eq("occupancy_id", petit.id)
      .order("timestamp", { ascending: false })
      .limit(1)
      .single();
    assert.equal(event.type, "check_in");
    assert.equal(event.recorded_by, raId);
  });

  test("checking in twice is rejected", async () => {
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: petit.id,
      event_type: "check_in",
    });
    assert.ok(error, "a second check-in succeeded");
  });

  test("check_out is rejected while the move-out inspection is unsigned", async () => {
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: petit.id,
      event_type: "check_out",
    });
    assert.ok(error, "checked out without a signed move-out inspection");
    assert.match(error.message, /move-out inspection/i);
  });

  test("an RA can check out a checked-in resident once the move-out is signed", async () => {
    await createSignedInspection(ra, raId, petit.id, petit.room_id, "move_out");
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: petit.id,
      event_type: "check_out",
    });
    assert.equal(error, null, error?.message);

    const { data: after } = await admin
      .from("occupancies")
      .select("occupancy_status, is_present")
      .eq("id", petit.id)
      .single();
    assert.equal(after.occupancy_status, "checked_out");
    assert.equal(after.is_present, false, "checked-out residents are not in the building");
  });

  test("checking out twice is rejected", async () => {
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: petit.id,
      event_type: "check_out",
    });
    assert.ok(error, "a second check-out succeeded");
  });

  test("checking out someone who never checked in is rejected", async () => {
    const { data: expected } = await admin
      .from("occupancies")
      .select("id")
      .eq("occupancy_status", "expected")
      .limit(1)
      .single();
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: expected.id,
      event_type: "check_out",
    });
    assert.ok(error, "checked out an `expected` resident");
  });

  test("the status cache matches the latest event", async () => {
    // occupancy_status is a cache; the event log is the source of truth. If
    // they drift, occupancy reporting silently lies.
    const testy = await occupancyByStudentId(TESTY);
    const { data: latest } = await admin
      .from("occupancy_events")
      .select("type")
      .eq("occupancy_id", testy.id)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest) {
      const expected = latest.type === "check_in" ? "checked_in" : "checked_out";
      assert.equal(testy.occupancy_status, expected, "cache drifted from the log");
    }
  });

  test("the audit trail cannot be written directly", async () => {
    const { error } = await ra
      .from("occupancy_events")
      .insert({ occupancy_id: petit.id, type: "check_in" });
    assert.ok(error, "direct insert into occupancy_events succeeded");
  });
});
