"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// Launch splash: an orange orbit spins while the app loads, then the seal
// comes forward from behind it, holds briefly, and the screen fades out.
//
// The first frame is server-rendered HTML + CSS, so it paints before any
// JavaScript runs (no blank screen). This component only drives the phases:
//   loading -> reveal -> exit -> done
// The visuals for each phase live in globals.css (.th-splash*).

const MIN_ORBIT_MS = 1200; // orbit is always visible at least this long
const REVEAL_MS = 900; // seal comes forward
const HOLD_MS = 800; // seal stays on screen
const EXIT_MS = 400; // fade out into the app

const SEEN_KEY = "th-splash"; // sessionStorage flag; the inline script in layout.tsx reads the same key

type Phase = "loading" | "reveal" | "exit" | "done";

export function SplashScreen() {
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    // Already played this session: the inline script in layout.tsx hid the
    // overlay before first paint, so just unmount it.
    const timers: number[] = [];

    if (document.documentElement.dataset.splash === "skip") {
      timers.push(window.setTimeout(() => setPhase("done"), 0));
      return () => timers.forEach((t) => window.clearTimeout(t));
    }

    let minElapsed = false;
    let loaded = document.readyState === "complete";
    let revealed = false;

    const reveal = () => {
      if (revealed || !minElapsed || !loaded) return;
      revealed = true;
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        // Storage blocked: the splash simply plays again next time.
      }
      setPhase("reveal");
      timers.push(window.setTimeout(() => setPhase("exit"), REVEAL_MS + HOLD_MS));
      timers.push(
        window.setTimeout(() => setPhase("done"), REVEAL_MS + HOLD_MS + EXIT_MS),
      );
    };

    const onLoad = () => {
      loaded = true;
      reveal();
    };

    timers.push(
      window.setTimeout(() => {
        minElapsed = true;
        reveal();
      }, MIN_ORBIT_MS),
    );
    if (!loaded) window.addEventListener("load", onLoad, { once: true });
    else reveal();

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("load", onLoad);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      className="th-splash"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-label="Loading Tudor Hall"
    >
      <div className="th-splash-stage">
        <div className="th-splash-orbit" aria-hidden="true">
          <svg
            className="th-splash-spin"
            width="252"
            height="252"
            viewBox="0 0 252 252"
          >
            <circle
              cx="126"
              cy="126"
              r="122"
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="3"
            />
            <circle
              cx="126"
              cy="126"
              r="122"
              fill="none"
              stroke="#f7b267"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="180 590"
            />
          </svg>
        </div>
        <Image
          className="th-splash-logo"
          src="/splash-seal.png"
          alt="Tudor Hall seal"
          width={208}
          height={208}
          priority
          unoptimized
        />
      </div>
      <div className="th-splash-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
