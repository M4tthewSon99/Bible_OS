"use client";

import type { ReactNode, RefObject } from "react";
import { Button } from "react-aria-components";
import { motion } from "motion/react";
import { AnimatePresence } from "@/components/fluid-surfaces";
import {
  WEEKDAY_INITIALS,
  formatMonthLabel,
  monthMatrix,
  todayKey,
} from "@/lib/devotion";

interface DevotionCalendarProps {
  hasEntry: (dateKey: string) => boolean;
  month: string;
  monthDirection: 1 | -1;
  onPick: (dateKey: string) => void;
  onStepMonth: (delta: 1 | -1) => void;
  selectedDate: string;
}

// The grid slides toward the month you asked for, so the direction of the
// press is visible in the motion itself. Critically damped — nothing was
// flicked here, so nothing should overshoot.
const monthVariants = {
  enter: (direction: 1 | -1) => ({ opacity: 0, x: direction * 14 }),
  center: { opacity: 1, x: 0 },
  // The outgoing month leaves on a short tween rather than the spring: a
  // spring's tail keeps it mounted (and tabbable) long after it is invisible.
  exit: (direction: 1 | -1) => ({
    opacity: 0,
    x: direction * -14,
    transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] as const },
  }),
};

const MONTH_SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 38,
  mass: 1,
};

export function DevotionCalendar({
  hasEntry,
  month,
  monthDirection,
  onPick,
  onStepMonth,
  selectedDate,
}: DevotionCalendarProps): ReactNode {
  const today = todayKey();

  return (
    <div className="devotion-calendar">
      <div className="calendar-head">
        <Button aria-label="Previous month" className="calendar-nav" onPress={() => onStepMonth(-1)}>
          <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Button>
        <span aria-live="polite" className="calendar-month">{formatMonthLabel(month)}</span>
        <Button aria-label="Next month" className="calendar-nav" onPress={() => onStepMonth(1)}>
          <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Button>
      </div>

      <div aria-hidden="true" className="calendar-weekdays">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <span key={`${initial}-${index}`}>{initial}</span>
        ))}
      </div>

      <div className="calendar-viewport">
        <AnimatePresence custom={monthDirection} initial={false} mode="wait">
          <motion.div
            animate="center"
            className="calendar-grid"
            custom={monthDirection}
            exit="exit"
            initial="enter"
            key={month}
            transition={MONTH_SPRING}
            variants={monthVariants}
          >
            {monthMatrix(month).flat().map((cell) => {
              const classes = ["calendar-day"];
              if (cell.outside) classes.push("outside");
              if (cell.key === today) classes.push("today");
              if (cell.key === selectedDate) classes.push("selected");
              if (hasEntry(cell.key)) classes.push("has-entry");
              return (
                <Button
                  aria-current={cell.key === selectedDate ? "date" : undefined}
                  aria-label={cell.key}
                  className={classes.join(" ")}
                  key={cell.key}
                  onPress={() => onPick(cell.key)}
                >
                  {cell.day}
                </Button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="calendar-footer">
        <Button className="calendar-today" onPress={() => onPick(today)}>Today</Button>
      </div>
    </div>
  );
}

interface DevotionTriggerProps {
  hasEntryToday: boolean;
  onPress: () => void;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function DevotionTrigger({
  hasEntryToday,
  onPress,
  open,
  triggerRef,
}: DevotionTriggerProps): ReactNode {
  return (
    <button
      aria-expanded={open}
      aria-label="Daily devotion"
      className="icon-button devotion-button"
      onClick={onPress}
      ref={triggerRef}
      title="Daily devotion"
      type="button"
    >
      <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
        <rect height="16" rx="2.5" width="18" x="3" y="5" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      {hasEntryToday && <span aria-hidden="true" className="devotion-dot" />}
    </button>
  );
}
