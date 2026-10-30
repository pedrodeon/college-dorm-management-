"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { humanDbError } from "@/lib/db-errors";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type ResidentInput = {
  full_name: string;
  student_id: string;
  room_id: string;
  phone: string;
  emergency_contact: string;
};

/**
 * Opening a stay: either for a person we already have (the returning student) or
 * for a brand-new one. The caller says which — the path is never inferred from
 * whether a student ID happens to match, because the RD needs to SEE that we
 * matched their Jane Doe to last year's Jane Doe before a stay is created.
 */
export type OpenStayInput = {
  person:
    | { kind: "existing"; person_id: string }
    | { kind: "new"; full_name: string; student_id: string };
  room_id: string;
  term: string;
  phone: string;
  emergency_contact: string;
};

export type OpenStayResult =
  | { ok: true; occupancyId: string; archivedPriorStays: number }
  /**
   * The "new person" path hit a student ID we already have. Not an error the RD
   * should have to re-type their way out of: the UI switches to that person.
   */
  | { ok: false; duplicateOf: { person_id: string; full_name: string }; error: string }
  | { ok: false; error: string };

function clean(input: ResidentInput) {
  return {
    full_name: input.full_name.trim(),
    student_id: input.student_id.trim(),
    room_id: input.room_id,
    phone: input.phone.trim() || null,
    emergency_contact: input.emergency_contact.trim() || null,
  };
}

const STATUS_WORD: Record<string, string> = {
  expected: "still expected",
  checked_in: "still checked in",
};

function revalidateRoster() {
  revalidatePath("/admin/residents");
  revalidatePath("/desk");
  revalidatePath("/"); // dashboard counts
}

// All writes go through the RLS-scoped client — RLS enforces RD-only. The admin
// UI guard is defense-in-depth, not the security boundary.

/**
 * Open a new stay — the returning-student flow.
 *
 * A returning student keeps their `people` row and gets a NEW occupancy. Their
 * previous stay is never reused, reset, or edited: it keeps its room, status,
 * and the inspections and events hanging off it, because that is the record a
 * damage dispute is settled from. Completed previous stays are archived so the
 * everyday screens show only the live roster.
 */
