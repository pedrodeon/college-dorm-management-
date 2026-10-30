"use client";

import { useState, useTransition } from "react";
import { setMaintenanceStatus } from "@/app/(app)/maintenance/actions";
import { Button } from "@/components/ui/button";

/** Close or reopen one request. RD only — the action and RLS both check.
    The action revalidates the queue, so no client refresh is needed. */
export function MaintenanceStatusButton({
  id,
  status,
}: {
  id: string;
  status: "open" | "done";
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setMaintenanceStatus(
        id,
        status === "open" ? "done" : "open",
      );
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <Button
        variant={status === "open" ? "primary" : "subtle"}
        size="sm"
        onClick={toggle}
        disabled={isPending}
      >
        {isPending ? "…" : status === "open" ? "Mark done" : "Reopen"}
      </Button>
    </span>
  );
}
