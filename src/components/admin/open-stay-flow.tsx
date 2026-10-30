"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusChip } from "@/components/ui/status-chip";
import {
  openStay,
  type PersonOption,
  type PersonStay,
} from "@/app/(app)/admin/residents/actions";
import { matchesResident } from "@/lib/resident-search";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";

export type { PersonOption, PersonStay };

export type RoomChoice = {
  id: string;
  label: string;
  occupants: number;
  capacity: number;
};

/** Who the new stay is for: an existing person, or one being created. */
type Subject =
  | { kind: "existing"; person: PersonOption }
  | { kind: "new"; full_name: string; student_id: string };

/**
 * The returning-student flow. Step 1 finds the person — searching rather than
 * typing a name in blind, so the RD can see that this is the same student who
 * lived here before. Step 2 opens ONE new occupancy for them.
 *
 * Search is client-side over the already-loaded list: ~200 people filter
 * instantly, and the query never reaches the URL, since resident data must not
 * appear in URLs (CLAUDE.md).
 */
export function OpenStayFlow({
  people,
  rooms,
  currentTerm,
}: {
  people: PersonOption[];
  rooms: RoomChoice[];
  currentTerm: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState<Subject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Same matcher as every other resident search (name partial, student-ID
  // prefix, accents folded).
  const q = query.trim();
  const matches = q ? people.filter((p) => matchesResident(p, q)) : people;

  function pickExisting(person: PersonOption) {
    setError(null);
    setSubject({ kind: "existing", person });
  }

  if (subject) {
    return (
      <StayForm
        subject={subject}
        rooms={rooms}
        currentTerm={currentTerm}
        error={error}
        isPending={isPending}
        onBack={() => {
          setError(null);
          setSubject(null);
        }}
        onSubmit={(values) => {
          setError(null);
          startTransition(async () => {
            const result = await openStay({
              person:
                subject.kind === "existing"
                  ? { kind: "existing", person_id: subject.person.id }
                  : {
                      kind: "new",
                      full_name: values.full_name,
                      student_id: values.student_id,
                    },
              room_id: values.room_id,
              term: values.term,
              phone: values.phone,
              emergency_contact: values.emergency_contact,
            });

            if (result.ok) {
              // Land on the new stay: its "Other stays" section is the proof
              // that the old one is separate and intact.
              router.push(`/residents/${result.occupancyId}`);
              return;
            }
            setError(result.error);
            // A student ID collision isn't a dead end — switch to the person we
            // already have, keeping the RD in the flow. The action returns the
            // whole record, so this works even for someone added after this
            // page loaded.
            if ("duplicateOf" in result) {
              setSubject({ kind: "existing", person: result.duplicateOf });
            }
          });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Find the student</span>
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or student ID"
            autoComplete="off"
          />
        </label>

        {people.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No students on record yet — add the first one below.
          </p>
        ) : matches.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No match for &ldquo;{query}&rdquo;. If they&rsquo;re new to Tudor
            Hall, add them below.
          </p>
        ) : (
          <Card as="ul" variant="list" className="mt-3">
            {matches.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => pickExisting(person)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">{person.full_name}</p>
                    <p className="mt-0.5 font-mono text-xs text-gray-500">
                      {person.student_id}
                    </p>
                    <StayLines stays={person.stays} />
                  </div>
                  <span className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white">
                    New stay
                  </span>
                </button>
              </li>
            ))}
          </Card>
        )}
      </div>

      <Card variant="box">
        <h2 className="text-sm font-semibold">Not on the list?</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Only for a student who has never lived in Tudor Hall. Searching first
          keeps us from making a second record of someone we already have.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() =>
            setSubject({
              kind: "new",
              full_name: "",
              // Prefill whatever they typed — usually it's the ID they searched.
              student_id: /^[a-z]?\d/i.test(query.trim()) ? query.trim() : "",
            })
          }
        >
          Add a new student
        </Button>
      </Card>
    </div>
  );
}

