import { describe, expect, it } from "vitest";
import { blockForDevotionDisplay, sectionsForDevotionDisplay } from "../lib/devotion-layout";

describe("imported devotion display normalization", () => {
  it("turns a legacy text question into an answerable prompt without changing its ID", () => {
    expect(blockForDevotionDisplay({
      kind: "text",
      id: "section-1-text-2",
      text: "How can I apply lessons from this passage to my life?",
    })).toEqual({
      kind: "prompt",
      id: "section-1-text-2",
      text: "How can I apply lessons from this passage to my life?",
    });
  });

  it("recognizes old text-shaped references and quotes before question detection", () => {
    expect(blockForDevotionDisplay({ kind: "text", id: "r", text: "2 Samuel 14:13-14" }).kind).toBe("reference");
    expect(blockForDevotionDisplay({ kind: "text", id: "q", text: "“A quoted study note?”" }).kind).toBe("quote");
  });

  it("repairs the old reference-at-the-end ordering without changing stored blocks", () => {
    const sections = sectionsForDevotionDisplay([
      {
        id: "one",
        title: "Option 1: Questions for Personal Study & Reflection",
        blocks: [
          { kind: "text", id: "q1", text: "What does this passage teach me?" },
          { kind: "text", id: "q2", text: "How can I apply this passage?" },
          { kind: "text", id: "q3", text: "What did David do?" },
          { kind: "text", id: "q4", text: "What can I learn from this?" },
          { kind: "quote", id: "quote", text: "A quoted study note." },
          { kind: "text", id: "q5", text: "Reflect on justice?" },
          { kind: "text", id: "q6", text: "How does this apply?" },
          { kind: "text", id: "q7", text: "What is human nature here?" },
          { kind: "text", id: "q8", text: "To what extent have I seen this?" },
        ],
      },
      {
        id: "two",
        title: "Option 2: Questions to Help You Go Deeper",
        blocks: [
          { kind: "reference", id: "r1", text: "2 Samuel 14:1-21" },
          { kind: "reference", id: "r2", text: "2 Samuel 14:13-14" },
          { kind: "reference", id: "r3", text: "2 Samuel 14:32-33" },
          { kind: "text", id: "citation", text: "Source citation" },
        ],
      },
    ]);
    expect(sections[0].blocks.map((block) => block.id)).toEqual(["q1", "q2"]);
    expect(sections[1].blocks.map((block) => block.id)).toEqual([
      "r1", "q3", "q4", "r2", "quote", "q5", "q6", "r3", "q7", "q8", "citation",
    ]);
  });
});
