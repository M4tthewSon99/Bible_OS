import { BY_ID, MD_DIRS, ORDER, STRUCTURE } from "./bible-books";
import type {
  ChapterBlock,
  ChapterData,
  ChapterSide,
  EnglishSourceId,
  ScriptureReference,
  SearchResult,
  VerseText,
} from "./types";

declare global {
  interface Window {
    OpenCC?: {
      Converter: (options: { from: string; to: string }) => (value: string) => string;
    };
  }
}

const API = "https://bible-api.com/data";
const SEARCH_API = "https://dailybible.ca/api/search";
const ESV_KEY_LS = "bibleos.esvKey.v1";
const SRC_LS = "bibleos.englishSource.v1";
const ESV_VERSE_BUDGET = 450;
const MD_BASE = "https://cdn.jsdelivr.net/gh/lguenth/mdbible@main/by_chapter";

let converter: ((value: string) => string) | null = null;
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
let esvKey: string | null = null;
let selectedSource: EnglishSourceId | null = null;
let esvStatus = { ok: true, message: "" };

const chapterCache = new Map<string, ChapterData>();
const inflight = new Map<string, Promise<ChapterData>>();

export async function ready(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (!converter && window.OpenCC) {
        try {
          converter = window.OpenCC.Converter({ from: "tw", to: "cn" });
        } catch {
          converter = null;
        }
      }

      if (converter) resolve(true);
      else if (Date.now() - startedAt >= 6_000) resolve(false);
      else window.setTimeout(tick, 60);
    };

    tick();
  });
}

function t2s(value: string): string {
  if (!value) return "";
  try {
    return converter ? converter(value) : value;
  } catch {
    return value;
  }
}

function queued<T>(request: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = Math.max(0, 140 - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return request();
  };

  const promise = queue.then(run, run);
  queue = promise.catch(() => undefined);
  return promise;
}

async function getJSON<T>(url: string): Promise<T> {
  return queued(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 14_000);

      try {
        const response = await fetch(url, { signal: controller.signal });
        window.clearTimeout(timer);
        if (response.status === 429) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_400));
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as T;
      } catch (error) {
        window.clearTimeout(timer);
        if (attempt === 1) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
    }

    throw new Error("Request failed");
  });
}

export function getEsvKey(): string {
  if (esvKey === null) {
    try {
      esvKey = localStorage.getItem(ESV_KEY_LS) || "";
    } catch {
      esvKey = "";
    }
  }
  return esvKey;
}

export function setEsvKey(key: string): void {
  esvKey = key.trim();
  try {
    if (esvKey) localStorage.setItem(ESV_KEY_LS, esvKey);
    else localStorage.removeItem(ESV_KEY_LS);
  } catch {
    // Storage may be unavailable in privacy modes; the in-memory key still works.
  }
  esvStatus = { ok: true, message: "" };
  chapterCache.clear();
}

export function englishSourceId(): EnglishSourceId {
  if (selectedSource === null) {
    try {
      const stored = localStorage.getItem(SRC_LS);
      selectedSource = stored === "mdesv" || stored === "esvapi" ? stored : "web";
    } catch {
      selectedSource = "web";
    }
  }
  return selectedSource;
}

export function setEnglishSource(id: EnglishSourceId): void {
  selectedSource = id;
  try {
    localStorage.setItem(SRC_LS, id);
  } catch {
    // Keep the selection in memory when local storage is unavailable.
  }
  esvStatus = { ok: true, message: "" };
  chapterCache.clear();
}

export function englishSource(): "WEB" | "ESV" {
  return englishSourceId() === "web" ? "WEB" : "ESV";
}

export function esvState(): { ok: boolean; message: string } {
  return esvStatus;
}

export function esvVerseBudget(): number {
  return englishSourceId() === "esvapi" ? ESV_VERSE_BUDGET : 1_400;
}

async function fetchMarkdownEsvChapter(bookId: string, chapter: number): Promise<VerseText[] | null> {
  const directory = MD_DIRS[ORDER.indexOf(bookId)];
  if (!directory) return null;
  const url = `${MD_BASE}/${directory}/Chapter_${String(chapter).padStart(2, "0")}.md`;

  try {
    const text = await queued(async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 14_000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        window.clearTimeout(timer);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      } catch (error) {
        window.clearTimeout(timer);
        throw error;
      }
    });

    const verses: VerseText[] = [];
    text.split("\n").forEach((line) => {
      const match = line.match(/^\s*(\d+)\.\s+(.*\S)\s*$/);
      if (match) verses.push({ verse: Number(match[1]), text: match[2] });
    });
    if (!verses.length) throw new Error("Empty chapter");
    esvStatus = { ok: true, message: "" };
    return verses;
  } catch {
    esvStatus = {
      ok: false,
      message: "That chapter isn’t available from the hosted ESV copy. Showing the public-domain English text.",
    };
    return null;
  }
}

