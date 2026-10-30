"use client";

import { useState, useTransition } from "react";
import {
  inviteStaff,
  removeStaff,
  setAssignment,
} from "@/app/(app)/admin/staff/actions";
import type { StaffRole } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type AdminStaff = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  hallwayIds: string[];
};
export type HallwayChoice = { id: string; name: string };

export function StaffManager({
  staff,
  hallways,
  currentUserId,
}: {
  staff: AdminStaff[];
  hallways: HallwayChoice[];
  currentUserId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  // A refusal about one member renders on their card, not at the top.
  const [memberError, setMemberError] = useState<{ id: string; message: string } | null>(null);
  const [invited, setInvited] = useState<{ email: string; tempPassword: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("ra");

  function invite() {
    setError(null);
    setMemberError(null);
    setInvited(null);
    startTransition(async () => {
      const res = await inviteStaff(name, email, role);
      if (!res.ok) setError(res.error);
      else {
        setInvited({ email: res.email, tempPassword: res.tempPassword });
        setName("");
        setEmail("");
      }
    });
  }

  function run(memberId: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setMemberError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setMemberError({ id: memberId, message: res.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {error && <Alert tone="error">{error}</Alert>}

      {invited && (
        <div className="rounded-md border-l-4 border-accent bg-accent-soft px-4 py-3 text-sm text-ink">
          <p className="font-semibold">Account created for {invited.email}.</p>
          <p className="mt-1">
            Temporary password (shown once — relay it securely; they&rsquo;ll be
            required to set their own on first login):{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono">{invited.tempPassword}</code>
          </p>
        </div>
      )}

      <Card variant="box" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}
            className="rounded-md border border-gray-300 px-3 py-2 text-base">
            <option value="ra">RA</option>
            <option value="rd">RD</option>
          </select>
        </label>
        <Button onClick={invite} disabled={isPending || !name.trim() || !email.trim()}>
          Invite staff
        </Button>
      </Card>

      <ul className="flex flex-col gap-3">
        {staff.map((member) => (
          <Card as="li" key={member.id} variant="box">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-sm font-medium">{member.name}</span>
                <span className="ml-2 rounded-full bg-navy/10 px-2 py-0.5 text-xs font-medium uppercase text-navy">
                  {member.role}
                </span>
                <p className="mt-0.5 text-xs text-gray-500">{member.email}</p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (
                    confirm(
                      `Remove ${member.name}? Their login is deleted and any front-desk shifts they claimed are released for someone else to take.`,
                    )
                  ) {
                    run(member.id, () => removeStaff(member.id));
                  }
                }}
                disabled={isPending || member.id === currentUserId}
                title={member.id === currentUserId ? "You can't remove yourself" : undefined}
              >
                Remove
              </Button>
            </div>

            {memberError?.id === member.id && (
              <Alert tone="error" className="mt-3">
                {memberError.message}
              </Alert>
            )}

            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
                Hallway coverage
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {hallways.map((h) => {
                  const assigned = member.hallwayIds.includes(h.id);
                  return (
                    <label key={h.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={assigned}
                        disabled={isPending}
                        // Six cards each list the same eight hallways; the
                        // label has to say whose coverage this box is.
                        aria-label={`${member.name} covers ${h.name}`}
                        onChange={() => run(member.id, () => setAssignment(member.id, h.id, !assigned))}
                      />
                      {h.name}
                    </label>
                  );
                })}
              </div>
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}
