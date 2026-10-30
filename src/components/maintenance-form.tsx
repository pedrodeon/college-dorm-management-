"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PillToggle } from "@/components/ui/pill-toggle";
import {
  submitMaintenance,
  type Urgency,
} from "@/app/(app)/maintenance/actions";

export function MaintenanceForm() {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitMaintenance({
        location,
        description,
        urgency,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFiled(true);
    });
  }

  if (filed) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" icon>
          Request filed. The Resident Director has been notified in the app.
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
        {/* No "date noticed": the request's created_at is the record, and a
            field the row never stored would only pretend otherwise. */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Where is the problem?</span>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Room 213, Lebanon 2 bathroom, front stairwell"
            className="rounded-xl border border-line px-3 py-2 text-base"
          />
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-medium">What&rsquo;s broken?</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="rounded-xl border border-line px-3 py-2 text-base"
          />
        </label>

        <div className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-medium">Urgency</span>
          <PillToggle
            options={[
              { value: "low", label: "Low" },
              { value: "normal", label: "Normal" },
              { value: "high", label: "High" },
            ]}
            value={urgency}
            onChange={setUrgency}
          />
        </div>
      </Card>

      <Alert tone="info" icon>
        The request is stored in the app and the Resident Director is notified
        right away; they close it once it&rsquo;s fixed.
      </Alert>

      <div className="flex gap-2">
        <Button
          size="lg"
          onClick={submit}
          disabled={isPending || !location.trim() || !description.trim()}
        >
          {isPending ? "Filing…" : "File request"}
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
