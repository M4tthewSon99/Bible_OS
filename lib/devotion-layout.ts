import type { DevotionTemplateBlock, DevotionTemplateSection } from "@/lib/types";

const SCRIPTURE_REFERENCE = /^(?:[1-3]\s+)?[A-Za-z]+(?:\s+[A-Za-z]+){0,2}\s+\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?$/;
const QUESTION_OPENING = /^(?:what|how|why|who|which|when|where|contrast|reflect|consider|describe|discuss|identify|explain|do|read|think|in what ways)\b/i;

/** Older local imports can contain a question as generic source text when a
 * photographed bullet is missed. Present it as a prompt without mutating the
 * saved template, so its stable block ID remains a valid answer key. */
export function blockForDevotionDisplay(block: DevotionTemplateBlock): DevotionTemplateBlock {
  if (block.kind !== "text") return block;
  const text = block.text.trim();
  if (SCRIPTURE_REFERENCE.test(text.replace(/\s+/g, " "))) return { ...block, kind: "reference" };
  if (/^[“"]/.test(text) && /[”"]$/.test(text)) return { ...block, kind: "quote" };
  if (QUESTION_OPENING.test(text) || text.includes("?")) return { ...block, kind: "prompt" };
  return block;
}

function isOption(section: DevotionTemplateSection, number: number): boolean {
  return new RegExp(`^Option\\s+${number}\\s*:`, "i").test(section.title.trim());
}

function isPrompt(block: DevotionTemplateBlock): boolean {
  return blockForDevotionDisplay(block).kind === "prompt";
}

/**
 * Early OCR builds occasionally separated the Option 2 references from their
 * questions. The source pages consistently begin with two Option 1 prompts,
 * then group the remaining prompts beneath Scripture sub-references. Repair
 * that recognisable legacy shape only for display; normal imported templates
 * pass through unchanged.
 */
export function sectionsForDevotionDisplay(
  sections: DevotionTemplateSection[],
): DevotionTemplateSection[] {
  if (sections.length !== 2 || !isOption(sections[0], 1) || !isOption(sections[1], 2)) return sections;
  const [optionOne, optionTwo] = sections;
  const optionOnePromptIndexes = optionOne.blocks
    .map((block, index) => isPrompt(block) ? index : -1)
    .filter((index) => index >= 0);
  const optionTwoPrompts = optionTwo.blocks.filter(isPrompt);
  const references = optionTwo.blocks.filter((block) => blockForDevotionDisplay(block).kind === "reference");
  if (optionOnePromptIndexes.length < 3 || optionTwoPrompts.length || !references.length) return sections;

  const optionOneEnd = optionOnePromptIndexes[1] + 1;
  const optionOneBlocks = optionOne.blocks.slice(0, optionOneEnd);
  const deepBlocks = optionOne.blocks.slice(optionOneEnd);
  const referenceIds = new Set(references.map((block) => block.id));
  const optionTwoTail = optionTwo.blocks.filter((block) => !referenceIds.has(block.id));
  const rebuiltDeepBlocks: DevotionTemplateBlock[] = [];
  const remaining = [...deepBlocks];
  let promptsRemaining = remaining.filter(isPrompt).length;

  references.forEach((reference, index) => {
    rebuiltDeepBlocks.push(reference);
    const referencesRemaining = references.length - index;
    const promptQuota = Math.ceil(promptsRemaining / referencesRemaining);
    let promptsAdded = 0;
    while (remaining.length && promptsAdded < promptQuota) {
      const block = remaining.shift()!;
      rebuiltDeepBlocks.push(block);
      if (isPrompt(block)) {
        promptsAdded += 1;
        promptsRemaining -= 1;
      }
    }
  });
  rebuiltDeepBlocks.push(...remaining, ...optionTwoTail);
  return [
    { ...optionOne, blocks: optionOneBlocks },
    { ...optionTwo, blocks: rebuiltDeepBlocks },
  ];
}
