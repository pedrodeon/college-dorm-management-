// Inspection photo constants, the browser-side downscale helper, and the one
// signed-URL minting helper the record screens share. Plain module: the form
// runs the downscale in the browser; the server pages mint URLs.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Private storage bucket for inspection photos. Created in the migrations. */
export const PHOTO_BUCKET = "inspection-photos";

/** Longest edge after downscale. Phone originals are 3–10 MB; ~1600px JPEG is
 * plenty to show a scuffed wall and keeps uploads (and the free storage tier)
 * small. */
export const PHOTO_MAX_DIMENSION = 1600;

/** The bucket's own cap (see the inspection_photos migration). Checked in the
 * browser before any upload starts, so a too-large photo is refused up front
 * instead of failing halfway through a batch and orphaning what went before. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Photos per inspection item. Each one is downloaded again for the PDF, and
 * the hallway packet multiplies that by every room, so the cap is deliberate. */
export const PHOTOS_PER_ITEM_MAX = 4;

/** How long a signed URL for a photo or signature image stays valid. The
 * record screens mint them per request; an hour outlives any page view. */
export const SIGNED_URL_TTL = 3600;

const JPEG_QUALITY = 0.8;

/**
 * Downscale an image file to a ≤{PHOTO_MAX_DIMENSION}px JPEG blob in the
 * browser. Throws when the browser cannot decode the file (a HEIC on desktop
 * Chrome, say): an undecodable original must never be uploaded under an
 * `image/jpeg` label, because nothing downstream could render it.
 */
export async function downscalePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      `${file.name || "This photo"} can't be read by this browser. Take it again as a JPEG, or pick a different photo.`,
    );
  }
  const scale = Math.min(
    1,
    PHOTO_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) {
    throw new Error(`${file.name || "This photo"} could not be converted to a JPEG.`);
  }
  return blob;
}

/**
 * Short-lived signed URLs for objects in the private bucket, keyed by storage
 * path. Minted under the caller's own client, so only staff who can SELECT
 * the objects get URLs — never public URLs. A path that fails to sign is
 * simply absent from the map; callers render "unavailable" for it rather than
 * dropping the row it belongs to.
 */
export async function signedUrlMap(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Map<string, string>> {
  const byPath = new Map<string, string>();
  if (paths.length === 0) return byPath;
  const { data: signed } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);
  for (const entry of signed ?? []) {
    if (entry.signedUrl && entry.path) byPath.set(entry.path, entry.signedUrl);
  }
  return byPath;
}