/** A person's stays, most recent first — the "have we housed them before" signal. */
function StayLines({ stays }: { stays: PersonStay[] }) {
  if (stays.length === 0) {
    return (
      <p className="mt-1 text-xs text-gray-600">On record, but no stays yet.</p>
    );
  }
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {stays.map((stay) => (
        <li key={stay.id} className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="font-medium text-gray-600">{stay.term}</span>
          <span>{stay.room_label}</span>
          <StatusChip
            status={stay.occupancy_status}
            isPresent={stay.occupancy_status === "checked_in"}
          />
          {stay.is_archived && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">
              archived
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

type FormValues = {
  full_name: string;
  student_id: string;
  room_id: string;
  term: string;
  phone: string;
  emergency_contact: string;
};

function StayForm({
  subject,
  rooms,
  currentTerm,
  error,
  isPending,
  onBack,
  onSubmit,
}: {
  subject: Subject;
  rooms: RoomChoice[];
  currentTerm: string;
  error: string | null;
  isPending: boolean;
  onBack: () => void;
  onSubmit: (values: FormValues) => void;
}) {
  const existing = subject.kind === "existing" ? subject.person : null;
  const [values, setValues] = useState<FormValues>({
    full_name: subject.kind === "existing" ? subject.person.full_name : subject.full_name,
    student_id: subject.kind === "existing" ? subject.person.student_id : subject.student_id,
    room_id: "",
    term: currentTerm,
    phone: existing?.phone ?? "",
    emergency_contact: existing?.emergency_contact ?? "",
  });

  function set(patch: Partial<FormValues>) {
    setValues((v) => ({ ...v, ...patch }));
  }

  const termIsCurrent = values.term.trim() === currentTerm;
  const chosenRoom = rooms.find((r) => r.id === values.room_id) ?? null;
  // Capacity is a warning, not a wall: the RD sometimes has to triple a room
  // for a week. Both counts are current-term, so a next-term stay in a room
  // that is full today is a false alarm — say so rather than nag.
  const roomFull =
    chosenRoom !== null && termIsCurrent && chosenRoom.occupants >= chosenRoom.capacity;
  const priorStays = existing?.stays.filter((s) => !s.is_archived) ?? [];
  const completedPriors = priorStays.filter(
    (s) => s.occupancy_status === "checked_out",
  );
  const canSubmit =
    values.room_id !== "" &&
    values.term.trim() !== "" &&
    (subject.kind === "existing" ||
      (values.full_name.trim() !== "" && values.student_id.trim() !== ""));

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        disabled={isPending}
        className="self-start text-sm text-navy hover:underline disabled:opacity-50"
      >
        ← Choose a different student
      </button>

      {error && <Alert tone="error">{error}</Alert>}

      <Card variant="box">
        {existing ? (
          <>
            <h2 className="text-sm font-semibold">
              New stay for {existing.full_name}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              <span className="font-mono">{existing.student_id}</span> — already
              on record, so this creates a stay, not a second student.
            </p>
            {completedPriors.length > 0 && (
              <p className="mt-2 text-xs text-gray-500">
                {completedPriors.length === 1
                  ? "Their completed stay will be archived"
                  : `Their ${completedPriors.length} completed stays will be archived`}{" "}
                when this one opens — hidden from everyday screens, and still
                there for dispute history.
              </p>
            )}
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold">New student</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Full name"
                value={values.full_name}
                onChange={(v) => set({ full_name: v })}
              />
              <Field
                label="Student ID"
                value={values.student_id}
                onChange={(v) => set({ student_id: v })}
              />
            </div>
          </>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Room</span>
            <select
              value={values.room_id}
              onChange={(e) => set({ room_id: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-base"
            >
              <option value="">Select a room…</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} · {r.occupants}/{r.capacity}
                  {r.occupants >= r.capacity ? " full" : ""}
                </option>
              ))}
            </select>
            {roomFull && (
              <span className="text-xs font-normal text-gray-600">
                Already full ({chosenRoom.occupants}/{chosenRoom.capacity}).
                You&rsquo;ll be asked to confirm.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Term</span>
            <input
              type="text"
              value={values.term}
              onChange={(e) => set({ term: e.target.value })}
              placeholder="Fall 2026"
              className="rounded-md border border-gray-300 px-3 py-2 text-base"
            />
          </label>

          <Field label="Phone" value={values.phone} onChange={(v) => set({ phone: v })} />
          <Field
            label="Emergency contact"
            value={values.emergency_contact}
            onChange={(v) => set({ emergency_contact: v })}
          />
        </div>

        {!termIsCurrent && values.term.trim() !== "" && (
          <Alert tone="attention" className="mt-3">
            {`The current term is ${currentTerm || "not set"}, so a ${values.term.trim()} stay won’t show on the dashboard, hallway or room screens until the current term is switched to match. Useful for setting up next semester early.`}
          </Alert>
        )}

        <p className="mt-3 text-xs text-gray-500">
          The stay starts as <strong>expected</strong>. Check-in happens on the
          resident&rsquo;s own screen, after a signed move-in inspection.
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => {
              if (
                roomFull &&
                !confirm(
                  `${chosenRoom.label} is already full (${chosenRoom.occupants}/${chosenRoom.capacity}). Open the stay there anyway?`,
                )
              ) {
                return;
              }
              onSubmit(values);
            }}
            disabled={isPending || !canSubmit}
          >
            {isPending ? "Opening stay…" : "Open stay"}
          </Button>
          <Button variant="subtle" onClick={onBack} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
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
