"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import { motion, type Transition } from "motion/react";
import { AnimatePresence, FluidBackdrop, FluidSurface } from "@/components/fluid-surfaces";
import { DevotionCalendar } from "@/components/devotion-calendar";
import { DEVOTION_PROMPTS, formatDateLabel } from "@/lib/devotion";
import { markdown } from "@/lib/markdown";
import type { DevotionEntry } from "@/lib/types";

interface DevotionPanelProps {
  calendarOpen: boolean;
  date: string;
  entry: DevotionEntry | undefined;
  hasEntry: (dateKey: string) => boolean;
  mode: "write" | "preview";
  month: string;
  monthDirection: 1 | -1;
  narrow: boolean;
  onAnswerChange: (promptId: string, value: string) => void;
  onClear: () => void;
  onClose: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onModeChange: (mode: "write" | "preview") => void;
  onPickDate: (dateKey: string) => void;
  onStepMonth: (delta: 1 | -1) => void;
  onToggleCalendar: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  /* Supplied by the reader so both side panels share one resize handle
     implementation and one stored width. */
  resizer?: ReactNode;
  saveState: string;
  transitionOverride?: Transition;
  width: number;
}

export function DevotionPanel({
  calendarOpen,
  date,
  entry,
  hasEntry,
  mode,
  month,
  monthDirection,
  narrow,
  onAnswerChange,
  onClear,
  onClose,
  onKeyDown,
  onModeChange,
  onPickDate,
  onStepMonth,
  onToggleCalendar,
  panelRef,
  resizer,
  saveState,
  transitionOverride,
  width,
}: DevotionPanelProps): ReactNode {
  const answers = entry?.answers || {};

  const panel = (
    <FluidSurface
      ariaLabel="Daily devotion"
      ariaModal={narrow}
      className="notes-panel devotion-panel"
      draggable={narrow}
      edge="right"
      /* On desktop this is intentionally the same width transition as Notes:
         the reader and its companion rail trade space as one physical action. */
      expandWidth={narrow ? undefined : width}
      key="devotion-panel"
      onClick={(event) => event.stopPropagation()}
      onDismiss={onClose}
      onKeyDown={onKeyDown}
      ref={panelRef}
      role={narrow ? "dialog" : "complementary"}
      showHandle={narrow}
      transitionOverride={transitionOverride}
    >
      {resizer}
      <div className="notes-header">
        <span>Devotion</span>
        <button aria-label="Close devotion" onClick={onClose} type="button">×</button>
      </div>

      <div className="notes-content">
        <button
          aria-expanded={calendarOpen}
          className={`devotion-date-button${calendarOpen ? " open" : ""}`}
          onClick={onToggleCalendar}
          type="button"
        >
          <span>{formatDateLabel(date)}</span>
          <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="13">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* Collapses out of the way once a day is chosen, so the writing
            surface gets the room. Fades before it closes, matching the
            book-picker accordion. */}
        <AnimatePresence initial={false}>
          {calendarOpen && (
            <motion.div
              animate={{
                height: "auto",
                opacity: 1,
                transition: {
                  height: { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] },
                  opacity: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] },
                },
              }}
              className="devotion-calendar-wrap"
              exit={{
                height: 0,
                opacity: 0,
                transition: {
                  opacity: { duration: 0.1, ease: [0.2, 0.8, 0.2, 1] },
                  height: { delay: 0.08, duration: 0.2, ease: [0.2, 0.8, 0.2, 1] },
                },
              }}
              initial={{ height: 0, opacity: 0 }}
            >
              <DevotionCalendar
                hasEntry={hasEntry}
                month={month}
                monthDirection={monthDirection}
                onPick={onPickDate}
                onStepMonth={onStepMonth}
                selectedDate={date}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {entry?.ref && <p className="annotation-language">Reading · {entry.ref}</p>}

        <div aria-label="Devotion editor mode" className="segmented editor-mode" role="group">
          {(["write", "preview"] as const).map((value) => (
            <button
              aria-pressed={mode === value}
              className={mode === value ? "active" : ""}
              key={value}
              onClick={() => onModeChange(value)}
              type="button"
            >
              {value === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>

        {DEVOTION_PROMPTS.map((prompt) => (
          <section className="devotion-block" key={prompt.id}>
            <p className="notes-eyebrow">{prompt.label}</p>
            <p className="devotion-hint">{prompt.hint}</p>
            {mode === "write" ? (
              <textarea
                aria-label={prompt.label}
                className="note-editor devotion-editor"
                onChange={(event) => onAnswerChange(prompt.id, event.target.value)}
                placeholder="Markdown welcome — **bold**, *italics*, - list, > quote"
                value={answers[prompt.id] || ""}
              />
            ) : (
              <div
                className="note-preview devotion-editor"
                dangerouslySetInnerHTML={{
                  __html: answers[prompt.id]?.trim()
                    ? markdown(answers[prompt.id])
                    : '<p class="empty-preview">Nothing written yet.</p>',
                }}
              />
            )}
          </section>
        ))}

        <p aria-live="polite" className="save-state">{saveState}</p>
      </div>

      <div className="notes-footer">
        <span>Saved in this browser</span>
        <button disabled={!entry} onClick={onClear} type="button">Clear this day</button>
      </div>
    </FluidSurface>
  );

  return narrow ? (
    <FluidBackdrop className="notes-backdrop devotion-backdrop" onDismiss={onClose}>
      {panel}
    </FluidBackdrop>
  ) : panel;
}
