import type { DevotionImportMethod } from "@/lib/types";

/** Tesseract reports its own internal lifecycle — "loading tesseract core",
 * "initializing api" — which is engine bookkeeping, not something a reader
 * asked to know. These map the machine's vocabulary onto the three things
 * actually happening to their photo. Anything unrecognised falls back to the
 * phase headline rather than leaking a raw status string. */
const OCR_STAGES: [RegExp, string][] = [
  [/loading (tesseract|language)|initiali[sz]ing/i, "Warming up the reader"],
  [/loading image|recogniz/i, "Reading the printed text"],
  [/done|complete/i, "Laying out the questions"],
];

const VISION_STAGES: [RegExp, string][] = [
  [/optimi[sz]ing/i, "Preparing the photo"],
  [/sending|vision import$/i, "Reading the page"],
  [/unavailable/i, "Vision is unavailable — reading on this device instead"],
  [/ready|layout/i, "Laying out the questions"],
];

export function importHeadline(method: DevotionImportMethod | undefined): string {
  return method === "cloud-vision" ? "Reading your page" : "Reading your page privately";
}

/** The one-line detail under the headline.
 *
 * Both tables are consulted, the chosen method's first. A vision import that
 * falls back keeps reporting as "cloud-vision" while the vocabulary underneath
 * it switches to Tesseract's, and a reader mid-import should not be told
 * something vaguer just because the engine changed out from under them. */
export function importStageLabel(
  method: DevotionImportMethod | undefined,
  status: string,
): string {
  const preferred = method === "cloud-vision" ? VISION_STAGES : OCR_STAGES;
  const fallback = method === "cloud-vision" ? OCR_STAGES : VISION_STAGES;
  const matched = [...preferred, ...fallback].find(([pattern]) => pattern.test(status));
  if (matched) return matched[1];
  return status.trim() ? "Working through the page" : "Getting started";
}

/** Both engines report real fractions, so the track is always determinate.
 * It is floored just above zero so the bar reads as *started* the moment the
 * reader hands over a photo rather than sitting visibly empty. */
export function importProgressValue(progress: number): number {
  if (!Number.isFinite(progress)) return 0.04;
  return Math.min(1, Math.max(0.04, progress));
}
