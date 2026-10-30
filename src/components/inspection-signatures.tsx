"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import {
  addInspectionSignature,
  waiveResidentSignature,
} from "@/app/(app)/inspections/[id]/actions";
import { recordOccupancy } from "@/app/(app)/desk/actions";
import { occupancySuccessPath } from "@/lib/occupancy-gate";
import { ATTESTATIONS, WAIVER_REASON_MAX_LENGTH } from "@/lib/attestations";
import { createClient } from "@/lib/supabase/client";
import { PHOTO_BUCKET } from "@/lib/photos";
import type { SignatureRole } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LocalTime } from "@/components/ui/local-time";
import { SectionLabel } from "@/components/ui/typography";

export type StoredSignature = {
  role: SignatureRole;
  /** Signed URL, or null when the image could not be signed for this view.
      The row still exists — the role is signed either way. */
  url: string | null;
  signed_at: string;
  /** Who actually signed (from captured_by) — a stored RA signature must be
      labeled with the signer, not whoever happens to be viewing. */
  signerName?: string;
};

export type StoredWaiver = {
  reason: string;
  waivedByName: string;
  created_at: string;
};

type Mode = "move_in" | "move_out";

// Finalization per inspection type. The resident is present at move-in by
// definition, so only move-out offers the waiver. The attestation sentences
// themselves live in lib/attestations.ts, shared with the PDF.
const MODE_COPY: Record<
  Mode,
  {
    finalizeStatus: string; // occupancy_status that can still be finalized
    finalizeLabel: string;
    finalizeType: "check_in" | "check_out";
    doneStatus: string;
    doneText: string;
  }
> = {
  move_in: {
    finalizeStatus: "expected",
    finalizeLabel: "Finalize check-in",
    finalizeType: "check_in",
    doneStatus: "checked_in",
    doneText: "is checked in.",
  },
  move_out: {
    finalizeStatus: "checked_in",
    finalizeLabel: "Finalize check-out",
    finalizeType: "check_out",
    doneStatus: "checked_out",
    doneText: "is checked out.",
  },
};

/**
 * The attestation step on a move-in or move-out inspection. Each signature
 * saves independently and permanently; finalization is gated on the RA
 * signature plus the resident half — the resident's signature, or (move-out
 * only) a recorded "unavailable / declined to sign" waiver with its reason.
 * The record_occupancy RPC enforces the same rule server-side. The RA half
 * is offered only to the inspector: "I confirm I conducted this inspection"
 * is nobody else's to sign, and the database refuses anyone else.
 */
