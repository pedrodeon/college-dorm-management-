"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRd } from "@/lib/auth";
import { humanDbError } from "@/lib/db-errors";
import type { StaffRole } from "@/lib/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type InviteResult =
  | { ok: true; tempPassword: string; email: string }
  | { ok: false; error: string };

/**
 * Invite a staff member. Creating an auth user needs the service-role admin
 * client, which bypasses RLS — so we verify the CALLER is the RD ourselves
 * before using it. Dev has no SMTP, so we set a generated temp password and
 * return it to show once. Production should switch to inviteUserByEmail once
 * an SMTP provider is configured in Supabase.
 */
export async function inviteStaff(
  name: string,
  email: string,
  role: StaffRole,
): Promise<InviteResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanName || !cleanEmail) {
    return { ok: false, error: "Name and email are required." };
  }

  const admin = createAdminClient();
  const tempPassword = `Tudor-${randomUUID().slice(0, 8)}`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password: tempPassword,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    // GoTrue, not Postgres: its codes are words. The one the RD will hit is
    // an email that already has a login.
    return {
      ok: false,
      error:
        createErr?.code === "email_exists"
          ? "A login with that email already exists."
          : "The account couldn't be created. Check the email address and try again.",
    };
  }

  const { error: rowErr } = await admin
    .from("users")
    // must_change_password: the account starts on a relayed temp password,
    // so the app forces a personal one on first login — same rule as the
    // seed-ra-accounts script.
    .insert({
      id: created.user.id,
      name: cleanName,
      email: cleanEmail,
      role,
      must_change_password: true,
    });
  if (rowErr) {
    // Roll back the orphaned auth user so a retry can reuse the email.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: humanDbError(rowErr, "The staff record couldn't be created.") };
  }

  revalidatePath("/admin/staff");
  return { ok: true, tempPassword, email: cleanEmail };
}

export async function removeStaff(userId: string): Promise<ActionResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;
  if (userId === rd.staff.id) {
    return { ok: false, error: "You can't remove your own account." };
  }

  const admin = createAdminClient();
  // Deleting the auth user cascades to the public.users row (FK on delete).
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "user_not_found"
          ? "That account was already removed — refresh the page."
          : "The account couldn't be removed. Refresh the page and try again.",
    };
  }

  revalidatePath("/admin/staff");
  return { ok: true };
}

// Hallway coverage is RD-managed metadata; the RLS-scoped client enforces RD,
// and requireRd keeps an RA's no-op from reading as success.
export async function setAssignment(
  userId: string,
  hallwayId: string,
  assigned: boolean,
): Promise<ActionResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;

  const supabase = await createClient();
  if (assigned) {
    // Already-assigned is the state asked for, so a duplicate is ignored
    // rather than failed.
    const { error } = await supabase
      .from("hallway_assignments")
      .upsert({ user_id: userId, hallway_id: hallwayId }, { onConflict: "user_id,hallway_id", ignoreDuplicates: true });
    if (error) {
      return {
        ok: false,
        error: humanDbError(
          error,
          error.code === "23503"
            ? "That staff member or hallway no longer exists — refresh the page."
            : "The coverage couldn't be saved.",
        ),
      };
    }
  } else {
    const { data: rows, error } = await supabase
      .from("hallway_assignments")
      .delete()
      .eq("user_id", userId)
      .eq("hallway_id", hallwayId)
      .select("id");
    if (error) return { ok: false, error: humanDbError(error, "The coverage couldn't be removed.") };
    if (!rows?.length) {
      return { ok: false, error: "That coverage was already removed — refresh the page." };
    }
  }
  revalidatePath("/admin/staff");
  revalidatePath("/");
  return { ok: true };
}
