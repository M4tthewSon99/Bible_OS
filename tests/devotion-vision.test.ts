import { describe, expect, it } from "vitest";
import { devotionDraftFromVision, devotionDraftFromVisionJson } from "../lib/devotion-vision";

describe("vision devotion formatting", () => {
  it("turns a model layout into the same durable draft used by private OCR", () => {
    const draft = devotionDraftFromVision({
      date: "2026-07-17",
      bibleText: "2 Samuel 6 (ESV)",
      sections: [{
        title: "Questions to Help You Go Deeper",
        blocks: [
          { kind: "reference", text: "2 Samuel 6:6-8", initialAnswer: "" },
          { kind: "quote", text: "The unfortunate Uzzah illustrates the holiness of God.", initialAnswer: "" },
          {
            kind: "prompt",
            text: "What was offensive about Uzzah's act?",
            initialAnswer: "- It treated holy things casually.\n  - It assumed good motives remove reverence.",
          },
        ],
      }],
    });

    expect(draft).toMatchObject({
      date: "2026-07-17",
      template: {
        kind: "photo-ocr",
        bibleText: "2 Samuel 6 (ESV)",
        sections: [{
          id: "section-1",
          blocks: [
            { id: "section-1-reference-1", kind: "reference" },
            { id: "section-1-quote-2", kind: "quote" },
            { id: "section-1-prompt-3", kind: "prompt" },
          ],
        }],
      },
    });
    expect(draft.answers["section-1-prompt-3"]).toContain("  - It assumed good motives");
  });

  it("keeps an unreadable date empty so the review UI requires a choice", () => {
    const draft = devotionDraftFromVision({
      date: "Friday, July 17, 2026",
      bibleText: "",
      sections: [{ title: "Devotion", blocks: [{ kind: "prompt", text: "A readable question?", initialAnswer: "" }] }],
    });
    expect(draft.date).toBe("");
  });

  it("repairs harmless model formatting but rejects structurally unsafe output", () => {
    const draft = devotionDraftFromVision({
      date: "",
      bibleText: "2 Samuel 6",
      sections: [{
        title: "Option 1: Reflection",
        blocks: [
          { kind: "text", text: "“A quoted study note.”", initialAnswer: "" },
          { kind: "prompt", text: "What should I learn?", initialAnswer: "What should I learn?" },
        ],
      }, {
        title: "Option 2: Go deeper",
        blocks: [{ kind: "prompt", text: "How can I respond?", initialAnswer: "" }],
      }],
    });
    expect(draft.template.sections[0].blocks[0]).toMatchObject({ kind: "quote" });
    expect(draft.answers).toEqual({});
    expect(() => devotionDraftFromVision({
      date: "",
      bibleText: "2 Samuel 6",
      sections: [{ title: "Option 2: Go deeper", blocks: [{ kind: "prompt", text: "One? Two?", initialAnswer: "" }] }],
    })).toThrow("omitted");
  });

  it("rejects malformed model JSON without accepting partial text", () => {
    expect(() => devotionDraftFromVisionJson("not JSON")).toThrow("vision response could not be read");
    expect(() => devotionDraftFromVision({ date: "", bibleText: "", sections: [] })).toThrow("did not contain");
    expect(() => devotionDraftFromVision({
      date: "",
      bibleText: "",
      sections: [{ title: "Option 1", blocks: [{ kind: "text", text: "Option 1", initialAnswer: "" }] }],
    })).toThrow("did not contain");
    expect(() => devotionDraftFromVision({
      date: "",
      bibleText: "2 Samuel 6",
      sections: [
        { title: "Option 2", blocks: [] },
        { title: "Option 2", blocks: [] },
      ],
    })).toThrow("repeated");
  });
});
