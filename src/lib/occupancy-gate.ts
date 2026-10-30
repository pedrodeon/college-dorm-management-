// How far a resident has progressed through an occupancy gate.
//
// Both gates need a signed inspection of the matching type before the
// occupancy event can be recorded:
//   move_in  — RA signature + resident signature
//   move_out — RA signature + (resident signature OR a recorded waiver)
//
// `signatures` counts the halves satisfied (0-2) rather than raw rows, so a
// waived resident half reads the same as a signed one. record_occupancy
// enforces the identical rule in the database; this is the shared read of it,
// so the desk and the resident screen can never disagree.

export type OccupancyFlow = "move_in" | "move_out";

export type GateProgress = {
  inspectionId: string;
  /** Halves satisfied, 0-2. Gate is met at 2. */
  signatures: number;
};

/** Shape needed from an inspection row; extra columns are ignored. */
export type GateInspection = {
  id: string;
  type: string;
  timestamp: string;
  inspection_signatures: { role: string }[];
  inspection_signature_waivers: { id: string } | null;
};

/**
 * The furthest-along inspection of `flow` for one resident, or null if they
 * have none yet.
 *
 * A stay can carry more than one inspection of a type (a retry after a
 * timeout, a second tab), so the choice must not depend on the order rows
 * happen to come back in: most signatures first, then the NEWEST. The desk
 * and the resident screen then open the same record, and the hallway packet
 * prints the same one.
 */
export function gateProgress(
  inspections: GateInspection[],
  flow: OccupancyFlow,
): GateProgress | null {
  return (
    inspections
      .filter((i) => i.type === flow)
      .map((i) => {
        const roles = new Set(i.inspection_signatures.map((s) => s.role));
        const residentHalf =
          roles.has("resident") ||
          (flow === "move_out" && i.inspection_signature_waivers !== null);
        return {
          inspectionId: i.id,
          signatures: (roles.has("ra") ? 1 : 0) + (residentHalf ? 1 : 0),
          timestamp: i.timestamp,
        };
      })
      .sort(
        (a, b) =>
          b.signatures - a.signatures || b.timestamp.localeCompare(a.timestamp),
      )
      .map(({ inspectionId, signatures }) => ({ inspectionId, signatures }))[0] ??
    null
  );
}

/**
 * Where a successfully recorded occupancy event lands. BOTH finalize buttons
 * (OccupancyGate and InspectionSignatures) route through this, so the
 * check-in and check-out confirmations can never diverge again — each
 * destination re-verifies the status server-side and bounces mid-flow
 * visitors back to the stay.
 */
export function occupancySuccessPath(
  occupancyId: string,
  event: "check_in" | "check_out",
): string {
  return `/residents/${occupancyId}/${event === "check_in" ? "checked-in" : "checked-out"}`;
}
