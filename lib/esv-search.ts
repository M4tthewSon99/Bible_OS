import MiniSearch, { type Options, type SearchResult as MiniSearchResult } from "minisearch";
import { stemmer } from "stemmer";
import { BY_ID, ORDER } from "./bible-books";
import type { SearchResult } from "./types";

export const ESV_SEARCH_SCHEMA = 1;
export const ESV_SOURCE_COMMIT = "fd66568dd9d790ecd73af79acdfdede3b61f21cc";
export const ESV_SOURCE_SHA256 = "1432db73f69e2541801dbfc1036fc1e9cb7dbd0ad17e11c2eb06875551fe7ce0";
export const ESV_SOURCE_URL = `https://cdn.jsdelivr.net/gh/lguenth/mdbible@${ESV_SOURCE_COMMIT}/json/ESV.json`;
export const ESV_SEARCH_CACHE_KEY = `esv-search:${ESV_SEARCH_SCHEMA}:${ESV_SOURCE_COMMIT}:${ESV_SOURCE_SHA256}`;

type EsvToken = [string, ...string[]];
type EsvChapter = EsvToken[][];

export interface EsvCorpus {
  version?: string;
  versionName?: string;
  books: Record<string, EsvChapter[]>;
}

export interface EsvSearchDocument {
  id: string;
  bookId: string;
  chapter: number;
  verse: number;
  order: number;
  ref: string;
  text: string;
  previousText: string;
  nextText: string;
  context: string;
}

export interface EsvSearchOutput {
  results: SearchResult[];
  elapsedMs: number;
}

const STORED_FIELDS: (keyof EsvSearchDocument)[] = [
  "bookId",
  "chapter",
  "verse",
  "order",
  "ref",
  "text",
  "previousText",
  "nextText",
  "context",
];

const TRAILING_OPEN = /[([{“‘]$/;
const LEADING_CLOSED = /^[,.;:!?%\])}’]/;

export function joinEsvTokens(tokens: EsvToken[]): string {
  let output = "";
  for (const token of tokens) {
    const piece = token[0]?.trim();
    if (!piece) continue;
    const needsSpace = Boolean(output)
      && !TRAILING_OPEN.test(output)
      && !LEADING_CLOSED.test(piece)
      && !output.endsWith("-")
      && !piece.startsWith("-");
    output += `${needsSpace ? " " : ""}${piece}`;
  }
  return output.replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim();
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

function stemTerm(term: string): string {
  return stemmer(term);
}

export function corpusToSearchDocuments(
  corpus: EsvCorpus,
  bookIds: readonly string[] = ORDER,
): EsvSearchDocument[] {
  const books = Object.values(corpus.books || {});
  if (books.length !== bookIds.length) {
    throw new Error(`Expected ${bookIds.length} ESV books, received ${books.length}.`);
  }

  const documents: EsvSearchDocument[] = [];
  let order = 0;
  books.forEach((chapters, bookIndex) => {
    const bookId = bookIds[bookIndex];
    if (!BY_ID[bookId]) throw new Error(`Unknown Bible book id: ${bookId}`);
    chapters.forEach((chapterVerses, chapterIndex) => {
      const texts = chapterVerses.map(joinEsvTokens);
      texts.forEach((text, verseIndex) => {
        const previousText = verseIndex > 0 ? texts[verseIndex - 1] : "";
        const nextText = verseIndex + 1 < texts.length ? texts[verseIndex + 1] : "";
        const chapter = chapterIndex + 1;
        const verse = verseIndex + 1;
        documents.push({
          id: `${bookId}/${chapter}/${verse}`,
          bookId,
          chapter,
          verse,
          order: order++,
          ref: `${BY_ID[bookId].name} ${chapter}:${verse}`,
          text,
          previousText,
          nextText,
          context: [previousText, text, nextText].filter(Boolean).join(" "),
        });
      });
    });
  });
  return documents;
}

export function esvSearchOptions(): Options<EsvSearchDocument> {
  return {
    fields: ["text", "context"],
    idField: "id",
    storeFields: STORED_FIELDS,
    tokenize: tokens,
    processTerm: stemTerm,
    searchOptions: {
      boost: { text: 4, context: 0.3 },
      combineWith: "AND",
    },
  };
}

export function createEsvSearchIndex(documents: EsvSearchDocument[]): MiniSearch<EsvSearchDocument> {
  const index = new MiniSearch<EsvSearchDocument>(esvSearchOptions());
  index.addAll(documents);
  return index;
}

interface Candidate extends EsvSearchDocument {
  score: number;
  terms: string[];
  match: Record<string, string[]>;
}

function asCandidate(result: MiniSearchResult): Candidate {
  return result as unknown as Candidate;
}

function quotedQuery(raw: string): { phrase: string; quoted: boolean } {
  const trimmed = raw.trim();
  const quoted = trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("“") && trimmed.endsWith("”")));
  return {
    phrase: normalizeSearchText(quoted ? trimmed.slice(1, -1) : trimmed),
    quoted,
  };
}

