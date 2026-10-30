import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/types";

export type StaffContext = {
  id: string;
  email: string | null;
  name: string;
  role: StaffRole;
  /** Seeded with a temporary password; must set their own before using the app. */
  mustChangePassword: boolean;
};

export type AccessState = {
  /** A valid Supabase auth session exists. */
  authenticated: boolean;
  /** The matching row in public.users, or null if there isn't one. */
  staff: StaffContext | null;
};

/**
 * Resolve the caller's auth + staff-record state in one place.
 *
 * `authenticated` and `staff` are tracked separately on purpose: an
 * authenticated user with no staff row is a real state (account removed or not
 * yet set up) that must be handled differently from "not signed in" — see
 * accessDecision in ./access. Collapsing them is what caused the /login loop.
 *
 * Wrapped in React's `cache` so the layout, the page and any route handler in
 * one request share a single auth call and one users query instead of each
 * repeating them.
 */
export const getAccessState = cache(async (): Promise<AccessState> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authenticated: false, staff: null };

  // maybeSingle: a missing row is the "no staff record" state and comes back
  // as null; anything else is a real failure and must not be read as "not
  // staff", or a brief database hiccup would send real staff to /no-access.
  const { data: staff, error } = await supabase
    .from("users")
    .select("id, name, role, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load the staff record: ${error.message}`);
  }

  return {
    authenticated: true,
    staff: staff
      ? {
          id: staff.id,
          email: user.email ?? null,
          name: staff.name,
          role: staff.role as StaffRole,
          mustChangePassword: staff.must_change_password === true,
        }
      : null,
  };
});

/**
 * The logged-in staff member with their role, or null if not signed in / not a
 * staff record. Used to gate RD-only UI (defense-in-depth on top of RLS).
 */
export async function getStaffContext(): Promise<StaffContext | null> {
  return (await getAccessState()).staff;
}

export type RdCheck =
  | { ok: true; staff: StaffContext }
  | { ok: false; error: string };

/**
 * The caller as the RD, or a sentence saying why not. Every admin server
 * action starts with this: RLS is the real boundary, but without it an RA's
 * update or delete returns zero rows and reads as success.
 */
export async function requireRd(): Promise<RdCheck> {
  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: "You're not signed in as staff." };
  if (staff.role !== "rd") return { ok: false, error: "Only the RD can do that." };
  return { ok: true, staff };
}
