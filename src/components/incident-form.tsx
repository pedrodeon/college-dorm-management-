"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { submitIncident } from "@/app/(app)/reports/incident/actions";

export type RoomOption = { id: string; label: string };

export function IncidentForm({
  rooms,
  defaults,
}: {
  rooms: RoomOption[];
  /** "Now" on the building's clock (America/Chicago), from the server — the
      incident is usually happening as it's filed. Server-provided so the
      first paint and hydration agree and the stamp is Chicago wherever the
      RA's phone thinks it is. */
  defaults: { date: string; time: string };
}) {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [description, setDescription] = useState("");
  const [peopleInvolved, setPeopleInvolved] = useState("");
  const [actionsTaken, setActionsTaken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitIncident({
        roomId: roomId || null,
        date,
        time,
        description,
        peopleInvolved,
        actionsTaken,
      });
      if (!result.ok) setError(result.error);
      else setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" icon>
          Report filed. The Resident Director has been notified in the app and
          is the only person who can read it.
        </Alert>
        <div>
          <Button variant="subtle" onClick={() => router.push("/")}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}

      <Card variant="box">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-line px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Time</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-xl border border-line px-3 py-2 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Room{" "}
              <span className="font-normal text-faint">(if applicable)</span>
            </span>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="rounded-xl border border-line px-3 py-2 text-base"
            >
              <option value="">Not room-specific</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-medium">What happened</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="rounded-xl border border-line px-3 py-2 text-base"
          />
        </label>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-medium">
            People involved{" "}
            <span className="font-normal text-faint">
              (names, roles — witnesses too)
            </span>
          </span>
          <textarea
            value={peopleInvolved}
            onChange={(e) => setPeopleInvolved(e.target.value)}
            rows={2}
            className="rounded-xl border border-line px-3 py-2 text-base"
          />
        </label>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-medium">Actions taken</span>
          <textarea
            value={actionsTaken}
            onChange={(e) => setActionsTaken(e.target.value)}
            rows={2}
            className="rounded-xl border border-line px-3 py-2 text-base"
          />
        </label>
      </Card>

      <Alert tone="info" icon>
        This report is stored in the app and readable only by the Resident
        Director, who is notified as soon as you submit it.
      </Alert>

      <div className="flex gap-2">
        <Button
          size="lg"
          onClick={submit}
          disabled={isPending || !description.trim() || !date || !time}
        >
          {isPending ? "Sending…" : "Send incident report"}
        </Button>
        <Button
          variant="subtle"
          size="lg"
          onClick={() => router.push("/")}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
