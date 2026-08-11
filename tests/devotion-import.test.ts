import { describe, expect, it } from "vitest";
import { findDevotionDate, parseDevotionPhotoText } from "../lib/devotion-import";
import { markdown } from "../lib/markdown";

describe("devotion photo parser", () => {
  it("recognizes the printed date, Bible Text, options, references, and questions", () => {
    const draft = parseDevotionPhotoText(`
Tuesday, July 14, 2026
Bible Text: 2 Samuel 2 (ESV)
Option 1: Questions for Personal Study & Reflection
• What does this passage teach me about God, myself, or human nature?
• How can I apply lessons from this passage to my life?
Option 2: Questions to Help You Go Deeper
2 Samuel 2:1-9
• Contrast David and Abner’s actions after Saul’s death. What does this reveal about David?
2 Samuel 2:12-31
• Reflect on the consequences and lessons from Abner and Joab.
`);

    expect(draft.date).toBe("2026-07-14");
    expect(draft.template.bibleText).toBe("2 Samuel 2 (ESV)");
    expect(draft.template.sections.map((section) => section.title)).toEqual([
      "Option 1: Questions for Personal Study & Reflection",
      "Option 2: Questions to Help You Go Deeper",
    ]);
    expect(draft.template.sections[1].blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "reference", text: "2 Samuel 2:1-9" }),
      expect.objectContaining({ kind: "prompt", text: expect.stringContaining("Contrast David") }),
      expect.objectContaining({ kind: "reference", text: "2 Samuel 2:12-31" }),
    ]));
  });

  it("keeps a multi-line quoted study note separate from its follow-up questions", () => {
    const draft = parseDevotionPhotoText(`
Friday, July 17, 2026
Bible Text: 2 Samuel 6 (ESV)
Option 2: Questions to Help You Go Deeper
2 Samuel 6:6-8
“In a way that seems especially foreign to present-day readers, the unfortunate Uzzah illustrates the holiness of God present
in the ark. To touch the ark is to impinge on God’s holiness, to draw too close and presume too much.”
• What was offensive about Uzzah’s act of taking “hold of the ark of God”?
• How does this incident challenge my understanding of God’s holiness?
`);
    const blocks = draft.template.sections[0].blocks;
    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "quote", text: expect.stringContaining("unfortunate Uzzah") }),
      expect.objectContaining({ kind: "prompt", text: expect.stringContaining("What was offensive") }),
    ]));
  });

  it("turns nested bullet material into an editable Markdown answer beneath one main question", () => {
    const draft = parseDevotionPhotoText(`
Monday, July 20, 2026
Option 2: Questions to Help You Go Deeper
2 Samuel 9:1
• What can I learn from David searching for anyone left of the house of Saul?
  - David actively sought to fulfill a vow made to Jonathan years prior.
    - True love and friendship extend beyond the grave.
`);
    const prompt = draft.template.sections[0].blocks.find((block) => block.kind === "prompt");
    expect(prompt).toBeDefined();
    expect(draft.answers[prompt!.id]).toBe(
      "- David actively sought to fulfill a vow made to Jonathan years prior.\n  - True love and friendship extend beyond the grave.",
    );
  });

  it("accepts common OCR bullet substitutions and unbulleted wrapped questions", () => {
    const draft = parseDevotionPhotoText(`
Tuesday, July 14, 2026
Option 1: Questions for Personal Study & Reflection
© Whatdoes this passage teach me about God, myself, or human nature?
«How can I apply lessons from this passage to my life?
Option 2: Questions to Help You Go Deeper
2 Samuel 2:1-9
Contrast David and Abner’s actions after Saul's death. What is the fundamental difference in their views towards
power? How am I challenged regarding my view towards power?
`);
    const firstSectionPrompts = draft.template.sections[0].blocks.filter((block) => block.kind === "prompt");
    const secondSectionPrompt = draft.template.sections[1].blocks.find((block) => block.kind === "prompt");
    expect(firstSectionPrompts).toHaveLength(2);
    expect(secondSectionPrompt).toMatchObject({ text: expect.stringContaining("power? How am I") });
  });

  it("does not merge adjacent questions when OCR misses their bullets", () => {
    const draft = parseDevotionPhotoText(`
Wednesday, August 5, 2026
Option 1: Questions for Personal Study & Reflection
What does this passage teach me about God, myself, or human nature?
How can I apply lessons from this passage to my life?
`);
    const prompts = draft.template.sections[0].blocks.filter((block) => block.kind === "prompt");
    expect(prompts).toMatchObject([
      { text: "What does this passage teach me about God, myself, or human nature?" },
      { text: "How can I apply lessons from this passage to my life?" },
    ]);
  });

  it("only accepts a real calendar date", () => {
    expect(findDevotionDate("Tuesday, July 14, 2026")).toBe("2026-07-14");
    expect(findDevotionDate("Tuesday, February 30, 2026")).toBeNull();
  });
});

describe("nested Markdown", () => {
  it("renders nested lists without flattening their hierarchy", () => {
    expect(markdown("- Parent\n  - Child\n    - Leaf")).toBe(
      "<ul><li>Parent<ul><li>Child<ul><li>Leaf</li></ul></li></ul></li></ul>",
    );
  });

  it("escapes list content before it is rendered", () => {
    expect(markdown("- <script>alert(1)</script>")).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
