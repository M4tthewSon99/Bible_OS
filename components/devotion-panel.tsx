"use client";

import type {
  ChangeEvent,
  ReactNode,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { AnimatePresence, SURFACE_SPRING } from "@/components/fluid-surfaces";
import { DevotionCalendar } from "@/components/devotion-calendar";
import { DEVOTION_PROMPTS, formatCompactDateLabel, formatDateLabel } from "@/lib/devotion";
import { blockForDevotionDisplay, sectionsForDevotionDisplay } from "@/lib/devotion-layout";
import {
  importHeadline,
  importProgressValue,
  importStageLabel,
} from "@/lib/devotion-import-progress";
import { markdown } from "@/lib/markdown";
import type {
  DevotionEntry,
  DevotionImportDraft,
  DevotionImportMethod,
  DevotionImportUi,
  DevotionSourceView,
  DevotionTemplateBlock,
  DevotionTemplateSection,
  RemovedDevotionBlock,
} from "@/lib/types";

interface DevotionPanelProps {
  calendarOpen: boolean;
  canOpenReference: (reference: string) => boolean;
  date: string;
  entry: DevotionEntry | undefined;
  hasEntry: (dateKey: string) => boolean;
  importUi: DevotionImportUi;
  mode: "write" | "preview";
  month: string;
  monthDirection: 1 | -1;
  onAnswerChange: (promptId: string, value: string) => void;
  onCancelImport: () => void;
  onClear: () => void;
  onConfirmReplace: () => void;
  onEditImported: () => void;
  onLoadSource: (dateKey: string) => Promise<DevotionSourceView | null>;
  onModeChange: (mode: "write" | "preview") => void;
  onOpenReference: (reference: string) => void;
  onPhotoSelected: (file: File, method: DevotionImportMethod) => void;
  onPickDate: (dateKey: string) => void;
  onRemoveBlock: (sectionId: string, blockId: string) => void;
  onRestoreBlock: (blockId: string) => void;
  onSaveImport: () => void;
  onStepMonth: (delta: 1 | -1) => void;
  onToggleCalendar: () => void;
  onUpdateImportDraft: (draft: DevotionImportDraft) => void;
  saveState: string;
  sourceAvailable: boolean;
}

/* Response ~0.34s, critically damped: the default for a surface that simply
   appears. Nothing here is thrown, so nothing here overshoots. */
const REVEAL_SPRING = { ...SURFACE_SPRING };

const EMPTY_ANSWER_PREVIEW = '<p class="empty-preview">Nothing written yet.</p>';

/**
 * One answer, in whichever mode the reader chose. Both kinds of devotion page
 * — the fixed prompts and an imported page's questions — write into the same
 * store and should therefore behave identically here; they differ only in what
 * the field is called and what it suggests when empty.
 */
function AnswerEditor({
  ariaLabel,
  mode,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string;
  mode: "write" | "preview";
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}): ReactNode {
  if (mode === "write") {
    return (
      <textarea
        aria-label={ariaLabel}
        className="note-editor devotion-editor"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    );
  }
  return (
    <div
      className="note-preview devotion-editor"
      dangerouslySetInnerHTML={{ __html: value.trim() ? markdown(value) : EMPTY_ANSWER_PREVIEW }}
    />
  );
}

function draftWithBlockText(draft: DevotionImportDraft, blockId: string, text: string): DevotionImportDraft {
  return {
    ...draft,
    template: {
      ...draft.template,
      sections: draft.template.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => block.id === blockId ? { ...block, text } : block),
      })),
    },
  };
}

function sourceBlockLabel(block: DevotionTemplateBlock): string {
  if (block.kind === "reference") return "Scripture reference";
  if (block.kind === "quote") return "Quoted study note";
  if (block.kind === "prompt") return "Question";
  return "Study text";
}

function promptCount(sections: DevotionTemplateSection[]): number {
  return sections.reduce(
    (total, section) => total + section.blocks.filter((block) => block.kind === "prompt").length,
    0,
  );
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function CheckIcon(): ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height="11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" viewBox="0 0 12 12" width="11">
      <path d="m2 6.3 2.6 2.6L10 3.4" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }): ReactNode {
  return (
    <motion.svg
      animate={{ rotate: open ? 180 : 0 }}
      aria-hidden="true"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      transition={REVEAL_SPRING}
      viewBox="0 0 24 24"
      width="12"
    >
      <path d="m6 9 6 6 6-6" />
    </motion.svg>
  );
}

