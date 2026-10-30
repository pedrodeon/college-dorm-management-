// Move-out attestations and the documented escape hatch. The gate: check_out
// requires a move-out inspection with the RA signature AND either the resident
// signature or a recorded "resident unavailable / declined to sign" waiver
// with its reason. The RA signature is never waivable; waivers exist only for
// move-out; and a waiver, like a signature, is permanent.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  anonClient,
  staffClient,
  assertSeededDevDatabase,
  occupancyByStudentId,
  restoreOccupancy,
  uploadSignature,
  RA_EMAIL,
  RD_EMAIL,
} from "./helpers.mjs";

const TESTY = "S1000101"; // checked_in in fixtures — signature path
const DANVERS = "S1000102"; // checked_in in fixtures — waiver path

let admin, anon, ra, raId, rdId, testy, danvers, inspTesty, inspDanvers;

async function createMoveOut(occupancyId, roomId) {
  const { data: item } = await admin
    .from("inventory_items")
    .select("id")
    .order("sort_order")
    .limit(1)
    .single();
  const { data, error } = await ra.rpc("create_inspection", {
    target_room: roomId,
    target_occupancy: occupancyId,
    inspection_type: "move_out",
    inspection_notes: "move-out signature suite",
    items: [{ item_id: item.id, condition: "good", note: null }],
  });
  if (error) throw new Error(`setup failed: ${error.message}`);
  return data;
}

before(async () => {
  await assertSeededDevDatabase();
  admin = adminClient();
  anon = anonClient();
  ({ client: ra, userId: raId } = await staffClient(RA_EMAIL));
  ({ userId: rdId } = await staffClient(RD_EMAIL));
  testy = await occupancyByStudentId(TESTY);
  danvers = await occupancyByStudentId(DANVERS);
  inspTesty = await createMoveOut(testy.id, testy.room_id);
  inspDanvers = await createMoveOut(danvers.id, danvers.room_id);
});

after(async () => {
  // The check-outs below flip fixture statuses; put them back for other runs.
  await restoreOccupancy(TESTY, { occupancy_status: "checked_in", is_present: true });
  await restoreOccupancy(DANVERS, { occupancy_status: "checked_in", is_present: true });
});

describe("the check-out gate, signature path", () => {
  test("rejected with no signatures at all", async () => {
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: testy.id,
      event_type: "check_out",
    });
    assert.ok(error, "checked out with an unsigned move-out inspection");
  });

  test("resident signature alone is not enough (RA is never waivable)", async () => {
    await ra.from("inspection_signatures").insert({
      inspection_id: inspTesty,
      role: "resident",
      storage_path: await uploadSignature(ra, inspTesty, "resident"),
      captured_by: raId,
    });
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: testy.id,
      event_type: "check_out",
    });
    assert.ok(error, "checked out without the RA signature");
  });

  test("RA + resident signatures complete the check-out", async () => {
    await ra.from("inspection_signatures").insert({
      inspection_id: inspTesty,
      role: "ra",
      storage_path: await uploadSignature(ra, inspTesty, "ra"),
      captured_by: raId,
    });
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: testy.id,
      event_type: "check_out",
    });
    assert.equal(error, null, error?.message);

    const { data: afterRow } = await admin
      .from("occupancies")
      .select("occupancy_status")
      .eq("id", testy.id)
      .single();
    assert.equal(afterRow.occupancy_status, "checked_out");
  });
});

describe("the waiver (escape hatch)", () => {
  test("RA signature alone is not enough without a waiver", async () => {
    await ra.from("inspection_signatures").insert({
      inspection_id: inspDanvers,
      role: "ra",
      storage_path: await uploadSignature(ra, inspDanvers, "ra"),
      captured_by: raId,
    });
    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: danvers.id,
      event_type: "check_out",
    });
    assert.ok(error, "checked out with RA signature but no resident half");
  });

  test("a blank reason is rejected — the reason is required", async () => {
    const { error } = await ra.from("inspection_signature_waivers").insert({
      inspection_id: inspDanvers,
      reason: "   ",
      waived_by: raId,
    });
    assert.ok(error, "a blank-reason waiver was accepted");
  });

  test("waived_by cannot be forged", async () => {
    const { error } = await ra.from("inspection_signature_waivers").insert({
      inspection_id: inspDanvers,
      reason: "forged attribution attempt",
      waived_by: rdId,
    });
    assert.ok(error, "a waiver was recorded as another staff member");
  });

  test("a move-in inspection cannot carry a waiver", async () => {
    // The resident is present at move-in by definition.
    const { data: item } = await admin
      .from("inventory_items")
      .select("id")
      .order("sort_order")
      .limit(1)
      .single();
    const { data: moveInId } = await ra.rpc("create_inspection", {
      target_room: danvers.room_id,
      target_occupancy: danvers.id,
      inspection_type: "move_in",
      inspection_notes: "waiver-rejection probe",
      items: [{ item_id: item.id, condition: "good", note: null }],
    });
    const { error } = await ra.from("inspection_signature_waivers").insert({
      inspection_id: moveInId,
      reason: "should not be possible",
      waived_by: raId,
    });
    assert.ok(error, "a move-in inspection accepted a waiver");
  });

  test("anon cannot record or read waivers", async () => {
    const { error } = await anon.from("inspection_signature_waivers").insert({
      inspection_id: inspDanvers,
      reason: "anon attempt",
      waived_by: raId,
    });
    assert.ok(error, "anon recorded a waiver");
    const { data } = await anon
      .from("inspection_signature_waivers")
      .select("id")
      .limit(1);
    assert.equal(data?.length ?? 0, 0, "anon read waivers");
  });

  test("RA signature + waiver completes the check-out, recording why", async () => {
    const { error: waiveErr } = await ra
      .from("inspection_signature_waivers")
      .insert({
        inspection_id: inspDanvers,
        reason: "Resident left campus before the inspection",
        waived_by: raId,
      });
    assert.equal(waiveErr, null, waiveErr?.message);

    const { error } = await ra.rpc("record_occupancy", {
      target_occupancy: danvers.id,
      event_type: "check_out",
    });
    assert.equal(error, null, error?.message);

    const { data: waiver } = await admin
      .from("inspection_signature_waivers")
      .select("reason, waived_by, created_at")
      .eq("inspection_id", inspDanvers)
      .single();
    assert.equal(waiver.reason, "Resident left campus before the inspection");
    assert.equal(waiver.waived_by, raId);
    assert.ok(waiver.created_at, "waiver has no timestamp");
  });

  test("only one waiver per inspection", async () => {
    const { error } = await ra.from("inspection_signature_waivers").insert({
      inspection_id: inspDanvers,
      reason: "second waiver attempt",
      waived_by: raId,
    });
    assert.ok(error, "a second waiver was accepted");
  });

  test("a waiver is permanent", async () => {
    const { data: updated } = await ra
      .from("inspection_signature_waivers")
      .update({ reason: "rewritten history" })
      .eq("inspection_id", inspDanvers)
      .select();
    assert.equal(updated?.length ?? 0, 0, "a waiver was edited");

    const { data: deleted } = await ra
      .from("inspection_signature_waivers")
      .delete()
      .eq("inspection_id", inspDanvers)
      .select();
    assert.equal(deleted?.length ?? 0, 0, "a waiver was deleted by staff");

    const { error: svcErr } = await admin
      .from("inspection_signature_waivers")
      .delete()
      .eq("inspection_id", inspDanvers);
    assert.ok(svcErr, "service_role deleted a waiver");
  });
});
