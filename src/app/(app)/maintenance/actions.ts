"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type Urgency = "low" | "normal" | "high";

export type MaintenanceInput = {
  location: string;
  description: string;
  urgency: Urgency;
};

export type MaintenanceResult = { ok: true } | { ok: false; error: string };

/**
 * File a maintenance request. STORED, not e-mailed: the RPC writes the row and
 * the RD's bell notification in one transaction, so an alert exists iff the
 * request does. Any staff member files; only the RD reads the queue and closes
 * it (RLS).
 */
export async function submitMaintenance(
  input: MaintenanceInput,
): Promise<MaintenanceResult> {
  const staff = await getStaffContext();
  if (!staff) return { ok: false, error: "You're not signed in as staff." };

  const location = input.location.trim();
  const description = input.description.trim();
  if (!location) return { ok: false, error: "Say where the problem is." };
  if (!description) return { ok: false, error: "Describe what's broken." };
  if (!["low", "normal", "high"].includes(input.urgency)) {
    return { ok: false, error: "Pick an urgency." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("file_maintenance_request", {
    location,
    description,
    urgency: input.urgency,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout"); // the RD's bell badge lives in the shell
  revalidatePath("/admin/submissions");
  return { ok: true };
}

/**
 * Close or reopen a request. RD only — enforced by RLS as well. The update
 * returns the row it touched: zero rows (unknown id, or RLS hid it) is a
 * failure, not a silent ok.
 */
export async function setMaintenanceStatus(
  id: string,
  status: "open" | "done",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await getStaffContext();
  if (!staff || staff.role !== "rd") {
    return { ok: false, error: "Only the RD can close maintenance requests." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_requests")
    .update(
      status === "done"
        ? { status, done_by: staff.id, done_at: new Date().toISOString() }
        : { status, done_by: null, done_at: null },
    )
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "That request wasn't found — reload the page." };
  }

  revalidatePath("/admin/submissions");
  return { ok: true };
}
