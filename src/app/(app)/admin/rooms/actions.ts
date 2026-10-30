"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRd } from "@/lib/auth";
import { humanDbError } from "@/lib/db-errors";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Mirrors the rooms_capacity_check constraint: the database refuses 0 or 9
// too, but a sentence here beats a constraint name.
const MAX_CAPACITY = 8;

function capacityError(capacity: number): string | null {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    return `Capacity must be a whole number from 1 to ${MAX_CAPACITY}.`;
  }
  return null;
}

function revalidateRooms() {
  revalidatePath("/admin/rooms");
  // Room lists everywhere else — the new-stay picker, hallway tiles.
  revalidatePath("/admin/residents/new");
  revalidatePath("/hallways", "layout");
}

export async function createRoom(
  hallwayId: string,
  roomNumber: string,
  capacity: number,
): Promise<ActionResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;

  if (!hallwayId || !roomNumber.trim()) {
    return { ok: false, error: "Hallway and room number are required." };
  }
  const invalid = capacityError(capacity);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { error } = await supabase
    .from("rooms")
    .insert({ hallway_id: hallwayId, room_number: roomNumber.trim(), capacity });
  if (error) return { ok: false, error: humanDbError(error, "The room couldn't be added.") };
  revalidateRooms();
  return { ok: true };
}

export async function updateRoom(
  id: string,
  roomNumber: string,
  capacity: number,
): Promise<ActionResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;

  if (!roomNumber.trim()) return { ok: false, error: "Room number is required." };
  const invalid = capacityError(capacity);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();

  // Capacity can't drop below the people living there now. Every stay that
  // isn't complete or archived holds a bed, this term or the next.
  const { count, error: countError } = await supabase
    .from("occupancies")
    .select("id", { count: "exact", head: true })
    .eq("room_id", id)
    .eq("is_archived", false)
    .neq("occupancy_status", "checked_out");
  if (countError) {
    return { ok: false, error: humanDbError(countError, "The room's occupants couldn't be checked.") };
  }
  if ((count ?? 0) > capacity) {
    return {
      ok: false,
      error: `${count} ${count === 1 ? "resident is" : "residents are"} assigned to this room, so capacity can't be set below ${count}. Reassign them first.`,
    };
  }

  const { data: rows, error } = await supabase
    .from("rooms")
    .update({ room_number: roomNumber.trim(), capacity })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: humanDbError(error, "The room couldn't be saved.") };
  if (!rows?.length) {
    return { ok: false, error: "That room no longer exists — refresh the page." };
  }
  revalidateRooms();
  return { ok: true };
}

export async function deleteRoom(id: string): Promise<ActionResult> {
  const rd = await requireRd();
  if (!rd.ok) return rd;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", id)
    .select("id");
  // Stays (including past and archived ones), inspections, room checks,
  // room-change history and incident reports all reference rooms with no
  // cascade; humanDbError names which one got in the way.
  if (error) {
    return {
      ok: false,
      error: humanDbError(
        error,
        "This room has records attached, so it can't be deleted.",
      ),
    };
  }
  if (!rows?.length) {
    return { ok: false, error: "That room was already removed — refresh the page." };
  }
  revalidateRooms();
  return { ok: true };
}
