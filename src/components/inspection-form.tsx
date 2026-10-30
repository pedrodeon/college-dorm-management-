"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createInspection,
  type InspectionItemInput,
} from "@/app/(app)/rooms/[id]/inspections/new/actions";
import { createClient } from "@/lib/supabase/client";
import {
  downscalePhoto,
  PHOTO_BUCKET,
  PHOTO_MAX_BYTES,
  PHOTOS_PER_ITEM_MAX,
} from "@/lib/photos";
import type {
  CreatableInspectionType,
  InventoryItem,
  ItemCondition,
} from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/typography";

const CONDITIONS: ItemCondition[] = ["good", "fair", "damaged", "missing"];

// A photo picked in the form but not yet uploaded. It is decoded, downscaled
// and size-checked the moment it is picked, so by the time Save runs every
// photo is known to be uploadable — a batch never fails halfway through and
// strands the uploads that went before. Uploads happen on save so an
// abandoned form leaves nothing in the bucket.
type PendingPhoto = { blob: Blob; previewUrl: string };

// One item on the sheet. `condition` starts null: an item nobody looked at
// must never be recorded as "good" and signed for.
type Row = { item_id: string; condition: ItemCondition | null; note: string };

export type FormResident = { id: string; full_name: string };

export function InspectionForm({
  roomId,
  roomNumber,
  residents,
  template,
  defaultType,
  defaultResidentId,
}: {
  roomId: string;
  roomNumber: string;
  residents: FormResident[];
  template: InventoryItem[];
  defaultType: CreatableInspectionType;
  defaultResidentId?: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<CreatableInspectionType>(defaultType);
  // Both inspection types bracket one resident's stay, so a resident is
  // required: preselect the one we were sent for, else the first in the room.
  const [residentId, setResidentId] = useState<string>(
    defaultResidentId ?? residents[0]?.id ?? "",
  );
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>(
    template.map((t) => ({ item_id: t.id, condition: null, note: "" })),
  );
  const [pendingPhotos, setPendingPhotos] = useState<
    Record<string, PendingPhoto[]>
  >({});
  const [preparing, setPreparing] = useState(0); // photos being decoded
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const remaining = rows.filter((r) => r.condition === null).length;
  const canSave =
    !isPending && preparing === 0 && residentId !== "" && remaining === 0;

  // Release preview object URLs when the form unmounts.
  useEffect(() => {
    return () => {
      for (const photos of Object.values(pendingPhotos)) {
        for (const p of photos) URL.revokeObjectURL(p.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setRow(itemId: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => (r.item_id === itemId ? { ...r, ...patch } : r)),
    );
  }

  async function addPhotos(itemId: string, itemName: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setPhotoError(null);
    const room = PHOTOS_PER_ITEM_MAX - (pendingPhotos[itemId]?.length ?? 0);
    const picked = [...files];
    const kept = picked.slice(0, Math.max(0, room));
    const problems: string[] = [];
    if (kept.length < picked.length) {
      problems.push(
        `Up to ${PHOTOS_PER_ITEM_MAX} photos per item — ${itemName} already has ${pendingPhotos[itemId]?.length ?? 0}, so ${picked.length - kept.length} of these were not added.`,
      );
    }

    setPreparing((n) => n + kept.length);
    const prepared = await Promise.all(
      kept.map((file) => preparePhoto(file).catch((e: Error) => e.message)),
    );
    setPreparing((n) => n - kept.length);

    const added: PendingPhoto[] = [];
    for (const result of prepared) {
      if (typeof result === "string") problems.push(result);
      else added.push(result);
    }
    if (added.length > 0) {
      setPendingPhotos((prev) => ({
        ...prev,
        [itemId]: [...(prev[itemId] ?? []), ...added],
      }));
    }
    if (problems.length > 0) setPhotoError(problems.join(" "));
  }

  function removePhoto(itemId: string, previewUrl: string) {
    URL.revokeObjectURL(previewUrl);
    setPendingPhotos((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] ?? []).filter((p) => p.previewUrl !== previewUrl),
    }));
  }

  function submit() {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      // 1. Upload pending photos to the private bucket under one group id.
      //    Runs in the browser under the caller's session; storage RLS allows
      //    staff INSERT only. Photos become immutable the moment they land.
      //    Every blob was decoded and size-checked when it was picked.
      const supabase = createClient();
      const groupId = crypto.randomUUID();
      const pathsByItem: Record<string, string[]> = {};
      const total = Object.values(pendingPhotos).reduce(
        (n, list) => n + list.length,
        0,
      );
      let done = 0;

      for (const [itemId, photos] of Object.entries(pendingPhotos)) {
        for (const photo of photos) {
          setUploadStatus(`Uploading photos… (${done + 1}/${total})`);
          const path = `${groupId}/${itemId}/${done}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from(PHOTO_BUCKET)
            .upload(path, photo.blob, { contentType: "image/jpeg" });
          if (uploadError) {
            setUploadStatus(null);
            setError(`Photo upload failed: ${uploadError.message}`);
            return; // nothing recorded — the RPC never ran
          }
          (pathsByItem[itemId] ??= []).push(path);
          done += 1;
        }
      }
      setUploadStatus(total > 0 ? "Saving inspection…" : null);

      // 2. Record the snapshot (items + photo paths) atomically via the RPC.
      const items: InspectionItemInput[] = rows.map((r) => ({
        item_id: r.item_id,
        condition: r.condition!, // canSave guarantees every row has one
        note: r.note,
        photos: pathsByItem[r.item_id] ?? [],
      }));
      const result = await createInspection({
        roomId,
        // The resident picker's value is the occupancy id.
        occupancyId: residentId || null,
        type,
        notes,
        items,
      });
      // Only returns on error; success redirects server-side.
      setUploadStatus(null);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert tone="error">{error}</Alert>}
      {photoError && <Alert tone="error">{photoError}</Alert>}

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Type</span>
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as CreatableInspectionType)
            }
            className="rounded-md border border-gray-300 px-3 py-2 text-base"
          >
            <option value="move_in">Move-in</option>
            <option value="move_out">Move-out</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Resident</span>
          <select
            value={residentId}
            onChange={(e) => setResidentId(e.target.value)}
            disabled={residents.length === 0}
            className="rounded-md border border-gray-300 px-3 py-2 text-base disabled:bg-gray-50 disabled:text-gray-400"
          >
            {residents.length === 0 && <option value="">No residents</option>}
            {residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {residents.length === 0 && (
        <Alert tone="attention">
          This room has no residents. Move-in and move-out inspections record
          one resident&rsquo;s condition report, so assign a resident first.
        </Alert>
      )}

      <div>
        <SectionLabel>
          Condition — Room {roomNumber}
          <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
            {remaining === 0
              ? "every item rated"
              : `${remaining} of ${template.length} items still need a condition`}
          </span>
        </SectionLabel>
        <Card as="ul" variant="list" className="mt-2">
          {template.map((item) => {
            const row = rows.find((r) => r.item_id === item.id)!;
            const flagged =
              row.condition === "damaged" || row.condition === "missing";
            return (
              <li
                key={item.id}
                className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${
                  flagged ? "border-l-4 border-accent bg-accent-soft" : ""
                }`}
              >
                <span className="w-48 text-sm font-medium">{item.name}</span>
                <select
                  value={row.condition ?? ""}
                  onChange={(e) =>
                    setRow(item.id, {
                      condition: (e.target.value || null) as ItemCondition | null,
                    })
                  }
                  aria-label={`${item.name} condition`}
                  className={`rounded-md border px-2 py-1.5 text-sm capitalize ${
                    row.condition === null
                      ? "border-gray-400 text-gray-500"
                      : "border-gray-300"
                  }`}
                >
                  <option value="">Choose…</option>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c} className="capitalize">
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={row.note}
                  onChange={(e) => setRow(item.id, { note: e.target.value })}
                  placeholder="Note (optional)"
                  aria-label={`${item.name} note`}
                  className="min-w-40 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />

                {/* Photos: camera on phones (capture), file picker at a desk.
                    Capped per item — each photo is downloaded again for every
                    PDF the record appears in. */}
                <label
                  className={`rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-600 ${
                    (pendingPhotos[item.id]?.length ?? 0) >= PHOTOS_PER_ITEM_MAX
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-gray-100"
                  }`}
                >
                  + Photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    disabled={(pendingPhotos[item.id]?.length ?? 0) >= PHOTOS_PER_ITEM_MAX}
                    className="hidden"
                    aria-label={`${item.name} photos`}
                    onChange={(e) => {
                      void addPhotos(item.id, item.name, e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>

                {(pendingPhotos[item.id]?.length ?? 0) > 0 && (
                  <div className="flex w-full flex-wrap gap-2 pt-1">
                    {pendingPhotos[item.id].map((photo) => (
                      <span key={photo.previewUrl} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.previewUrl}
                          alt={`${item.name} photo preview`}
                          className="h-16 w-16 rounded-md border border-gray-200 object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(item.id, photo.previewUrl)}
                          aria-label="Remove photo"
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-navy text-xs text-white hover:bg-navy-dark"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </Card>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Overall notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="rounded-md border border-gray-300 px-3 py-2 text-base"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={submit} disabled={!canSave}>
          {isPending ? (uploadStatus ?? "Saving…") : "Save inspection"}
        </Button>
        <Button
          variant="subtle"
          size="lg"
          onClick={() => router.push(`/rooms/${roomId}`)}
          disabled={isPending}
        >
          Cancel
        </Button>
        {preparing > 0 ? (
          <span className="text-xs text-gray-400">Preparing photos…</span>
        ) : remaining > 0 ? (
          <span className="text-xs text-gray-400">
            Rate every item to save ({remaining} left).
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Decode, downscale and size-check one picked file. Rejects with a sentence
    naming the problem, so nothing undecodable or oversized is ever uploaded. */
async function preparePhoto(file: File): Promise<PendingPhoto> {
  const blob = await downscalePhoto(file);
  if (blob.size > PHOTO_MAX_BYTES) {
    throw new Error(
      `${file.name || "A photo"} is still over ${Math.round(PHOTO_MAX_BYTES / 1024 / 1024)} MB after downscaling and can't be uploaded.`,
    );
  }
  return { blob, previewUrl: URL.createObjectURL(blob) };
}
