"use client";

import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import { useRef } from "react";
import { motion, type Transition } from "motion/react";
import { AnimatePresence, FluidBackdrop, FluidSurface } from "@/components/fluid-surfaces";
import { DevotionCalendar } from "@/components/devotion-calendar";
import { DEVOTION_PROMPTS, formatDateLabel } from "@/lib/devotion";
import { blockForDevotionDisplay, sectionsForDevotionDisplay } from "@/lib/devotion-layout";
import { markdown } from "@/lib/markdown";
import type {
  DevotionEntry,
  DevotionImportDraft,
  DevotionImportMethod,
  DevotionImportUi,
  DevotionTemplateBlock,
} from "@/lib/types";

interface DevotionPanelProps {
  calendarOpen: boolean;
  date: string;
  entry: DevotionEntry | undefined;
  hasEntry: (dateKey: string) => boolean;
  importUi: DevotionImportUi;
  mode: "write" | "preview";
  month: string;
  monthDirection: 1 | -1;
  narrow: boolean;
  onAnswerChange: (promptId: string, value: string) => void;
  onCancelImport: () => void;
  onClear: () => void;
  onClose: () => void;
  onConfirmReplace: () => void;
  onEditImported: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onModeChange: (mode: "write" | "preview") => void;
  onPhotoSelected: (file: File, method: DevotionImportMethod) => void;
  onPickDate: (dateKey: string) => void;
  onSaveImport: () => void;
  onStepMonth: (delta: 1 | -1) => void;
  onToggleCalendar: () => void;
  onUpdateImportDraft: (draft: DevotionImportDraft) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  /* Supplied by the reader so both side panels share one resize handle
     implementation and one stored width. */
  resizer?: ReactNode;
  saveState: string;
  transitionOverride?: Transition;
  width: number;
}

function fullDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return "Date needs review";
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return "Date needs review";
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
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