export async function openStay(input: OpenStayInput): Promise<OpenStayResult> {
  const term = input.term.trim();
  const phone = input.phone.trim() || null;
  const emergency_contact = input.emergency_contact.trim() || null;

  if (!input.room_id) return { ok: false, error: "Pick a room for the new stay." };
  if (!term) return { ok: false, error: "The term can't be blank." };

  const supabase = await createClient();
  let personId: string;
  let personName: string;

  if (input.person.kind === "existing") {
    const { data: person, error } = await supabase
      .from("people")
      .select("id, full_name")
      .eq("id", input.person.person_id)
      .single();
    if (error) {
      return { ok: false, error: "That person is no longer on record — refresh the list." };
    }
    personId = person.id;
    personName = person.full_name;

    // Refresh contact details; nothing about their history is touched.
    const { error: updateError } = await supabase
      .from("people")
      .update({ phone, emergency_contact })
      .eq("id", personId);
    if (updateError) {
      return { ok: false, error: humanDbError(updateError, "Their contact details couldn't be saved.") };
    }
  } else {
    const full_name = input.person.full_name.trim();
    const student_id = input.person.student_id.trim();
    if (!full_name || !student_id) {
      return { ok: false, error: "Name and student ID are required for a new student." };
    }

    // Duplicate guard: student ID is the identity key, so one match means this
    // is not a new student at all. Hand the person back rather than making a
    // second record of them.
    const { data: existing, error: lookupError } = await supabase
      .from("people")
      .select("id, full_name")
      .eq("student_id", student_id)
      .maybeSingle();
    if (lookupError) {
      return { ok: false, error: humanDbError(lookupError, "The student-ID check failed. Try again.") };
    }
    if (existing) {
      return {
        ok: false,
        duplicateOf: { person_id: existing.id, full_name: existing.full_name },
        error: `${student_id} is already on record as ${existing.full_name}. Open a new stay for them instead of creating a second record.`,
      };
    }

    const { data: created, error } = await supabase
      .from("people")
      .insert({ full_name, student_id, phone, emergency_contact })
      .select("id, full_name")
      .single();
    // The unique constraint is the backstop for the race between the lookup
    // above and this insert.
    if (error) {
      return {
        ok: false,
        error: error.code === "23505"
          ? `${student_id} was just added by someone else. Search for them and open a stay instead.`
          : humanDbError(error, "The student record couldn't be created."),
      };
    }
    personId = created.id;
    personName = created.full_name;
  }

  // A stay that is still expected or checked_in is a live one: opening another
  // would put this person in two rooms, and archiving it behind the RD's back
  // would drop them off the break roster. Refuse with an instruction instead —
  // the partial unique index would reject it anyway, less legibly.
  const { data: stays, error: staysError } = await supabase
    .from("occupancies")
    .select("id, term, occupancy_status")
    .eq("person_id", personId)
    .eq("is_archived", false);
  if (staysError) {
    return { ok: false, error: humanDbError(staysError, "Their existing stays couldn't be checked.") };
  }

  const live = (stays ?? []).find((s) => s.occupancy_status !== "checked_out");
  if (live) {
    return {
      ok: false,
      error: `${personName} is ${STATUS_WORD[live.occupancy_status] ?? "active"} for ${live.term}. Check them out, or archive that stay, before opening a new one.`,
    };
  }

  // Insert BEFORE archiving, deliberately. These are two round trips and can't
  // be atomic; if archiving came first and the insert then failed, this person
  // would vanish from every everyday screen with nothing to replace them. This
  // way the worst case is a new stay alongside an unarchived old one — visible
  // on the admin list, and one click to fix.
  const { data: opened, error: occError } = await supabase
    .from("occupancies")
    .insert({ person_id: personId, room_id: input.room_id, term })
    .select("id")
    .single();
  if (occError) {
    return {
      ok: false,
      error: occError.message.includes("occupancies_one_active_per_person")
        ? `${personName} already has an active stay. Check them out or archive it before opening a new one.`
        : humanDbError(occError, "The new stay couldn't be opened."),
    };
  }

  const priorIds = (stays ?? [])
    .filter((s) => s.occupancy_status === "checked_out")
    .map((s) => s.id);
  let archived = 0;
  if (priorIds.length > 0) {
    const { data: archivedRows, error: archiveError } = await supabase
      .from("occupancies")
      .update({ is_archived: true })
      .in("id", priorIds)
      .select("id");
    if (archiveError) {
      // The new stay exists and is usable; say what didn't happen rather than
      // implying the whole thing failed.
      revalidateRoster();
      return {
        ok: false,
        error: `The new stay was created, but ${personName}'s previous stay could not be archived. Archive it from the Residents list.`,
      };
    }
    archived = archivedRows?.length ?? 0;
  }

  revalidateRoster();
  return { ok: true, occupancyId: opened.id, archivedPriorStays: archived };
}

/**
 * Edit one stay: contact details belong to the person, the room to the
 * occupancy. The term and status are deliberately not editable here — status
 * moves only through record_occupancy, which holds the signature gate.
 */