/**
 * The photographed page, kept where the reader can reach it. A transcription
 * is only checkable against the thing it came from, so this sits above the
 * fields in review and stays one tap away for good afterwards. Collapsed it
 * is a thumbnail; expanded it fills the panel's width at the photo's own
 * aspect ratio, so the height never jumps to a guess.
 */
function SourcePageCard({
  caption,
  expanded,
  onToggle,
  source,
}: {
  caption: string;
  expanded: boolean;
  onToggle: () => void;
  source: DevotionSourceView;
}): ReactNode {
  const ratio = source.height > 0 ? source.width / source.height : 0.72;
  return (
    <div className="devotion-source-card">
      <button
        aria-expanded={expanded}
        className="devotion-source-toggle"
        onClick={onToggle}
        type="button"
      >
        <span className="devotion-source-thumb" style={{ backgroundImage: `url(${source.url})` }} />
        <span className="devotion-source-labels">
          <span className="devotion-source-title">{expanded ? "Hide the photo" : "Compare with the photo"}</span>
          <span className="devotion-source-hint">{caption}</span>
        </span>
        <ChevronIcon open={expanded} />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="devotion-source-full"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={REVEAL_SPRING}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="The photographed devotion page"
              src={source.url}
              style={{ aspectRatio: `${ratio}` }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Reading the photo. The page the reader handed over stays on screen under a
 * sweep, so the wait is spent looking at the thing being worked on rather than
 * at an abstract spinner. The sweep only says "still going"; the bar underneath
 * carries the actual amount, and it is determinate because both engines report
 * genuine fractions.
 */
function ImportProgress({
  method,
  onCancel,
  progress,
  source,
  status,
}: {
  method: DevotionImportMethod | undefined;
  onCancel: () => void;
  progress: number;
  source: DevotionSourceView | null;
  status: string;
}): ReactNode {
  const value = importProgressValue(progress);
  return (
    <div aria-live="polite" className="devotion-import-status">
      <div className="devotion-reading-frame">
        {source
          // eslint-disable-next-line @next/next/no-img-element
          ? <img alt="" src={source.url} />
          : <span className="devotion-reading-placeholder" aria-hidden="true" />}
        <span className="devotion-reading-sweep" aria-hidden="true" />
      </div>
      <p>{importHeadline(method)}</p>
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(value * 100)}
        className="devotion-progress-track"
        role="progressbar"
      >
        <motion.span
          animate={{ scaleX: value }}
          initial={{ scaleX: 0.04 }}
          transition={REVEAL_SPRING}
        />
      </div>
      <small>{importStageLabel(method, status)}</small>
      <button className="devotion-secondary-button" onClick={onCancel} type="button">Cancel</button>
    </div>
  );
}

function RemovedBlocks({
  onRestore,
  removed,
}: {
  onRestore: (blockId: string) => void;
  removed: RemovedDevotionBlock[];
}): ReactNode {
  return (
    <AnimatePresence initial={false}>
      {removed.length > 0 && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="devotion-removed-tray"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={REVEAL_SPRING}
        >
          <p className="notes-eyebrow">Removed</p>
          {removed.map(({ block }) => (
            <div className="devotion-removed-row" key={block.id}>
              <span>{block.text.slice(0, 64)}{block.text.length > 64 ? "…" : ""}</span>
              <button onClick={() => onRestore(block.id)} type="button">Undo</button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** One transcribed block, editable where it sits. A prompt also carries the
 * nested bullets the page printed under it, which are the reader's answer to
 * start from rather than more of the question. */
function ReviewBlock({
  answer,
  block,
  onAnswerChange,
  onRemove,
  onTextChange,
  opensPassage,
}: {
  answer: string;
  block: DevotionTemplateBlock;
  onAnswerChange: (value: string) => void;
  onRemove: () => void;
  onTextChange: (text: string) => void;
  opensPassage: boolean;
}): ReactNode {
  const label = sourceBlockLabel(block);
  return (
    <div className={`devotion-review-block ${block.kind}`}>
      <div className="devotion-review-block-head">
        <span>{label}</span>
        {opensPassage && <span className="devotion-review-badge">Opens the passage</span>}
        <button aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove} type="button">Remove</button>
      </div>
      <textarea
        aria-label={label}
        onChange={(event) => onTextChange(event.target.value)}
        value={block.text}
      />
      {block.kind === "prompt" && (
        <textarea
          aria-label={`Starting answer for ${block.text}`}
          className="devotion-review-answer"
          onChange={(event) => onAnswerChange(event.target.value)}
          placeholder="Optional starting notes — Markdown is supported"
          value={answer}
        />
      )}
    </div>
  );
}

/** Committing stays reachable from anywhere in a long review rather than
 * living at the end of a scroll the reader has to earn. Replacing an existing
 * day is the one genuinely destructive outcome here, so it is the one that
 * asks first. */
function ReviewActionBar({
  canSave,
  onCancel,
  onConfirmReplace,
  onSave,
  replacePending,
}: {
  canSave: boolean;
  onCancel: () => void;
  onConfirmReplace: () => void;
  onSave: () => void;
  replacePending: boolean;
}): ReactNode {
  return (
    <div className="devotion-review-bar">
      {replacePending ? (
        <>
          <p role="alert">This date already has a devotion. Keeping this page replaces it, and its answers go with it.</p>
          <button className="devotion-danger-button" onClick={onConfirmReplace} type="button">Replace it</button>
          <button className="devotion-secondary-button" onClick={onCancel} type="button">Keep the old one</button>
        </>
      ) : (
        <>
          <button className="devotion-primary-button" disabled={!canSave} onClick={onSave} type="button">
            Keep this page
          </button>
          <button className="devotion-secondary-button" onClick={onCancel} type="button">Discard</button>
        </>
      )}
    </div>
  );
}

function ImportReview({
  canOpenReference,
  draft,
  method,
  onCancel,
  onChange,
  onConfirmReplace,
  onRemoveBlock,
  onRestoreBlock,
  onSave,
  removed,
  replacePending,
  source,
}: {
  canOpenReference: (reference: string) => boolean;
  draft: DevotionImportDraft;
  method: DevotionImportMethod | undefined;
  onCancel: () => void;
  onChange: (draft: DevotionImportDraft) => void;
  onConfirmReplace: () => void;
  onRemoveBlock: (sectionId: string, blockId: string) => void;
  onRestoreBlock: (blockId: string) => void;
  onSave: () => void;
  removed: RemovedDevotionBlock[];
  replacePending: boolean;
  source: DevotionSourceView | null;
}): ReactNode {
  const [sourceOpen, setSourceOpen] = useState(false);
  const changeSectionTitle = (sectionId: string, title: string) => onChange({
    ...draft,
    template: {
      ...draft.template,
      sections: draft.template.sections.map((section) => section.id === sectionId ? { ...section, title } : section),
    },
  });
  const changeAnswer = (promptId: string, value: string) => onChange({
    ...draft,
    answers: { ...draft.answers, [promptId]: value },
  });
  const questions = promptCount(draft.template.sections);
  const dateMissing = !draft.date;

  return (
    <div className="devotion-import-review">
      {source && (
        <SourcePageCard
          caption={method === "cloud-vision" ? "Read by vision import" : "Read on this device"}
          expanded={sourceOpen}
          onToggle={() => setSourceOpen((open) => !open)}
          source={source}
        />
      )}

      <div className="devotion-review-summary">
        <p className="devotion-review-found">
          Found {countLabel(draft.template.sections.length, "section")} and {countLabel(questions, "question")}.
        </p>
        <p className="devotion-import-copy">
          {method === "cloud-vision"
            ? "A resized copy of this page went to OpenRouter to be laid out. Fix anything it misread, then keep the page."
            : "This page was read entirely on this device. Fix anything it misread, then keep the page."}
        </p>
      </div>

      <label className={`devotion-review-field${dateMissing ? " needs-attention" : ""}`}>
        <span>Printed date</span>
        <input
          aria-label="Printed devotion date"
          onChange={(event) => onChange({ ...draft, date: event.target.value })}
          type="date"
          value={draft.date}
        />
        {dateMissing && <small role="status">The printed date could not be read — choose it to keep this page.</small>}
      </label>
      <label className="devotion-review-field">
        <span>Bible Text</span>
        <input
          aria-label="Bible text"
          onChange={(event) => onChange({
            ...draft,
            template: { ...draft.template, bibleText: event.target.value || null },
          })}
          placeholder="2 Samuel 2 (ESV)"
          value={draft.template.bibleText || ""}
        />
      </label>

      {draft.template.sections.map((section) => (
        <section className="devotion-review-section" key={section.id}>
          <label className="devotion-review-field">
            <span>Section heading</span>
            <input
              aria-label={`Section heading ${section.title}`}
              onChange={(event) => changeSectionTitle(section.id, event.target.value)}
              value={section.title}
            />
          </label>
          {section.blocks.map((block) => (
            <ReviewBlock
              answer={draft.answers[block.id] || ""}
              block={block}
              key={block.id}
              opensPassage={block.kind === "reference" && canOpenReference(block.text)}
              onAnswerChange={(value) => changeAnswer(block.id, value)}
              onRemove={() => onRemoveBlock(section.id, block.id)}
              onTextChange={(text) => onChange(draftWithBlockText(draft, block.id, text))}
            />
          ))}
        </section>
      ))}

      <RemovedBlocks onRestore={onRestoreBlock} removed={removed} />

      <ReviewActionBar
        canSave={!dateMissing}
        onCancel={onCancel}
        onConfirmReplace={onConfirmReplace}
        onSave={onSave}
        replacePending={replacePending}
      />
    </div>
  );
}

/** A printed reference in a Bible app should be a way into the text. When it
 * does not parse it stays plain type rather than becoming a control that
 * quietly does nothing. */
function ReferenceLink({
  canOpen,
  className,
  onOpen,
  text,
}: {
  canOpen: boolean;
  className: string;
  onOpen: (reference: string) => void;
  text: string;
}): ReactNode {
  if (!canOpen) return <p className={className}>{text}</p>;
  return (
    <p className={className}>
      <button className="devotion-reference-link" onClick={() => onOpen(text)} type="button">
        <span>{text}</span>
        <svg aria-hidden="true" fill="none" height="11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="11">
          <path d="M5 12h13M12 5l7 7-7 7" />
        </svg>
      </button>
    </p>
  );
}

function ImportedDevotion({
  canOpenReference,
  entry,
  mode,
  onAnswerChange,
  onOpenReference,
}: {
  canOpenReference: (reference: string) => boolean;
  entry: DevotionEntry;
  mode: "write" | "preview";
  onAnswerChange: (promptId: string, value: string) => void;
  onOpenReference: (reference: string) => void;
}): ReactNode {
  const template = entry.template;
  const sections = useMemo(
    () => template ? sectionsForDevotionDisplay(template.sections) : [],
    [template],
  );
  /* Numbered across the whole page, not per section: the reader thinks in
     "question 4 of 6", which is also what the masthead counts. */
  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    let next = 0;
    sections.forEach((section) => section.blocks.map(blockForDevotionDisplay).forEach((block) => {
      if (block.kind === "prompt") map.set(block.id, (next += 1));
    }));
    return map;
  }, [sections]);
  if (!template) return null;

  const total = numbers.size;
  const answered = [...numbers.keys()].filter((id) => (entry.answers[id] || "").trim()).length;

  return (
    <div className="imported-devotion">
      <header className="devotion-masthead">
        <p className="devotion-masthead-eyebrow">
          <span>Imported page</span>
          {total > 0 && <span>{answered} of {total} answered</span>}
        </p>
        {template.bibleText && (
          <ReferenceLink
            canOpen={canOpenReference(template.bibleText)}
            className="devotion-bible-text"
            onOpen={onOpenReference}
            text={template.bibleText}
          />
        )}
        {total > 0 && (
          <div
            aria-label={`${answered} of ${total} questions answered`}
            aria-valuemax={total}
            aria-valuemin={0}
            aria-valuenow={answered}
            className="devotion-answered-track"
            role="progressbar"
          >
            <motion.span
              animate={{ scaleX: total ? answered / total : 0 }}
              initial={false}
              transition={REVEAL_SPRING}
            />
          </div>
        )}
      </header>

      {sections.map((section) => (
        <section className="devotion-source-section" key={section.id}>
          {section.title && <h2>{section.title}</h2>}
          {section.blocks.map(blockForDevotionDisplay).map((block) => {
            if (block.kind === "reference") {
              return (
                <ReferenceLink
                  canOpen={canOpenReference(block.text)}
                  className="devotion-source-reference"
                  key={block.id}
                  onOpen={onOpenReference}
                  text={block.text}
                />
              );
            }
            if (block.kind === "quote") return <blockquote className="devotion-source-quote" key={block.id}>{block.text}</blockquote>;
            if (block.kind === "text") return <p className="devotion-source-text" key={block.id}>{block.text}</p>;
            const answer = entry.answers[block.id] || "";
            const done = Boolean(answer.trim());
            return (
              <article className={`devotion-question${done ? " answered" : ""}`} key={block.id}>
                <div className="devotion-question-head">
                  <span aria-hidden="true" className="devotion-question-number">
                    <AnimatePresence initial={false} mode="wait">
                      {done ? (
                        <motion.span
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.6 }}
                          initial={{ opacity: 0, scale: 0.6 }}
                          key="done"
                          transition={REVEAL_SPRING}
                        >
                          <CheckIcon />
                        </motion.span>
                      ) : (
                        <motion.span
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.6 }}
                          initial={{ opacity: 0, scale: 0.6 }}
                          key="number"
                          transition={REVEAL_SPRING}
                        >
                          {numbers.get(block.id)}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                  <p>{block.text}</p>
                </div>
                <AnswerEditor
                  ariaLabel={`Response to question ${numbers.get(block.id)}: ${block.text}`}
                  mode={mode}
                  onChange={(value) => onAnswerChange(block.id, value)}
                  placeholder="Write your reflection — Markdown and nested lists are supported"
                  value={answer}
                />
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: "write" | "preview";
  onModeChange: (mode: "write" | "preview") => void;
}): ReactNode {
  return (
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
  );
}

/** Which day, and whether you are writing on it — one row, because they are
 * one decision. The picker unrolls beneath rather than replacing anything. */
function DevotionDayBar({
  calendarOpen,
  date,
  hasDevotion,
  hasEntry,
  mode,
  month,
  monthDirection,
  onModeChange,
  onPickDate,
  onStepMonth,
  onToggleCalendar,
}: {
  calendarOpen: boolean;
  date: string;
  hasDevotion: boolean;
  hasEntry: (dateKey: string) => boolean;
  mode: "write" | "preview";
  month: string;
  monthDirection: 1 | -1;
  onModeChange: (mode: "write" | "preview") => void;
  onPickDate: (dateKey: string) => void;
  onStepMonth: (delta: 1 | -1) => void;
  onToggleCalendar: () => void;
}): ReactNode {
  return (
    <>
      <div className="devotion-day-bar">
        <button
          aria-expanded={calendarOpen}
          className={`devotion-date-button${calendarOpen ? " open" : ""}`}
          onClick={onToggleCalendar}
          type="button"
        >
          <span>{hasDevotion ? formatCompactDateLabel(date) : formatDateLabel(date)}</span>
          <ChevronIcon open={calendarOpen} />
        </button>
        {hasDevotion && <ModeToggle mode={mode} onModeChange={onModeChange} />}
      </div>

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
    </>
  );
}

/** A failed import is a place to try again from, not just something to
 * acknowledge, so the retry sits beside the dismissal. */
function ImportErrorNotice({
  message,
  onDismiss,
  onRetry,
}: {
  message: string;
  onDismiss: () => void;
  onRetry: () => void;
}): ReactNode {
  return (
    <div className="devotion-import-error" role="alert">
      <p>{message}</p>
      <div className="devotion-import-error-actions">
        <button onClick={onRetry} type="button">Try another photo</button>
        <button className="devotion-secondary-button" onClick={onDismiss} type="button">Dismiss</button>
      </div>
    </div>
  );
}

/** The two engines differ in a way the reader has a real stake in, so the
 * trade is stated rather than left to the button names. */
function ImportEmptyState({
  onChoosePhoto,
}: {
  onChoosePhoto: (method: DevotionImportMethod) => void;
}): ReactNode {
  return (
    <div className="devotion-empty-state">
      <p className="notes-eyebrow">Today&apos;s page</p>
      <p>Photograph the church handout and it becomes this day&apos;s questions, ready to answer here.</p>
      <button className="devotion-primary-button" onClick={() => onChoosePhoto("cloud-vision")} type="button">
        Import with vision
      </button>
      <button className="devotion-empty-secondary" onClick={() => onChoosePhoto("local-ocr")} type="button">
        Read it on this device
      </button>
      <small>Vision sends a resized copy to OpenRouter and lays the page out more accurately. Reading on this device is slower and never sends the photo anywhere.</small>
    </div>
  );
}

/** Days recorded before imported pages existed, still on the original four
 * prompts. */
function PromptJournal({
  entry,
  mode,
  onAnswerChange,
}: {
  entry: DevotionEntry;
  mode: "write" | "preview";
  onAnswerChange: (promptId: string, value: string) => void;
}): ReactNode {
  return (
    <>
      {entry.ref && <p className="annotation-language">Reading · {entry.ref}</p>}
      {DEVOTION_PROMPTS.map((prompt) => (
        <section className="devotion-block" key={prompt.id}>
          <p className="notes-eyebrow">{prompt.label}</p>
          <p className="devotion-hint">{prompt.hint}</p>
          <AnswerEditor
            ariaLabel={prompt.label}
            mode={mode}
            onChange={(value) => onAnswerChange(prompt.id, value)}
            placeholder="Markdown welcome — **bold**, *italics*, - list, > quote"
            value={entry.answers[prompt.id] || ""}
          />
        </section>
      ))}
    </>
  );
}

/**
 * Status plus the page's own actions. Everything past viewing the original and
 * re-checking the layout lives one level deeper in a sheet, so a destructive
 * "Clear this day" is never sitting at the same weight as the rest — and the
 * sheet grows out of the bar it belongs to rather than arriving from nowhere.
 */
function DevotionFooter({
  hasEntry,
  imported,
  moreOpen,
  onChoosePhoto,
  onClear,
  onEditImported,
  onToggleMore,
  onToggleSource,
  sourceAvailable,
  sourceOpen,
  status,
}: {
  hasEntry: boolean;
  imported: boolean;
  moreOpen: boolean;
  onChoosePhoto: (method: DevotionImportMethod) => void;
  onClear: () => void;
  onEditImported: () => void;
  onToggleMore: () => void;
  onToggleSource: () => void;
  sourceAvailable: boolean;
  sourceOpen: boolean;
  status: string;
}): ReactNode {
  return (
    <div className="devotion-panel-footer">
      <AnimatePresence initial={false}>
        {moreOpen && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="devotion-more-sheet"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={REVEAL_SPRING}
          >
            <button onClick={() => onChoosePhoto("cloud-vision")} type="button">
              {hasEntry ? "Replace with a vision import" : "Import with vision"}
            </button>
            <button onClick={() => onChoosePhoto("local-ocr")} type="button">
              {hasEntry ? "Replace by reading on this device" : "Read a photo on this device"}
            </button>
            {hasEntry && (
              <button className="devotion-more-destructive" onClick={onClear} type="button">
                Clear this day
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="notes-footer">
        <span>{status}</span>
        {imported && sourceAvailable && (
          <button aria-pressed={sourceOpen} onClick={onToggleSource} type="button">Original</button>
        )}
        {imported && <button onClick={onEditImported} type="button">Edit layout</button>}
        <button
          aria-expanded={moreOpen}
          aria-label="More devotion actions"
          className="devotion-more-button"
          onClick={onToggleMore}
          type="button"
        >
          <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 16 16" width="14">
            <circle cx="3.2" cy="8" r="1.35" /><circle cx="8" cy="8" r="1.35" /><circle cx="12.8" cy="8" r="1.35" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** While an import is on screen the footer carries no actions — the review's
 * own bar owns the decision — so it says where the photo went instead. */
function importFooterStatus(method: DevotionImportMethod | undefined): string {
  return method === "cloud-vision" ? "Resized photo sent to vision import" : "Photo stays in this browser";
}

/**
 * The day itself, in whichever of its three shapes applies: nothing imported
 * yet, a pre-import journal on the original fixed prompts, or a photographed
 * page. A failed import is shown above whichever of those is underneath rather
 * than replacing it, so a bad photo never costs the reader the day's work.
 */
function DevotionDayContent({
  canOpenReference,
  entry,
  error,
  mode,
  onAnswerChange,
  onChoosePhoto,
  onDismissError,
  onHideSource,
  onOpenReference,
  saveState,
  source,
}: {
  canOpenReference: (reference: string) => boolean;
  entry: DevotionEntry | undefined;
  error: string | null;
  mode: "write" | "preview";
  onAnswerChange: (promptId: string, value: string) => void;
  onChoosePhoto: (method: DevotionImportMethod) => void;
  onDismissError: () => void;
  onHideSource: () => void;
  onOpenReference: (reference: string) => void;
  saveState: string;
  source: DevotionSourceView | null;
}): ReactNode {
  const imported = entry?.template?.kind === "photo-ocr";
  return (
    <>
      {error && (
        <ImportErrorNotice
          message={error}
          onDismiss={onDismissError}
          onRetry={() => onChoosePhoto("cloud-vision")}
        />
      )}
      {!entry && <ImportEmptyState onChoosePhoto={onChoosePhoto} />}
      {entry && !imported && (
        <PromptJournal entry={entry} mode={mode} onAnswerChange={onAnswerChange} />
      )}
      {entry && imported && (
        <>
          <AnimatePresence initial={false}>
            {source && (
              <motion.div
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                transition={REVEAL_SPRING}
              >
                <SourcePageCard
                  caption="The page this was read from"
                  expanded
                  onToggle={onHideSource}
                  source={source}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <ImportedDevotion
            canOpenReference={canOpenReference}
            entry={entry}
            mode={mode}
            onAnswerChange={onAnswerChange}
            onOpenReference={onOpenReference}
          />
        </>
      )}
      {entry && <p aria-live="polite" className="save-state">{saveState}</p>}
    </>
  );
}

/**
 * The kept page for a day, fetched only once the reader asks to see it.
 *
 * The loader mints the object URL and ownership passes here, which is the
 * whole reason this is a hook: the URL has to outlive the render that produced
 * it and still be findable at cleanup, so it lives in a ref rather than in the
 * state that renders it. Changing day revokes and forgets, so a panel left
 * open across a month of devotions never holds more than one bitmap.
 */
function useStoredSourcePage(
  date: string,
  sourceAvailable: boolean,
  onLoadSource: (dateKey: string) => Promise<DevotionSourceView | null>,
): [DevotionSourceView | null, boolean, (open: boolean | ((open: boolean) => boolean)) => void] {
  const urlRef = useRef<string | null>(null);
  const [page, setPage] = useState<DevotionSourceView | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setPage(null);
    setOpen(false);
    return () => {
      if (!urlRef.current) return;
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [date]);

  useEffect(() => {
    if (!open || page || !sourceAvailable) return;
    let live = true;
    void onLoadSource(date).then((loaded) => {
      if (!loaded) return;
      if (!live) {
        URL.revokeObjectURL(loaded.url);
        return;
      }
      urlRef.current = loaded.url;
      setPage(loaded);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [date, onLoadSource, open, page, sourceAvailable]);

  return [page, open, setOpen];
}

export function DevotionPanel({
  calendarOpen,
  canOpenReference,
  date,
  entry,
  hasEntry,
  importUi,
  mode,
  month,
  monthDirection,
  onAnswerChange,
  onCancelImport,
  onClear,
  onConfirmReplace,
  onEditImported,
  onLoadSource,
  onModeChange,
  onOpenReference,
  onPhotoSelected,
  onPickDate,
  onRemoveBlock,
  onRestoreBlock,
  onSaveImport,
  onStepMonth,
  onToggleCalendar,
  onUpdateImportDraft,
  saveState,
  sourceAvailable,
}: DevotionPanelProps): ReactNode {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoImportMethodRef = useRef<DevotionImportMethod>("cloud-vision");
  const [moreOpen, setMoreOpen] = useState(false);
  const [pageSource, pageSourceOpen, setPageSourceOpen] = useStoredSourcePage(date, sourceAvailable, onLoadSource);
  const importing = importUi.phase === "recognizing";
  const reviewing = importUi.phase === "review" && Boolean(importUi.draft);
  const imported = entry?.template?.kind === "photo-ocr";
  /* An import owns the whole panel while it runs: the day picker and the
     page's own actions would both be second, contradicting ways to answer the
     question already on screen. */
  const busy = importing || reviewing;

  /* The overflow sheet is a transient choice about the day on screen, so it
     does not survive moving to another one. */
  useEffect(() => setMoreOpen(false), [date]);

  const selectPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const photo = event.target.files?.[0];
    event.target.value = "";
    if (photo) onPhotoSelected(photo, photoImportMethodRef.current);
  };
  const choosePhoto = (method: DevotionImportMethod) => {
    setMoreOpen(false);
    photoImportMethodRef.current = method;
    photoInputRef.current?.click();
  };

  return (
    <div className="devotion-panel-view">
      {reviewing && <p className="utility-panel-context">Check the import</p>}
      <div className={`notes-content${busy ? " devotion-focused" : ""}`}>
        {!busy && (
          <DevotionDayBar
            calendarOpen={calendarOpen}
            date={date}
            hasDevotion={Boolean(entry)}
            hasEntry={hasEntry}
            mode={mode}
            month={month}
            monthDirection={monthDirection}
            onModeChange={onModeChange}
            onPickDate={onPickDate}
            onStepMonth={onStepMonth}
            onToggleCalendar={onToggleCalendar}
          />
        )}

        <input
          accept="image/jpeg,image/png,image/webp"
          aria-hidden="true"
          className="devotion-photo-input"
          onChange={selectPhoto}
          ref={photoInputRef}
          tabIndex={-1}
          type="file"
        />

        {importing ? (
          <ImportProgress
            method={importUi.method}
            onCancel={onCancelImport}
            progress={importUi.progress}
            source={importUi.source}
            status={importUi.status}
          />
        ) : reviewing ? (
          <ImportReview
            canOpenReference={canOpenReference}
            draft={importUi.draft!}
            method={importUi.method}
            onCancel={onCancelImport}
            onChange={onUpdateImportDraft}
            onConfirmReplace={onConfirmReplace}
            onRemoveBlock={onRemoveBlock}
            onRestoreBlock={onRestoreBlock}
            onSave={onSaveImport}
            removed={importUi.removedBlocks}
            replacePending={importUi.replacePending}
            source={importUi.source}
          />
        ) : (
          <DevotionDayContent
            canOpenReference={canOpenReference}
            entry={entry}
            error={importUi.phase === "error" ? importUi.error : null}
            mode={mode}
            onAnswerChange={onAnswerChange}
            onChoosePhoto={choosePhoto}
            onDismissError={onCancelImport}
            onHideSource={() => setPageSourceOpen(false)}
            onOpenReference={onOpenReference}
            saveState={saveState}
            source={sourceAvailable && pageSourceOpen ? pageSource : null}
          />
        )}
      </div>

      {busy ? (
        <div className="devotion-panel-footer">
          <div className="notes-footer"><span>{importFooterStatus(importUi.method)}</span></div>
        </div>
      ) : (
        <DevotionFooter
          hasEntry={Boolean(entry)}
          imported={imported}
          moreOpen={moreOpen}
          onChoosePhoto={choosePhoto}
          onClear={() => { setMoreOpen(false); onClear(); }}
          onEditImported={onEditImported}
          onToggleMore={() => setMoreOpen((open) => !open)}
          onToggleSource={() => setPageSourceOpen((open) => !open)}
          sourceAvailable={sourceAvailable}
          sourceOpen={pageSourceOpen}
          status="Saved in this browser"
        />
      )}
    </div>
  );
}
