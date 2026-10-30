"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  acceptCoverage,
  assignShift,
  claimShift,
  releaseShift,
  requestCoverage,
  withdrawCoverage,
} from "@/app/(app)/front-desk/actions";
import { chicagoInstant, dateKey, daysInMonth } from "@/lib/chicago-date";
import {
  SHIFT_SLOTS,
  shiftLabel,
  slotStartHour,
  slotsOn,
  weekdayOf,
  type ShiftSlot,
} from "@/lib/desk-shifts";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/typography";

type ShiftRow = {
  shift_date: string;
  slot: number;
  claimed_by: string | null;
  coverage_requested_at: string | null;
};
type StaffRow = { id: string; name: string; role: string };
type SlotState = { owner: string | null; cover: boolean };
type SlotRef = { date: string; slot: ShiftSlot };

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const LOCK_MS = 24 * 60 * 60 * 1000;

/** Shift start as epoch ms — Chicago wall clock, the same instant the
    database's 24-hour rule uses, wherever the server or browser runs. */
function shiftStartMs(date: string, slot: ShiftSlot): number {
  return chicagoInstant(date, slotStartHour(slot)).getTime();
}

/**
 * The monthly grid + coverage flows. Presentation-side rules only — the RPCs
 * re-check everything (staff, ownership, the 24-hour lock, the accept race),
 * so a stale tab can't cheat, it just gets the server's refusal as an error
 * banner. Losing an accept race surfaces here as "already covered".
 */
