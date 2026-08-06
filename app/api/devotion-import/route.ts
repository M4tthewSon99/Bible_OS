import { DEVOTION_PHOTO_TYPES, photoValidationError } from "@/lib/devotion-import";
import {
  DEVOTION_VISION_MODEL,
  DEVOTION_VISION_PROMPT,
  devotionDraftFromVisionJson,
  devotionVisionSchema,
} from "@/lib/devotion-vision";

export const runtime = "nodejs";

const MAX_IMPORTS_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;
const importAttempts = new Map<string, number[]>();

function response(body: object, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requestIdentifier(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

function requestAllowed(request: Request): boolean {
  const now = Date.now();
  const identifier = requestIdentifier(request);
  const recent = (importAttempts.get(identifier) || []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= MAX_IMPORTS_PER_MINUTE) return false;
  recent.push(now);
  importAttempts.set(identifier, recent);
  return true;
}

function completionText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return response({ error: "Vision import has not been configured on this server." }, 503);
  if (!requestAllowed(request)) return response({ error: "Too many photo imports. Please wait a minute and try again." }, 429);

  let photo: File;
  try {
    const form = await request.formData();
    const value = form.get("photo");
    if (!(value instanceof File)) return response({ error: "Choose one devotion photo to import." }, 400);
    photo = value;
  } catch {
    return response({ error: "That photo could not be received." }, 400);
  }

  const fileError = photoValidationError(photo);
  if (fileError || !(DEVOTION_PHOTO_TYPES as readonly string[]).includes(photo.type)) {
    return response({ error: fileError || "Choose a JPEG, PNG, or WebP photo." }, 400);
  }

  const photoData = Buffer.from(await photo.arrayBuffer()).toString("base64");
  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Bible OS Devotion Import",
    },
    body: JSON.stringify({
      model: DEVOTION_VISION_MODEL,
      temperature: 0,
      max_tokens: 1_800,
      provider: { require_parameters: true },
      response_format: { type: "json_schema", json_schema: devotionVisionSchema },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: DEVOTION_VISION_PROMPT },
          { type: "image_url", image_url: { url: `data:${photo.type};base64,${photoData}` } },
        ],
      }],
    }),
  });

  if (!upstream.ok) {
    return response({ error: "Vision import is temporarily unavailable. Try again or use private OCR." }, 502);
  }

  try {
    const draft = devotionDraftFromVisionJson(completionText(await upstream.json()) || "");
    return response({ draft });
  } catch {
    return response({ error: "Vision import returned an incomplete page. Please try again or use private OCR." }, 502);
  }
}
