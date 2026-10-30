"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRd } from "@/lib/auth";
import { humanDbError } from "@/lib/db-errors";
import { compareTermsNewestFirst } from "@/lib/terms";
import type { OccupancyStatus } from "@/lib/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** One of a person's stays, as the new-stay picker lists them. */
export type PersonStay = {
  id: string;
  term: string;
  occupancy_status: OccupancyStatus;
  is_archived: boolean;
  room_label: string;
};

/** A person as the new-stay picker shows them: record plus every stay. */
export type PersonOption = {
  id: string;
  full_name: string;
  student_id: string;
  phone: string;
  emergency_contact: string;
  stays: PersonStay[];
};

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
   * The whole record comes back so the switch works even when the person was
   * added after the page loaded.
   */
  | { ok: false; duplicateOf: PersonOption; error: string }
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

// All writes go through the RLS-scoped client — RLS enforces RD-only. The
// requireRd() check at the top of each action is defense-in-depth that also
// keeps the failure legible: without it an RA's update matches zero rows and
// reads as success.

type PersonRow = {
  id: string;
  full_name: string;
  student_id: string;
  phone: string | null;
  emergency_contact: string | null;
  occupancies: {
    id: string;
    term: string;
    occupancy_status: OccupancyStatus;
    is_archived: boolean;
    rooms: { room_number: string; hallways: { name: string } | null } | null;
  }[];
};

const PERSON_SELECT = `id, full_name, student_id, phone, emergency_contact,
  occupancies ( id, term, occupancy_status, is_archived,
                rooms ( room_number, hallways ( name ) ) )`;

/** The picker's shape for one person (the same mapping /admin/residents/new
    builds its list with; kept private so a "use server" file exports only
    actions). */
function toPersonOption(p: PersonRow): PersonOption {
  return {
    id: p.id,
    full_name: p.full_name,
    student_id: p.student_id,
    phone: p.phone ?? "",
    emergency_contact: p.emergency_contact ?? "",
    stays: [...p.occupancies]
      .sort((a, b) => compareTermsNewestFirst(a.term, b.term))
      .map((o) => ({
        id: o.id,
        term: o.term,
        occupancy_status: o.occupancy_status,
        is_archived: o.is_archived,
        room_label: `${o.rooms?.hallways?.name ?? "?"} · Room ${o.rooms?.room_number ?? "?"}`,
      })),
  };
}

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
  const rd = await requireRd();
  if (!rd.ok) return rd;

  const term = input.term.trim();
  const phone = input.phone.trim() || null;
  const emergency_contact = input.emergency_contact.trim() || null;

  if (!input.room_id) return { ok: false, error: "Pick a room for the new stay." };
  if (!term) return { ok: false, error: "The term can't be blank." };

  const supabase = await createClient();
  let personId: string;
  let personName: string;
  // Set when this call created the person, so a failed stay insert can take
  // the orphan back out: otherwise a retry trips the duplicate guard on a
  // record the RD never saw succeed.
  let createdPersonId: string | null = null;

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
    // Contact details are written AFTER the stay opens (below): a refused
    // stay must leave the record exactly as it was.
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
      .select(PERSON_SELECT)
      .eq("student_id", student_id)
      .maybeSingle()
      .overrideTypes<PersonRow>();
    if (lookupError) {
      return { ok: false, error: humanDbError(lookupError, "The student-ID check failed. Try again.") };
    }
    if (existing) {
      return {
        ok: false,
        duplicateOf: toPersonOption(existing),
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
    createdPersonId = created.id;
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
    if (createdPersonId) {
      // Best effort; if this fails too the person shows on the picker with
      // "no stays yet", which is at least honest.
      await supabase.from("people").delete().eq("id", createdPersonId);
    }
    return {
      ok: false,
      error: occError.code === "23503"
        ? "That room no longer exists — refresh the page and pick again."
        : humanDbError(occError, "The new stay couldn't be opened."),
    };
  }

  // Now the stay exists, refresh the returning student's contact details.
  // Nothing about their history is touched.
  if (input.person.kind === "existing") {
    const { error: updateError } = await supabase
      .from("people")
      .update({ phone, emergency_contact })
      .eq("id", personId);
    if (updateError) {
      revalidateRoster();
      return {
        ok: false,
        error: `The new stay was opened, but ${personName}'s contact details couldn't be saved. Edit them from the Residents list.`,
      };
    }
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
  const rd = await requireRd();
  if (!rd.ok) return rd;

  const row = clean(input);
  if (!row.full_name || !row.student_id || !row.room_id) {
    return { ok: false, error: "Name, student ID, and room are required." };
  }
  const supabase = await createClient();

  const { data: personRows, error: personError } = await supabase
    .from("people")
    .update({
      full_name: row.full_name,
      student_id: row.student_id,
      phone: row.phone,
      emergency_contact: row.emergency_contact,
    })
    .eq("id", personId)
    .select("id");
  if (personError) {
    return { ok: false, error: humanDbError(personError, "Their details couldn't be saved.") };
  }
  if (!personRows?.length) {
    return { ok: false, error: "That person is no longer on record — refresh the list." };
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
    const { data: moved, error: occError } = await supabase
      .from("occupancies")
      .update({ room_id: row.room_id })
      .eq("id", occupancyId)
      .select("id");
    if (occError) {
      return { ok: false, error: humanDbError(occError, "The room change couldn't be saved.") };
    }
    if (!moved?.length) {
      return { ok: false, error: "That stay no longer exists — refresh the list." };
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
  const rd = await requireRd();
  if (!rd.ok) return rd;

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

  const { data: deleted, error } = await supabase
    .from("occupancies")
    .delete()
    .eq("id", occupancyId)
    .select("id");
  if (error) return { ok: false, error: humanDbError(error) };
  if (!deleted?.length) {
    return { ok: false, error: "That stay was already removed — refresh the list." };
  }
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
  const rd = await requireRd();
  if (!rd.ok) return rd;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("occupancies")
    .update({ is_archived: archived })
    .eq("id", occupancyId)
    .select("id");
  if (error) {
    // humanDbError knows occupancies_one_active_per_person: unarchiving a
    // stay for someone who has a live one elsewhere.
    return { ok: false, error: humanDbError(error, "That stay couldn't be updated.") };
  }
  if (!rows?.length) {
    return { ok: false, error: "That stay no longer exists — refresh the list." };
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
  const rd = await requireRd();
  if (!rd.ok) return rd;

  const trimmed = term.trim();
  if (!trimmed) return { ok: false, error: "The term can't be blank." };
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("app_settings")
    .update({ current_term: trimmed })
    .eq("id", true)
    .select("id");
  if (error) {
    return { ok: false, error: humanDbError(error, "The term couldn't be saved.") };
  }
  if (!rows?.length) {
    return { ok: false, error: "The settings row is missing — apply the schema (docs/SETUP.md)." };
  }
  revalidateRoster();
  revalidatePath("/hallways", "layout");
  return { ok: true };
}
