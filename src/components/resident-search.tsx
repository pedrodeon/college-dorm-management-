"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  searchResidents,
  type SearchResponse,
} from "@/app/(app)/search/actions";
import { SEARCH_LIMIT } from "@/lib/resident-search";
import { StatusChip } from "@/components/ui/status-chip";
import { SearchInput } from "@/components/ui/search-input";

const DEBOUNCE_MS = 250;

/**
 * Building-wide resident search: a magnifier that opens a full-screen sheet
 * on phones and a centred modal on desktop. Mounted on Home and Roster only.
 *
 * Results are whatever the caller's own session can read — the action queries
 * the same view the roster does, so an RA and the RD see search results
 * scoped exactly like every other screen.
 */
export function ResidentSearch({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search residents"
        title="Search residents"
        className={`flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 ${className ?? ""}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path
            d="M16.5 16.5L21 21"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && <SearchOverlay onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // The answer is stored WITH the question it answers, so a result is only
  // ever shown against the text it was actually for.
  const [answer, setAnswer] = useState<{
    query: string;
    outcome: SearchResponse;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Server actions can't be aborted mid-flight, so every request carries a
  // sequence number and anything but the newest is dropped on arrival — a
  // slow early keystroke can never overwrite a fast late one.
  const latest = useRef(0);

  const go = useCallback(
    (hit: { id: string }) => {
      onClose();
      router.push(`/residents/${hit.id}`);
    },
    [onClose, router],
  );

  useEffect(() => {
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed === "") {
      latest.current += 1; // strand anything already in flight
      return;
    }
    const timer = setTimeout(async () => {
      const ticket = ++latest.current;
      // A rejected action (network gone, server down) must land as an
      // answer too, or the overlay reads "Searching…" forever.
      const outcome = await searchResidents(trimmed).catch(
        (): SearchResponse => ({
          kind: "error",
          message: "Search couldn't reach the server. Check your connection and try again.",
        }),
      );
      if (ticket !== latest.current) return; // a newer keystroke won
      setAnswer({ query: trimmed, outcome });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const top = result?.matches[0];
      if (top) go(top);
    }
  }

  // Only an answer to the CURRENT text counts; anything else still reads as
  // "searching", which is what it is.
  const response = answer?.query === trimmed ? answer.outcome : null;
  const failure = response?.kind === "error" ? response.message : null;
  const result = response && response.kind !== "error" ? response : null;
  const matches = result?.matches ?? [];
  const hasQuery = trimmed !== "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search residents"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-canvas/95 backdrop-blur-sm sm:items-center sm:justify-start sm:bg-black/50 sm:pt-24"
    >
      {/* Desktop: a card floating on the dimmed page. Phone: the whole screen. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:min-h-0 sm:w-full sm:max-w-lg sm:flex-none sm:rounded-2xl sm:bg-sheet sm:p-4 sm:shadow-2xl">
        <div className="flex items-center gap-2">
          <SearchInput
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or student ID"
            aria-label="Search by name or student ID"
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={onClose}
            className="flex-none rounded-full border border-white/20 px-3 py-2 text-sm text-white sm:border-line sm:text-ink"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto sm:max-h-[60vh]">
          {!hasQuery ? (
            <Hint>
              Type a name, or a student ID. Only this term&rsquo;s residents
              are searched.
            </Hint>
          ) : failure ? (
            <p
              role="alert"
              className="mx-1 my-3 rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {failure}
            </p>
          ) : result === null ? (
            <Hint>Searching…</Hint>
          ) : matches.length === 0 ? (
            <Hint>No residents match &ldquo;{trimmed}&rdquo;.</Hint>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {matches.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => go(hit)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-left transition-colors hover:bg-white/20 sm:border-line sm:bg-white sm:hover:bg-gray-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white sm:text-ink">
                          {hit.full_name}
                        </span>
                        {/* Room and hallway only. The student ID matched the
                            query but is never put on screen. */}
                        <span className="mt-0.5 block truncate text-xs text-white/60 sm:text-gray-500">
                          {hit.hallway_name ?? "—"}
                          {hit.room_number ? ` · Room ${hit.room_number}` : ""}
                        </span>
                      </span>
                      <StatusChip
                        status={hit.occupancy_status}
                        isPresent={hit.is_present}
                      />
                    </button>
                  </li>
                ))}
              </ul>
              {result !== null && result.total > SEARCH_LIMIT && (
                <Hint>
                  Showing {SEARCH_LIMIT} of {result.total} matches — refine your
                  search.
                </Hint>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 py-3 text-sm text-white/60 sm:text-gray-500">
      {children}
    </p>
  );
}
