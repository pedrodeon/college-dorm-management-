// The two-signature attestation on move-in inspections. The rules: signatures
// bind to one exact inspection snapshot, one per role, captured only by the
// signed-in staff member, only against a move-in inspection that names a
// resident — and once captured they are permanent for every role, service_role
// included. record_occupancy's check_in gate is covered in occupancy.test.mjs.

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  anonClient,
  staffClient,
  assertSeededDevDatabase,
  occupancyByStudentId,
  signaturePath,
  uploadSignature,
  RA_EMAIL,
  RD_EMAIL,
} from "./helpers.mjs";

const TESTY = "S1000101";

let admin, anon, ra, raId, rdId, moveInId, periodicId, roomId;

before(async () => {
  await assertSeededDevDatabase();
  admin = adminClient();
  anon = anonClient();
  ({ client: ra, userId: raId } = await staffClient(RA_EMAIL));
  ({ userId: rdId } = await staffClient(RD_EMAIL));

  const testy = await occupancyByStudentId(TESTY);
  roomId = testy.room_id;
  const { data: item } = await admin
    .from("inventory_items")
    .select("id")
    .order("sort_order")
    .limit(1)
    .single();

  // One move-in inspection (signable) and one periodic (not signable).
  ({ data: moveInId } = await ra.rpc("create_inspection", {
    target_room: roomId,
    target_occupancy: testy.id,
    inspection_type: "move_in",
    inspection_notes: "signature suite",
    items: [{ item_id: item.id, condition: "good", note: null }],
  }));
  ({ data: periodicId } = await ra.rpc("create_inspection", {
    target_room: roomId,
    target_occupancy: null,
    inspection_type: "periodic",
    inspection_notes: "signature suite (unsignable)",
    items: [{ item_id: item.id, condition: "good", note: null }],
  }));
});

describe("capturing signatures", () => {
  test("a signature must be the signer's own upload under the inspection's path", async () => {
    // A path that points at nothing.
    const { error: missing } = await ra.from("inspection_signatures").insert({
      inspection_id: moveInId,
      role: "resident",
      storage_path: signaturePath(moveInId, "resident"),
      captured_by: raId,
    });
    assert.ok(missing, "a signature row pointed at an object that does not exist");

    // A real upload, but under another inspection's prefix.
    const elsewhere = await uploadSignature(ra, periodicId, "resident");
    const { error: borrowed } = await ra.from("inspection_signatures").insert({
      inspection_id: moveInId,
      role: "resident",
      storage_path: elsewhere,
      captured_by: raId,
    });
    assert.ok(borrowed, "a signature row borrowed another inspection's image");
  });

  test("staff can record the resident signature against a move-in inspection", async () => {
    const { error } = await ra.from("inspection_signatures").insert({
      inspection_id: moveInId,
      role: "resident",
      storage_path: await uploadSignature(ra, moveInId, "resident"),
      captured_by: raId,
    });
    assert.equal(error, null, error?.message);
  });

  test("a role can only be signed once per inspection", async () => {
    const { error } = await ra.from("inspection_signatures").insert({
      inspection_id: moveInId,
      role: "resident",
      storage_path: await uploadSignature(ra, moveInId, "resident"),
      captured_by: raId,
    });
    assert.ok(error, "a second resident signature was accepted");
  });

  test("captured_by cannot be forged", async () => {
    const { error } = await ra.from("inspection_signatures").insert({
      inspection_id: moveInId,
      role: "ra",
      storage_path: await uploadSignature(ra, moveInId, "ra"),
      captured_by: rdId, // someone else
    });
    assert.ok(error, "a signature was recorded as another staff member");
  });

  test("a periodic inspection cannot carry signatures", async () => {
    const { error } = await ra.from("inspection_signatures").insert({
      inspection_id: periodicId,
      role: "resident",
      storage_path: await uploadSignature(ra, periodicId, "resident"),
      captured_by: raId,
    });
    assert.ok(error, "signed a non-move-in inspection");
  });

  test("anon can neither insert nor read signatures", async () => {
    const { error } = await anon.from("inspection_signatures").insert({
      inspection_id: moveInId,
      role: "ra",
      storage_path: signaturePath(moveInId, "ra"),
      captured_by: raId,
    });
    assert.ok(error, "anon recorded a signature");

    const { data } = await anon.from("inspection_signatures").select("id").limit(1);
    assert.equal(data?.length ?? 0, 0, "anon read signatures");
  });
});

describe("signatures are permanent", () => {
  test("rows cannot be edited or deleted by staff", async () => {
    const { data: updated } = await ra
      .from("inspection_signatures")
      .update({ storage_path: "swapped.png" })
      .eq("inspection_id", moveInId)
      .select();
    assert.equal(updated?.length ?? 0, 0, "a signature row was edited");

    const { data: deleted } = await ra
      .from("inspection_signatures")
      .delete()
      .eq("inspection_id", moveInId)
      .select();
    assert.equal(deleted?.length ?? 0, 0, "a signature row was deleted");
  });

  test("rows cannot be deleted by the service role", async () => {
    const { error } = await admin
      .from("inspection_signatures")
      .delete()
      .eq("inspection_id", moveInId);
    assert.ok(error, "service_role deleted a signature");
  });

  test("a stored signature image cannot be overwritten", async () => {
    const { data: row } = await admin
      .from("inspection_signatures")
      .select("storage_path")
      .eq("inspection_id", moveInId)
      .eq("role", "resident")
      .single();

    // First land the object (the suite's rows use paths without objects), then
    // prove a second write to the same path is rejected.
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    await ra.storage
      .from("inspection-photos")
      .upload(row.storage_path, png, { contentType: "image/png" });
    const { error } = await ra.storage
      .from("inspection-photos")
      .upload(row.storage_path, png, { contentType: "image/png", upsert: true });
    assert.ok(error, "a signature image was overwritten");
  });
});
