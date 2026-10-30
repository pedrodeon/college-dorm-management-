"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChangePasswordResult = { ok: false; error: string };

/**
 * Set the caller's own password, then clear their must_change_password flag.
 * The flag is cleared with the service role ON PURPOSE: users have no RLS
 * self-update on the users table, so the only way the flag drops is through
 * this action — i.e. after the password really changed.
 */
export async function changePassword(
  password: string,
  confirm: string,
): Promise<ChangePasswordResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (password.length < 10) {
    return { ok: false, error: "Use at least 10 characters." };
  }
  if (password !== confirm) {
    return { ok: false, error: "The two passwords don't match." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // e.g. "New password should be different from the old password."
    return { ok: false, error: error.message };
  }

  const { error: flagError } = await createAdminClient()
    .from("users")
    .update({ must_change_password: false })
    .eq("id", user.id);
  if (flagError) {
    return {
      ok: false,
      error: `Password changed, but clearing the flag failed: ${flagError.message}. Reload and try once more.`,
    };
  }

  redirect("/");
}
