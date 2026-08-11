import { resizedPhoto } from "@/lib/devotion-photo";
import type { DevotionImportDraft } from "@/lib/types";
import type { OcrProgress } from "@/lib/devotion-import";

const TARGET_EDGE = 2_000;

function renamedPhoto(photo: File): string {
  return photo.name.replace(/\.[^/.]+$/, "") + ".jpg";
}

/** Normalizes the visual-token budget before the file leaves the browser.
 * A 2,000px edge preserves small printed references and gives compact
 * screenshots enough visual tokens to read their fine text. */
export async function prepareVisionPhoto(photo: File): Promise<File> {
  const { blob } = await resizedPhoto(photo, TARGET_EDGE, 0.9);
  return new File([blob], renamedPhoto(photo), { type: "image/jpeg" });
}

export async function recognizeDevotionWithVision(
  photo: File,
  onProgress: (progress: OcrProgress) => void,
  signal: AbortSignal,
): Promise<DevotionImportDraft> {
  onProgress({ progress: 0.08, status: "Optimizing photo" });
  const prepared = await prepareVisionPhoto(photo);
  if (signal.aborted) throw new DOMException("Import canceled", "AbortError");
  onProgress({ progress: 0.24, status: "Sending to vision import" });
  const form = new FormData();
  form.set("photo", prepared);
  const response = await fetch("/api/devotion-import", { method: "POST", body: form, signal });
  const payload = await response.json().catch(() => null) as { draft?: DevotionImportDraft; error?: string } | null;
  if (!response.ok || !payload?.draft) {
    throw new Error(payload?.error || "Vision import is unavailable. You can try private OCR instead.");
  }
  onProgress({ progress: 1, status: "Devotion layout ready" });
  return payload.draft;
}
