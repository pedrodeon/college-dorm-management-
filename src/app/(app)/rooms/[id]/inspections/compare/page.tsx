import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConditionChip } from "@/components/condition-chip";
import { PHOTO_BUCKET } from "@/lib/photos";
import type { InspectionType, ItemCondition } from "@/lib/types";
import { PageTitle } from "@/components/ui/typography";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

type SideInspection = {
  id: string;
  type: InspectionType;
  timestamp: string;
  room_id: string;
  rooms: { room_number: string } | null;
  inspection_items: {
    item_name: string;
    condition: ItemCondition;
    inventory_items: { id: string; name: string; sort_order: number } | null;
    inspection_photos: { id: string; storage_path: string }[];
  }[];
};

const TYPE_LABEL: Record<InspectionType, string> = {
  move_in: "Move-in",
  move_out: "Move-out",
  periodic: "Periodic",
};

// Ordinal severity so we can tell a degradation (got worse) from a repair.
const SEVERITY: Record<ItemCondition, number> = {
  good: 0,
  fair: 1,
  damaged: 2,
  missing: 3,
};

const SELECT = `id, type, timestamp, room_id, rooms ( room_number ),
   inspection_items ( item_name, condition, inventory_items ( id, name, sort_order ),
                      inspection_photos ( id, storage_path ) )`;

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { id: roomId } = await params;
  const { a, b } = await searchParams;
  if (!a || !b) notFound();

  const supabase = await createClient();
  const [{ data: left }, { data: right }] = await Promise.all([
    supabase.from("inspections").select(SELECT).eq("id", a).single().overrideTypes<SideInspection>(),
    supabase.from("inspections").select(SELECT).eq("id", b).single().overrideTypes<SideInspection>(),
  ]);

  // Both must exist and belong to this room (no cross-room compares via URL).
  if (
    !left ||
    !right ||
    left.room_id !== roomId ||
    right.room_id !== roomId
  ) {
    notFound();
  }

  // Union of items by sort_order (template could have changed between snapshots).
  type Row = {
    name: string;
    sort_order: number;
    left?: ItemCondition;
    right?: ItemCondition;
    leftPhotos: string[]; // storage paths
    rightPhotos: string[];
  };
  const byId = new Map<string, Row>();
  for (const [side, insp] of [
    ["left", left],
    ["right", right],
  ] as const) {
    for (const item of insp.inspection_items) {
      const inv = item.inventory_items;
      if (!inv) continue;
      const entry = byId.get(inv.id) ?? {
        // The snapshot's own name, not the template's current one.
        name: item.item_name,
        sort_order: inv.sort_order,
        leftPhotos: [],
        rightPhotos: [],
      };
      entry[side] = item.condition;
      entry[side === "left" ? "leftPhotos" : "rightPhotos"] =
        item.inspection_photos.map((p) => p.storage_path);
      byId.set(inv.id, entry);
    }
  }
  const rows = [...byId.values()].sort((x, y) => x.sort_order - y.sort_order);

  // Signed URLs for both sides' photos (private bucket, caller's RLS).
  const allPaths = rows.flatMap((r) => [...r.leftPhotos, ...r.rightPhotos]);
  const signedByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(allPaths, 3600);
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) {
        signedByPath.set(entry.path, entry.signedUrl);
      }
    }
  }

  function Thumbs({ paths, label }: { paths: string[]; label: string }) {
    if (paths.length === 0) return null;
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {paths.map((path) => {
          const url = signedByPath.get(path);
          if (!url) return null;
          return (
            <a key={path} href={url} target="_blank" rel="noreferrer" title="Open full size">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`${label} photo`}
                className="h-14 w-14 rounded border border-gray-200 object-cover"
              />
            </a>
          );
        })}
      </div>
    );
  }

  return (
    <section>
      <PageHeader back={{ href: `/rooms/${roomId}`, label: left.rooms ? `Room ${left.rooms.room_number}` : "Room" }} />

      <PageTitle>Compare inspections</PageTitle>

      <Card variant="sheet" className="mt-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">
                <Link href={`/inspections/${left.id}`} className="hover:text-navy hover:underline">
                  {TYPE_LABEL[left.type]}
                  <span className="block font-normal normal-case text-gray-400">
                    {new Date(left.timestamp).toLocaleDateString()}
                  </span>
                </Link>
              </th>
              <th className="px-3 py-2">
                <Link href={`/inspections/${right.id}`} className="hover:text-navy hover:underline">
                  {TYPE_LABEL[right.type]}
                  <span className="block font-normal normal-case text-gray-400">
                    {new Date(right.timestamp).toLocaleDateString()}
                  </span>
                </Link>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const differs = row.left !== row.right;
              // Highlight in orange when the second snapshot is worse — the
              // damage that appeared between the two inspections.
              const degraded =
                row.left !== undefined &&
                row.right !== undefined &&
                SEVERITY[row.right] > SEVERITY[row.left];
              return (
                <tr
                  key={row.name}
                  className={`border-t border-gray-100 ${
                    degraded
                      ? "border-l-4 border-l-accent bg-accent-soft"
                      : differs
                        ? "bg-gray-50"
                        : ""
                  }`}
                >
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2 align-top">
                    {row.left ? <ConditionChip condition={row.left} /> : "—"}
                    <Thumbs paths={row.leftPhotos} label={row.name} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    {row.right ? <ConditionChip condition={row.right} /> : "—"}
                    <Thumbs paths={row.rightPhotos} label={row.name} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        Rows highlighted orange got worse between the two snapshots — the damage
        to attribute.
      </p>
      </Card>
    </section>
  );
}
