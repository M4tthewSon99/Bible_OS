import type { DevotionEntry } from "@/lib/types";

export interface DevotionPrompt {
  id: string;
  label: string;
  hint: string;
}

export const DEVOTION_PROMPTS: DevotionPrompt[] = [
  {
    id: "scripture",
    label: "Scripture",
    hint: "Which passage did you read? Write out the verse that stood out.",
  },
  {
    id: "observation",
    label: "Observation",
    hint: "What does the text actually say? Who is speaking, and to whom?",
  },
  {
    id: "application",
    label: "Application",
    hint: "What does this mean for how you live today?",
  },
  {
    id: "prayer",
    label: "Prayer",
    hint: "Turn it into a prayer.",
  },
];

export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

export interface CalendarCell {
  key: string;
  day: number;
  outside: boolean;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A day key is always the *local* calendar date. Deriving it from
 * toISOString() would shift to UTC and hand an evening reader yesterday's
 * entry anywhere west of Greenwich.
 */
export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string {
  return dateKeyOf(new Date());
}

export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const shifted = new Date(year, index - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

/**
 * Always six rows of seven, Sunday first, so the popover keeps one height
 * across every month instead of jumping when the weeks change.
 */
export function monthMatrix(month: string): CalendarCell[][] {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(year, index - 1, 1);
  const start = new Date(year, index - 1, 1 - first.getDay());
  const rows: CalendarCell[][] = [];

  for (let row = 0; row < 6; row += 1) {
    const cells: CalendarCell[] = [];
    for (let column = 0; column < 7; column += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + row * 7 + column);
      cells.push({
        key: dateKeyOf(date),
        day: date.getDate(),
        outside: date.getMonth() !== index - 1,
      });
    }
    rows.push(cells);
  }
  return rows;
}

export function formatMonthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${MONTH_NAMES[index - 1]} ${year}`;
}

export function formatDateLabel(dateKey: string): string {
  const [year, index, day] = dateKey.split("-").map(Number);
  const date = new Date(year, index - 1, day);
  return `${WEEKDAY_NAMES[date.getDay()]}, ${MONTH_NAMES[index - 1]} ${day}`;
}

/**
 * The same date for a control that shares its row with the mode toggle. The
 * weekday stays whole because that is what a reader scans for; the month gives
 * up its tail so no combination of the two has to truncate.
 */
export function formatCompactDateLabel(dateKey: string): string {
  const [year, index, day] = dateKey.split("-").map(Number);
  const date = new Date(year, index - 1, day);
  return `${WEEKDAY_NAMES[date.getDay()]}, ${MONTH_NAMES[index - 1].slice(0, 3)} ${day}`;
}

export function emptyEntry(dateKey: string, ref: string | null): DevotionEntry {
  const now = new Date().toISOString();
  return {
    v: 1,
    date: dateKey,
    answers: {},
    ref,
    createdAt: now,
    updatedAt: now,
  };
}

export function hasContent(entry: DevotionEntry | undefined): boolean {
  if (!entry) return false;
  // An imported page is meaningful before the reader has written an answer.
  // Without this, the persistence cleanup would silently drop a new plan.
  if (entry.template?.kind === "photo-ocr") return true;
  return Object.values(entry.answers).some((answer) => answer.trim().length > 0);
}
