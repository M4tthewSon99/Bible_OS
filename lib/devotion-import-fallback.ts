import type { DevotionImportDraft, DevotionImportMethod } from "@/lib/types";

export interface CompletedDevotionImport {
  draft: DevotionImportDraft;
  method: DevotionImportMethod;
}

/** Cloud responses can fail at the network, provider, JSON, or layout-quality
 * layer. In each case the original File remains available to private OCR. */
export async function importWithLocalOcrFallback(
  importWithVision: () => Promise<DevotionImportDraft>,
  importWithLocalOcr: () => Promise<DevotionImportDraft>,
  isCanceled: () => boolean,
  onFallback: () => void,
): Promise<CompletedDevotionImport> {
  try {
    return { draft: await importWithVision(), method: "cloud-vision" };
  } catch (error) {
    if (isCanceled()) throw error;
    onFallback();
    return { draft: await importWithLocalOcr(), method: "local-ocr" };
  }
}
