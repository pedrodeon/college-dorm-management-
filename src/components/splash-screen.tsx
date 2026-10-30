"use client";

import { useEffect, useState } from "react";

// Launch splash: the seal fills itself with color from the bottom up, like
// water rising in a glass, then the screen fades out into the app.
//
// The first frame is server-rendered HTML + CSS, so it paints before any
// JavaScript runs (no blank screen). This component only drives the phases:
//   loading -> fill -> exit -> done
// "loading" rises to ~85% and waits there for the page; "fill" tops it off.
// The visuals for each phase live in globals.css (.th-splash*).

// Both deadlines are measured from navigation start, not from when this
// effect runs: the CSS rise began at first paint, and hydration can lag it
// by seconds on a slow phone.
const MIN_RISE_MS = 1800; // matches th-splash-rise in globals.css
const MAX_WAIT_MS = 4000; // stop waiting for `load` after this, whatever is still fetching
const FILL_MS = 700; // last 15% fills once the app has loaded
const HOLD_MS = 500; // full seal stays on screen
const EXIT_MS = 400; // fade out into the app
// globals.css also hides .th-splash on its own after th-splash-failsafe's
// delay, so a bundle that never runs can't leave the overlay up for good.

const SEEN_KEY = "th-splash"; // sessionStorage flag; the inline script in layout.tsx reads the same key
const SEAL_SRC = "/splash-seal.png";

type Phase = "loading" | "fill" | "exit" | "done";

export function SplashScreen() {
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    const timers: number[] = [];

    // Already played this session: the inline script in layout.tsx hid the
    // overlay before first paint, so just unmount it. (The zero-delay timeout
    // keeps the state update out of the effect body itself.)
    if (document.documentElement.dataset.splash === "skip") {
      timers.push(window.setTimeout(() => setPhase("done"), 0));
      return () => timers.forEach((t) => window.clearTimeout(t));
    }

    // How long the page has already been on screen before hydration.
    const alreadyElapsed = performance.now();
    const at = (sinceNavigationMs: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, Math.max(0, sinceNavigationMs - alreadyElapsed)));
    };

    let minElapsed = false;
    let loaded = document.readyState === "complete";
    let filled = false;

    const fill = () => {
      if (filled || !minElapsed || !loaded) return;
      filled = true;
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        // Storage blocked: the splash simply plays again next time.
      }
      setPhase("fill");
      timers.push(window.setTimeout(() => setPhase("exit"), FILL_MS + HOLD_MS));
      timers.push(
        window.setTimeout(() => setPhase("done"), FILL_MS + HOLD_MS + EXIT_MS),
      );
    };

    const onLoad = () => {
      loaded = true;
      fill();
    };

    at(MIN_RISE_MS, () => {
      minElapsed = true;
      fill();
    });
    // The app is usable as soon as it has hydrated; `load` can trail that by
    // a long way on a page full of inspection photos. Don't make people wait.
    at(MAX_WAIT_MS, onLoad);
    if (!loaded) window.addEventListener("load", onLoad, { once: true });

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("load", onLoad);
    };
  }, []);

  if (phase === "done") return null;

  // Two stacked copies of the seal: a translucent back wave just ahead of the
  // surface, and the full-color water itself. Nothing shows above the water.
  return (
    <div
      className="th-splash"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-label="Loading Tudor Hall"
    >
      <div className="th-splash-seal">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="th-splash-water th-splash-water-back" src={SEAL_SRC} alt="" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="th-splash-water" src={SEAL_SRC} alt="Tudor Hall seal" />
      </div>
    </div>
  );
}
