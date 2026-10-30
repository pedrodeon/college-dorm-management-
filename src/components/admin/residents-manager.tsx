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

const EMPTY: ResidentInput = {
  full_name: "",
  student_id: "",
  room_id: "",
  phone: "",
  emergency_contact: "",
};

const STATUS_LABEL: Record<OccupancyStatus, string> = {
  expected: "expected",
  checked_in: "checked in",
  checked_out: "checked out",
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk?: () => void,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else onOk?.();
    });
  }

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
        isPending={isPending}
        onEdit={(id) => {
          setEditingId(id);
          setError(null);
        }}
        onCancelEdit={() => setEditingId(null)}
        onSave={(stay, input) =>
          run(() => updateResident(stay.id, stay.person_id, input), () =>
            setEditingId(null),
          )
        }
        onArchive={(stay) => run(() => setOccupancyArchived(stay.id, true))}
        onUnarchive={(stay) => run(() => setOccupancyArchived(stay.id, false))}
        onDelete={(stay) => run(() => deleteOccupancy(stay.id))}
      />

      {other.length > 0 && (
        <StayList
          heading={`${other.length} past or archived ${other.length === 1 ? "stay" : "stays"}`}
          note="Hidden from the dashboard, hallway and room screens — kept for dispute history."
          stays={other}
          rooms={rooms}
          editingId={editingId}
          isPending={isPending}
          onEdit={(id) => {
            setEditingId(id);
            setError(null);
          }}
          onCancelEdit={() => setEditingId(null)}
          onSave={(stay, input) =>
            run(() => updateResident(stay.id, stay.person_id, input), () =>
              setEditingId(null),
            )
          }
          onArchive={(stay) => run(() => setOccupancyArchived(stay.id, true))}
          onUnarchive={(stay) => run(() => setOccupancyArchived(stay.id, false))}
          onDelete={(stay) => run(() => deleteOccupancy(stay.id))}
        />
      )}
    </div>
  );
}

function TermControl({
  currentTerm,
  disabled,
  onSave,
}: {
  currentTerm: string;
  disabled: boolean;
  onSave: (term: string) => void;
}) {
  const [term, setTerm] = useState(currentTerm);
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
            className="rounded-md border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <Button
          onClick={() => onSave(term)}
          disabled={disabled || term.trim() === "" || term.trim() === currentTerm}
        >
          Save term
        </Button>
      </div>
    </Card>
  );
}

function StayList({
  heading,
  note,
  stays,
  rooms,
  editingId,
  isPending,
  onEdit,
  onCancelEdit,
  onSave,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  heading: string;
  note?: string;
  stays: AdminOccupancy[];
  rooms: RoomChoice[];
  editingId: string | null;
  isPending: boolean;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSave: (stay: AdminOccupancy, input: ResidentInput) => void;
  onArchive: (stay: AdminOccupancy) => void;
  onUnarchive: (stay: AdminOccupancy) => void;
  onDelete: (stay: AdminOccupancy) => void;
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
                  submitLabel="Save"
                  disabled={isPending}
                  onCancel={onCancelEdit}
                  onSubmit={(input) => onSave(stay, input)}
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
                      <span className="ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 font-medium text-ink">
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
                  <Button variant="subtle" size="sm" onClick={() => onEdit(stay.id)}>
                    Edit
                  </Button>
                  {stay.is_archived ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onUnarchive(stay)}
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
                      onClick={() => onArchive(stay)}
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
                          onDelete(stay);
                        }
                      }}
                      disabled={isPending}
                    >
                      Delete
                    </Button>
                  )}
                </div>
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
  hint,
  rooms,
  initial,
  roomLocked,
  submitLabel,
  disabled,
  onSubmit,
  onCancel,
}: {
  title: string;
  hint?: string;
  rooms: RoomChoice[];
  initial?: ResidentInput;
  /** Why the room can't be changed here, when it can't. */
  roomLocked?: string;
  submitLabel: string;
  disabled: boolean;
  onSubmit: (input: ResidentInput, reset: () => void) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<ResidentInput>(initial ?? EMPTY);
  function set(patch: Partial<ResidentInput>) {
    setForm((f) => ({ ...f, ...patch }));
  }
  return (
    <Card variant="box">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
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
        <Button onClick={() => onSubmit(form, () => setForm(EMPTY))} disabled={disabled}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="subtle" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        )}
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