function parseEsvPassage(text: string): VerseText[] {
  const parts = text.split(/\[(\d+)\]/);
  const output: VerseText[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    output.push({ verse: Number(parts[index]), text: parts[index + 1] });
  }
  return output;
}

async function fetchEsvApiChapter(bookId: string, chapter: number): Promise<VerseText[] | null> {
  const key = getEsvKey();
  if (!key) return null;
  const reference = `${BY_ID[bookId].name} ${chapter}`;
  const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(reference)}`
    + "&include-passage-references=false&include-verse-numbers=true&include-first-verse-numbers=true"
    + "&include-footnotes=false&include-footnote-body=false&include-headings=false"
    + "&include-short-copyright=false&include-copyright=false&include-selahs=false"
    + "&indent-paragraphs=0&indent-poetry=false&indent-declares=0&indent-psalm-doxology=0&line-length=0";

  try {
    const data = await queued(async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 14_000);
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Token ${key}` },
          signal: controller.signal,
        });
        window.clearTimeout(timer);
        if (response.status === 401 || response.status === 403) throw new Error("key");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as { passages?: string[] };
      } catch (error) {
        window.clearTimeout(timer);
        throw error;
      }
    });

    const verses = parseEsvPassage((data.passages || []).join("\n"));
    if (!verses.length) throw new Error("empty");
    esvStatus = { ok: true, message: "" };
    return verses;
  } catch (error) {
    esvStatus = {
      ok: false,
      message: error instanceof Error && error.message === "key"
        ? "That ESV key was refused. Showing the public-domain English text."
        : "The ESV service didn’t answer. Showing the public-domain English text.",
    };
    return null;
  }
}

function fetchEnglishOverride(bookId: string, chapter: number): Promise<VerseText[] | null> {
  const source = englishSourceId();
  if (source === "esvapi") return fetchEsvApiChapter(bookId, chapter);
  if (source === "mdesv") return fetchMarkdownEsvChapter(bookId, chapter);
  return Promise.resolve(null);
}

function trimEsvCache(): void {
  if (englishSourceId() !== "esvapi") return;
  let total = 0;
  const chapters = [...chapterCache.values()].filter((chapter) => chapter.source === "ESV").reverse();
  for (const chapter of chapters) {
    total += chapter.numbers.length;
    if (total > ESV_VERSE_BUDGET) chapterCache.delete(chapter.key);
  }
}

const cleanEnglish = (text: string) => text.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
const cleanChinese = (text: string) => t2s(text.replace(/〔[^〕]*〕/g, "").replace(/\s+/g, "")).trim();

function chapterKey(bookId: string, chapter: number): string {
  return `${bookId}/${chapter}`;
}

export function bookSlug(bookId: string): string {
  return BY_ID[bookId]?.name.replace(/\s+/g, "-") || bookId;
}

export function slugToBook(slug: string): string | null {
  const normalized = slug.replace(/[-_+]/g, " ").toLowerCase().trim();
  for (const id of ORDER) {
    const book = BY_ID[id];
    if (book.name.toLowerCase() === normalized) return id;
    if (book.aliases.includes(normalized.replace(/[\s.]/g, ""))) return id;
  }
  return null;
}

export function nextChapter(bookId: string, chapter: number): { bookId: string; chapter: number } | null {
  const book = BY_ID[bookId];
  if (!book) return null;
  if (chapter < book.chapters) return { bookId, chapter: chapter + 1 };
  const index = ORDER.indexOf(bookId);
  return index >= 0 && index < ORDER.length - 1 ? { bookId: ORDER[index + 1], chapter: 1 } : null;
}

export function prevChapter(bookId: string, chapter: number): { bookId: string; chapter: number } | null {
  if (chapter > 1) return { bookId, chapter: chapter - 1 };
  const index = ORDER.indexOf(bookId);
  return index > 0 ? { bookId: ORDER[index - 1], chapter: BY_ID[ORDER[index - 1]].chapters } : null;
}

