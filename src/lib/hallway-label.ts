import type { Hallway } from "@/lib/types";

/** H1, L1, H2A… — the squircle label, derived from the hallway's own fields. */
export function hallwayAbbrev(
  hallway: Pick<Hallway, "wing" | "floor" | "section">,
): string {
  return `${hallway.wing[0].toUpperCase()}${hallway.floor}${hallway.section ?? ""}`;
}
