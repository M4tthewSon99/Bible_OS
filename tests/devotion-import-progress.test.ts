import { describe, expect, it } from "vitest";
import {
  importHeadline,
  importProgressValue,
  importStageLabel,
} from "../lib/devotion-import-progress";

describe("import progress copy", () => {
  it("keeps Tesseract's internal lifecycle off the screen", () => {
    expect(importStageLabel("local-ocr", "loading tesseract core")).toBe("Warming up the reader");
    expect(importStageLabel("local-ocr", "initializing api")).toBe("Warming up the reader");
    expect(importStageLabel("local-ocr", "recognizing text")).toBe("Reading the printed text");
  });

  it("names the vision stages a reader can act on", () => {
    expect(importStageLabel("cloud-vision", "Optimizing photo")).toBe("Preparing the photo");
    expect(importStageLabel("cloud-vision", "Sending to vision import")).toBe("Reading the page");
    expect(importStageLabel("cloud-vision", "Devotion layout ready")).toBe("Laying out the questions");
  });

  it("says so when vision hands the page to the local engine", () => {
    expect(importStageLabel("cloud-vision", "Vision unavailable — using private OCR"))
      .toBe("Vision is unavailable — reading on this device instead");
  });

  /* The method stays "cloud-vision" after a fallback while the statuses
     underneath switch to Tesseract's, so both tables have to be consulted. */
  it("still reads OCR stages once a vision import has fallen back", () => {
    expect(importStageLabel("cloud-vision", "recognizing text")).toBe("Reading the printed text");
  });

  it("falls back to a plain phrase rather than leaking an unknown status", () => {
    expect(importStageLabel("local-ocr", "some-new-engine-state")).toBe("Working through the page");
    expect(importStageLabel("local-ocr", "   ")).toBe("Getting started");
  });

  it("distinguishes the two headlines by where the photo goes", () => {
    expect(importHeadline("cloud-vision")).toBe("Reading your page");
    expect(importHeadline("local-ocr")).toBe("Reading your page privately");
  });
});

describe("import progress value", () => {
  it("reads as started rather than sitting visibly empty", () => {
    expect(importProgressValue(0)).toBe(0.04);
    expect(importProgressValue(Number.NaN)).toBe(0.04);
  });

  it("clamps to the track", () => {
    expect(importProgressValue(0.5)).toBe(0.5);
    expect(importProgressValue(4)).toBe(1);
  });
});
