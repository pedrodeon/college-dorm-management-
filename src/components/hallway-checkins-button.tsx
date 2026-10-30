"use client";

import { useState } from "react";

/**
 * "Download check-ins" — the hallway's move-in records as one PDF.
 *
 * Two steps on purpose. First a cheap probe asking whether the hallway has
 * any completed check-ins (or whether the lookup failed — the route answers
 * 500 for that), so an empty or broken one says so under the button instead
 * of downloading a blank file or showing a page of JSON. Only then does the
 * browser fetch the document itself, by ordinary navigation: the packet can
 * run to tens of megabytes with photos, and letting the browser stream it
 * to disk keeps it out of the page's memory and gives phones their normal
 * download / share sheet. The one case that still reaches the raw JSON is a
 * 409 race (every record became unprintable between probe and download),
 * which cannot happen in normal use.
 */
export function HallwayCheckinsButton({ hallwayId }: { hallwayId: string }) {
  const [state, setState] = useState<"idle" | "working">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function download() {
    setMessage(null);
    setState("working");
    const url = `/api/hallways/${hallwayId}/checkins/pdf`;
    try {
      const probe = await fetch(`${url}?probe=1`, { cache: "no-store" });
      if (!probe.ok) {
        setMessage("Couldn't prepare the packet. Try again.");
        return;
      }
      const { count } = (await probe.json()) as { count: number };
      if (count === 0) {
        setMessage("No completed check-ins in this hallway yet.");
        return;
      }

      // Hand off to the browser: it downloads (or opens the share sheet on
      // an iOS home-screen app) without the page holding the bytes.
      window.location.assign(url);
    } catch {
      setMessage("Couldn't prepare the packet. Try again.");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={download}
        disabled={state === "working"}
        className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-60"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {state === "working" ? "Preparing…" : "Download check-ins"}
      </button>
      {message && (
        <p role="status" className="text-[11px] text-white/60">
          {message}
        </p>
      )}
    </div>
  );
}
