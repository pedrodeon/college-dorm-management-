"use client";

import { useState, useTransition } from "react";
import { createItem, updateItem, deleteItem } from "@/app/(app)/admin/inventory/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type AdminItem = { id: string; name: string; sort_order: number };

export function InventoryManager({ items }: { items: AdminItem[] }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  const nextOrder = items.reduce((max, i) => Math.max(max, i.sort_order), 0) + 1;

  // `onError` lets a row show its own refusal next to its buttons.
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
    <div className="flex flex-col gap-6">
      {error && <Alert tone="error">{error}</Alert>}

      <Card variant="box" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">New item</span>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Mini-fridge"
            className="rounded-md border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <Button
          onClick={() => run(() => createItem(newName, nextOrder), () => setNewName(""))}
          disabled={isPending || !newName.trim()}
        >
          Add
        </Button>
      </Card>

      <p className="-mt-2 text-xs text-gray-600">
        Giving an item another item&rsquo;s position swaps the two.
      </p>

      <Card as="ul" variant="list">
        {[...items]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((item) => (
            <ItemRow key={item.id} item={item} disabled={isPending} run={run} />
          ))}
      </Card>
    </div>
  );
}

function ItemRow({
  item,
  disabled,
  run,
}: {
  item: AdminItem;
  disabled: boolean;
  run: (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    onOk?: () => void,
    onError?: (message: string) => void,
  ) => void;
}) {
  const [name, setName] = useState(item.name);
  const [order, setOrder] = useState(String(item.sort_order));
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== item.name || order !== String(item.sort_order);

  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <input
        type="number"
        min={1}
        step={1}
        value={order}
        onChange={(e) => setOrder(e.target.value)}
        aria-label={`${item.name} order`}
        className="w-16 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={`${item.name} name`}
        className="min-w-40 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          run(() => updateItem(item.id, name, Number(order)), undefined, setError);
        }}
        disabled={disabled || !dirty}
      >
        Save
      </Button>
      <Button
        variant="danger"
        size="sm"
        onClick={() => {
          if (confirm(`Delete "${item.name}" from the template?`)) {
            setError(null);
            run(() => deleteItem(item.id), undefined, setError);
          }
        }}
        disabled={disabled}
      >
        Delete
      </Button>
      {error && (
        <Alert tone="error" className="basis-full">
          {error}
        </Alert>
      )}
    </li>
  );
}