export function DeskShiftCalendar({
  year,
  month,
  shifts,
  staff,
  meId,
  isRd,
  nowMs,
  todayKey,
}: {
  year: number;
  month: number; // 1–12
  shifts: ShiftRow[];
  staff: StaffRow[];
  meId: string | null;
  isRd: boolean;
  /** Server render time — lock states derive from it, keeping render pure
      (no hydration mismatch). Every shift action revalidates the page, so
      it stays current. */
  nowMs: number;
  /** Today on the building's clock (YYYY-MM-DD), from the server. */
  todayKey: string;
}) {
  const [error, setError] = useState<string | null>(null);
  // RD assignment target, or null when the picker is closed.
  const [picking, setPicking] = useState<SlotRef | null>(null);
  // Own-shift action panel (release / request coverage / withdraw).
  const [ownPanel, setOwnPanel] = useState<SlotRef | null>(null);
  const [, startTransition] = useTransition();

  const base = new Map<string, SlotState>();
  for (const row of shifts) {
    if (row.claimed_by) {
      base.set(`${row.shift_date}|${row.slot}`, {
        owner: row.claimed_by,
        cover: row.coverage_requested_at !== null,
      });
    }
  }
  const [optimistic, applyOptimistic] = useOptimistic(
    base,
    (state, update: { key: string; value: SlotState | null }) => {
      const copy = new Map(state);
      if (update.value) copy.set(update.key, update.value);
      else copy.delete(update.key);
      return copy;
    },
  );

  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const ownerLabel = (owner: string | null) =>
    owner ? (nameOf.get(owner) ?? "staff") : "staff";

  function run(
    key: string,
    value: SlotState | null,
    call: () => Promise<{ ok: boolean } & { error?: string }>,
  ) {
    setError(null);
    startTransition(async () => {
      applyOptimistic({ key, value });
      const result = await call();
      if (!result.ok && result.error) setError(result.error);
    });
  }

  function slotState(date: string, slot: ShiftSlot): SlotState {
    return optimistic.get(`${date}|${slot}`) ?? { owner: null, cover: false };
  }

  function onAccept(date: string, slot: ShiftSlot) {
    run(`${date}|${slot}`, { owner: meId, cover: false }, () =>
      acceptCoverage(date, slot),
    );
  }

  function onSlotTap(date: string, slot: ShiftSlot, locked: boolean) {
    const { owner, cover } = slotState(date, slot);
    if (isRd) {
      // The RD always gets the picker — assign, reassign, or clear, any time.
      setPicking({ date, slot });
      setOwnPanel(null);
      return;
    }
    if (owner === meId && owner !== null) {
      // Two possible actions on one chip — open the panel to choose.
      setOwnPanel({ date, slot });
      return;
    }
    if (cover) {
      // Someone else's shift that needs cover: tapping accepts it.
      onAccept(date, slot);
      return;
    }
    if (owner === null && !locked) {
      run(`${date}|${slot}`, { owner: meId, cover: false }, () =>
        claimShift(date, slot),
      );
    }
  }

  function onAssign(userId: string | null) {
    if (!picking) return;
    const { date, slot } = picking;
    setPicking(null);
    run(
      `${date}|${slot}`,
      userId ? { owner: userId, cover: false } : null,
      () => assignShift(date, slot, userId),
    );
  }

  // Own-shift panel actions.
  function onRelease() {
    if (!ownPanel) return;
    const { date, slot } = ownPanel;
    setOwnPanel(null);
    run(`${date}|${slot}`, null, () => releaseShift(date, slot));
  }
  function onCoverage(date: string, slot: ShiftSlot, requesting: boolean) {
    setOwnPanel(null);
    run(
      `${date}|${slot}`,
      { owner: meId, cover: requesting },
      () => (requesting ? requestCoverage(date, slot) : withdrawCoverage(date, slot)),
    );
  }

  // Calendar geometry — plain calendar math, no timezone conversion.
  const leadingBlanks = weekdayOf(dateKey(year, month, 1));
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1),
  ];

  // Open coverage requests this month that can still be accepted — a shift
  // already under way can't change hands, so it leaves the strip.
  const needsCover = [...optimistic.entries()]
    .filter(([, v]) => v.cover)
    .map(([key, v]) => {
      const [date, slot] = key.split("|");
      return { date, slot: Number(slot) as ShiftSlot, owner: v.owner };
    })
    .filter(({ date, slot }) => shiftStartMs(date, slot) > nowMs)
    .sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);

  const ownPanelState = ownPanel ? slotState(ownPanel.date, ownPanel.slot) : null;
  const ownPanelStartMs = ownPanel ? shiftStartMs(ownPanel.date, ownPanel.slot) : 0;

  return (
    <div className="mt-4">
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}

      {needsCover.length > 0 && (
        <CoverageStrip
          items={needsCover.map((n) => ({ ...n, ownerName: ownerLabel(n.owner) }))}
          meId={meId}
          onWithdraw={(date, slot) => onCoverage(date, slot, false)}
          onAccept={onAccept}
        />
      )}

      {picking && (
        <AssignPicker
          target={picking}
          staff={staff}
          onAssign={onAssign}
          onCancel={() => setPicking(null)}
        />
      )}

      {ownPanel && ownPanelState && (
        <OwnShiftPanel
          target={ownPanel}
          cover={ownPanelState.cover}
          locked={ownPanelStartMs - nowMs < LOCK_MS}
          started={ownPanelStartMs <= nowMs}
          onRelease={onRelease}
          onCoverage={(requesting) => onCoverage(ownPanel.date, ownPanel.slot, requesting)}
          onCancel={() => setOwnPanel(null)}
        />
      )}

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <p key={i} className="text-[10px] font-semibold uppercase text-faint">
            {d}
          </p>
        ))}

        {cells.map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;
          const date = dateKey(year, month, day);
          const isToday = date === todayKey;
          const scheduled = slotsOn(date);
          const offNight = scheduled.length === 0;
          // The schedule decides what can be claimed; a shift someone already
          // holds renders regardless, so dropping a night never hides who
          // worked it. Off-schedule slots therefore only ever appear taken.
          const visibleSlots = SHIFT_SLOTS.filter(
            ({ slot }) =>
              scheduled.includes(slot) || slotState(date, slot).owner !== null,
          );
          return (
            <div
              key={date}
              className={`flex min-h-[72px] flex-col gap-1 rounded-lg border p-1 ${
                offNight ? "border-line/50 bg-chip/40" : "border-line"
              }`}
            >
              {/* The date, visible but quiet — the shifts are the content. */}
              <p
                className={`text-right text-[10px] leading-none ${
                  isToday
                    ? "font-bold text-navy"
                    : offNight
                      ? "text-faint/50"
                      : "text-faint"
                }`}
              >
                {day}
              </p>
              {visibleSlots.map(({ slot, label, short }) => {
                const { owner, cover } = slotState(date, slot);
                const start = shiftStartMs(date, slot);
                const locked = start - nowMs < LOCK_MS;
                const started = start <= nowMs;
                const mine = owner !== null && owner === meId;
                const ownerName = owner ? ownerLabel(owner) : null;

                // What a tap would do decides whether this renders tappable:
                // RD → picker; mine → action panel; needs-cover → accept;
                // open+unlocked → claim.
                const tappable =
                  isRd ||
                  mine ||
                  (cover && !started) ||
                  (owner === null && !locked);
                const title = owner
                  ? cover
                    ? `${label} — ${ownerName} needs coverage${mine ? " (your request)" : " — tap to accept"}`
                    : `${label} — ${ownerName}${mine ? " (you — tap for actions)" : ""}`
                  : locked && !isRd
                    ? `${label} — open, but locked (<24 h). Ask the RD.`
                    : `${label} — open, tap to claim`;

                return (
                  <button
                    key={slot}
                    type="button"
                    title={title}
                    aria-label={title}
                    disabled={!tappable}
                    onClick={() => onSlotTap(date, slot, locked)}
                    className={`flex h-6 items-center justify-center rounded-full [touch-action:manipulation] ${
                      owner
                        ? cover
                          ? "ring-2 ring-accent-deep"
                          : mine
                            ? "ring-2 ring-navy/35"
                            : ""
                        : `border border-dashed text-[9px] font-semibold ${
                            locked && !isRd
                              ? "border-line text-faint/60"
                              : "border-faint text-muted hover:border-navy hover:text-navy"
                          }`
                    } ${tappable ? "cursor-pointer" : "cursor-default"}`}
                  >
                    {owner ? (
                      <Avatar name={ownerName!} size="sm" />
                    ) : (
                      <span>{short}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className="mt-3 px-1 text-xs text-muted">
        Tap an open slot to claim it
        {isRd ? "; as RD, tap any slot to assign or clear it" : ""}. Greyed
        days aren&rsquo;t staffed, so they have no slots to claim — a shift
        already held on one still shows, and can still be released or covered.
        Tap your own circle for actions. Shifts lock 24 hours before start —
        inside the window, requesting coverage is the only way out, and you
        stay on the shift until someone accepts. Orange means a shift needs
        cover: tap it (or Accept above) to take it.
      </p>
    </div>
  );
}

/** Shifts needing cover — the one orange-accent state on this screen. */
function CoverageStrip({
  items,
  meId,
  onWithdraw,
  onAccept,
}: {
  items: { date: string; slot: ShiftSlot; owner: string | null; ownerName: string }[];
  meId: string | null;
  onWithdraw: (date: string, slot: ShiftSlot) => void;
  onAccept: (date: string, slot: ShiftSlot) => void;
}) {
  return (
    <div className="mb-4">
      <SectionLabel className="text-[15px]">Needs coverage</SectionLabel>
      <ul className="mt-2 space-y-2">
        {items.map(({ date, slot, owner, ownerName }) => {
          const mine = owner !== null && owner === meId;
          return (
            <li
              key={`${date}|${slot}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent-border bg-accent-soft px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Avatar name={ownerName} size="sm" />
                <p className="text-sm text-ink">
                  <span className="font-semibold">{shiftLabel(date, slot)}</span>
                  {" · "}
                  {mine ? "your shift" : ownerName}
                </p>
              </div>
              {mine ? (
                <Button variant="subtle" size="sm" onClick={() => onWithdraw(date, slot)}>
                  Withdraw
                </Button>
              ) : (
                <Button variant="attention" size="sm" onClick={() => onAccept(date, slot)}>
                  Accept
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** RD only: pick who takes a slot, or clear it back to open. */
function AssignPicker({
  target,
  staff,
  onAssign,
  onCancel,
}: {
  target: SlotRef;
  staff: StaffRow[];
  onAssign: (userId: string | null) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-3 rounded-xl border border-line bg-chip p-3">
      <p className="text-xs font-semibold text-muted">
        Assign {shiftLabel(target.date, target.slot)}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {staff.map((s) => (
          <Button key={s.id} variant="outline" size="sm" onClick={() => onAssign(s.id)}>
            {s.name}
          </Button>
        ))}
        <Button variant="subtle" size="sm" onClick={() => onAssign(null)}>
          Open
        </Button>
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Actions on a shift you hold. Release needs 24 hours of notice; a coverage
 * request works right up to the start, and nothing changes hands after that.
 */
function OwnShiftPanel({
  target,
  cover,
  locked,
  started,
  onRelease,
  onCoverage,
  onCancel,
}: {
  target: SlotRef;
  cover: boolean;
  locked: boolean;
  started: boolean;
  onRelease: () => void;
  onCoverage: (requesting: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-3 rounded-xl border border-line bg-chip p-3">
      <p className="text-xs font-semibold text-muted">
        Your shift — {shiftLabel(target.date, target.slot)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!started && (
          <Button
            variant="outline"
            size="sm"
            disabled={locked}
            title={
              locked
                ? "Inside 24 hours you can't leave the shift open — request coverage instead"
                : undefined
            }
            onClick={onRelease}
          >
            Release shift
          </Button>
        )}
        {cover ? (
          <Button variant="subtle" size="sm" onClick={() => onCoverage(false)}>
            Withdraw coverage request
          </Button>
        ) : (
          !started && (
            <Button variant="attention" size="sm" onClick={() => onCoverage(true)}>
              Request coverage
            </Button>
          )
        )}
        <Button variant="subtle" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {started ? (
        <p className="mt-2 text-xs text-muted">
          This shift has already started — it can&rsquo;t change hands now.
        </p>
      ) : (
        locked && (
          <p className="mt-2 text-xs text-muted">
            This shift starts in under 24 hours — you stay assigned until
            someone accepts your coverage request.
          </p>
        )
      )}
    </div>
  );
}
