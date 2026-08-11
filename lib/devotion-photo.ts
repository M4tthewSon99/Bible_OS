/** Shared photo downscaling for devotion import.
 *
 * Two callers want the same operation at different budgets: the vision request
 * needs a large edge so printed sub-references survive the model's tokenizer,
 * and the kept source page needs a small one so a month of imports does not
 * fill the browser's storage. Both go through here so a photo is decoded once
 * per purpose and the white matte behind a transparent PNG is applied the same
 * way for each. */

export interface ResizedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

async function decode(photo: Blob): Promise<HTMLImageElement> {
  const source = URL.createObjectURL(photo);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("This photo could not be read."));
      element.src = source;
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** Scales the longest edge down to `edge`. A photo already at or under the
 * budget is still re-encoded, because the caller's quality ceiling is the
 * point — a 400 KB 900px JPEG is not cheaper for having small dimensions. */
export async function resizedPhoto(photo: Blob, edge: number, quality: number): Promise<ResizedPhoto> {
  const image = await decode(photo);
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(1, edge / longestEdge);
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("This photo could not be prepared for import.");
  return { blob, width, height };
}
