"use client";

import { useState, useTransition } from "react";
import { createRoom, updateRoom, deleteRoom } from "@/app/(app)/admin/rooms/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/typography";

export type AdminRoom = {
  id: string;
  room_number: string;
  capacity: number;
  occupants: number;
};
export type HallwayGroup = { id: string; name: string; rooms: AdminRoom[] };

export function RoomsManager({ hallways }: { hallways: HallwayGroup[] }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [hallwayId, setHallwayId] = useState(hallways[0]?.id ?? "");
  const [roomNumber, setRoomNumber] = useState("");
  const [capacity, setCapacity] = useState("2");

  // `onError` lets a row keep its own refusal next to its buttons instead of
  // at the top of an 84-row list.
  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk?: () => void,
    onError: (message: string) => void = setError,
  ) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) onError(res.error ?? "Something went wrong.");
      else onOk?.();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {error && <Alert tone="error">{error}</Alert>}

      <Card variant="box" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Hallway</span>
          <select
            value={hallwayId}
            onChange={(e) => setHallwayId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-base"
          >
            {hallways.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Room number</span>
          <input
            type="text"
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            className="w-32 rounded-md border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Capacity</span>
          <input
            type="number"
            min={1}
            max={8}
            step={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="w-24 rounded-md border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <Button
          onClick={() =>
            run(() => createRoom(hallwayId, roomNumber, Number(capacity)), () => setRoomNumber(""))
          }
          disabled={isPending || !roomNumber.trim()}
        >
          Add room
        </Button>
      </Card>

      {hallways.map((h) => (
        <div key={h.id}>
          <SectionLabel>{h.name}</SectionLabel>
          {h.rooms.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No rooms.</p>
          ) : (
            <Card as="ul" variant="list" className="mt-2">
              {h.rooms.map((room) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  hallwayName={h.name}
                  disabled={isPending}
                  run={run}
                />
              ))}
            </Card>
          )}
        </div>
      ))}
    </div>
  );
}

function RoomRow({
  room,
  hallwayName,
  disabled,
  run,
}: {
  room: AdminRoom;
  hallwayName: string;
  disabled: boolean;
  run: (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk?: () => void,
    onError?: (message: string) => void,
  ) => void;
}) {
  const [number, setNumber] = useState(room.room_number);
  const [capacity, setCapacity] = useState(String(room.capacity));
  const [error, setError] = useState<string | null>(null);
  const dirty = number !== room.room_number || capacity !== String(room.capacity);
  // Every row has the same two inputs; the label names which room's.
  const which = `${hallwayName} room ${room.room_number}`;

  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <input
        type="text"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        aria-label={`Room number for ${which}`}
        className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <input
        type="number"
        min={1}
        max={8}
        step={1}
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
        aria-label={`Capacity for ${which}`}
        className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <span className="text-xs text-gray-500">{room.occupants} in room</span>
      <div className="ml-auto flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            run(() => updateRoom(room.id, number, Number(capacity)), undefined, setError);
          }}
          disabled={disabled || !dirty}
        >
          Save
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (confirm(`Delete ${which}?`)) {
              setError(null);
              run(() => deleteRoom(room.id), undefined, setError);
            }
          }}
          disabled={disabled}
        >
          Delete
        </Button>
      </div>
      {error && (
        <Alert tone="error" className="basis-full">
          {error}
        </Alert>
      )}
    </li>
  );
}
