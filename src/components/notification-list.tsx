"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { markNotificationsSeen } from "@/app/(app)/notifications/actions";
import { shiftLabel } from "@/lib/desk-shifts";
import { staffName } from "@/lib/staff-name";
import { Card } from "@/components/ui/card";
import { LocalTime } from "@/components/ui/local-time";

export type NotificationRow = {
  id: string;
  type:
    | "claimed"
    | "released"
    | "coverage_requested"
    | "coverage_withdrawn"
    | "coverage_accepted"
    | "assigned"
    | "incident_filed"
    | "maintenance_filed";
  /** Null on report events — those carry target_id instead. */
  shift_date: string | null;
  slot: number | null;
  target_id: string | null;
  created_at: string;
  actor: { id: string; name: string } | null;
  other: { name: string } | null;
};

/** Where a notification leads, or null when it isn't a link. */
function href(n: NotificationRow): string | null {
  if (n.type === "incident_filed") {
    return n.target_id ? `/admin/submissions/incidents/${n.target_id}` : null;
  }
  if (n.type === "maintenance_filed") {
    return "/admin/submissions?tab=maintenance";
  }
  return "/front-desk";
}

/** One sentence per event — the wording lives here, the data is structured. */
function sentence(n: NotificationRow): string {
  const actor = staffName(n.actor);
  const other = staffName(n.other);
  // Report events have no shift; only the desk types below use the label.
  if (n.type === "incident_filed") return `${actor} filed an incident report`;
  if (n.type === "maintenance_filed") return `${actor} filed a maintenance request`;
  const shift = shiftLabel(n.shift_date ?? "", n.slot ?? 0);
  switch (n.type) {
    case "claimed":
      return `${actor} claimed the ${shift} shift`;
    case "released":
      return `${actor} released the ${shift} shift — it's open again`;
    case "coverage_requested":
      return `${actor} needs coverage for the ${shift} shift`;
    case "coverage_withdrawn":
      return `${actor} withdrew their coverage request for ${shift}`;
    case "coverage_accepted":
      return `${actor} accepted coverage for ${shift} from ${other}`;
    case "assigned":
      return n.other
        ? `${actor} assigned the ${shift} shift to ${other}`
        : `${actor} cleared the ${shift} shift`;
  }
}

/**
 * The feed. Rendering it counts as reading it: on mount the seen-watermark
 * moves up to the newest row shown, which clears the header bell badge.
 * The watermark we highlight against is frozen at first render — the
 * action revalidates the layout, which re-renders this page with the new
 * watermark, and without the freeze every "new" chip would vanish the
 * moment the page opened. Your own actions never count as news.
 */
export function NotificationList({
  rows,
  seenAt,
  meId,
}: {
  rows: NotificationRow[];
  /** Newest first — rows[0] is what the watermark moves to. */
  seenAt: string | null;
  meId: string | null;
}) {
  const [highlightAfter] = useState(seenAt);
  const [seenError, setSeenError] = useState<string | null>(null);
  const newest = rows[0]?.created_at ?? null;

  useEffect(() => {
    markNotificationsSeen(newest).then((result) => {
      if (!result.ok) setSeenError(result.error);
    });
  }, [newest]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Nothing yet — Front Desk schedule changes (and, for the RD, filed
        incidents and maintenance requests) will show up here.
      </p>
    );
  }

  return (
    <Card as="ul" variant="list">
      {seenError && (
        <li className="px-4 py-2 text-xs text-muted">
          Couldn&rsquo;t mark these as read: {seenError}
        </li>
      )}
      {rows.map((n) => {
        const mine = meId !== null && n.actor?.id === meId;
        const isNew =
          !mine && (highlightAfter === null || n.created_at > highlightAfter);
        const to = href(n);
        const body = (
          <>
            <p className="text-sm text-ink">{sentence(n)}</p>
            <LocalTime
              iso={n.created_at}
              className="text-xs whitespace-nowrap text-gray-500"
            />
          </>
        );
        const rowClass = `flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 ${
          isNew ? "bg-chip" : ""
        }`;
        return (
          <li key={n.id}>
            {to ? (
              <Link href={to} className={`${rowClass} hover:bg-gray-50`}>
                {body}
              </Link>
            ) : (
              <div className={rowClass}>{body}</div>
            )}
          </li>
        );
      })}
    </Card>
  );
}
