"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InspectionType } from "@/lib/types";
import { INSPECTION_TYPE_LABEL } from "@/lib/attestations";
import { CHICAGO_TZ } from "@/lib/chicago-date";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/typography";

export type HistoryEntry = {
  id: string;
  type: InspectionType;
  timestamp: string;
  inspector: string | null;
};

/** The building's calendar, fixed locale — the same string on the server and
    in the browser, so the list hydrates without a mismatch. */
function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: CHICAGO_TZ,
    dateStyle: "medium",
  });
}

function labelOf(insp: HistoryEntry): string {
  return `${INSPECTION_TYPE_LABEL[insp.type]} · ${dateOf(insp.timestamp)}`;
}

export function InspectionHistory({
  roomId,
  inspections,
}: {
  roomId: string;
  inspections: HistoryEntry[];
}) {
  const router = useRouter();
  // Default the compare picker to the two most recent snapshots; the compare
  // view puts them in time order itself, whichever way round they are picked.
  const [a, setA] = useState(inspections[1]?.id ?? "");
  const [b, setB] = useState(inspections[0]?.id ?? "");

  function compare() {
    if (a && b && a !== b) {
      router.push(`/rooms/${roomId}/inspections/compare?a=${a}&b=${b}`);
    }
  }

  return (
    <div>
      {/* No create button here on purpose: the only inspection types are
          move-in and move-out, and each belongs to one resident, so they are
          started from that resident's screen as part of check-in / check-out.
          This section is history + compare. */}
      <SectionLabel>Inspections</SectionLabel>

      {inspections.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          No inspections yet. Move-in and move-out inspections are recorded from
          a resident&rsquo;s screen, as part of their check-in or check-out.
        </p>
      ) : (
        <Card as="ul" variant="list" className="mt-2">
          {inspections.map((insp) => (
            <li key={insp.id}>
              <Link
                href={`/inspections/${insp.id}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50"
              >
                <span className="text-sm font-medium">
                  {INSPECTION_TYPE_LABEL[insp.type]}
                </span>
                <span className="text-xs text-gray-500">
                  {dateOf(insp.timestamp)}
                  {insp.inspector ? ` · ${insp.inspector}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </Card>
      )}

      {inspections.length >= 2 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Compare
            <select
              value={a}
              onChange={(e) => setA(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {inspections.map((i) => (
                <option key={i.id} value={i.id}>
                  {labelOf(i)}
                </option>
              ))}
            </select>
          </label>
          <span className="pb-2 text-xs text-gray-400">vs</span>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            &nbsp;
            <select
              value={b}
              onChange={(e) => setB(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {inspections.map((i) => (
                <option key={i.id} value={i.id}>
                  {labelOf(i)}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={compare}
            disabled={!a || !b || a === b}
          >
            Compare
          </Button>
        </div>
      )}
    </div>
  );
}