function structureFor(bookId: string, chapter: number, numbers: number[]) {
  const preset = STRUCTURE[chapterKey(bookId, chapter)];
  if (preset) {
    const maximum = numbers.at(-1) || 1;
    return preset
      .map((section) => ({
        en: section.en,
        zh: section.zh,
        paras: section.paras
          .filter(([start]) => start <= maximum)
          .map(([start, end]) => [start, Math.min(end, maximum)] as [number, number]),
      }))
      .filter((section) => section.paras.length);
  }

  const paragraphs: [number, number][] = [];
  for (let index = 0; index < numbers.length; index += 5) {
    const chunk = numbers.slice(index, index + 5);
    paragraphs.push([chunk[0], chunk.at(-1) as number]);
  }
  return [{ en: null, zh: null, paras: paragraphs }];
}

function buildSide(numbers: number[], texts: Record<number, string>, joiner: string): ChapterSide {
  let text = "";
  const verses: ChapterSide["verses"] = [];
  numbers.forEach((number, index) => {
    const body = texts[number] || "";
    if (index > 0 && text) text += joiner;
    const off = text.length;
    text += body;
    verses.push({ n: number, off, end: text.length });
  });
  return { text, verses };
}

interface BibleApiResponse {
  verses?: VerseText[];
}

export async function getChapter(bookId: string, chapter: number): Promise<ChapterData> {
  const key = chapterKey(bookId, chapter);
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const [esv, web, chinese] = await Promise.all([
      fetchEnglishOverride(bookId, chapter),
      getJSON<BibleApiResponse>(`${API}/web/${bookId}/${chapter}`).catch(() => ({ verses: [] })),
      getJSON<BibleApiResponse>(`${API}/cuv/${bookId}/${chapter}`).catch(() => ({ verses: [] })),
    ]);

    const source = esv ? "ESV" : "WEB";
    const english = esv ? { verses: esv } : web;
    const enText: Record<number, string> = {};
    const zhText: Record<number, string> = {};
    const seen = new Set<number>();

    (english.verses || []).forEach((verse) => {
      enText[verse.verse] = cleanEnglish(verse.text);
      seen.add(verse.verse);
    });
    (chinese.verses || []).forEach((verse) => {
      zhText[verse.verse] = cleanChinese(verse.text);
      seen.add(verse.verse);
    });

    const numbers = [...seen].sort((a, b) => a - b);
    if (!numbers.length) throw new Error("Empty chapter");

    const book = BY_ID[bookId];
    const blocks: ChapterBlock[] = [{
      type: "title",
      id: `${key}/title`,
      text: `${book.name} ${chapter}`,
      zhText: `${book.zh} 第${chapter}章`,
    }];

    let paragraphIndex = 0;
    structureFor(bookId, chapter, numbers).forEach((section, sectionIndex) => {
      if (section.en) {
        blocks.push({
          type: "heading",
          id: `${key}/h${sectionIndex}`,
          en: section.en,
          zh: section.zh,
        });
      }

      section.paras.forEach(([verseStart, verseEnd]) => {
        const paragraphNumbers = numbers.filter((number) => number >= verseStart && number <= verseEnd);
        if (!paragraphNumbers.length) return;
        blocks.push({
          type: "para",
          id: `${key}/p${paragraphIndex++}`,
          key,
          bookId,
          chapter,
          vs: paragraphNumbers[0],
          ve: paragraphNumbers.at(-1) as number,
          en: buildSide(paragraphNumbers, enText, " "),
          zh: buildSide(paragraphNumbers, zhText, ""),
        });
      });
    });

    const data: ChapterData = {
      key,
      bookId,
      chapter,
      source,
      label: `${book.name} ${chapter}`,
      zhLabel: `${book.zh} ${chapter}`,
      numbers,
      enText,
      zhText,
      blocks,
    };

    chapterCache.set(key, data);
    trimEsvCache();
    inflight.delete(key);
    return data;
  })();

  inflight.set(key, job);
  job.catch(() => inflight.delete(key));
  return job;
}

const CJK = /[㐀-鿿]/;

