"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { humanDbError } from "@/lib/db-errors";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createItem(name: string, sortOrder: number): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, error: "Name is required." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_items")
    .insert({ name: name.trim(), sort_order: sortOrder });
  if (error) return { ok: false, error: humanDbError(error, "The item couldn't be added.") };
  revalidatePath("/admin/inventory");
  return { ok: true };
}

export async function updateItem(id: string, name: string, sortOrder: number): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, error: "Name is required." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_items")
    .update({ name: name.trim(), sort_order: sortOrder })
    .eq("id", id);
  if (error) return { ok: false, error: humanDbError(error, "The item couldn't be saved.") };
  revalidatePath("/admin/inventory");
  return { ok: true };
}

export async function deleteItem(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_items").delete().eq("id", id);
  if (error) {
    // Past snapshots reference the item (each keeps its own copy of the
    // name, so renaming is always safe; removing is not).
    if (error.code === "23503") {
      return {
        ok: false,
        error: "This item appears on past inspections, so it can't be removed. Rename it instead.",
      };
    }
    return { ok: false, error: humanDbError(error, "The item couldn't be removed.") };
  }
  revalidatePath("/admin/inventory");
  return { ok: true };
}
