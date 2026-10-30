"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  updateResident,
  deleteOccupancy,
  setOccupancyArchived,
  setCurrentTerm,
  type ResidentInput,
} from "@/app/(app)/admin/residents/actions";
import type { OccupancyStatus } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { SectionLabel } from "@/components/ui/typography";
import { matchesResident } from "@/lib/resident-search";
import { compareTermsNewestFirst } from "@/lib/terms";

export type RoomChoice = { id: string; label: string };

/** One stay, flattened with its person's details for the form. */
export type AdminOccupancy = ResidentInput & {
  id: string;
  person_id: string;
  term: string;
  occupancy_status: OccupancyStatus;
  is_archived: boolean;
  room_label: string;
  /**
   * Inspections attached to this stay. They do not cascade on delete — a
   * signed inspection outlives the roster row on purpose — so any number
   * above zero means the database will refuse to delete this stay, and the
   * screen says so instead of letting the click fail.
   */
  inspection_count: number;
};

const STATUS_LABEL: Record<OccupancyStatus, string> = {
  expected: "expected",
  checked_in: "checked in",
  checked_out: "checked out",
};

/** A refusal, pinned to the stay it was about so it renders on that row. */
type RowError = { id: string; message: string };

/** What a stay row can ask the manager to do. */
type StayHandlers = {
  edit: (id: string) => void;
  cancelEdit: () => void;
  save: (stay: AdminOccupancy, input: ResidentInput) => void;
  archive: (stay: AdminOccupancy) => void;
  unarchive: (stay: AdminOccupancy) => void;
  remove: (stay: AdminOccupancy) => void;
};

export function ResidentsManager({
  stays,
  rooms,
  currentTerm,
}: {
  stays: AdminOccupancy[];
  rooms: RoomChoice[];
  currentTerm: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Screen-level messages (the term control) vs. a refusal about one stay,
  // which renders on that row — on a phone the top of a 200-row list is a
  // long way from the button that was tapped.
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk?: () => void,
    stayId?: string,
  ) {
    setError(null);
    setRowError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onOk?.();
        return;
      }
      const message = res.error ?? "Something went wrong.";
      if (stayId) setRowError({ id: stayId, message });
      else setError(message);
    });
  }

  const handlers: StayHandlers = {
    edit: (id) => {
      setEditingId(id);
      setError(null);
      setRowError(null);
    },
    cancelEdit: () => setEditingId(null),
    save: (stay, input) =>
      run(
        () => updateResident(stay.id, stay.person_id, input),
        () => setEditingId(null),
        stay.id,
      ),
    archive: (stay) => {
      // Archiving a LIVE stay drops the resident off the hallway roster and
      // the break safety list; that deserves a second look.
      if (
        stay.occupancy_status !== "checked_out" &&
        !confirm(
          `${stay.full_name} is still ${STATUS_LABEL[stay.occupancy_status]} for ${stay.term}. Archiving hides them from the dashboard, hallway roster and desk. Archive anyway?`,
        )
      ) {
        return;
      }
      run(() => setOccupancyArchived(stay.id, true), undefined, stay.id);
    },
    unarchive: (stay) =>
      run(() => setOccupancyArchived(stay.id, false), undefined, stay.id),
    remove: (stay) => run(() => deleteOccupancy(stay.id), undefined, stay.id),
  };

  // The same matcher the search overlay uses — a name partial or a student-ID
  // prefix — applied to the rows already on the page, so filtering here costs
  // no round trip. Unlike the overlay this deliberately searches PAST and
  // archived stays too: this screen is the one place they are visible, and
  // hiding them from its own filter would make them unfindable.
  const filtered =
    filter.trim() === ""
      ? stays
      : stays.filter((s) => matchesResident(s, filter));

  // Current term first, then past terms — the everyday roster is what the RD
  // is usually here for.
  const current = filtered.filter(
    (s) => s.term === currentTerm && !s.is_archived,
  );
  const other = filtered.filter(
    (s) => s.term !== currentTerm || s.is_archived,
  );

  return (
    <div className="flex flex-col gap-8">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      <SearchInput
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name or student ID"
        aria-label="Filter residents by name or student ID"
      />
      {filter.trim() !== "" && filtered.length === 0 && (
        <p className="-mt-4 px-1 text-sm text-gray-500">
          No stays match &ldquo;{filter.trim()}&rdquo;.
        </p>
      )}

      <TermControl
        currentTerm={currentTerm}
        stays={stays}
        disabled={isPending}
        onSave={(term) =>
          run(() => setCurrentTerm(term), () =>
            setNotice(`Current term is now ${term.trim()}.`),
          )
        }
      />

      {/* One write path: adding anyone — new or returning — goes through the
          flow, so the duplicate guard and the archive rule can't diverge
          between two forms. */}
      <Card variant="box">
        <h2 className="text-sm font-semibold">Add a resident</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Search for the student first. A returning student keeps their record
          and gets a new stay; their old one is never reused.
        </p>
        <LinkButton href="/admin/residents/new" className="mt-3 inline-block">
          New or returning student
        </LinkButton>
      </Card>

      <StayList
        heading={`${current.length} ${current.length === 1 ? "stay" : "stays"} — ${currentTerm || "no term set"}`}
        stays={current}
        rooms={rooms}
        editingId={editingId}
        rowError={rowError}
        isPending={isPending}
        on={handlers}
      />

      {other.length > 0 && (
        <StayList
          heading={`${other.length} past or archived ${other.length === 1 ? "stay" : "stays"}`}
          note="Hidden from the dashboard, hallway and room screens — kept for dispute history."
          stays={other}
          rooms={rooms}
          editingId={editingId}
          rowError={rowError}
          isPending={isPending}
          on={handlers}
        />
      )}
    </div>
  );
}