export function InspectionSignatures({
  mode,
  inspectionId,
  occupancyId,
  residentName,
  inspectorName,
  viewerIsInspector,
  hallwayId,
  occupancyStatus,
  stored,
  waiver,
}: {
  mode: Mode;
  inspectionId: string;
  /** The stay being finalized — inspections and signatures are per-stay. */
  occupancyId: string;
  residentName: string;
  /** Who conducted the inspection — the only staff who can sign as the RA. */
  inspectorName: string;
  viewerIsInspector: boolean;
  hallwayId: string | null;
  occupancyStatus: string;
  stored: StoredSignature[];
  waiver: StoredWaiver | null;
}) {
  const router = useRouter();
  const copy = MODE_COPY[mode];
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const byRole = (role: SignatureRole) => stored.find((s) => s.role === role);
  const residentHalf = !!byRole("resident") || waiver !== null;
  const gateSatisfied = !!byRole("ra") && residentHalf;

  function save(role: SignatureRole, pad: SignaturePadHandle | null) {
    setError(null);
    startTransition(async () => {
      const blob = await pad?.getBlob();
      if (!blob) {
        setError("Draw the signature before saving.");
        return;
      }
      const supabase = createClient();
      const path = `signatures/${inspectionId}/${role}-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/png" });
      if (uploadError) {
        setError(`Could not save the signature: ${uploadError.message}`);
        return;
      }
      const result = await addInspectionSignature(inspectionId, role, path);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function waive(reason: string) {
    setError(null);
    startTransition(async () => {
      const result = await waiveResidentSignature(inspectionId, reason);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function finalize() {
    setError(null);
    startTransition(async () => {
      const result = await recordOccupancy(
        occupancyId,
        copy.finalizeType,
        hallwayId,
      );
      if (!result.ok) setError(result.error);
      // Every finalized event gets its confirmation screen, no matter which
      // screen finalized it — the shared path keeps this and OccupancyGate
      // from ever diverging again. The route re-verifies the status
      // server-side, so a race just bounces back.
      else router.push(occupancySuccessPath(occupancyId, copy.finalizeType));
    });
  }

  return (
    <div className="mt-8">
      <SectionLabel>Signatures</SectionLabel>

      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}

      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <SignatureBlock
          title={`Resident signature — ${residentName}`}
          attestation={ATTESTATIONS[mode].resident}
          existing={byRole("resident")}
          waiver={waiver}
          allowWaiver={mode === "move_out" && !byRole("resident") && !waiver}
          disabled={isPending}
          onSave={(pad) => save("resident", pad)}
          onWaive={waive}
        />
        <SignatureBlock
          title={`RA signature — ${byRole("ra")?.signerName ?? inspectorName}`}
          attestation={ATTESTATIONS[mode].ra}
          existing={byRole("ra")}
          waiver={null}
          allowWaiver={false}
          lockedReason={
            viewerIsInspector
              ? null
              : `Only ${inspectorName}, who conducted this inspection, can sign as the RA.`
          }
          disabled={isPending}
          onSave={(pad) => save("ra", pad)}
          onWaive={() => {}}
        />
      </div>

      {occupancyStatus === copy.finalizeStatus && (
        <div className="mt-4">
          {gateSatisfied ? (
            <Button size="lg" onClick={finalize} disabled={isPending}>
              {isPending
                ? "Finalizing…"
                : `${copy.finalizeLabel} for ${residentName}`}
            </Button>
          ) : (
            <Alert tone="attention">
              {mode === "move_in"
                ? "Check-in stays incomplete until both signatures are captured."
                : "Check-out stays incomplete until the RA has signed and the resident has either signed or been recorded as unavailable."}
            </Alert>
          )}
        </div>
      )}
      {occupancyStatus === copy.doneStatus && (
        <p className="mt-4 text-sm text-gray-600">
          {residentName} {copy.doneText}
        </p>
      )}
    </div>
  );
}

function SignatureBlock({
  title,
  attestation,
  existing,
  waiver,
  allowWaiver,
  lockedReason = null,
  disabled,
  onSave,
  onWaive,
}: {
  title: string;
  attestation: string;
  existing: StoredSignature | undefined;
  waiver: StoredWaiver | null;
  allowWaiver: boolean;
  /** When set, the pad is withheld and this sentence says why. */
  lockedReason?: string | null;
  disabled: boolean;
  onSave: (pad: SignaturePadHandle | null) => void;
  onWaive: (reason: string) => void;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");

  return (
    <Card variant="box">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500">&ldquo;{attestation}&rdquo;</p>

      {existing ? (
        <div className="mt-3">
          {/* Stored, immutable; served via a short-lived signed URL. */}
          {existing.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={existing.url}
              alt={`${title} (signed)`}
              className="h-32 w-full rounded-md border border-gray-200 bg-white object-contain"
            />
          ) : (
            <div className="flex h-32 w-full items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-500">
              Signed — image unavailable right now
            </div>
          )}
          <p className="mt-1.5 text-xs text-gray-500">
            Signed <LocalTime iso={existing.signed_at} />
          </p>
        </div>
      ) : waiver ? (
        // The documented absence of the resident signature — needs-attention
        // orange, permanently part of this inspection's record.
        <div className="mt-3 rounded-md border-l-4 border-accent bg-accent-soft px-3 py-2.5 text-sm text-ink">
          <p className="font-semibold">Resident signature waived</p>
          <p className="mt-1 whitespace-pre-wrap">{waiver.reason}</p>
          <p className="mt-1.5 text-xs">
            Recorded by {waiver.waivedByName},{" "}
            <LocalTime iso={waiver.created_at} />
          </p>
        </div>
      ) : lockedReason ? (
        <Alert tone="info" className="mt-3">
          {lockedReason}
        </Alert>
      ) : (
        <div className="mt-3">
          <SignaturePad ref={padRef} onDirtyChange={setDirty} disabled={disabled} />
          <Button
            className="mt-2"
            onClick={() => onSave(padRef.current)}
            disabled={disabled || !dirty}
          >
            Save signature
          </Button>

          {allowWaiver && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              {!waiverOpen ? (
                <button
                  type="button"
                  onClick={() => setWaiverOpen(true)}
                  className="text-xs font-medium text-gray-500 underline hover:text-navy"
                >
                  Resident unavailable or declined to sign?
                </button>
              ) : (
                <div>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-gray-600">
                      Reason (required) — why is the resident not signing?
                    </span>
                    <textarea
                      value={waiverReason}
                      onChange={(e) => setWaiverReason(e.target.value)}
                      maxLength={WAIVER_REASON_MAX_LENGTH}
                      rows={2}
                      className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="attention"
                      size="sm"
                      onClick={() => onWaive(waiverReason)}
                      disabled={disabled || waiverReason.trim() === ""}
                    >
                      Record without resident signature
                    </Button>
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => setWaiverOpen(false)}
                      disabled={disabled}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
