import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import { Card, CardLink } from "@/components/ui/card";
import { SquareBadge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { PageTitle } from "@/components/ui/typography";
import { ResidentSearch } from "@/components/resident-search";
import type { Hallway } from "@/lib/types";
import { hallwayAbbrev } from "@/lib/hallway-label";

export const metadata = { title: "Roster — Tudor Hall" };

type HallwayRow = Hallway & {
  hallway_assignments: { users: { name: string } | null }[];
};

/**
 * The Roster tab. An RA lands straight on their own hallway's roster (first
 * by sort_order when they cover several); the RD — or an RA with no
 * assignment — picks a hallway here. The hallway screen itself is the roster
 * (presence toggles, bulk actions); this route just gets people to the right
 * one in a single tap.
 */
export default async function RosterPage() {
  const staff = await getStaffContext();
  const supabase = await createClient();

  if (staff?.role === "ra") {
    const { data: mine } = await supabase
      .from("hallway_assignments")
      .select("hallways ( id, sort_order )")
      .eq("user_id", staff.id)
      .overrideTypes<{ hallways: { id: string; sort_order: number } | null }[]>();
    const first = (mine ?? [])
      .map((a) => a.hallways)
      .filter((h): h is { id: string; sort_order: number } => h !== null)
      .sort((a, b) => a.sort_order - b.sort_order)[0];
    if (first) redirect(`/hallways/${first.id}`);
    // No assignment recorded — fall through to the picker.
  }

  const { data: hallways } = await supabase
    .from("hallways")
    .select(
      `id, name, wing, floor, section, sort_order,
       hallway_assignments ( users ( name ) )`,
    )
    .order("sort_order")
    .overrideTypes<HallwayRow[]>();

  return (
    <section>
      <PageHeader />

      <div className="flex items-center justify-between gap-3">
        <PageTitle>Roster</PageTitle>
        <ResidentSearch />
      </div>
      <p className="mt-1 text-sm text-white/60">
        Pick a hallway to see its residents and presence toggles.
      </p>

      <Card variant="sheet" className="mt-6">
        <ul className="flex flex-col gap-2.5">
          {(hallways ?? []).map((hallway) => {
            const coveredBy = hallway.hallway_assignments
              .map((a) => a.users?.name)
              .filter(Boolean);
            return (
              <li key={hallway.id}>
                <CardLink variant="row" href={`/hallways/${hallway.id}`}>
                  <SquareBadge>{hallwayAbbrev(hallway)}</SquareBadge>
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{hallway.name}</p>
                    <p className="mt-0.5 truncate text-sm text-gray-500">
                      Floor {hallway.floor} · {hallway.wing} wing
                      {coveredBy.length > 0 && ` · ${coveredBy.join(", ")}`}
                    </p>
                  </div>
                </CardLink>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
