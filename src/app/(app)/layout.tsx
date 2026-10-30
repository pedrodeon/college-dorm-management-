import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccessState } from "@/lib/auth";
import { accessDecision } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/bottom-nav";
import { signOut } from "./actions";

/** Notifications newer than the caller's seen-watermark, not counting the
    caller's own actions. (`actor` is null once its staff account is removed,
    so the filter keeps nulls — a bare `neq` would drop them.) */
async function unseenNotificationCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { data: seen } = await supabase
    .from("notification_seen")
    .select("seen_at")
    .eq("user_id", userId)
    .maybeSingle();
  let query = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .or(`actor.is.null,actor.neq.${userId}`);
  if (seen?.seen_at) query = query.gt("created_at", seen.seen_at);
  const { count } = await query;
  return count ?? 0;
}

/**
 * Protected shell for every staff-facing screen. The proxy already redirects
 * unauthenticated requests, but we re-check here as defense in depth — never
 * rely on a single layer for access control.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { authenticated, staff } = await getAccessState();
  switch (accessDecision({ authenticated, hasStaffRecord: staff !== null })) {
    case "redirect-login":
      redirect("/login");
    case "redirect-no-access":
      // Authenticated but no staff row — send them somewhere terminal instead
      // of bouncing to /login (which would send them right back here).
      redirect("/no-access");
  }
  // "allow": staff is guaranteed non-null; this also narrows it for TS.
  if (!staff) redirect("/no-access");
  // Seeded temporary password: nothing in the app until they set their own.
  // /change-password lives outside this layout, so no redirect loop.
  if (staff.mustChangePassword) redirect("/change-password");
  const isRd = staff.role === "rd";
  const unseen = await unseenNotificationCount(staff.id);

  const glassPill =
    "whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/20 hover:text-white sm:px-3.5 sm:text-sm";

  return (
    // canvas-v2 is the app-wide backdrop; overflow-x-clip: no element may ever
    // widen the page — wide content must scroll inside its own overflow-x-auto
    // container (the compare table does). header/main are `relative` so they
    // paint above the canvas glow orbs (positioned pseudo-elements).
    <div className="canvas-v2 flex min-h-screen flex-col overflow-x-clip">
      <header className="relative">
        {/* Slim account strip: bell, email, sign out — primary navigation
            lives in the bottom tab bar, never up here. */}
        <div className="mx-auto flex w-full max-w-5xl items-center justify-end gap-3 px-4 py-3 sm:px-6">
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/notifications"
              aria-label={
                unseen > 0
                  ? `Notifications (${unseen} unread)`
                  : "Notifications"
              }
              className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Zm4 9a2 2 0 0 0 4 0"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {unseen > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-ink">
                  {unseen > 9 ? "9+" : unseen}
                </span>
              )}
            </Link>
            <span className="hidden text-sm text-white/50 sm:inline">
              {staff.email}
            </span>
            <form action={signOut}>
              <button type="submit" className={glassPill}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* pb-28: room for the fixed bottom tab bar (plus its safe-area pad),
          so no screen's last content can hide behind it. */}
      <main className="relative mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-4 sm:px-6">
        {children}
      </main>

      <BottomNav isRd={isRd} />
    </div>
  );
}
