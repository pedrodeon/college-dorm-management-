// The words an inspection record carries, in one place. Plain module (no
// `server-only`): the signature step renders them in the browser and the PDF
// prints them on the server, and the PDF must print EXACTLY what the resident
// agreed to on screen — so neither side may keep its own copy.

import type { InspectionType, SignatureRole } from "@/lib/types";

/** What each signer attests to, per inspection type. */
export const ATTESTATIONS: Record<
  "move_in" | "move_out",
  Record<SignatureRole, string>
> = {
  move_in: {
    resident: "I agree the recorded conditions are accurate.",
    ra: "I confirm I conducted this inspection.",
  },
  move_out: {
    resident: "I agree the recorded move-out conditions are accurate.",
    ra: "I confirm I conducted this move-out inspection.",
  },
};

/** How an inspection type reads on screen. `periodic` is legacy: never
    created any more, but old records keep rendering. */
export const INSPECTION_TYPE_LABEL: Record<InspectionType, string> = {
  move_in: "Move-in",
  move_out: "Move-out",
  periodic: "Periodic",
};

/** A waiver reason is a sentence or two, not an essay; the PDF box grows to
    fit it but has to stay on one page. The form and the action share the cap. */
export const WAIVER_REASON_MAX_LENGTH = 1000;
