import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import {
  loadInspectionRecord,
  recordComplete,
  sortedItems,
} from "@/lib/inspection-record";
import { ConditionChip } from "@/components/condition-chip";
import {
  InspectionSignatures,
  type StoredSignature,
  type StoredWaiver,
} from "@/components/inspection-signatures";
import { signedUrlMap } from "@/lib/photos";
import { INSPECTION_TYPE_LABEL } from "@/lib/attestations";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LocalTime } from "@/components/ui/local-time";
import { PageTitle } from "@/components/ui/typography";
import { PageHeader } from "@/components/ui/page-header";
import { staffName } from "@/lib/staff-name";

/**
 * The read-only record view of one inspection. Strictly a viewer: it loads
 * through the same `loadInspectionRecord` the PDF export uses (so screen and
 * document can never disagree) and renders nothing editable — the only
 * mutations reachable from here are the signature/waiver steps while a
 * record is still incomplete, which belong to the check-in/out flow itself.
 */
export default async function InspectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const inspection = await loadInspectionRecord(supabase, id);

  if (!inspection || !inspection.rooms) notFound();

  const stay = inspection.occupancies;
  const residentName = stay?.people?.full_name ?? null;
  const signable =
    (inspection.type === "move_in" || inspection.type === "move_out") &&
    stay !== null;
  const staff = signable ? await getStaffContext() : null;
  const waiverRow = inspection.inspection_signature_waivers;
  const complete = recordComplete(inspection);
  const items = sortedItems(inspection);

  // Short-lived signed URLs for the private bucket, minted under the caller's
  // RLS — only staff who can SELECT the objects get URLs. Never public URLs.
  // Photos and signature images live in the same bucket.
  const signedByPath = await signedUrlMap(supabase, [
    ...items.flatMap((i) => i.inspection_photos.map((p) => p.storage_path)),
    ...inspection.inspection_signatures.map((s) => s.storage_path),
  ]);
  const room = inspection.rooms;

  // Every stored signature passes through, URL or not: a row that exists but
  // whose image failed to sign must still read as "signed" — never as an
  // empty pad that invites a second (and duplicate-refused) signature.
  const stored: StoredSignature[] = inspection.inspection_signatures.map((s) => ({
    role: s.role,
    url: signedByPath.get(s.storage_path) ?? null,
    signed_at: s.signed_at,
    // The RA label must name who SIGNED (captured_by), not whoever is viewing
    // the record.
    signerName: s.role === "ra" ? staffName(s.captured) : undefined,
  }));

  return (
    <section>
      <PageHeader back={{ href: `/rooms/${room.id}`, label: `Room ${room.room_number}` }} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PageTitle>{INSPECTION_TYPE_LABEL[inspection.type]} inspection</PageTitle>
        {signable && !complete && (
          <Badge tone="attention">awaiting signatures</Badge>
        )}
        {/* The liability record: only a COMPLETE inspection (both halves of
            the signature gate) exports; the route re-checks the same rule. */}
        {signable && complete && (
          <a
            href={`/api/inspections/${inspection.id}/pdf`}
            className="rounded-full border border-white/30 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/15"
          >
            Download PDF
          </a>
        )}
      </div>

<Card variant="sheet" className="mt-6">
      {/* The record header — who, where, when, by whom. Same fields the PDF
          prints, from the same loader. */}
      <Card as="dl" variant="box" className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Resident</dt>
          <dd className="font-medium">{residentName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Student ID</dt>
          <dd className="font-mono">{stay?.people?.student_id ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Room</dt>
          <dd>
            {room.hallways ? `${room.hallways.name} · ` : ""}Room {room.room_number}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Term</dt>
          <dd>{stay?.term ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          {/* When the snapshot was taken — the signatures carry their own
              timestamps below. */}
          <dt className="text-gray-500">Inspected</dt>
          <dd>
            <LocalTime iso={inspection.timestamp} />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Conducted by</dt>
          <dd>{staffName(inspection.users)}</dd>
        </div>
      </Card>

      {inspection.notes && (
        <Card as="p" variant="note" className="mt-4">
          {inspection.notes}
        </Card>
      )}

      <Card as="ul" variant="list" className="mt-4">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
          >
            <div>
              <span className="text-sm font-medium">
                {item.item_name}
              </span>
              {item.note && (
                <span className="ml-2 text-xs text-gray-500">{item.note}</span>
              )}
            </div>
            <ConditionChip condition={item.condition} />
            {item.inspection_photos.length > 0 && (
              <div className="flex w-full flex-wrap gap-2">
                {item.inspection_photos.map((photo) => {
                  const url = signedByPath.get(photo.storage_path);
                  if (!url) return null;
                  return (
                    <a
                      key={photo.id}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      title="Open full size"
                    >
                      {/* Signed URLs are short-lived; plain img, no optimizer. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`${item.item_name} photo`}
                        className="h-20 w-20 rounded-md border border-gray-200 object-cover"
                      />
                    </a>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </Card>

      {/* Attestations: resident + RA sign against this exact snapshot; the
          check-in / check-out cannot be finalized until the gate is met. On a
          completed record this renders the stored images read-only. */}
      {signable && stay && (
        <InspectionSignatures
          mode={inspection.type as "move_in" | "move_out"}
          inspectionId={inspection.id}
          occupancyId={stay.id}
          residentName={residentName ?? "the resident"}
          inspectorName={staffName(inspection.users)}
          // "I confirm I conducted this inspection" is only true of the
          // inspector; the database refuses anyone else's `ra` signature.
          viewerIsInspector={staff !== null && inspection.inspected_by === staff.id}
          hallwayId={room.hallways?.id ?? null}
          occupancyStatus={stay.occupancy_status}
          stored={stored}
          waiver={
            waiverRow
              ? ({
                  reason: waiverRow.reason,
                  waivedByName: staffName(waiverRow.users),
                  created_at: waiverRow.created_at,
                } satisfies StoredWaiver)
              : null
          }
        />
      )}
      </Card>
    </section>
  );
}
