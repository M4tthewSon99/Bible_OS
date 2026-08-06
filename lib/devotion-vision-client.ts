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
  const source = URL.createObjectURL(photo);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("This photo could not be prepared for vision import."));
      element.src = source;
    });
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
    if (longestEdge === TARGET_EDGE) return photo;

    const scale = TARGET_EDGE / longestEdge;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the photo.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("This photo could not be prepared for vision import.");
    return new File([blob], renamedPhoto(photo), { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(source);
  }
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