function TermControl({
  currentTerm,
  stays,
  disabled,
  onSave,
}: {
  currentTerm: string;
  stays: AdminOccupancy[];
  disabled: boolean;
  onSave: (term: string) => void;
}) {
  const [term, setTerm] = useState(currentTerm);
  const trimmed = term.trim();
  // Every term on record, newest first — offered as suggestions so the roll-
  // over is a pick, not a retype that could land one character off.
  const knownTerms = [...new Set(stays.map((s) => s.term))].sort(
    compareTermsNewestFirst,
  );
  const staysInTarget = stays.filter(
    (s) => s.term === trimmed && !s.is_archived,
  ).length;

  function save() {
    // A typo here empties every everyday screen, so say what the switch
    // will show before it happens.
    const outcome =
      staysInTarget === 0
        ? `No stays are in "${trimmed}" yet, so the dashboard, hallway and desk screens will be empty until stays are opened in it.`
        : `${staysInTarget} ${staysInTarget === 1 ? "stay is" : "stays are"} in "${trimmed}"; everyday screens will show only those.`;
    if (
      confirm(
        `Switch the current term from "${currentTerm || "none"}" to "${trimmed}"?\n\n${outcome} Nothing is deleted.`,
      )
    ) {
      onSave(trimmed);
    }
  }

  return (
    <Card variant="box">
      <h3 className="text-sm font-semibold">Current term</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Everyday screens show only this term&rsquo;s stays. Changing it rolls the
        building over — nothing is deleted.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Term</span>
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Fall 2026"
            list="known-terms"
            className="rounded-md border border-gray-300 px-3 py-2 text-base"
          />
          <datalist id="known-terms">
            {knownTerms.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <Button
          onClick={save}
          disabled={disabled || trimmed === "" || trimmed === currentTerm}
        >
          Save term
        </Button>
      </div>
      {trimmed !== "" && trimmed !== currentTerm && (
        <p className="mt-2 text-xs text-gray-600">
          {staysInTarget === 0
            ? `No stays are in "${trimmed}" yet.`
            : `${staysInTarget} ${staysInTarget === 1 ? "stay" : "stays"} in "${trimmed}".`}
        </p>
      )}
    </Card>
  );
}

function StayList({
  heading,
  note,
  stays,
  rooms,
  editingId,
  rowError,
  isPending,
  on,
}: {
  heading: string;
  note?: string;
  stays: AdminOccupancy[];
  rooms: RoomChoice[];
  editingId: string | null;
  rowError: RowError | null;
  isPending: boolean;
  on: StayHandlers;
}) {
  return (
    <div>
      <SectionLabel>{heading}</SectionLabel>
      {note && <p className="mt-1 text-xs text-gray-500">{note}</p>}
      {stays.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">Nothing here yet.</p>
      ) : (
        <Card as="ul" variant="list" className="mt-2">
          {stays.map((stay) =>
            editingId === stay.id ? (
              <li key={stay.id} className="p-4">
                {rowError?.id === stay.id && (
                  <Alert tone="error" className="mb-3">
                    {rowError.message}
                  </Alert>
                )}
                <ResidentFields
                  title={`Edit ${stay.full_name} — ${stay.term}`}
                  rooms={rooms}
                  initial={stay}
                  roomLocked={
                    stay.occupancy_status === "checked_in"
                      ? "Checked in — move them with Reassign room on their screen so the change is recorded."
                      : stay.occupancy_status === "checked_out"
                        ? "This stay is complete and keeps its room."
                        : undefined
                  }
                  disabled={isPending}
                  onCancel={on.cancelEdit}
                  onSubmit={(input) => on.save(stay, input)}
                />
              </li>
            ) : (
              <li
                key={stay.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <div>
                  <Link
                    href={`/residents/${stay.id}`}
                    className="text-sm font-medium hover:text-navy hover:underline"
                  >
                    {stay.full_name}
                  </Link>
                  <p className="mt-0.5 text-xs text-gray-500">
                    <span className="font-mono">{stay.student_id}</span> ·{" "}
                    {stay.room_label} · {stay.term} ·{" "}
                    {STATUS_LABEL[stay.occupancy_status]}
                    {stay.is_archived && (
                      // Neutral grey: archived is a settled state, not one
                      // that needs attention, so it never gets the accent.
                      <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">
                        archived
                      </span>
                    )}
                  </p>
                  {stay.inspection_count > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      This stay has {stay.inspection_count} inspection{" "}
                      {stay.inspection_count === 1 ? "record" : "records"},
                      which are permanent, so it can&apos;t be deleted. Archive
                      it instead.{" "}
                      <Link
                        href={`/residents/${stay.id}#inspections`}
                        className="font-medium text-navy underline"
                      >
                        View inspections
                      </Link>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="subtle" size="sm" onClick={() => on.edit(stay.id)}>
                    Edit
                  </Button>
                  {stay.is_archived ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => on.unarchive(stay)}
                      disabled={isPending}
                    >
                      Unarchive
                    </Button>
                  ) : (
                    <Button
                      // With Delete unavailable, Archive is the action to
                      // take, so it stops looking like the quiet one.
                      variant={stay.inspection_count > 0 ? "primary" : "subtle"}
                      size="sm"
                      onClick={() => on.archive(stay)}
                      disabled={isPending}
                    >
                      Archive
                    </Button>
                  )}
                  {stay.inspection_count > 0 ? (
                    // Not hidden — a disabled button with a reason teaches the
                    // rule; a missing one just looks broken.
                    <Button
                      variant="danger"
                      size="sm"
                      disabled
                      title="This stay has inspection records"
                    >
                      Delete
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (
                          confirm(
                            `Delete ${stay.full_name}'s ${stay.term} stay and its events? Archiving keeps the history instead.`,
                          )
                        ) {
                          on.remove(stay);
                        }
                      }}
                      disabled={isPending}
                    >
                      Delete
                    </Button>
                  )}
                </div>
                {rowError?.id === stay.id && (
                  <Alert tone="error" className="basis-full">
                    {rowError.message}
                  </Alert>
                )}
              </li>
            ),
          )}
        </Card>
      )}
    </div>
  );
}