function phraseRange(candidate: Candidate, phrase: string): { start: number; end: number } | null {
  if (!phrase) return null;
  const parts = [candidate.previousText, candidate.text, candidate.nextText];
  const normalized = parts.map(normalizeSearchText);
  if (` ${normalized[1]} `.includes(` ${phrase} `)) {
    return { start: candidate.verse, end: candidate.verse };
  }
  const segments: { offset: number; start: number; end: number }[] = [];
  let joined = "";
  normalized.forEach((part, index) => {
    if (!part) return;
    if (joined) joined += " ";
    const start = joined.length;
    joined += part;
    segments.push({ offset: index - 1, start, end: joined.length });
  });
  const padded = ` ${joined} `;
  const phraseStart = padded.indexOf(` ${phrase} `);
  if (phraseStart < 0) return null;
  const unpaddedStart = phraseStart;
  const unpaddedEnd = unpaddedStart + phrase.length;
  const startsIn = segments.find((segment) => unpaddedStart >= segment.start && unpaddedStart < segment.end)?.offset;
  const endsIn = [...segments].reverse().find((segment) => unpaddedEnd > segment.start && unpaddedEnd <= segment.end)?.offset;
  if (startsIn === undefined || endsIn === undefined) return null;
  return {
    start: Math.max(1, candidate.verse + startsIn),
    end: candidate.verse + endsIn,
  };
}

function minimumOrderedSpan(text: string, queryTerms: string[]): number | null {
  const haystack = tokens(text).map(stemTerm);
  const needles = queryTerms.map(stemTerm);
  let best = Number.POSITIVE_INFINITY;
  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack[start] !== needles[0]) continue;
    let cursor = start + 1;
    let needle = 1;
    while (cursor < haystack.length && needle < needles.length) {
      if (haystack[cursor] === needles[needle]) needle += 1;
      cursor += 1;
    }
    if (needle === needles.length) best = Math.min(best, cursor - start);
  }
  return Number.isFinite(best) ? best : null;
}

function snippet(value: string, maximum = 190): string {
  return value.length > maximum ? `${value.slice(0, maximum).trim()}…` : value;
}

export function searchEsvIndex(
  index: MiniSearch<EsvSearchDocument>,
  rawQuery: string,
  limit = 20,
): EsvSearchOutput {
  const startedAt = performance.now();
  const { phrase, quoted } = quotedQuery(rawQuery);
  const queryTerms = tokens(phrase);
  if (!queryTerms.length) return { results: [], elapsedMs: performance.now() - startedAt };

  const strict = index.search(phrase, {
    boost: { text: 4, context: 0.3 },
    combineWith: "AND",
    fields: quoted ? ["text", "context"] : ["text"],
    fuzzy: false,
    prefix: false,
  }).slice(0, 240);
  const relaxed = strict.length >= Math.max(40, limit * 2) || quoted
    ? []
    : index.search(phrase, {
      boost: { text: 4, context: 0.3 },
      combineWith: "OR",
      fields: ["text"],
      fuzzy: (term) => term.length >= 5 ? 1 : false,
      maxFuzzy: 1,
      prefix: (_term, position, termsList) => position === termsList.length - 1,
      weights: { fuzzy: 0.35, prefix: 0.65 },
    }).slice(0, 240);

  const strictIds = new Set(strict.map((result) => String(result.id)));
  const candidates = new Map<string, Candidate>();
  [...strict, ...relaxed].forEach((result) => {
    const candidate = asCandidate(result);
    const existing = candidates.get(String(result.id));
    if (!existing || candidate.score > existing.score) candidates.set(String(result.id), candidate);
  });

  const ranked = [...candidates.values()].flatMap((candidate) => {
    const normalizedText = normalizeSearchText(candidate.text);
    const ownTerms = new Set(tokens(normalizedText).map(stemTerm));
    const exactTerms = new Set(tokens(normalizedText));
    const hasEveryStem = queryTerms.every((term) => ownTerms.has(stemTerm(term)));
    const hasEveryExact = queryTerms.every((term) => exactTerms.has(term));
    const range = phraseRange(candidate, phrase);
    const exactPhrase = Boolean(range);
    if (quoted && !exactPhrase) return [];
    if (!exactPhrase && !hasEveryStem && strictIds.has(candidate.id)) return [];

    const finalStem = stemTerm(queryTerms.at(-1) || "");
    const prefix = !hasEveryStem
      && finalStem.length >= 3
      && [...ownTerms].some((term) => term.startsWith(finalStem));
    const matchKind: NonNullable<SearchResult["matchKind"]> = exactPhrase
      ? "exact-phrase"
      : hasEveryExact || hasEveryStem
        ? "all-terms"
        : prefix
          ? "prefix"
          : "fuzzy";
    const tier = matchKind === "exact-phrase" ? 4
      : matchKind === "all-terms" ? 3
        : matchKind === "prefix" ? 2 : 1;
    const span = minimumOrderedSpan(candidate.text, queryTerms);
    const proximity = span ? 1 / Math.max(1, span - queryTerms.length + 1) : 0;
    const verse = range?.start || candidate.verse;
    const verseEnd = range?.end || candidate.verse;
    return [{ candidate, tier, proximity, matchKind, verse, verseEnd }];
  });

  ranked.sort((left, right) => right.tier - left.tier
    || right.proximity - left.proximity
    || right.candidate.score - left.candidate.score
    || left.candidate.order - right.candidate.order);

  const deduped = new Map<string, SearchResult>();
  ranked.forEach(({ candidate, matchKind, verse, verseEnd }) => {
    const key = `${candidate.bookId}/${candidate.chapter}/${verse}/${verseEnd}`;
    if (deduped.has(key)) return;
    const ref = `${BY_ID[candidate.bookId].name} ${candidate.chapter}:${verse}${verseEnd !== verse ? `–${verseEnd}` : ""}`;
    deduped.set(key, {
      bookId: candidate.bookId,
      chapter: candidate.chapter,
      verse,
      verseEnd,
      ref,
      en: snippet(candidate.text),
      matchKind,
      score: candidate.score,
      rank: deduped.size + 1,
    });
  });

  return {
    results: [...deduped.values()].slice(0, limit),
    elapsedMs: performance.now() - startedAt,
  };
}
