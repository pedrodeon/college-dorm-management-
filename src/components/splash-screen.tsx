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

const MIN_RISE_MS = 1800; // matches th-splash-rise in globals.css
const FILL_MS = 700; // last 15% fills once the app has loaded
const HOLD_MS = 500; // full seal stays on screen
const EXIT_MS = 400; // fade out into the app

const SEEN_KEY = "th-splash"; // sessionStorage flag; the inline script in layout.tsx reads the same key
const SEAL_SRC = "/splash-seal.png";

type Phase = "loading" | "fill" | "exit" | "done";

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

    timers.push(
      window.setTimeout(() => {
        minElapsed = true;
        fill();
      }, MIN_RISE_MS),
    );
    if (!loaded) window.addEventListener("load", onLoad, { once: true });
    else fill();

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