function draftWithoutBlock(draft: DevotionImportDraft, blockId: string): DevotionImportDraft {
  return {
    ...draft,
    template: {
      ...draft.template,
      sections: draft.template.sections.map((section) => ({
        ...section,
        blocks: section.blocks.filter((block) => block.id !== blockId),
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

function ImportReview({
  draft,
  method,
  replacePending,
  onCancel,
  onChange,
  onConfirmReplace,
  onSave,
}: {
  draft: DevotionImportDraft;
  method: DevotionImportMethod | undefined;
  replacePending: boolean;
  onCancel: () => void;
  onChange: (draft: DevotionImportDraft) => void;
  onConfirmReplace: () => void;
  onSave: () => void;
}): ReactNode {
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

  return (
    <div className="devotion-import-review">
      <p className="notes-eyebrow">Review import</p>
      <p className="devotion-import-copy">
        {method === "cloud-vision"
          ? "Vision import sent a resized copy of this page to OpenRouter for formatting. Correct anything below before saving."
          : "Private OCR ran only in this browser. Correct anything below before saving the page."}
      </p>

      <label className="devotion-review-field">
        <span>Printed date</span>
        <input
          aria-label="Printed devotion date"
          onChange={(event) => onChange({ ...draft, date: event.target.value })}
          type="date"
          value={draft.date}
        />
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
            <div className={`devotion-review-block ${block.kind}`} key={block.id}>
              <div className="devotion-review-block-head">
                <span>{sourceBlockLabel(block)}</span>
                <button
                  aria-label={`Remove ${sourceBlockLabel(block).toLowerCase()}`}
                  onClick={() => onChange(draftWithoutBlock(draft, block.id))}
                  type="button"
                >Remove</button>
              </div>
              <textarea
                aria-label={sourceBlockLabel(block)}
                onChange={(event) => onChange(draftWithBlockText(draft, block.id, event.target.value))}
                value={block.text}
              />
              {block.kind === "prompt" && (
                <textarea
                  aria-label={`Starting answer for ${block.text}`}
                  className="devotion-review-answer"
                  onChange={(event) => changeAnswer(block.id, event.target.value)}
                  placeholder="Optional starting notes — Markdown is supported"
                  value={draft.answers[block.id] || ""}
                />
              )}
            </div>
          ))}
        </section>
      ))}

      <div className="devotion-import-actions">
        {replacePending ? (
          <>
            <p role="status">A devotion already exists for this date. Replacing it removes its prompts and responses.</p>
            <button className="devotion-danger-button" onClick={onConfirmReplace} type="button">Replace devotion</button>
            <button className="devotion-secondary-button" onClick={onCancel} type="button">Keep existing</button>
          </>
        ) : (
          <>
            <button disabled={!draft.date} onClick={onSave} type="button">Save imported devotion</button>
            <button className="devotion-secondary-button" onClick={onCancel} type="button">Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function ImportedDevotion({
  entry,
  mode,
  onAnswerChange,
}: {
  entry: DevotionEntry;
  mode: "write" | "preview";
  onAnswerChange: (promptId: string, value: string) => void;
}): ReactNode {
  const template = entry.template;
  if (!template) return null;
  const sections = sectionsForDevotionDisplay(template.sections);
  return (
    <div className="imported-devotion">
      <p className="devotion-date-ribbon">{fullDateLabel(entry.date)}</p>
      {template.bibleText && <p className="devotion-bible-text"><span>Bible Text:</span> {template.bibleText}</p>}
      {sections.map((section) => (
        <section className="devotion-source-section" key={section.id}>
          {section.title && <h2>{section.title}</h2>}
          {section.blocks.map(blockForDevotionDisplay).map((block) => {
            if (block.kind === "reference") return <p className="devotion-source-reference" key={block.id}>{block.text}</p>;
            if (block.kind === "quote") return <blockquote className="devotion-source-quote" key={block.id}>{block.text}</blockquote>;
            if (block.kind === "text") return <p className="devotion-source-text" key={block.id}>{block.text}</p>;
            const answer = entry.answers[block.id] || "";
            return (
              <article className="devotion-question" key={block.id}>
                <p>{block.text}</p>
                {mode === "write" ? (
                  <textarea
                    aria-label={`Response: ${block.text}`}
                    className="note-editor devotion-editor"
                    onChange={(event) => onAnswerChange(block.id, event.target.value)}
                    placeholder="Write your reflection — Markdown and nested lists are supported"
                    value={answer}
                  />
                ) : (
                  <div
                    className="note-preview devotion-editor"
                    dangerouslySetInnerHTML={{
                      __html: answer.trim()
                        ? markdown(answer)
                        : '<p class="empty-preview">Nothing written yet.</p>',
                    }}
                  />
                )}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export function DevotionPanel({
  calendarOpen,
  date,
  entry,
  hasEntry,
  importUi,
  mode,
  month,
  monthDirection,
  narrow,
  onAnswerChange,
  onCancelImport,
  onClear,
  onClose,
  onConfirmReplace,
  onEditImported,
  onKeyDown,
  onModeChange,
  onPhotoSelected,
  onPickDate,
  onSaveImport,
  onStepMonth,
  onToggleCalendar,
  onUpdateImportDraft,
  panelRef,
  resizer,
  saveState,
  transitionOverride,
  width,
}: DevotionPanelProps): ReactNode {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoImportMethodRef = useRef<DevotionImportMethod>("cloud-vision");
  const answers = entry?.answers || {};
  const importing = importUi.phase === "recognizing";
  const reviewing = importUi.phase === "review" && importUi.draft;
  const imported = entry?.template?.kind === "photo-ocr";
  const selectPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const photo = event.target.files?.[0];
    event.target.value = "";
    if (photo) onPhotoSelected(photo, photoImportMethodRef.current);
  };
  const choosePhoto = (method: DevotionImportMethod) => {
    photoImportMethodRef.current = method;
    photoInputRef.current?.click();
  };

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
        <span>{reviewing ? "Review devotion" : "Devotion"}</span>
        <button aria-label="Close devotion" onClick={onClose} type="button">×</button>
      </div>

      <div className="notes-content">
        {!reviewing && (
          <>
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
          <div aria-live="polite" className="devotion-import-status">
            <span className="devotion-import-spinner" aria-hidden="true" />
            <p>{importUi.method === "cloud-vision" ? "Formatting your photo" : "Reading your photo"}</p>
            <small>{importUi.status || "Preparing import"}{importUi.progress > 0 ? ` · ${Math.round(importUi.progress * 100)}%` : ""}</small>
            <button className="devotion-secondary-button" onClick={onCancelImport} type="button">Cancel</button>
          </div>
        ) : reviewing ? (
          <ImportReview
            draft={importUi.draft!}
            method={importUi.method}
            onCancel={onCancelImport}
            onChange={onUpdateImportDraft}
            onConfirmReplace={onConfirmReplace}
            onSave={onSaveImport}
            replacePending={importUi.replacePending}
          />
        ) : (
          <>
            {importUi.phase === "error" && importUi.error && (
              <div className="devotion-import-error" role="alert">
                <p>{importUi.error}</p>
                <button className="devotion-secondary-button" onClick={onCancelImport} type="button">Dismiss</button>
              </div>
            )}
            {!entry && (
              <div className="devotion-empty-state">
                <p className="notes-eyebrow">Today&apos;s page</p>
                <p>Import the church devotion photo to build this day&apos;s questions here.</p>
                <button onClick={() => choosePhoto("cloud-vision")} type="button">Import with vision</button>
                <button className="devotion-empty-secondary" onClick={() => choosePhoto("local-ocr")} type="button">Use private OCR</button>
                <small>Vision uses OpenRouter · private OCR stays on this device</small>
              </div>
            )}
            {entry && !imported && (
              <>
                {entry.ref && <p className="annotation-language">Reading · {entry.ref}</p>}
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
              </>
            )}
            {imported && entry && (
              <>
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
                <ImportedDevotion entry={entry} mode={mode} onAnswerChange={onAnswerChange} />
              </>
            )}
            {entry && <p aria-live="polite" className="save-state">{saveState}</p>}
          </>
        )}
      </div>

      <div className="notes-footer">
        <span>{reviewing || importing
          ? importUi.method === "cloud-vision" ? "Resized photo sent to vision import" : "Photo stays in this browser"
          : "Saved in this browser"}</span>
        {!reviewing && !importing && (
          <>
            {imported && <button onClick={onEditImported} type="button">Edit layout</button>}
            <button onClick={() => choosePhoto("cloud-vision")} type="button">{entry ? "Import with vision" : "Choose vision photo"}</button>
            <button onClick={() => choosePhoto("local-ocr")} type="button">Private OCR</button>
            <button disabled={!entry} onClick={onClear} type="button">Clear this day</button>
          </>
        )}
      </div>
    </FluidSurface>
  );

  return narrow ? (
    <FluidBackdrop className="notes-backdrop devotion-backdrop" onDismiss={onClose}>
      {panel}
    </FluidBackdrop>
  ) : panel;
}
