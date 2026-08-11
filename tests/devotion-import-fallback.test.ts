import { describe, expect, it, vi } from "vitest";
import { importWithLocalOcrFallback } from "../lib/devotion-import-fallback";
import type { DevotionImportDraft } from "../lib/types";

const draft: DevotionImportDraft = {
  date: "2026-07-14",
  template: { kind: "photo-ocr", sourceLanguage: "en", bibleText: null, sections: [] },
  answers: {},
};

describe("vision import fallback", () => {
  it("uses private OCR when cloud vision rejects the page", async () => {
    const fallback = vi.fn();
    const result = await importWithLocalOcrFallback(
      async () => { throw new Error("Vision layout incomplete"); },
      async () => draft,
      () => false,
      fallback,
    );
    expect(result).toEqual({ draft, method: "local-ocr" });
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("does not start private OCR after the reader cancels the cloud request", async () => {
    const localOcr = vi.fn(async () => draft);
    await expect(importWithLocalOcrFallback(
      async () => { throw new Error("Request aborted"); },
      localOcr,
      () => true,
      vi.fn(),
    )).rejects.toThrow("Request aborted");
    expect(localOcr).not.toHaveBeenCalled();
  });
});
