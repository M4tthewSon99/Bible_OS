"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface PanelResizerProps {
  max: number;
  min: number;
  onResizeEnd: (width: number) => void;
  onResizeMove: (width: number) => void;
  onResizeStart: () => void;
  width: number;
}

const KEY_STEP = 16;
const KEY_STEP_LARGE = 48;

/* Past a bound the divider keeps moving but gives progressively less, so the
   edge reads as "responsive, but there's nothing more here" rather than as a
   frozen control. Apple's rubber-band curve. */
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function resist(raw: number, min: number, max: number): number {
  const span = max - min || 1;
  if (raw > max) return max + rubberband(raw - max, span);
  if (raw < min) return min - rubberband(min - raw, span);
  return raw;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, value)));

export function PanelResizer(props: PanelResizerProps): ReactNode {
  const { max, min, width } = props;
  /* `active` drives styling only; the gesture is gated on a ref, because a
     state update is not visible until the next render and a fast drag can
     deliver moves before that. */
  const [active, setActive] = useState(false);
  const dragging = useRef(false);
  const origin = useRef({ x: 0, width: 0 });
  /* Pointer moves outpace paint, and each width change reflows the whole
     scripture column, so updates are coalesced to one per frame. `latestWidth`
     survives the flush — clearing it there would mean a release that lands
     just after a frame reads back the pre-drag width and snaps home. */
  const latestWidth = useRef<number | null>(null);
  const dirty = useRef(false);
  const frame = useRef<number | null>(null);
  const teardown = useRef<(() => void) | null>(null);
  // Keeps window listeners reading current props without being re-bound.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    teardown.current?.();
  }, []);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragging.current) return;
    event.preventDefault();
    origin.current = { x: event.clientX, width };
    latestWidth.current = null;
    dirty.current = false;
    dragging.current = true;
    setActive(true);
    latest.current.onResizeStart();

    /* Capture keeps the gesture attached to this element, but the window
       listeners are what actually guarantee tracking once the pointer runs
       past the divider — or if capture is unavailable. */
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Tracking still works through the window listeners below.
    }

    const flush = () => {
      frame.current = null;
      if (!dirty.current || latestWidth.current === null) return;
      dirty.current = false;
      latest.current.onResizeMove(latestWidth.current);
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragging.current) return;
      /* The panel sits on the right, so dragging left widens it. Measured
         from where the pointer went down, so the grab point stays put. */
      const raw = origin.current.width - (moveEvent.clientX - origin.current.x);
      latestWidth.current = resist(raw, latest.current.min, latest.current.max);
      dirty.current = true;
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    };

    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      /* The last tracked value, not the prop — the prop trails the last
         flushed frame. Falls back to the origin only if no move ever landed. */
      const raw = latestWidth.current ?? origin.current.width;
      latestWidth.current = null;
      dirty.current = false;
      setActive(false);
      teardown.current?.();
      // Settling runs on the spring, so an overshot drag springs home.
      latest.current.onResizeEnd(clamp(raw, latest.current.min, latest.current.max));
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    teardown.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      teardown.current = null;
    };
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = width + step;
    else if (event.key === "ArrowRight") next = width - step;
    else if (event.key === "Home") next = max;
    else if (event.key === "End") next = min;
    if (next === null) return;
    event.preventDefault();
    latest.current.onResizeEnd(clamp(next, min, max));
  };

  return (
    <div
      aria-label="Resize panel"
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(width)}
      className="panel-resizer"
      data-active={active || undefined}
      onKeyDown={handleKeyDown}
      onPointerDown={beginDrag}
      role="separator"
      tabIndex={0}
    >
      <span aria-hidden="true" />
    </div>
  );
}
