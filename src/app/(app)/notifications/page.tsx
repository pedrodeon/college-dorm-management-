import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import { NotificationList, type NotificationRow } from "@/components/notification-list";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageTitle } from "@/components/ui/typography";

export const metadata = { title: "Notifications — Tudor Hall" };

export default async function NotificationsPage() {
  const staff = await getStaffContext();
  const supabase = await createClient();

  const [{ data: rows }, { data: seen }] = await Promise.all([
    supabase
      .from("notifications")
      .select(
        `id, type, shift_date, slot, target_id, created_at,
         actor:actor ( id, name ),
         other:other_user ( name )`,
      )
      .order("created_at", { ascending: false })
      .limit(50)
      .overrideTypes<NotificationRow[]>(),
    staff
      ? supabase
          .from("notification_seen")
          .select("seen_at")
          .eq("user_id", staff.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <section>
      <PageHeader back={{ href: "/", label: "TUDOR HALL" }} />

      <PageTitle>Notifications</PageTitle>
      <p className="mt-1 text-sm text-white/60">
        {staff?.role === "rd"
          ? "Front-desk schedule changes, plus every incident report and maintenance request staff file."
          : "Front-desk schedule changes — who claimed, released, or covered which shift."}
      </p>

      <Card variant="sheet" className="mt-6">
        <NotificationList
          rows={rows ?? []}
          seenAt={seen?.seen_at ?? null}
          meId={staff?.id ?? null}
        />
      </Card>
    </section>
  );
}
