import type {
  DevotionImportDraft,
  DevotionTemplateBlock,
  DevotionTemplateSection,
  ImportedDevotionTemplate,
} from "@/lib/types";

export const DEVOTION_VISION_MODEL = "qwen/qwen3-vl-30b-a3b-instruct";

export const devotionVisionSchema = {
  name: "devotion_import",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["date", "bibleText", "sections"],
    properties: {
      date: {
        type: "string",
        description: "Printed date as YYYY-MM-DD, or an empty string if it cannot be read confidently.",
      },
      bibleText: {
        type: "string",
        description: "The text after the printed Bible Text label, or an empty string if absent.",
      },
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "blocks"],
          properties: {
            title: { type: "string" },
            blocks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "text", "initialAnswer"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["reference", "quote", "prompt", "text"],
                  },
                  text: { type: "string" },
                  initialAnswer: {
                    type: "string",
                    description: "Markdown nested content belonging to a prompt; otherwise an empty string.",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const DEVOTION_VISION_PROMPT = `Read this single English church devotion page and return only the requested JSON.

Transcribe the printed content faithfully; do not answer questions, summarize, or invent text. Merge ordinary line wraps within a paragraph. Keep the printed date as YYYY-MM-DD when confident; otherwise use an empty string. Populate bibleText only when an explicit “Bible Text:” label appears; never use a later scripture sub-reference as Bible Text.

Each “Option” heading is a section. Keep the distinct Option 1 and Option 2 headings in their original order; never repeat one heading in place of the other. The two short generic questions before Option 2 belong to Option 1. Classify scripture ranges as reference. Preserve a multi-line quoted or italic study note as exactly one quote block, even after removing its outer quotation marks. Put every reader-facing question or discussion prompt in a prompt block. If a primary question has indented bullets or sub-bullets beneath it, preserve those bullets as valid nested Markdown in that prompt’s initialAnswer; do not create extra prompts for them. Never copy a prompt’s own text into initialAnswer. Use text only for read-only study copy that is neither a reference, quote, nor question. Use an empty initialAnswer for every non-prompt block.`;

interface VisionBlock {
  kind: "reference" | "quote" | "prompt" | "text";
  text: string;
  initialAnswer: string;
}

interface VisionSection {
  title: string;
  blocks: VisionBlock[];
}

interface VisionResponse {
  date: string;
  bibleText: string;
  sections: VisionSection[];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function dateValue(value: unknown): string {
  const valueAsString = stringValue(value);
  if (!valueAsString || !/^\d{4}-\d{2}-\d{2}$/.test(valueAsString)) return "";
  const [year, month, day] = valueAsString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? valueAsString
    : "";
}

function blockValue(value: unknown): VisionBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  let kind = stringValue(block.kind);
  const text = stringValue(block.text);
  let initialAnswer = typeof block.initialAnswer === "string" ? block.initialAnswer.trim() : "";
  if (!text || !kind || !["reference", "quote", "prompt", "text"].includes(kind)) return null;
  if (kind === "text" && /^[“"]/.test(text) && /[”"]$/.test(text)) kind = "quote";
  if (kind === "prompt" && initialAnswer.replace(/\s+/g, " ") === text.replace(/\s+/g, " ")) {
    initialAnswer = "";
  }
  return { kind: kind as VisionBlock["kind"], text, initialAnswer };
}

function sectionValue(value: unknown): VisionSection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const section = value as Record<string, unknown>;
  const blocks = Array.isArray(section.blocks)
    ? section.blocks.map(blockValue).filter((block): block is VisionBlock => Boolean(block))
    : [];
  const title = stringValue(section.title) || "Devotion";
  return { title, blocks };
}

function responseValue(value: unknown): VisionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The vision response was not a devotion layout.");
  }
  const response = value as Record<string, unknown>;
  const sections = Array.isArray(response.sections)
    ? response.sections.map(sectionValue).filter((section): section is VisionSection => Boolean(section))
    : [];
  const bibleText = stringValue(response.bibleText) || "";
  const titles = sections.map((section) => section.title.toLocaleLowerCase());
  if (new Set(titles).size !== titles.length) {
    throw new Error("The vision response repeated a devotion section.");
  }
  const optionTitles = titles.filter((title) => /^option\s+\d+\s*:/i.test(title));
  if (optionTitles.length && (!optionTitles.some((title) => /^option\s+1\s*:/i.test(title))
    || !optionTitles.some((title) => /^option\s+2\s*:/i.test(title)))) {
    throw new Error("The vision response omitted a devotion option.");
  }
  const mergedQuestions = sections
    .flatMap((section) => section.blocks)
    .some((block) => block.kind === "prompt" && (block.text.match(/\?/g)?.length || 0) > 1);
  if (mergedQuestions) throw new Error("The vision response merged multiple devotion questions.");
  const substantiveBlock = sections
    .flatMap((section) => section.blocks)
    .some((block) => block.kind === "reference" || block.kind === "quote" || block.kind === "prompt");
  if (!bibleText && !substantiveBlock) {
    throw new Error("The vision response did not contain a readable devotion page.");
  }
  return { date: dateValue(response.date), bibleText, sections };
}

/** Converts model-owned JSON to the app's durable shape. IDs are assigned in
 * one place so responses, editors, and persisted answers stay aligned. */
export function devotionDraftFromVision(value: unknown): DevotionImportDraft {
  const response = responseValue(value);
  const answers: Record<string, string> = {};
  const sections: DevotionTemplateSection[] = response.sections.map((section, sectionIndex) => {
    const id = `section-${sectionIndex + 1}`;
    const blocks: DevotionTemplateBlock[] = section.blocks.map((block, blockIndex) => {
      const blockId = `${id}-${block.kind}-${blockIndex + 1}`;
      if (block.kind === "prompt" && block.initialAnswer) answers[blockId] = block.initialAnswer;
      return { kind: block.kind, id: blockId, text: block.text };
    });
    return { id, title: section.title, blocks };
  });
  const template: ImportedDevotionTemplate = {
    kind: "photo-ocr",
    sourceLanguage: "en",
    bibleText: response.bibleText || null,
    sections,
  };
  return { date: response.date, template, answers };
}

export function devotionDraftFromVisionJson(source: string): DevotionImportDraft {
  try {
    return devotionDraftFromVision(JSON.parse(source));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("The vision response could not be read. Please try again.");
    throw error;
  }
}