export async function updateResident(
  occupancyId: string,
  personId: string,
  input: ResidentInput,
): Promise<ActionResult> {
  const row = clean(input);
  if (!row.full_name || !row.student_id || !row.room_id) {
    return { ok: false, error: "Name, student ID, and room are required." };
  }
  const supabase = await createClient();

  const { error: personError } = await supabase
    .from("people")
    .update({
      full_name: row.full_name,
      student_id: row.student_id,
      phone: row.phone,
      emergency_contact: row.emergency_contact,
    })
    .eq("id", personId);
  if (personError) {
    return { ok: false, error: humanDbError(personError, "Their details couldn't be saved.") };
  }

  // A room change recorded here is a correction for someone who has not
  // arrived, not a move. Once a stay is checked in, a move is history and goes
  // through reassign_room so it lands in room_change_events; a completed stay
  // keeps the room it was in. The database trigger refuses both, so the check
  // here only turns that refusal into a sentence before the write.
  const { data: stay, error: stayError } = await supabase
    .from("occupancies")
    .select("room_id, occupancy_status")
    .eq("id", occupancyId)
    .single();
  if (stayError || !stay) {
    return { ok: false, error: humanDbError(stayError, "That stay no longer exists.") };
  }
  if (stay.room_id !== row.room_id) {
    if (stay.occupancy_status === "checked_in") {
      return {
        ok: false,
        error:
          "They have already checked in, so a room change is a move: use Reassign room on their screen so it is recorded.",
      };
    }
    if (stay.occupancy_status === "checked_out") {
      return {
        ok: false,
        error: "This stay is complete and keeps the room it was in.",
      };
    }
    const { error: occError } = await supabase
      .from("occupancies")
      .update({ room_id: row.room_id })
      .eq("id", occupancyId);
    if (occError) {
      return { ok: false, error: humanDbError(occError, "The room change couldn't be saved.") };
    }
  }

  revalidateRoster();
  revalidatePath(`/residents/${occupancyId}`);
  return { ok: true };
}

/**
 * Delete the STAY, not the person: their other occupancies and the history
 * attached to them survive. Prefer archiving — deletion cascades this stay's
 * events, so it's for roster mistakes only.
 *
 * Four tables reference an occupancy. Three of them — presence_events,
 * occupancy_events and room_change_events — cascade, because they only mean
 * anything as part of the stay they belong to. `inspections` deliberately
 * does NOT: a signed inspection is the document a damage dispute is settled
 * from, and it must outlive a careless click on this screen.
 *
 * So the dependent check happens HERE, before the delete, rather than being
 * left to the foreign key. The FK still stands as the real guarantee; this
 * just means the RD reads a sentence about archiving instead of a constraint
 * name. The UI blocks the button too, but a stale page could still get here.
 */
export async function deleteOccupancy(occupancyId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { count, error: countError } = await supabase
    .from("inspections")
    .select("id", { count: "exact", head: true })
    .eq("occupancy_id", occupancyId);
  if (countError) {
    return { ok: false, error: humanDbError(countError) };
  }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `This stay has ${count} inspection ${count === 1 ? "record" : "records"}. Archive it instead — deleting would destroy the signed record a damage dispute rests on.`,
    };
  }

  const { error } = await supabase
    .from("occupancies")
    .delete()
    .eq("id", occupancyId);
  if (error) return { ok: false, error: humanDbError(error) };
  revalidateRoster();
  return { ok: true };
}

/**
 * Archive / unarchive a stay. Archived is hidden, never deleted: it drops off
 * every everyday screen (they read the current_residents view) while staying
 * queryable for dispute history.
 */
export async function setOccupancyArchived(
  occupancyId: string,
  archived: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("occupancies")
    .update({ is_archived: archived })
    .eq("id", occupancyId);
  if (error) {
    return {
      ok: false,
      error: error.message.includes("occupancies_one_active_per_person")
        ? "That person already has another active stay — archive or check out that one first."
        : humanDbError(error, "That stay couldn't be updated."),
    };
  }
  revalidateRoster();
  revalidatePath(`/residents/${occupancyId}`);
  return { ok: true };
}

/**
 * Set the current term. Everyday screens follow this immediately: last term's
 * occupancies stop appearing without anything being deleted.
 */
export async function setCurrentTerm(term: string): Promise<ActionResult> {
  const trimmed = term.trim();
  if (!trimmed) return { ok: false, error: "The term can't be blank." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({ current_term: trimmed })
    .eq("id", true);
  if (error) {
    return { ok: false, error: humanDbError(error, "The term couldn't be saved.") };
  }
  revalidateRoster();
  revalidatePath("/hallways", "layout");
  return { ok: true };
}
