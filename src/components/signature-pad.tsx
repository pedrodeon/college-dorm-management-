"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

export type SignaturePadHandle = {
  /** PNG of the drawing, or null if nothing has been drawn. */
  getBlob: () => Promise<Blob | null>;
  clear: () => void;
};

// Canvas can't use CSS classes, so read the design tokens off the document at
// mount time — the pad follows globals.css instead of duplicating hex values.
function token(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/**
 * Finger/stylus/mouse signature capture on a plain canvas. No dependencies.
 * `touch-action: none` is what makes finger-signing work on phones — without
 * it the page scrolls instead of drawing.
 *
 * The bitmap follows the element's size while the pad is still empty (a
 * phone rotated before signing gets a crisp, correctly shaped canvas). Once
 * strokes exist the bitmap is frozen — resizing would erase them — and
 * pointer positions are mapped through the element-to-bitmap ratio instead,
 * so a stretched pad still draws where the finger is.
 */
export function SignaturePad({
  ref,
  onDirtyChange,
  disabled = false,
}: {
  ref?: Ref<SignaturePadHandle>;
  onDirtyChange?: (hasStrokes: boolean) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirtyRef = useRef(false);
  // The bitmap's size in CSS pixels at the moment it was last (re)built.
  const logical = useRef({ width: 0, height: 0 });
  const [dirty, setDirty] = useState(false);

  function paintBackground(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = token("--color-paper", "#ffffff");
    ctx.fillRect(0, 0, logical.current.width, logical.current.height);
  }

  // Size the bitmap to the element * devicePixelRatio so strokes stay crisp,
  // and set up the pen. Clears the drawing, so only ever called while empty.
  function fitToElement(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    logical.current = { width: rect.width, height: rect.height };
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    paintBackground(ctx);
    ctx.strokeStyle = token("--color-navy", "#16264a");
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    fitToElement(canvas);
    const observer = new ResizeObserver(() => {
      if (!dirtyRef.current) fitToElement(canvas);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pointer position in bitmap (logical) coordinates, whatever size the
      element is drawn at right now. */
  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { width, height } = logical.current;
    return {
      x: (e.clientX - rect.left) * (width / rect.width),
      y: (e.clientY - rect.top) * (height / rect.height),
    };
  }

  function markDirty() {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    setDirty(true);
    onDirtyChange?.(true);
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A dot counts as a stroke (initials, marks).
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    markDirty();
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function handleUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    dirtyRef.current = false;
    setDirty(false);
    onDirtyChange?.(false);
    // Empty again, so the bitmap may follow the element's current size.
    fitToElement(canvas);
  }

  useImperativeHandle(ref, () => ({
    getBlob: () =>
      new Promise<Blob | null>((resolve) => {
        if (!dirtyRef.current || !canvasRef.current) return resolve(null);
        canvasRef.current.toBlob((b) => resolve(b), "image/png");
      }),
    clear,
  }));

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        aria-label="Signature area — draw with your finger"
        className={`h-40 w-full rounded-md border-2 bg-white ${
          disabled
            ? "cursor-not-allowed border-gray-200"
            : "cursor-crosshair border-gray-300"
        }`}
        style={{ touchAction: "none" }}
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {dirty ? "" : "Sign above with your finger"}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !dirty}
          className="text-xs font-medium text-gray-500 hover:text-navy disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
