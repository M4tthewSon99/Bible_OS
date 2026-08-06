export type Language = "en" | "zh";
export type LanguageMode = "both" | Language;
export type EnglishSourceId = "web" | "mdesv" | "esvapi";

export type Testament = "old" | "new";

export interface Book {
  id: string;
  name: string;
  zh: string;
  chapters: number;
  aliases: string[];
}

export interface VerseText {
  verse: number;
  text: string;
}

export interface VerseRange {
  n: number;
  off: number;
  end: number;
}

export interface ChapterSide {
  text: string;
  verses: VerseRange[];
}

export interface TitleBlock {
  type: "title";
  id: string;
  text: string;
  zhText: string;
}

export interface HeadingBlock {
  type: "heading";
  id: string;
  en: string | null;
  zh: string | null;
}

export interface ParagraphBlock {
  type: "para";
  id: string;
  key: string;
  bookId: string;
  chapter: number;
  vs: number;
  ve: number;
  en: ChapterSide;
  zh: ChapterSide;
}

export type ChapterBlock = TitleBlock | HeadingBlock | ParagraphBlock;

export interface ChapterData {
  key: string;
  bookId: string;
  chapter: number;
  source: "WEB" | "ESV";
  label: string;
  zhLabel: string;
  numbers: number[];
  enText: Record<number, string>;
  zhText: Record<number, string>;
  blocks: ChapterBlock[];
}

export interface ScriptureReference {
  bookId: string;
  chapter: number;
  verse: number | null;
}

export interface SearchResult {
  bookId: string;
  chapter: number;
  verse: number;
  verseEnd?: number;
  ref: string;
  refZh?: string;
  en: string;
  zh?: string;
  matchKind?: "exact-phrase" | "all-terms" | "prefix" | "fuzzy";
  score?: number;
  rank?: number;
}

export interface Preferences {
  size: number;
  lh: number;
  langMode: LanguageMode;
  showVerseNumbers: boolean;
  showHeadings: boolean;
}

interface AnnotationBase {
  id: string;
  v: 1;
  bookId: string;
  chapter: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface HighlightAnnotation extends AnnotationBase {
  kind: "highlight";
  paraId: string;
  lang: Language;
  start: number;
  end: number;
  vs: number;
  ve: number;
  quote: string;
  color: "yellow";
}

export interface ChapterAnnotation extends AnnotationBase {
  kind: "chapter";
}

export type Annotation = HighlightAnnotation | ChapterAnnotation;

export interface DevotionEntry {
  v: 1;
  date: string;
  answers: Record<string, string>;
  ref: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DevotionStore = Record<string, DevotionEntry>;

export interface HighlightDraft {
  paraId: string;
  key: string;
  bookId: string;
  chapter: number;
  lang: Language;
  start: number;
  end: number;
  vs: number;
  ve: number;
  quote: string;
}
