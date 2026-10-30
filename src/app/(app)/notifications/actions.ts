"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SeenResult = { ok: true } | { ok: false; error: string };

/**
 * Move the caller's seen-watermark up to the newest notification the feed
 * actually rendered — the bell badge counts notifications newer than it.
 * Keyed to a rendered row, not the app clock, so a notification written
 * between the page query and this call stays unread until it is shown.
 * Capped at now as a sanity guard against a malformed value. RLS pins the
 * row to the caller.
 */
export async function markNotificationsSeen(
  newestShown: string | null,
): Promise<SeenResult> {
  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: "You're not signed in as staff." };
  // Nothing rendered → nothing to mark; the badge is already zero.
  if (!newestShown) return { ok: true };

  const shown = new Date(newestShown).getTime();
  if (Number.isNaN(shown)) return { ok: false, error: "Bad timestamp." };
  const seenAt = new Date(Math.min(shown, Date.now())).toISOString();

  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_seen")
    .upsert({ user_id: staff.id, seen_at: seenAt });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout"); // the badge lives in the app shell
  return { ok: true };
}