export function parseReference(raw: string): ScriptureReference | null {
  const query = raw.trim();
  if (!query) return null;

  if (CJK.test(query)) {
    const normalized = t2s(query).replace(/[：﹕]/g, ":").replace(/\s+/g, "");
    const match = normalized.match(/^([㐀-鿿]+?)(\d+)(?:[章篇]?[:第]?(\d+))?[章篇节節]*$/)
      || normalized.match(/^([㐀-鿿]+?)(\d+)(?:[章篇]?[:第]?(\d+))?/);
    if (!match) return null;

    const name = match[1];
    let bookId: string | null = null;
    for (const id of ORDER) {
      const chineseName = BY_ID[id].zh;
      if (chineseName === name) {
        bookId = id;
        break;
      }
      if (!bookId && (name.startsWith(chineseName) || chineseName.startsWith(name)) && name.length >= 2) {
        bookId = id;
      }
    }
    if (!bookId) return null;
    return clampReference(bookId, Number(match[2]), match[3] ? Number(match[3]) : null);
  }

  const match = query.match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z\s.]*?)\s*\.?\s+?(\d+)(?:\s*[:.v]\s*(\d+))?\s*$/i)
    || query.match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z\s.]*?)(\d+)(?:\s*[:.]\s*(\d+))?\s*$/i);
  if (!match) return null;
  const bookId = slugToBook(match[1]);
  if (!bookId) return null;
  return clampReference(bookId, Number(match[2]), match[3] ? Number(match[3]) : null);
}

function clampReference(bookId: string, chapter: number, verse: number | null): ScriptureReference {
  const book = BY_ID[bookId];
  return {
    bookId,
    chapter: Math.min(Math.max(1, chapter || 1), book.chapters),
    verse: verse || null,
  };
}

export function refLabel(bookId: string, chapter: number, vs?: number | null, ve?: number | null): string {
  const verses = !vs ? "" : ve && ve !== vs ? `:${vs}–${ve}` : `:${vs}`;
  return `${BY_ID[bookId].name} ${chapter}${verses}`;
}

export function refLabelZh(bookId: string, chapter: number, vs?: number | null, ve?: number | null): string {
  const verses = !vs ? "" : ve && ve !== vs ? `:${vs}–${ve}` : `:${vs}`;
  return `${BY_ID[bookId].zh} ${chapter}${verses}`;
}

function snippet(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum).trim()}…` : value;
}

function searchCache(query: string): SearchResult[] {
  const isChinese = CJK.test(query);
  const needle = isChinese ? t2s(query).replace(/\s+/g, "") : query.toLowerCase();
  const output: SearchResult[] = [];

  for (const chapter of chapterCache.values()) {
    for (const verse of chapter.numbers) {
      const en = chapter.enText[verse] || "";
      const zh = chapter.zhText[verse] || "";
      const haystack = isChinese ? zh : en.toLowerCase();
      if (haystack && haystack.includes(needle)) {
        output.push({
          bookId: chapter.bookId,
          chapter: chapter.chapter,
          verse,
          ref: refLabel(chapter.bookId, chapter.chapter, verse),
          refZh: refLabelZh(chapter.bookId, chapter.chapter, verse),
          en: snippet(en, 150),
          zh: snippet(zh, 60),
        });
      }
      if (output.length >= 40) break;
    }
  }

  return output;
}

interface RemoteSearchResult {
  book_id: string;
  chapter: number;
  verse: number;
  text: string;
}

export async function keywordSearch(
  query: string,
  limit = 8,
): Promise<{ results: SearchResult[]; scope: "none" | "cache" | "empty" | "canon" }> {
  const normalized = query.trim();
  if (normalized.length < 2) return { results: [], scope: "none" };

  const local = searchCache(normalized);
  if (CJK.test(normalized)) return { results: local.slice(0, limit), scope: "cache" };

  let remote: RemoteSearchResult[] = [];
  try {
    const data = await getJSON<{ results?: RemoteSearchResult[] }>(
      `${SEARCH_API}?q=${encodeURIComponent(normalized)}&translation=asv&limit=24`,
    );
    remote = (data.results || []).filter((result) => BY_ID[result.book_id]).slice(0, limit);
  } catch {
    // The locally loaded reading window remains searchable when the remote index is unavailable.
  }

  if (!remote.length) {
    return { results: local.slice(0, limit), scope: local.length ? "cache" : "empty" };
  }

  const keys = [...new Set(remote.map((result) => chapterKey(result.book_id, result.chapter)))].slice(0, 6);
  await Promise.all(keys.map((key) => {
    const [bookId, chapter] = key.split("/");
    return getChapter(bookId, Number(chapter)).catch(() => null);
  }));

  return {
    scope: "canon",
    results: remote.map((result) => {
      const chapter = chapterCache.get(chapterKey(result.book_id, result.chapter));
      return {
        bookId: result.book_id,
        chapter: result.chapter,
        verse: result.verse,
        ref: refLabel(result.book_id, result.chapter, result.verse),
        refZh: refLabelZh(result.book_id, result.chapter, result.verse),
        en: snippet(chapter ? chapter.enText[result.verse] : cleanEnglish(result.text), 150),
        zh: snippet(chapter ? chapter.zhText[result.verse] : "", 60),
      };
    }),
  };
}
