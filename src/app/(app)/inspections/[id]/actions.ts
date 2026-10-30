"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import { WAIVER_REASON_MAX_LENGTH } from "@/lib/attestations";
import type { SignatureRole } from "@/lib/types";

export type SignatureResult = { ok: true } | { ok: false; error: string };

/** Postgres unique_violation — the (inspection, role) key or the one-waiver key. */
const UNIQUE_VIOLATION = "23505";
/** Postgres insufficient_privilege — an RLS policy refused the row. */
const RLS_REFUSED = "42501";

/**
 * Record one attestation signature (image already uploaded to storage) against
 * a move-in or move-out inspection. RLS enforces the rest: staff only,
 * captured_by must be the caller, the inspection must be a move-in/out with a
 * resident, the `ra` half only by whoever conducted the inspection, and the
 * unique (inspection_id, role) key makes a signature unrepeatable.
 */
export async function addInspectionSignature(
  inspectionId: string,
  role: SignatureRole,
  storagePath: string,
): Promise<SignatureResult> {
  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: "Not signed in as staff." };

  // The database checks this too (and that the object is the caller's own
  // upload); refusing here just keeps the error readable.
  if (!storagePath.startsWith(`signatures/${inspectionId}/${role}-`)) {
    return { ok: false, error: "The signature image doesn't belong to this inspection." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("inspection_signatures").insert({
    inspection_id: inspectionId,
    role,
    storage_path: storagePath,
    captured_by: staff.id,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.code === UNIQUE_VIOLATION
          ? "This signature has already been recorded — signatures are permanent."
          : role === "ra" && error.code === RLS_REFUSED
            ? "Only the staff member who conducted this inspection can sign as the RA."
            : error.message,
    };
  }

  revalidatePath(`/inspections/${inspectionId}`);
  revalidatePath("/desk");
  return { ok: true };
}

/**
 * Record "resident unavailable / declined to sign" against a move-out
 * inspection, with the required reason. Satisfies the resident half of the
 * check-out gate while making the missing signature explicit and permanent.
 * RLS enforces: staff only, waived_by = caller, move-out inspections only,
 * one waiver per inspection.
 */
export async function waiveResidentSignature(
  inspectionId: string,
  reason: string,
): Promise<SignatureResult> {
  const trimmed = reason.trim();
  if (!trimmed) {
    return { ok: false, error: "A reason is required to record the waiver." };
  }
  if (trimmed.length > WAIVER_REASON_MAX_LENGTH) {
    return {
      ok: false,
      error: `Keep the reason under ${WAIVER_REASON_MAX_LENGTH} characters (it is ${trimmed.length}).`,
    };
  }

  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: "Not signed in as staff." };

  const supabase = await createClient();
  const { error } = await supabase.from("inspection_signature_waivers").insert({
    inspection_id: inspectionId,
    reason: trimmed,
    waived_by: staff.id,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.code === UNIQUE_VIOLATION
          ? "A waiver has already been recorded for this inspection."
          : error.message,
    };
  }

  revalidatePath(`/inspections/${inspectionId}`);
  revalidatePath("/desk");
  return { ok: true };
}
