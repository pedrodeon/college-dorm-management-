import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConditionChip } from "@/components/condition-chip";
import { signedUrlMap } from "@/lib/photos";
import { INSPECTION_TYPE_LABEL } from "@/lib/attestations";
import { CHICAGO_TZ } from "@/lib/chicago-date";
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
    note: string | null;
    inventory_items: { id: string; name: string; sort_order: number } | null;
    inspection_photos: { id: string; storage_path: string }[];
  }[];
};

// Ordinal severity so we can tell a degradation (got worse) from a repair.
const SEVERITY: Record<ItemCondition, number> = {
  good: 0,
  fair: 1,
  damaged: 2,
  missing: 3,
};

const SELECT = `id, type, timestamp, room_id, rooms ( room_number ),
   inspection_items ( item_name, condition, note, inventory_items ( id, name, sort_order ),
                      inspection_photos ( id, storage_path ) )`;

/** Server-rendered, so the building's clock — never the server's. */
function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: CHICAGO_TZ,
    dateStyle: "medium",
  });
}

type Side = { condition: ItemCondition; note: string | null; photos: string[] };

/** One side of a row: the chip, the item note, and photo thumbnails. */
function Cell({
  side,
  label,
  signedByPath,
}: {
  side: Side | undefined;
  label: string;
  signedByPath: Map<string, string>;
}) {
  if (!side) return <>—</>;
  return (
    <>
      <ConditionChip condition={side.condition} />
      {side.note && <p className="mt-1 text-xs text-gray-500">{side.note}</p>}
      {side.photos.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {side.photos.map((path) => {
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
      )}
    </>
  );
}

/** A column header naming the snapshot and linking to its record. */
function Heading({ insp, when }: { insp: SideInspection; when: string }) {
  return (
    <th className="px-3 py-2">
      <Link href={`/inspections/${insp.id}`} className="hover:text-navy hover:underline">
        {when} · {INSPECTION_TYPE_LABEL[insp.type]}
        <span className="block font-normal normal-case text-gray-400">
          {dateOf(insp.timestamp)}
        </span>
      </Link>
    </th>
  );
}

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
  const [{ data: first }, { data: second }] = await Promise.all([
    supabase.from("inspections").select(SELECT).eq("id", a).single().overrideTypes<SideInspection>(),
    supabase.from("inspections").select(SELECT).eq("id", b).single().overrideTypes<SideInspection>(),
  ]);

  // Both must exist and belong to this room (no cross-room compares via URL).
  if (
    !first ||
    !second ||
    first.room_id !== roomId ||
    second.room_id !== roomId
  ) {
    notFound();
  }

  // Time decides the sides, not the picker: "got worse" must mean the LATER
  // snapshot is worse, whichever order the two were chosen in.
  const [before, after] = [first, second].sort(
    (x, y) => new Date(x.timestamp).getTime() - new Date(y.timestamp).getTime(),
  );

  // Union of items by inventory id (the template could have changed between
  // snapshots), in template order.
  type Row = {
    id: string;
    name: string;
    sort_order: number;
    before?: Side;
    after?: Side;
  };
  const byId = new Map<string, Row>();
  for (const [side, insp] of [
    ["before", before],
    ["after", after],
  ] as const) {
    for (const item of insp.inspection_items) {
      const inv = item.inventory_items;
      if (!inv) continue;
      const entry = byId.get(inv.id) ?? {
        id: inv.id,
        // The snapshot's own name, not the template's current one.
        name: item.item_name,
        sort_order: inv.sort_order,
      };
      entry[side] = {
        condition: item.condition,
        note: item.note,
        photos: item.inspection_photos.map((p) => p.storage_path),
      };
      byId.set(inv.id, entry);
    }
  }
  const rows = [...byId.values()].sort((x, y) => x.sort_order - y.sort_order);

  // Signed URLs for both sides' photos (private bucket, caller's RLS).
  const signedByPath = await signedUrlMap(
    supabase,
    rows.flatMap((r) => [...(r.before?.photos ?? []), ...(r.after?.photos ?? [])]),
  );

  return (
    <section>
      <PageHeader back={{ href: `/rooms/${roomId}`, label: before.rooms ? `Room ${before.rooms.room_number}` : "Room" }} />

      <PageTitle>Compare inspections</PageTitle>

      <Card variant="sheet" className="mt-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Item</th>
              <Heading insp={before} when="Before" />
              <Heading insp={after} when="After" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const differs = row.before?.condition !== row.after?.condition;
              const worse =
                row.before !== undefined &&
                row.after !== undefined &&
                SEVERITY[row.after.condition] > SEVERITY[row.before.condition];
              // Orange is for damage: an item that is now damaged or missing.
              // Good→fair is worth a glance, not the accent.
              const damage =
                worse &&
                (row.after!.condition === "damaged" || row.after!.condition === "missing");
              return (
                <tr
                  key={row.id}
                  className={`border-t border-gray-100 ${
                    damage
                      ? "border-l-4 border-l-accent bg-accent-soft"
                      : worse
                        ? "border-l-4 border-l-gray-400 bg-gray-50 font-medium"
                        : differs
                          ? "bg-gray-50"
                          : ""
                  }`}
                >
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2 align-top">
                    <Cell side={row.before} label={row.name} signedByPath={signedByPath} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Cell side={row.after} label={row.name} signedByPath={signedByPath} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        Earlier snapshot on the left. Rows highlighted orange ended up damaged
        or missing — the damage to attribute; a grey bar marks an item that
        slipped from good to fair.
      </p>
      </Card>
    </section>
  );
}
