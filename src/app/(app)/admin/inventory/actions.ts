"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRd } from "@/lib/auth";
import { humanDbError } from "@/lib/db-errors";

export type ActionResult = { ok: true } | { ok: false; error: string };

function orderError(sortOrder: number): string | null {
  if (!Number.isInteger(sortOrder) || sortOrder < 1) {
    return "Position must be a whole number, 1 or higher.";
  }
  return null;
}

export async function createItem(name: string, sortOrder: number): Promise<ActionResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;

  if (!name.trim()) return { ok: false, error: "Name is required." };
  const invalid = orderError(sortOrder);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_items")
    .insert({ name: name.trim(), sort_order: sortOrder });
  if (error) return { ok: false, error: humanDbError(error, "The item couldn't be added.") };
  revalidatePath("/admin/inventory");
  return { ok: true };
}

/**
 * Rename and/or reposition one item. Positions are unique, so moving an item
 * onto another's position SWAPS the two — the only way to reorder a list
 * whose every slot is taken. The swap is three writes through a parking
 * position; if it fails partway, the message says which item to look at.
 */
export async function updateItem(id: string, name: string, sortOrder: number): Promise<ActionResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;

  if (!name.trim()) return { ok: false, error: "Name is required." };
  const invalid = orderError(sortOrder);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("inventory_items")
    .select("sort_order")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { ok: false, error: humanDbError(readError, "The item couldn't be read.") };
  if (!current) return { ok: false, error: "That item no longer exists — refresh the page." };

  if (current.sort_order !== sortOrder) {
    const swapped = await swapInto(supabase, id, current.sort_order, sortOrder);
    if (swapped) return swapped;
  }

  const { data: rows, error } = await supabase
    .from("inventory_items")
    .update({ name: name.trim(), sort_order: sortOrder })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: humanDbError(error, "The item couldn't be saved.") };
  if (!rows?.length) return { ok: false, error: "That item no longer exists — refresh the page." };
  revalidatePath("/admin/inventory");
  return { ok: true };
}

/**
 * If another item holds `target`, move it to `vacated` by way of a parking
 * position (the unique key forbids a direct exchange). Returns an error
 * result, or null when the target is free for the caller to take.
 */
async function swapInto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  vacated: number,
  target: number,
): Promise<ActionResult | null> {
  const { data: other, error } = await supabase
    .from("inventory_items")
    .select("id, name")
    .eq("sort_order", target)
    .neq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: humanDbError(error, "The item couldn't be saved.") };
  if (!other) return null;

  // Negative positions never appear in the template, so this can't collide.
  const parking = -Math.abs(target);
  const park = await supabase
    .from("inventory_items")
    .update({ sort_order: parking })
    .eq("id", other.id);
  if (park.error) {
    return { ok: false, error: humanDbError(park.error, `"${other.name}" couldn't be moved out of the way.`) };
  }
  // The caller's own update takes `target` next; `other` gets `vacated`
  // only after that succeeds, so a failure leaves at most one item parked
  // — visible on the list as a negative position, one edit to fix.
  const take = await supabase
    .from("inventory_items")
    .update({ sort_order: target })
    .eq("id", id);
  if (take.error) {
    await supabase.from("inventory_items").update({ sort_order: target }).eq("id", other.id);
    return { ok: false, error: humanDbError(take.error, "The item couldn't be moved.") };
  }
  const give = await supabase
    .from("inventory_items")
    .update({ sort_order: vacated })
    .eq("id", other.id);
  if (give.error) {
    return {
      ok: false,
      error: `The item moved, but "${other.name}" is left at position ${parking}. Give it position ${vacated}.`,
    };
  }
  return null;
}

export async function deleteItem(id: string): Promise<ActionResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    // Past snapshots reference the item (each keeps its own copy of the
    // name, so renaming is always safe; removing is not). humanDbError
    // knows the constraint; the fallback covers any other 23503.
    return {
      ok: false,
      error: humanDbError(
        error,
        error.code === "23503"
          ? "This item appears on past inspections, so it can't be removed. Rename it instead."
          : "The item couldn't be removed.",
      ),
    };
  }
  if (!rows?.length) return { ok: false, error: "That item was already removed — refresh the page." };
  revalidatePath("/admin/inventory");
  return { ok: true };
}
