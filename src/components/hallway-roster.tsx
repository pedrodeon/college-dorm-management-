"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Avatar, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PillToggle } from "@/components/ui/pill-toggle";
import { SectionLabel } from "@/components/ui/typography";
import { togglePresence, bulkSetPresence } from "@/app/(app)/hallways/[id]/actions";
import type { OccupancyStatus } from "@/lib/types";

export type RosterEntry = {
  id: string;
  full_name: string;
  room_number: string;
  occupancy_status: OccupancyStatus;
  is_present: boolean;
};

function statusLabel(entry: RosterEntry) {
  if (entry.occupancy_status === "expected") return "Not yet arrived";
  if (entry.occupancy_status === "checked_out") return "Checked out";
  return entry.is_present ? "In building" : "Away from building";
}

export function HallwayRoster({
  hallwayId,
  residents,
}: {
  hallwayId: string;
  residents: RosterEntry[];
}) {
  const [error, setError] = useState<string | null>(null);
  // Away-only view — display filter only, nothing about the data changes.
  const [filter, setFilter] = useState<"all" | "away">("all");
  const [isPending, startTransition] = useTransition();

  // Optimistic overlay of is_present by resident id, so flips feel instant.
  const [optimistic, setOptimistic] = useOptimistic(
    residents,
    (state, update: { ids: string[]; isPresent: boolean }) =>
      state.map((r) =>
        update.ids.includes(r.id) ? { ...r, is_present: update.isPresent } : r,
      ),
  );

  const checkedIn = optimistic.filter((r) => r.occupancy_status === "checked_in");
  const awayCount = checkedIn.filter((r) => !r.is_present).length;
  const visible =
    filter === "away"
      ? optimistic.filter(
          (r) => r.occupancy_status === "checked_in" && !r.is_present,
        )
      : optimistic;

  function flip(id: string, makePresent: boolean) {
    setError(null);
    startTransition(async () => {
      setOptimistic({ ids: [id], isPresent: makePresent });
      const result = await togglePresence(id, makePresent, hallwayId);
      if (!result.ok) setError(result.error);
    });
  }

  function flipAll(makePresent: boolean) {
    // "Mark all away" writes a permanent presence event per checked-in
    // resident; a mis-tap on the break-day screen shouldn't do that silently.
    if (
      !makePresent &&
      !confirm(
        `Mark all ${checkedIn.length} checked-in ${checkedIn.length === 1 ? "resident" : "residents"} away? Each one is recorded in presence history.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      setOptimistic({
        ids: checkedIn.map((r) => r.id),
        isPresent: makePresent,
      });
      const result = await bulkSetPresence(hallwayId, makePresent);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <SectionLabel>Roster</SectionLabel>
        {/* View filter — print shows the full list. */}
        <PillToggle
          className="print:hidden"
          options={[
            { value: "all", label: `All ${optimistic.length}` },
            { value: "away", label: `Away ${awayCount}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {/* Bulk sweep + print — the break-day workflow, kept from v1. */}
      <div className="mt-2.5 flex flex-wrap gap-2 px-1 print:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => flipAll(true)}
          disabled={isPending || checkedIn.length === 0}
        >
          Mark all present
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => flipAll(false)}
          disabled={isPending || checkedIn.length === 0}
        >
          Mark all away
        </Button>
        <Button variant="subtle" size="sm" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      {error && (
        <Alert tone="error" className="mt-2 print:hidden">
          {error}
        </Alert>
      )}

      {optimistic.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No residents in this hallway yet.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nobody is marked away.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {visible.map((resident) => {
            const away =
              resident.occupancy_status === "checked_in" && !resident.is_present;
            return (
              <li
                key={resident.id}
                className={`flex items-center gap-3 rounded-[18px] border bg-white px-3 py-[11px] shadow-[0_2px_6px_rgba(15,29,58,0.05)] ${
                  away ? "border-accent-border" : "border-line"
                }`}
              >
                <Avatar name={resident.full_name} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/residents/${resident.id}`}
                    className="block truncate text-sm font-semibold text-ink hover:text-navy hover:underline"
                  >
                    {resident.full_name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    Room {resident.room_number} · {statusLabel(resident)}
                  </p>
                </div>

                {resident.occupancy_status === "checked_in" ? (
                  <PresenceToggle
                    present={resident.is_present}
                    disabled={isPending}
                    onChange={(makePresent) => flip(resident.id, makePresent)}
                  />
                ) : resident.occupancy_status === "expected" ? (
                  <Badge tone="attention">Expected</Badge>
                ) : (
                  <Badge tone="quiet">Checked out</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PresenceToggle({
  present,
  disabled,
  onChange,
}: {
  present: boolean;
  disabled: boolean;
  onChange: (makePresent: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={present}
      aria-label={present ? "Mark away" : "Mark present"}
      disabled={disabled}
      onClick={() => onChange(!present)}
      className={`relative inline-flex h-[30px] w-[52px] flex-none items-center rounded-full border p-[3px] shadow-[inset_0_1px_3px_rgba(15,29,58,0.18)] transition-colors disabled:opacity-50 print:hidden ${
        present
          ? "border-navy bg-navy"
          : "border-accent-deep bg-accent"
      }`}
    >
      <span
        className={`block h-6 w-6 transform rounded-full bg-white shadow-[0_2px_5px_rgba(15,29,58,0.35)] transition-transform ${
          present ? "translate-x-[22px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}