function ResidentFields({
  title,
  rooms,
  initial,
  roomLocked,
  disabled,
  onSubmit,
  onCancel,
}: {
  title: string;
  rooms: RoomChoice[];
  initial: ResidentInput;
  /** Why the room can't be changed here, when it can't. */
  roomLocked?: string;
  disabled: boolean;
  onSubmit: (input: ResidentInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ResidentInput>(initial);
  function set(patch: Partial<ResidentInput>) {
    setForm((f) => ({ ...f, ...patch }));
  }
  return (
    <Card variant="box">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Full name" value={form.full_name} onChange={(v) => set({ full_name: v })} />
        <Field label="Student ID" value={form.student_id} onChange={(v) => set({ student_id: v })} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Room</span>
          <select
            value={form.room_id}
            onChange={(e) => set({ room_id: e.target.value })}
            disabled={roomLocked !== undefined}
            className="rounded-md border border-gray-300 px-3 py-2 text-base disabled:bg-gray-100 disabled:text-gray-500"
          >
            <option value="">Select a room…</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          {roomLocked && (
            <span className="text-xs font-normal text-gray-500">{roomLocked}</span>
          )}
        </label>
        <Field label="Phone" value={form.phone} onChange={(v) => set({ phone: v })} />
        <Field label="Emergency contact" value={form.emergency_contact} onChange={(v) => set({ emergency_contact: v })} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => onSubmit(form)} disabled={disabled}>
          Save
        </Button>
        <Button variant="subtle" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-300 px-3 py-2 text-base"
      />
    </label>
  );
}
