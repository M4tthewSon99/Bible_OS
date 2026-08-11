import type {
  DevotionImportDraft,
  DevotionPromptBlock,
  DevotionTemplateBlock,
  DevotionTemplateSection,
  ImportedDevotionTemplate,
} from "@/lib/types";

export const DEVOTION_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const WEEKDAYS = "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday";
const MONTH_PATTERN = MONTHS.map((month) => month[0].toUpperCase() + month.slice(1)).join("|");
const DATE_PATTERN = new RegExp(
  `(?:${WEEKDAYS})\\s*,?\\s+(${MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})`,
  "i",
);
/* Tesseract commonly sees a filled bullet as © or « in a small phone photo.
   Treat those as a bullet only at the beginning of a line; the original
   quotation marks are handled first below. */
const BULLET_PATTERN = /^(\s*)[•·●◦▪‣*+\-©«]\s*(.+)$/;
const OPTION_PATTERN = /^Option\s+\d+\s*:/i;
const QUOTE_START_PATTERN = /^[“"]/;
const QUOTE_END_PATTERN = /[”"]\s*$/;
const SCRIPTURE_PATTERN = /^(?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+){0,2}\s+\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?$/;
const QUESTION_START_PATTERN = /^(?:what|how|why|who|which|when|where|contrast|reflect|consider|describe|discuss|identify|explain|do|read|think|in what ways)/i;

export interface OcrProgress {
  progress: number;
  status: string;
}

interface OcrLine {
  indent: number;
  text: string;
}

function idFor(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function dateKey(year: number, month: number, day: number): string | null {
  const value = new Date(year, month, day);
  if (value.getFullYear() !== year || value.getMonth() !== month || value.getDate() !== day) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function findDevotionDate(source: string): string | null {
  const match = source.replace(/\s+/g, " ").match(DATE_PATTERN);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  return month === -1 ? null : dateKey(Number(match[3]), month, Number(match[2]));
}

export function photoValidationError(file: File): string | null {
  if (!(DEVOTION_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a JPEG, PNG, or WebP photo.";
  }
  if (file.size > MAX_PHOTO_BYTES) return "Choose a photo smaller than 15 MB.";
  return null;
}

function isScriptureReference(text: string): boolean {
  return SCRIPTURE_PATTERN.test(text.replace(/\s+/g, " ").trim());
}

function isQuoteStart(text: string): boolean {
  return QUOTE_START_PATTERN.test(text.trim());
}

function isQuoteEnd(text: string): boolean {
  return QUOTE_END_PATTERN.test(text.trim());
}

function looksLikeQuestion(text: string): boolean {
  return text.includes("?") || QUESTION_START_PATTERN.test(text.trim());
}

function lineIndent(raw: string, measured: number): number {
  const literal = raw.match(/^\s*/)?.[0].replace(/\t/g, "  ").length || 0;
  return Math.max(literal, measured * 2);
}

/**
 * Converts OCR text into the durable, editable structure used by the panel.
 * It is intentionally conservative: text it cannot classify remains a
 * read-only text block for the reader to correct in review rather than vanish.
 */
export function parseDevotionPhotoText(source: string): DevotionImportDraft {
  const lines: OcrLine[] = source
    .replace(/\r/g, "")
    .split("\n")
    .filter((text) => text.trim())
    .map((text) => ({ text: text.trim(), indent: lineIndent(text, 0) }));
  return parseDevotionOcrLines(lines);
}

function parseDevotionOcrLines(lines: OcrLine[]): DevotionImportDraft {
  const template: ImportedDevotionTemplate = {
    kind: "photo-ocr",
    sourceLanguage: "en",
    bibleText: null,
    sections: [],
  };
  const answers: Record<string, string> = {};
  let section: DevotionTemplateSection | null = null;
  let activePrompt: DevotionPromptBlock | null = null;
  let primaryIndent = 0;
  let quoteLines: string[] = [];
  let quoteSection: DevotionTemplateSection | null = null;

  const ensureSection = (): DevotionTemplateSection => {
    if (section) return section;
    section = { id: idFor("section", template.sections.length), title: "Devotion", blocks: [] };
    template.sections.push(section);
    return section;
  };
  const addBlock = (block: DevotionTemplateBlock): void => {
    ensureSection().blocks.push(block);
  };
  const addPrompt = (text: string, indent: number): void => {
    const target = ensureSection();
    const prompt: DevotionPromptBlock = {
      kind: "prompt",
      id: idFor(`${target.id}-prompt`, target.blocks.filter((block) => block.kind === "prompt").length),
      text,
    };
    target.blocks.push(prompt);
    activePrompt = prompt;
    primaryIndent = indent;
  };
  const flushQuote = (): void => {
    if (!quoteLines.length) return;
    const target = quoteSection || ensureSection();
    target.blocks.push({
      kind: "quote",
      id: idFor(`${target.id}-quote`, target.blocks.length),
      text: quoteLines.join(" ").replace(/\s+/g, " ").trim(),
    });
    quoteLines = [];
    quoteSection = null;
  };
  const appendNestedAnswer = (text: string, indent: number): void => {
    if (!activePrompt) return;
    const depth = Math.max(0, Math.round((indent - primaryIndent) / 2) - 1);
    const line = `${"  ".repeat(depth)}- ${text}`;
    answers[activePrompt.id] = answers[activePrompt.id]
      ? `${answers[activePrompt.id]}\n${line}`
      : line;
  };

  lines.forEach(({ indent, text: original }) => {
    const text = original.replace(/\s+/g, " ").trim();
    if (!text) return;
    if (quoteLines.length) {
      quoteLines.push(text);
      if (isQuoteEnd(text)) flushQuote();
      return;
    }
    if (DATE_PATTERN.test(text)) {
      activePrompt = null;
      return;
    }
    const bibleMatch = text.match(/^Bible\s*Text\s*:\s*(.+)$/i);
    if (bibleMatch) {
      template.bibleText = bibleMatch[1].trim();
      activePrompt = null;
      return;
    }
    if (OPTION_PATTERN.test(text)) {
      section = { id: idFor("section", template.sections.length), title: text, blocks: [] };
      template.sections.push(section);
      activePrompt = null;
      return;
    }
    if (isQuoteStart(text)) {
      activePrompt = null;
      quoteSection = ensureSection();
      quoteLines = [text];
      if (isQuoteEnd(text) && text.length > 1) flushQuote();
      return;
    }
    if (isScriptureReference(text)) {
      activePrompt = null;
      addBlock({ kind: "reference", id: idFor(`${ensureSection().id}-ref`, ensureSection().blocks.length), text });
      return;
    }
    const bullet = original.match(BULLET_PATTERN);
    if (bullet) {
      const bulletIndent = indent;
      const content = bullet[2].replace(/\s+/g, " ").trim();
      if (activePrompt && bulletIndent > primaryIndent) {
        appendNestedAnswer(content, bulletIndent);
        return;
      }
      addPrompt(content, bulletIndent);
      return;
    }
    /* OCR can lose a bullet entirely. A new question-opening line at the
       primary indentation is a fresh prompt, not a wrapped continuation. */
    if (activePrompt && QUESTION_START_PATTERN.test(text) && indent <= primaryIndent) {
      addPrompt(text, indent);
      return;
    }
    if (activePrompt) {
      activePrompt.text = `${activePrompt.text} ${text}`.replace(/\s+/g, " ").trim();
      return;
    }
    if (looksLikeQuestion(text)) {
      addPrompt(text, indent);
      return;
    }
    addBlock({ kind: "text", id: idFor(`${ensureSection().id}-text`, ensureSection().blocks.length), text });
  });
  flushQuote();

  return {
    date: findDevotionDate(lines.map((line) => line.text).join(" ")) || "",
    template,
    answers,
  };
}

function linesFromBlocks(blocks: Tesseract.Block[] | null): OcrLine[] {
  if (!blocks?.length) return [];
  const allLines = blocks.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
  const left = Math.min(...allLines.map((line) => line.bbox.x0));
  return allLines
    .map((line) => ({
      text: line.text,
      indent: Math.max(0, Math.round((line.bbox.x0 - left) / 12)) * 2,
      left: line.bbox.x0,
      top: line.bbox.y0,
    }))
    .filter((line) => line.text.trim())
    .sort((first, second) => first.top - second.top || first.left - second.left)
    .map(({ indent, text }) => ({ indent, text }));
}

/** Runs only after a reader chooses a photo. The File is passed directly to
 * the Web Worker and is never sent through a Next.js route or persisted. */
export async function recognizeDevotionPhoto(
  photo: File,
  onProgress: (progress: OcrProgress) => void,
): Promise<DevotionImportDraft> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", undefined, {
    logger: ({ progress, status }) => onProgress({ progress, status }),
  });
  try {
    /* Daily handouts are a single text column. This mode keeps the compact
       date ribbon readable rather than interpreting it as a separate image. */
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      user_defined_dpi: "300",
    });
    const result = await worker.recognize(photo, {}, { blocks: true });
    const lines = linesFromBlocks(result.data.blocks);
    const draft = lines.length
      ? parseDevotionOcrLines(lines)
      : parseDevotionPhotoText(result.data.text);
    const hasStructure = draft.template.bibleText || draft.template.sections.some((item) => item.blocks.length > 0);
    if (!hasStructure) throw new Error("The photo did not contain a readable devotion page.");
    return draft;
  } finally {
    await worker.terminate();
  }
}
