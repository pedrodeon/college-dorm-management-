"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordOccupancy } from "@/app/(app)/desk/actions";
import {
  occupancySuccessPath,
  type GateProgress,
  type OccupancyFlow,
} from "@/lib/occupancy-gate";
import type { OccupancyStatus } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";

export type GateResident = {
  /** The OCCUPANCY id — what record_occupancy and the inspection both key on. */
  id: string;
  full_name: string;
  room_id: string;
  hallway_id: string | null;
};

const FLOW = {
  move_in: {
    intent: "Check-in",
    // Intent-first labels (the mockup's "Check in"): step 1 still opens the
    // move-in inspection — same route, same gate.
    inlineStart: "Check in",
    inlineDone: "Check in",
    inspectionStep: "move-in inspection",
    event: "check_in" as const,
    nextStatus: "checked_in" as OccupancyStatus,
  },
  move_out: {
    intent: "Check-out",
    inlineStart: "Check out",
    inlineDone: "Check out",
    inspectionStep: "move-out inspection",
    event: "check_out" as const,
    nextStatus: "checked_out" as OccupancyStatus,
  },
};

/**
 * The occupancy ladder: where a resident stands in the signed-inspection flow
 * decides what this control offers — start the inspection, finish the
 * signatures, or record the occupancy event. The record_occupancy RPC enforces
 * the same rules server-side, so this is presentation, not the boundary.
 *
 * `variant="inline"` is the desk's compact chip ladder (labels name the next
 * step). `variant="primary"` is the resident screen's single status-driven
 * action (label names the intent — Check-in / Check-out — with a hint below
 * showing which step the flow is actually on).
 */
export function OccupancyGate({
  resident,
  flow,
  progress,
  variant,
  onOptimistic,
  onError,
}: {
  resident: GateResident;
  flow: OccupancyFlow;
  progress: GateProgress | null;
  variant: "inline" | "primary";
  /**
   * Lets a parent apply an optimistic status change in the same transition.
   * Called only once the event is recorded: flipping earlier would drop the
   * row out of a filtered list and unmount this control before a refusal
   * could be shown.
   */
  onOptimistic?: (occupancyId: string, status: OccupancyStatus) => void;
  /**
   * Where a refusal goes when the parent owns the list. `null` clears it. A
   * parent that supplies this must render the message itself; the inline
   * variant only shows errors locally when it is absent.
   */
  onError?: (occupancyId: string, message: string | null) => void;
}) {
  const router = useRouter();
  const copy = FLOW[flow];
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const gateMet = (progress?.signatures ?? 0) >= 2;
  const inspectionHref = `/rooms/${resident.room_id}/inspections/new?type=${flow}&resident=${resident.id}`;
  const reviewHref = progress ? `/inspections/${progress.inspectionId}` : null;

  function report(message: string | null) {
    setError(message);
    onError?.(resident.id, message);
  }

  function finalize() {
    report(null);
    startTransition(async () => {
      const result = await recordOccupancy(
        resident.id,
        copy.event,
        resident.hallway_id,
      );
      if (!result.ok) {
        report(result.error);
        return;
      }
      // After an await, updates need their own transition to stay one.
      startTransition(() => {
        onOptimistic?.(resident.id, copy.nextStatus);
        // Every finalized event gets its confirmation screen; the route
        // re-verifies the status server-side, so a race just bounces back.
        router.push(occupancySuccessPath(resident.id, copy.event));
      });
    });
  }

  // ---- Desk: compact chips naming the next step (visually unchanged) -------
  if (variant === "inline") {
    if (!progress) {
      return (
        <LinkButton size="sm" href={inspectionHref}>
          {copy.inlineStart}
        </LinkButton>
      );
    }
    if (!gateMet) {
      return (
        <LinkButton variant="attention" size="sm" href={reviewHref!}>
          Signatures ({progress.signatures}/2)
        </LinkButton>
      );
    }
    return (
      <>
        <Button size="sm" onClick={finalize} disabled={isPending}>
          {isPending ? "Recording…" : copy.inlineDone}
        </Button>
        {error && !onError && (
          <span role="alert" className="basis-full text-xs text-red-800">
            {error}
          </span>
        )}
      </>
    );
  }

  // ---- Resident screen: one action named by intent, with a step hint -------
  return (
    <div>
      {error && (
        <Alert tone="error" className="mb-2">
          {error}
        </Alert>
      )}

      {!progress ? (
        <>
          <LinkButton size="lg" href={inspectionHref} className="inline-block">
            {copy.intent}
          </LinkButton>
          <p className="mt-2 text-xs text-gray-500">
            Step 1 of 2 — record the {copy.inspectionStep}.
          </p>
        </>
      ) : !gateMet ? (
        <>
          <LinkButton size="lg" href={reviewHref!} className="inline-block">
            {copy.intent}
          </LinkButton>
          <p className="mt-2">
            <Badge tone="attention">
              Step 2 of 2 — awaiting signatures ({progress.signatures}/2)
            </Badge>
          </p>
        </>
      ) : (
        <>
          <Button size="lg" onClick={finalize} disabled={isPending}>
            {isPending ? "Recording…" : copy.intent}
          </Button>
          <p className="mt-2 text-xs text-gray-500">
            Inspection signed — ready to finalize.
          </p>
        </>
      )}
    </div>
  );
}
