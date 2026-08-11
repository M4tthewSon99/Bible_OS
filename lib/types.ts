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
  /** A translation the network owed us and did not deliver. A chapter that
      genuinely has no Chinese is not partial; one whose request failed is. */
  missing?: Language[];
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
  /* Width of the side panel (notes / devotion) in px, set by dragging its
     edge. Shared by both panels since only one is open at a time. */
  panelWidth: number;
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

export interface DevotionReferenceBlock {
  kind: "reference";
  id: string;
  text: string;
}

export interface DevotionQuoteBlock {
  kind: "quote";
  id: string;
  text: string;
}

export interface DevotionPromptBlock {
  kind: "prompt";
  id: string;
  text: string;
}

/* This preserves short explanatory copy that is neither a Scripture range nor
   a question. It is intentionally read-only once imported, like the source
   page's study text. */
export interface DevotionTextBlock {
  kind: "text";
  id: string;
  text: string;
}

export type DevotionTemplateBlock =
  | DevotionReferenceBlock
  | DevotionQuoteBlock
  | DevotionPromptBlock
  | DevotionTextBlock;

export interface DevotionTemplateSection {
  id: string;
  title: string;
  blocks: DevotionTemplateBlock[];
}

export interface ImportedDevotionTemplate {
  kind: "photo-ocr";
  sourceLanguage: "en";
  bibleText: string | null;
  sections: DevotionTemplateSection[];
}

export interface DevotionImportDraft {
  date: string;
  template: ImportedDevotionTemplate;
  answers: Record<string, string>;
}

export type DevotionImportMethod = "local-ocr" | "cloud-vision";

/* The photographed page, held as an object URL for as long as the import is
   on screen. A transcription cannot be checked without the thing it was
   transcribed from, so this is what makes the review step more than
   proofreading in the dark. */
export interface DevotionSourceView {
  url: string;
  width: number;
  height: number;
}

export interface DevotionImportUi {
  phase: "idle" | "recognizing" | "review" | "error";
  method?: DevotionImportMethod;
  progress: number;
  status: string;
  error: string | null;
  draft: DevotionImportDraft | null;
  replacePending: boolean;
  source: DevotionSourceView | null;
  /* Blocks the reader dropped during review. Held rather than deleted so the
     removal can be undone — an OCR mistake and a genuinely unwanted block look
     identical until you have re-read the photo. */
  removedBlocks: RemovedDevotionBlock[];
}

export interface RemovedDevotionBlock {
  sectionId: string;
  index: number;
  block: DevotionTemplateBlock;
  answer: string;
}

export interface DevotionEntry {
  v: 1 | 2;
  date: string;
  answers: Record<string, string>;
  ref: string | null;
  /* Version 1 entries predate imported source pages and continue to use the
     original fixed prompts. */
  template?: ImportedDevotionTemplate;
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
