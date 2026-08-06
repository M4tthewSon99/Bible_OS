"use client";

import {
  forwardRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  type PanInfo,
  useDragControls,
} from "motion/react";

export const SURFACE_SPRING = {
  type: "spring" as const,
  stiffness: 320,
  damping: 36,
  mass: 1,
};

const GESTURE_SPRING = {
  type: "spring" as const,
  stiffness: 440,
  damping: 34,
  mass: 1,
};

type SurfaceEdge = "center" | "popover" | "right" | "bottom";

interface FluidSurfaceProps {
  ariaLabel?: string;
  ariaModal?: boolean;
  children: ReactNode;
  className: string;
  draggable?: boolean;
  edge?: SurfaceEdge;
  expandWidth?: number;
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onDismiss?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  role?: "complementary" | "dialog" | "menu";
  showHandle?: boolean;
  style?: CSSProperties;
}

function projectedDistance(offset: number, velocity: number): number {
  const decelerationRate = 0.998;
  return offset + (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

export function FluidProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={SURFACE_SPRING}>
      {children}
    </MotionConfig>
  );
}

export { AnimatePresence };

export function SurfacePortal({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  if (!enabled) return children;
  return host ? createPortal(children, host) : null;
}

export const FluidSurface = forwardRef<HTMLDivElement, FluidSurfaceProps>(function FluidSurface(
  {
    ariaLabel,
    ariaModal,
    children,
    className,
    draggable = true,
    edge = "popover",
    expandWidth,
    onClick,
    onDismiss,
    onKeyDown,
    role,
    showHandle = false,
    style,
  },
  ref,
) {
  const dragControls = useDragControls();
  const axis = draggable && edge === "right" ? "x" : draggable && edge === "bottom" ? "y" : false;
  const initial = edge === "right"
    ? { opacity: 0.72, x: "100%", scale: 0.985 }
    : edge === "bottom"
      ? { opacity: 0.72, y: "100%", scale: 0.99 }
      : edge === "center"
        ? { opacity: 0, y: 0, scale: 1, filter: "blur(0px)" }
        : { opacity: 0, y: -7, scale: 0.96, filter: "blur(8px)" };
  const collapsed = expandWidth ? { ...initial, width: 0 } : initial;

  const finishDrag = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!axis || !onDismiss) return;
    const offset = axis === "x" ? info.offset.x : info.offset.y;
    const velocity = axis === "x" ? info.velocity.x : info.velocity.y;
    const span = axis === "x"
      ? Math.min(420, window.innerWidth * 0.92)
      : window.innerHeight * 0.92;
    if (velocity > 650 || projectedDistance(offset, velocity) > span * 0.42) onDismiss();
  };

  return (
    <motion.div
      animate={{
        opacity: 1,
        x: 0,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
        width: expandWidth,
      }}
      aria-label={ariaLabel}
      aria-modal={ariaModal}
      className={className}
      drag={axis}
      dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
      dragControls={dragControls}
      dragDirectionLock
      dragElastic={axis === "x"
        ? { left: 0.025, right: 0.22 }
        : axis === "y"
          ? { top: 0.025, bottom: 0.22 }
          : false}
      dragListener={false}
      dragMomentum={false}
      exit={collapsed}
      initial={collapsed}
      onClick={onClick}
      onDragEnd={finishDrag}
      onKeyDown={onKeyDown}
      ref={ref}
      role={role}
      style={style}
      transition={axis ? GESTURE_SPRING : SURFACE_SPRING}
    >
      {showHandle && axis && (
        <div
          aria-hidden="true"
          className={`sheet-grabber ${axis === "x" ? "vertical" : "horizontal"}`}
          onPointerDown={(event) => dragControls.start(event)}
        >
          <span />
        </div>
      )}
      {children}
    </motion.div>
  );
});

interface FluidBackdropProps {
  children: ReactNode;
  className: string;
  onDismiss: () => void;
}

export function FluidBackdrop({ children, className, onDismiss }: FluidBackdropProps) {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={className}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      onClick={onDismiss}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
