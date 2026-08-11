"use client";

import {
  Component,
  createRef,
  Fragment,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { ChapterPicker } from "@/components/chapter-picker";
import {
  AnimatePresence,
  FluidBackdrop,
  FluidProvider,
  FluidSurface,
} from "@/components/fluid-surfaces";
import * as scripture from "@/lib/bible-source";
import {
  emptyEntry,
  hasContent,
  monthKey,
  shiftMonth,
  todayKey,
} from "@/lib/devotion";
import { DevotionPanel } from "@/components/devotion-panel";
import { PanelResizer } from "@/components/panel-resizer";
import { esvSearchClient } from "@/lib/esv-search-client";
import { restoreFocus, trackInputModality } from "@/lib/focus";
import { markdown } from "@/lib/markdown";
import { importWithLocalOcrFallback } from "@/lib/devotion-import-fallback";
import { photoValidationError, recognizeDevotionPhoto } from "@/lib/devotion-import";
import { recognizeDevotionWithVision } from "@/lib/devotion-vision-client";
import { resizedPhoto } from "@/lib/devotion-photo";
import { devotionReferenceQuery } from "@/lib/devotion-layout";
import {
  deleteDevotionSource,
  listDevotionSourceDates,
  readDevotionSource,
  writeDevotionSource,
  type DevotionSourcePage,
} from "@/lib/devotion-source-store";
import type {
  Annotation,
  ChapterData,
  DevotionEntry,
  DevotionImportDraft,
  DevotionImportMethod,
  DevotionImportUi,
  DevotionSourceView,
  DevotionStore,
  EnglishSourceId,
  HighlightAnnotation,
  HighlightDraft,
  Language,
  LanguageMode,
  ParagraphBlock,
  Preferences,
  SearchResult,
} from "@/lib/types";

const STORAGE = {
  preferences: "bibleos.prefs.v1",
  annotations: "bibleos.annotations.v1",
  position: "bibleos.position.v1",
  devotions: "bibleos.devotions.v1",
};
const SIZES = [16, 17, 18, 19, 21, 23, 25];
const SPACING = [
  { label: "Snug", value: 1.55 },
  { label: "Normal", value: 1.72 },
  { label: "Roomy", value: 1.95 },
];
const MAX_LOADED = 8;
const HAS_CJK = /[\u3400-\u9fff]/;
const PANEL_WIDTH_DEFAULT = 344;
const PANEL_WIDTH_LEGACY_DEFAULT = 392;
const PANEL_WIDTH_MIN = 300;
const EMPTY_DEVOTION_IMPORT: DevotionImportUi = {
  phase: "idle",
  progress: 0,
  status: "",
  error: null,
  draft: null,
  replacePending: false,
  source: null,
  removedBlocks: [],
};

/** Big enough that a reader can zoom in and settle an argument with the OCR
 * about a single printed word, small enough that a month of them is a few
 * megabytes rather than a few hundred. */
const SOURCE_PAGE_EDGE = 1_500;

/* Module scope so the panel gets one stable identity for the life of the app
   instead of a fresh closure on every parent render. */
const canOpenDevotionReference = (reference: string): boolean =>
  scripture.parseReference(devotionReferenceQuery(reference)) !== null;
/* Leave the reader the majority of the window no matter how wide the screen
   is \u2014 the panel is a companion to the text, not a peer. */
const panelWidthMax = (): number => Math.min(720, Math.round(window.innerWidth * 0.55));

interface LoadedChapter {
  key: string;
  bookId: string;
  chapter: number;
  status: "loading" | "ready" | "error";
  label: string;
  data?: ChapterData;
}

function uniqueLoadedChapters(chapters: LoadedChapter[]): LoadedChapter[] {
  const seen = new Set<string>();
  return chapters.filter((chapter) => {
    if (seen.has(chapter.key)) return false;
    seen.add(chapter.key);
    return true;
  });
}

interface CurrentChapter {
  bookId: string;
  chapter: number;
}

interface SearchUiResult extends SearchResult {
  go: () => void;
}

interface ReferenceHint {
  bookId: string;
  chapter: number;
  verse: number | null;
  label: string;
  labelZh: string;
}

interface SelectionToolbar {
  top: number;
  left: number;
  valid: boolean;
  invalid: boolean;
  draft?: HighlightDraft;
}

interface Toast {
  message: string;
  undo: boolean;
  kind?: "devotion";
}

type SidePanelView = "search" | "settings" | "notes" | "devotion";

interface State {
  chapters: LoadedChapter[];
  current: CurrentChapter | null;
  preferences: Preferences;
  narrowLanguage: Language;
  narrow: boolean;
  resizingPanel: boolean;
  compact: boolean;
  annotations: Annotation[];
  sidePanelOpen: boolean;
  sidePanelView: SidePanelView;
  activeId: string | null;
  editorMode: "write" | "preview";
  saveState: string;
  menu: "chapters" | null;
  devotions: DevotionStore;
  devotionCalendarOpen: boolean;
  devotionDate: string;
  devotionMonth: string;
  devotionMonthDir: 1 | -1;
  devotionMode: "write" | "preview";
  devotionSaveState: string;
  devotionImport: DevotionImportUi;
  /* Dates whose photographed page is still in IndexedDB. Kept as a set in
     state so the panel can offer "Original" synchronously instead of showing
     a control that may turn out to open nothing. */
  devotionSourceDates: Set<string>;
  sourceId: EnglishSourceId;
  keyField: boolean;
  keyDraft: string;
  query: string;
  results: SearchUiResult[];
  resultsOpen: boolean;
  resultsNote: string;
  searching: boolean;
  searchStale: boolean;
  activeSearchIndex: number;
  referenceHint: ReferenceHint | null;
  landingVerseKey: string | null;
  selectionToolbar: SelectionToolbar | null;
  toast: Toast | null;
  atCanonStart: boolean;
  atCanonEnd: boolean;
}

interface Segment {
  off: number;
  text: string;
  vnum: number | null;
  showNum: boolean;
  verseKey: string | null;
  annotationId: string | null;
  linked: boolean;
  linkTitle: string | null;
  aria: string | null;
  dot: boolean;
}

interface SavedPosition {
  bookId: string;
  chapter: number;
  paraId?: string | null;
}

interface SegmentLocation {
  off: number;
  para: string;
  lang: Language;
}

interface OpenAtOptions {
  verse?: number | null;
  paragraphId?: string | null;
}

interface ScrollAnchor {
  element: HTMLElement;
  top: number;
}

export class ParallelBible extends Component<Record<string, never>, State> {
  state: State = {
    chapters: [],
    current: null,
    preferences: {
      size: 19,
      lh: 1.72,
      langMode: "both",
      showVerseNumbers: true,
      showHeadings: true,
      panelWidth: PANEL_WIDTH_DEFAULT,
    },
    narrowLanguage: "en",
    narrow: false,
    resizingPanel: false,
    compact: false,
    annotations: [],
    sidePanelOpen: false,
    sidePanelView: "search",
    activeId: null,
    editorMode: "write",
    saveState: "",
    menu: null,
    devotions: {},
    devotionCalendarOpen: true,
    devotionDate: todayKey(),
    devotionMonth: monthKey(todayKey()),
    devotionMonthDir: 1,
    devotionMode: "write",
    devotionSaveState: "",
    devotionImport: EMPTY_DEVOTION_IMPORT,
    devotionSourceDates: new Set<string>(),
    sourceId: "web",
    keyField: false,
    keyDraft: "",
    query: "",
    results: [],
    resultsOpen: false,
    resultsNote: "",
    searching: false,
    searchStale: false,
    activeSearchIndex: 0,
    referenceHint: null,
    landingVerseKey: null,
    selectionToolbar: null,
    toast: null,
    atCanonStart: false,
    atCanonEnd: false,
  };

  private readonly fileRef = createRef<HTMLInputElement>();
  private readonly spotlightInputRef = createRef<HTMLInputElement>();
  private readonly sidePanelTriggerRef = createRef<HTMLButtonElement>();
  private readonly sidePanelRef = createRef<HTMLDivElement>();
  private scrollAnchor: ScrollAnchor | null = null;
  private busy: Record<"next" | "prev", boolean> = { next: false, prev: false };
  private readonly healedChapters = new Set<string>();
  private healTimers: ReturnType<typeof setTimeout>[] = [];
  private clearSave?: ReturnType<typeof setTimeout>;
  private devotionImportAbort?: AbortController;
  private lastY: number | null = null;
  private pendingScroll: { selector: string; at: number } | null = null;
  private pendingUndo: Annotation | null = null;
  private positionTimer?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private scrollTick: number | null = null;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private searchIndicatorTimer?: ReturnType<typeof setTimeout>;
  private landingTimer?: ReturnType<typeof setTimeout>;
  private searchAbort?: AbortController;
  private searchToken?: symbol;
  private untrackModality?: () => void;
  private sidePanelOpener: HTMLElement | null = null;
  private devotionSaveTimer?: ReturnType<typeof setTimeout>;
  private clearDevotionSave?: ReturnType<typeof setTimeout>;
  private pendingDevotionUndo: DevotionEntry | null = null;
  private pendingDevotionSourceUndo: DevotionSourcePage | null = null;
  private devotionImportToken?: symbol;
  private devotionSourceBlob: { blob: Blob; width: number; height: number } | null = null;
  private readonly searchResponses = new Map<
    string,
    SearchResult[]
  >();
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private wentDeep = false;

  componentDidMount(): void {
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("hashchange", this.onHash);
    document.addEventListener("selectionchange", this.onSelectionChange);
    document.addEventListener("mousedown", this.onDocumentMouseDown, true);
    this.untrackModality = trackInputModality();

    this.setState({
      narrow: window.innerWidth < 1100,
      compact: window.innerWidth < 760,
      sourceId: scripture.englishSourceId(),
    });
    this.applyCssVariables();

    void listDevotionSourceDates()
      .then((dates) => this.setState({ devotionSourceDates: new Set(dates) }))
      .catch(() => undefined);

    void scripture.ready().then(() => {
      const preferences = this.readJson<Partial<Preferences>>(STORAGE.preferences);
      const annotations = this.readJson<Annotation[]>(STORAGE.annotations);
      const position = this.readJson<SavedPosition>(STORAGE.position);
      const devotions = this.readJson<DevotionStore>(STORAGE.devotions);
      this.setState(
        (state) => ({
          preferences: { ...state.preferences, ...this.migratePreferences(preferences) },
          annotations: Array.isArray(annotations) ? annotations : [],
          devotions: devotions && typeof devotions === "object" && !Array.isArray(devotions)
            ? devotions
            : {},
        }),
        () => {
          this.applyCssVariables();
          const start = this.startReference(position);
          const prefix = `${start.bookId}/${start.chapter}/`;
          const paragraphId = position?.paraId?.startsWith(prefix) ? position.paraId : null;
          void this.openAt(start.bookId, start.chapter, { paragraphId });
        },
      );
    });
  }

  componentWillUnmount(): void {
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("hashchange", this.onHash);
    document.removeEventListener("selectionchange", this.onSelectionChange);
    document.removeEventListener("mousedown", this.onDocumentMouseDown, true);
    this.untrackModality?.();
    if (this.scrollTick !== null) cancelAnimationFrame(this.scrollTick);
    [
      this.clearSave,
      this.clearDevotionSave,
      this.devotionSaveTimer,
      this.positionTimer,
      this.saveTimer,
      this.searchTimer,
      this.searchIndicatorTimer,
      this.landingTimer,
      this.selectionTimer,
      this.toastTimer,
    ].forEach((timer) => timer && clearTimeout(timer));
    this.healTimers.forEach(clearTimeout);
    this.healTimers = [];
    this.searchAbort?.abort();
    this.devotionImportToken = undefined;
    esvSearchClient.close();
    document.body.classList.remove("modal-open");
    document.body.classList.remove("resizing-panel");
  }

  componentDidUpdate(): void {
    this.applyCssVariables();
    document.body.classList.toggle(
      "modal-open",
      (this.state.narrow && this.state.sidePanelOpen)
        || this.state.menu === "chapters",
    );
    document.body.classList.toggle("resizing-panel", this.state.resizingPanel);
    this.restoreScrollAnchor();

    if (this.pendingScroll) {
      const target = this.pendingScroll;
      const element = document.querySelector<HTMLElement>(target.selector);
      if (element) {
        this.pendingScroll = null;
        this.scrollToElement(element);
      } else if (Date.now() - target.at > 4_000) {
        this.pendingScroll = null;
      }
    }

    if (this.state.sidePanelOpen && this.state.sidePanelView === "search") {
      document.getElementById(this.activeSearchOptionId())?.scrollIntoView({ block: "nearest" });
    }
  }

  private applyCssVariables(): void {
    const root = document.documentElement;
    const { preferences } = this.state;
    const languages = this.languages();
    const sizeIndex = SIZES.indexOf(preferences.size);
    root.style.setProperty("--os-size", `${preferences.size}px`);
    root.style.setProperty("--os-lh", String(preferences.lh));
    root.style.setProperty("--os-cols", languages.length === 2 ? "1fr 1fr" : "minmax(0, 44rem)");
    root.style.setProperty("--os-gap", languages.length === 2 ? "66px" : "0px");
    root.style.setProperty("--size-pct", `${Math.round((sizeIndex < 0 ? 3 : sizeIndex) / (SIZES.length - 1) * 100)}%`);
    root.style.setProperty("--panel-width", `${preferences.panelWidth}px`);
  }

  /* The panel used to open at 392px, which crowds the reading column. A stored
     width equal to the old default was never a choice anyone made — it is just
     that default written back — so it yields to the new one. A width the reader
     actually dragged to is kept. */
  private migratePreferences(stored: Partial<Preferences> | null): Partial<Preferences> {
    if (!stored) return {};
    if (stored.panelWidth !== PANEL_WIDTH_LEGACY_DEFAULT) return stored;
    const { panelWidth: _legacy, ...rest } = stored;
    return rest;
  }

  private readJson<T>(key: string): T | null {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") as T | null;
    } catch {
      return null;
    }
  }

  private writeJson(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The app continues in-memory when storage is unavailable.
    }
  }

  private persistAnnotations = (annotations: Annotation[]): void => {
    this.writeJson(STORAGE.annotations, annotations);
  };

  /* Width lives in component state while dragging and is only written to
     storage on release, so a drag does not spam localStorage. */
  private startPanelResize = (): void => {
    this.setState({ resizingPanel: true });
  };

  private movePanelResize = (panelWidth: number): void => {
    this.setState((state) => ({ preferences: { ...state.preferences, panelWidth } }));
  };

  private endPanelResize = (panelWidth: number): void => {
    this.setState({ resizingPanel: false });
    this.setPreferences({ panelWidth });
  };

  private renderPanelResizer(): ReactNode {
    if (this.state.narrow) return null;
    return (
      <PanelResizer
        max={panelWidthMax()}
        min={PANEL_WIDTH_MIN}
        onResizeEnd={this.endPanelResize}
        onResizeMove={this.movePanelResize}
        onResizeStart={this.startPanelResize}
        width={this.state.preferences.panelWidth}
      />
    );
  }

  private setPreferences = (patch: Partial<Preferences>): void => {
    this.setState((state) => {
      const preferences = { ...state.preferences, ...patch };
      this.writeJson(STORAGE.preferences, preferences);
      return { preferences };
    });
  };

  private startReference(position: SavedPosition | null): CurrentChapter {
    const hash = location.hash.replace(/^#\/?/, "");
    if (hash) {
      const parts = hash.split("/").filter(Boolean);
      const bookId = scripture.slugToBook(parts[0]);
      if (bookId) return { bookId, chapter: Math.max(1, Number.parseInt(parts[1], 10) || 1) };
    }
    if (position?.bookId) return { bookId: position.bookId, chapter: position.chapter || 1 };
    return { bookId: "MAT", chapter: 1 };
  }

  private onHash = (): void => {
    const reference = this.startReference(null);
    const { current } = this.state;
    if (!current || current.bookId !== reference.bookId || current.chapter !== reference.chapter) {
      void this.openAt(reference.bookId, reference.chapter);
    }
  };

  private setUrl(bookId: string, chapter: number): void {
    const next = `#/${scripture.bookSlug(bookId)}/${chapter}`;
    if (location.hash !== next) history.replaceState(null, "", next);
  }

  private openAt = async (bookId: string, chapter: number, options: OpenAtOptions = {}): Promise<void> => {
    const key = `${bookId}/${chapter}`;
    this.setState({
      chapters: [{ key, bookId, chapter, status: "loading", label: scripture.refLabel(bookId, chapter) }],
      current: { bookId, chapter },
      atCanonStart: false,
      atCanonEnd: false,
      activeId: null,
      landingVerseKey: options.verse ? `${key}:${options.verse}` : null,
    });
    this.setUrl(bookId, chapter);
    // A jump starts a fresh reading run: nothing above is loaded, no earlier
    // scroll position is meaningful, and no in-flight edge belongs to this list.
    this.scrollAnchor = null;
    this.busy = { next: false, prev: false };
    this.lastY = null;
    this.wentDeep = false;
    window.scrollTo(0, 0);
    await this.fetchInto(key, bookId, chapter);

    const selector = options.paragraphId
      ? `[data-pk="${options.paragraphId}"]`
      : options.verse
        ? `[data-vk="${key}:${options.verse}:en"], [data-vk="${key}:${options.verse}:zh"]`
        : null;
    if (selector) this.pendingScroll = { selector, at: Date.now() };
    else window.scrollTo(0, 0);
    if (options.verse) {
      if (this.landingTimer) clearTimeout(this.landingTimer);
      this.landingTimer = setTimeout(() => this.setState({ landingVerseKey: null }), 4_200);
    }
  };

  private fetchInto = async (key: string, bookId: string, chapter: number): Promise<void> => {
    try {
      const data = await scripture.getChapter(bookId, chapter);
      this.patchChapter(key, { status: "ready", data });
      this.healPartialChapter(key, bookId, chapter, data);
    } catch {
      this.patchChapter(key, { status: "error" });
    }
  };

  /**
   * A chapter can arrive whole in one translation and empty in the other,
   * because that one request was dropped rather than because the translation
   * has nothing there. Such a result is deliberately left out of the source
   * cache, so a single quiet retry usually fills the gap in without the reader
   * having to notice it, let alone ask.
   */
  private healPartialChapter(
    key: string,
    bookId: string,
    chapter: number,
    data: ChapterData,
  ): void {
    if (!data.missing?.length || this.healedChapters.has(key)) return;
    this.healedChapters.add(key);
    this.healTimers.push(setTimeout(() => {
      void scripture.getChapter(bookId, chapter).then((healed) => {
        if (healed.missing?.length) return;
        if (!this.state.chapters.some((loaded) => loaded.key === key)) return;
        this.patchChapter(key, { status: "ready", data: healed });
      }).catch(() => {
        // The reader keeps what did arrive; the notice offers a manual retry.
      });
    }, 1_600));
  }

  private patchChapter(key: string, patch: Partial<LoadedChapter>, onCommitted?: () => void): void {
    this.captureScrollAnchor(this.anchorForFill(key));
    this.setState((state) => ({
      chapters: uniqueLoadedChapters(state.chapters)
        .map((chapter) => chapter.key === key ? { ...chapter, ...patch } : chapter),
    }), onCommitted);
  }

  private retryChapter = (key: string): void => {
    const chapter = this.state.chapters.find((candidate) => candidate.key === key);
    if (!chapter) return;
    this.patchChapter(key, { status: "loading" });
    void this.fetchInto(key, chapter.bookId, chapter.chapter);
  };

  private extend = async (direction: "next" | "prev"): Promise<void> => {
    // Each edge holds its own lock. A single shared one let a slow forward
    // fetch swallow the backward request, and because nothing retries a
    // dropped request, the chapter above simply never loaded. Concurrent edges
    // are safe: they insert at opposite ends and the updater below rejects a
    // key that is already loaded.
    if (this.busy[direction]) return;
    const { chapters } = this.state;
    if (!chapters.length) return;
    const edge = direction === "next" ? chapters.at(-1) : chapters[0];
    if (!edge || edge.status !== "ready") return;

    const reference = direction === "next"
      ? scripture.nextChapter(edge.bookId, edge.chapter)
      : scripture.prevChapter(edge.bookId, edge.chapter);
    if (!reference) {
      if (direction === "next") this.setState({ atCanonEnd: true });
      else this.setState({ atCanonStart: true });
      return;
    }

    this.busy[direction] = true;
    const key = `${reference.bookId}/${reference.chapter}`;
    if (chapters.some((chapter) => chapter.key === key)) {
      this.busy[direction] = false;
      return;
    }
    const entry: LoadedChapter = {
      key,
      bookId: reference.bookId,
      chapter: reference.chapter,
      status: "loading",
      label: scripture.refLabel(reference.bookId, reference.chapter),
    };
    // Everything below the insertion point has to stay exactly where it is, so
    // hold the chapter the placeholder is being pushed in front of.
    if (direction === "prev") this.captureScrollAnchor(this.chapterBlockFor(chapters[0].key));
    this.setState((state) => {
      const uniqueChapters = uniqueLoadedChapters(state.chapters);
      if (uniqueChapters.some((chapter) => chapter.key === key)) {
        return { chapters: uniqueChapters };
      }
      return {
        chapters: direction === "next" ? [...uniqueChapters, entry] : [entry, ...uniqueChapters],
      };
    });

    try {
      const data = await scripture.getChapter(reference.bookId, reference.chapter);
      this.busy[direction] = false;
      this.patchChapter(key, { status: "ready", data }, () => {
        this.trimLoaded(direction);
        this.requestEdges();
      });
      this.healPartialChapter(key, reference.bookId, reference.chapter, data);
    } catch {
      this.busy[direction] = false;
      this.patchChapter(key, { status: "error" }, () => this.trimLoaded(direction));
    }
  };

  private trimLoaded(direction: "next" | "prev"): void {
    const budget = scripture.esvVerseBudget();
    const { chapters, current } = this.state;
    let total = chapters.reduce(
      (sum, chapter) => sum + (chapter.status === "ready" ? chapter.data?.numbers.length || 0 : 0),
      0,
    );
    if (total <= budget && chapters.length <= MAX_LOADED) return;

    const keep = [...chapters];
    const isCurrent = (chapter: LoadedChapter) =>
      current?.bookId === chapter.bookId && current.chapter === chapter.chapter;
    const overBudget = () => total > budget || keep.length > MAX_LOADED;

    while (keep.length > 1 && overBudget()) {
      const edge = direction === "next" ? keep[0] : keep.at(-1);
      if (!edge || edge.status !== "ready" || isCurrent(edge)) break;
      total -= edge.data?.numbers.length || 0;
      if (direction === "next") keep.shift();
      else keep.pop();
    }

    if (keep.length === chapters.length) return;
    // Anchoring to a block this trim is about to unmount silently forfeits the
    // correction and drops the reader a chapter or more away, so the anchor is
    // only ever taken from a survivor.
    const surviving = new Set(keep.map((chapter) => chapter.key));
    const visible = this.topVisibleChapterBlock();
    const fallback = direction === "next" ? keep[0] : keep.at(-1);
    this.captureScrollAnchor(
      visible && surviving.has(visible.dataset.chapterKey || "")
        ? visible
        : fallback && this.chapterBlockFor(fallback.key),
    );
    this.setState({ chapters: keep });
  }

  private headerLine(): number {
    return document.querySelector<HTMLElement>(".app-header")?.getBoundingClientRect().bottom || 0;
  }

  private chapterBlocks(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(".chapter-block"));
  }

  private chapterBlockFor(key: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.chapter-block[data-chapter-key="${key}"]`);
  }

  /** The chapter the reader is actually on — the first one still crossing the
      header line, or the last one once every chapter sits above it. */
  private topVisibleChapterBlock(): HTMLElement | null {
    const line = this.headerLine();
    const blocks = this.chapterBlocks();
    return blocks.find((block) => block.getBoundingClientRect().bottom > line + 1)
      || blocks.at(-1)
      || null;
  }

  /**
   * A chapter whose verses arrive while it sits above the reading position
   * grows the page upward. Holding the chapter *after* it keeps the passage
   * being read exactly where it is and lets the new verses fill the space the
   * reader is travelling toward. Anchoring the growing chapter itself would
   * instead shove that passage a screen or more further down the page.
   */
  private anchorForFill(key: string): HTMLElement | null {
    const blocks = this.chapterBlocks();
    const index = blocks.findIndex((block) => block.dataset.chapterKey === key);
    if (index < 0) return null;
    // The line is the top of the window, not the bottom of the header: the
    // reading column runs underneath the header, so a chapter whose opening is
    // merely behind the header is still one the reader is looking at, and it
    // should grow downward from where its first line already sits.
    if (blocks[index].getBoundingClientRect().top > -1) return null;
    return blocks[index + 1] || null;
  }

  /**
   * Preserve an actual piece of visible reading content rather than the
   * document height. The browser may clamp scrollY when chapters are removed,
   * and it applies its own scroll anchoring when content is inserted. Reading
   * the chosen chapter's final position measures what is left after both, so
   * no correction is applied twice.
   */
  private captureScrollAnchor(preferred?: HTMLElement | null): void {
    const element = preferred?.isConnected ? preferred : this.topVisibleChapterBlock();
    if (!element) return;
    this.scrollAnchor = { element, top: element.getBoundingClientRect().top };
  }

  private restoreScrollAnchor(): void {
    const anchor = this.scrollAnchor;
    this.scrollAnchor = null;
    if (!anchor?.element.isConnected) return;

    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) <= 0.5) return;
    window.scrollBy(0, delta);
    // Do not interpret this layout correction as upward user intent on the
    // next animation frame and accidentally request the opposite edge.
    this.lastY = window.scrollY;
  }

  /* Scripture arrives over the network, so a chapter can be reached before its
     verses are. Both edges are requested a screen and a half out, which is far
     enough that the placeholder is normally already text by the time it is
     scrolled into — the reader meets verses, not a waiting state. */
  private aheadDistance(): number {
    return Math.max(1_400, window.innerHeight * 1.5);
  }

  private behindDistance(): number {
    return Math.max(600, window.innerHeight * 0.75);
  }

  /**
   * Re-check both edges against the reading position. Called on scroll and
   * again once a chapter settles, because a request skipped while its edge was
   * in flight would otherwise wait for a scroll event that may never come —
   * the reader can be standing still at the top of the loaded range.
   */
  private requestEdges(movingUp = true): void {
    const y = window.scrollY;
    if (y + window.innerHeight > document.documentElement.scrollHeight - this.aheadDistance()) {
      void this.extend("next");
    }
    if (movingUp && y < this.behindDistance() && this.wentDeep) void this.extend("prev");
  }

  private onScroll = (): void => {
    if (this.scrollTick !== null) return;
    this.scrollTick = requestAnimationFrame(() => {
      this.scrollTick = null;
      const y = window.scrollY;
      const movingUp = y < (this.lastY ?? y) - 1;
      // Reading backwards only becomes an intent once the reader has moved down
      // from where the passage opened; before that, an upward nudge is just the
      // page settling.
      if (y > this.behindDistance()) this.wentDeep = true;
      this.requestEdges(movingUp);
      this.lastY = y;
      this.trackPosition();
    });
  };

  private onWheel = (event: WheelEvent): void => {
    if (event.deltaY < 0 && window.scrollY < this.behindDistance()) void this.extend("prev");
  };

  private trackPosition(): void {
    const markers = document.querySelectorAll<HTMLElement>("[data-ck]");
    let chapterKey: string | null = null;
    let paragraphId: string | null = null;

    for (const element of markers) {
      if (element.getBoundingClientRect().top >= 160) break;
      const candidate = element.dataset.ck || null;
      if (candidate !== chapterKey) {
        chapterKey = candidate;
        paragraphId = null;
      }
      if (element.dataset.pk) paragraphId = element.dataset.pk;
    }
    if (!chapterKey) return;

    const [bookId, chapterString] = chapterKey.split("/");
    const chapter = Number(chapterString);
    const { current } = this.state;
    if (!current || current.bookId !== bookId || current.chapter !== chapter) {
      this.setState({ current: { bookId, chapter } });
      this.setUrl(bookId, chapter);
    }

    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.positionTimer = setTimeout(
      () => this.writeJson(STORAGE.position, { bookId, chapter, paraId: paragraphId }),
      500,
    );
  }

  private scrollToElement(element: HTMLElement): void {
    const top = element.getBoundingClientRect().top + window.scrollY - 132;
    // A smooth travel across a whole chapter is exactly the vestibular motion
    // the reduced-motion setting asks us to drop; arrive instead.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  }

  private onResize = (): void => {
    const narrow = window.innerWidth < 1100;
    const compact = window.innerWidth < 760;
    if (narrow !== this.state.narrow || compact !== this.state.compact) {
      this.setState({
        narrow,
        compact,
      });
    }
  };

  private languages(): Language[] {
    const { narrow, narrowLanguage, preferences } = this.state;
    if (narrow) return [narrowLanguage];
    return preferences.langMode === "both" ? ["en", "zh"] : [preferences.langMode];
  }

  private onSelectionChange = (): void => {
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => this.readSelection(), 130);
  };

  private readSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      if (this.state.selectionToolbar) this.setState({ selectionToolbar: null });
      return;
    }

    const range = selection.getRangeAt(0);
    const startLocation = this.segmentOf(range.startContainer);
    const endLocation = this.segmentOf(range.endContainer);
    const rectangle = range.getBoundingClientRect();
    if (!rectangle || (!rectangle.width && !rectangle.height)) {
      this.setState({ selectionToolbar: null });
      return;
    }

    /* Toolbar is ~42px tall (34px button + 4px padding top/bottom), so an
       offset equal to its height would sit flush on the selection with no
       air between them. The extra 12px is the actual gap above the text. */
    const position = {
      top: Math.max(64, rectangle.top - 58),
      left: rectangle.left + rectangle.width / 2,
    };
    if (!startLocation || !endLocation) {
      this.setState({ selectionToolbar: null });
      return;
    }
    if (startLocation.para !== endLocation.para || startLocation.lang !== endLocation.lang) {
      this.setState({ selectionToolbar: { ...position, valid: false, invalid: true } });
      return;
    }

    const paragraph = this.paragraphBlock(startLocation.para);
    if (!paragraph) {
      this.setState({ selectionToolbar: null });
      return;
    }

    const side = paragraph[startLocation.lang];
    let start = startLocation.off + range.startOffset;
    let end = endLocation.off + range.endOffset;
    if (end < start) [start, end] = [end, start];
    while (start < end && /\s/.test(side.text[start])) start += 1;
    while (end > start && /\s/.test(side.text[end - 1])) end -= 1;
    if (end - start < 1) {
      this.setState({ selectionToolbar: null });
      return;
    }

    const verses = side.verses.filter((verse) => verse.off < end && verse.end > start);
    const draft: HighlightDraft = {
      paraId: paragraph.id,
      key: paragraph.key,
      bookId: paragraph.bookId,
      chapter: paragraph.chapter,
      lang: startLocation.lang,
      start,
      end,
      vs: verses[0]?.n || paragraph.vs,
      ve: verses.at(-1)?.n || paragraph.ve,
      quote: side.text.slice(start, end),
    };
    this.setState({ selectionToolbar: { ...position, valid: true, invalid: false, draft } });
  }

  private segmentOf(node: Node): SegmentLocation | null {
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
    element = element?.closest?.("[data-off]") || null;
    if (!element) return null;
    const para = element.getAttribute("data-para");
    const lang = element.getAttribute("data-lang");
    if (!para || (lang !== "en" && lang !== "zh")) return null;
    return { off: Number(element.getAttribute("data-off")), para, lang };
  }

  private paragraphBlock(paragraphId: string): ParagraphBlock | null {
    for (const chapter of this.state.chapters) {
      if (chapter.status !== "ready" || !chapter.data) continue;
      const block = chapter.data.blocks.find(
        (candidate) => candidate.type === "para" && candidate.id === paragraphId,
      );
      if (block?.type === "para") return block;
    }
    return null;
  }

  private createAnnotation(draft: HighlightDraft, openPanel: boolean): void {
    if (openPanel && !this.state.sidePanelOpen) {
      const activeElement = document.activeElement as HTMLElement | null;
      this.sidePanelOpener = activeElement && activeElement !== document.body ? activeElement : null;
    }
    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const annotation: HighlightAnnotation = {
      id,
      v: 1,
      kind: "highlight",
      bookId: draft.bookId,
      chapter: draft.chapter,
      paraId: draft.paraId,
      lang: draft.lang,
      start: draft.start,
      end: draft.end,
      vs: draft.vs,
      ve: draft.ve,
      quote: draft.quote,
      color: "yellow",
      note: "",
      createdAt: now,
      updatedAt: now,
    };

    this.setState((state) => {
      const annotations = [...state.annotations, annotation];
      this.persistAnnotations(annotations);
      return {
        annotations,
        selectionToolbar: null,
        sidePanelOpen: openPanel || state.sidePanelOpen,
        sidePanelView: openPanel ? "notes" : state.sidePanelView,
        activeId: openPanel ? id : state.activeId,
        editorMode: "write",
      };
    }, () => {
      window.getSelection()?.removeAllRanges();
      if (openPanel) {
        setTimeout(() => this.sidePanelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 60);
      }
    });
  }

  private updateNote(id: string, note: string): void {
    this.setState((state) => ({
      annotations: state.annotations.map((annotation) =>
        annotation.id === id ? { ...annotation, note, updatedAt: new Date().toISOString() } : annotation,
      ),
      saveState: "Saving…",
    }));
    this.scheduleAnnotationSave();
  }

  private scheduleAnnotationSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.persistAnnotations(this.state.annotations);
      this.setState({ saveState: "Saved" });
      if (this.clearSave) clearTimeout(this.clearSave);
      this.clearSave = setTimeout(() => this.setState({ saveState: "" }), 2_200);
    }, 350);
  }

  private deleteAnnotation(id: string): void {
    const annotation = this.state.annotations.find((candidate) => candidate.id === id);
    if (!annotation) return;
    this.pendingUndo = annotation;
    this.setState((state) => {
      const annotations = state.annotations.filter((candidate) => candidate.id !== id);
      this.persistAnnotations(annotations);
      return {
        annotations,
        activeId: null,
        toast: { message: "Annotation deleted.", undo: true },
      };
    });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.setState({ toast: null }), 7_000);
  }

  private annotationsForChapter(key: string): HighlightAnnotation[] {
    return this.state.annotations
      .filter((annotation): annotation is HighlightAnnotation =>
        annotation.kind === "highlight" && `${annotation.bookId}/${annotation.chapter}` === key,
      )
      .sort((left, right) => left.vs - right.vs || left.start - right.start);
  }

  private chapterNote(key: string): string {
    const annotation = this.state.annotations.find(
      (candidate) => candidate.kind === "chapter" && `${candidate.bookId}/${candidate.chapter}` === key,
    );
    return annotation?.note || "";
  }

  private setChapterNote(key: string, note: string): void {
    const [bookId, chapterString] = key.split("/");
    this.setState((state) => {
      const index = state.annotations.findIndex(
        (annotation) => annotation.kind === "chapter" && `${annotation.bookId}/${annotation.chapter}` === key,
      );
      const annotations = [...state.annotations];
      if (index >= 0) {
        annotations[index] = { ...annotations[index], note, updatedAt: new Date().toISOString() };
      } else {
        const now = new Date().toISOString();
        annotations.push({
          id: `c${key.replace("/", "-")}`,
          v: 1,
          kind: "chapter",
          bookId,
          chapter: Number(chapterString),
          note,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { annotations, saveState: "Saving…" };
    });
    this.scheduleAnnotationSave();
  }

  private onKey = (event: globalThis.KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const typing = target && (
      target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
    );
    if (event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "i") {
      event.preventDefault();
      this.toggleChapterPicker();
      return;
    }
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.code === "Backslash") {
      event.preventDefault();
      this.toggleDevotion();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.openSpotlight();
      return;
    }
    if (event.key === "Escape") {
      if (this.state.selectionToolbar) this.setState({ selectionToolbar: null });
      else if (this.state.menu) {
        this.setState({ menu: null });
      }
      else if (this.state.sidePanelOpen) this.closeSidePanel();
      else if (typing) target.blur();
      return;
    }
    if (typing) return;
    if (event.key === "/") {
      event.preventDefault();
      this.openSpotlight();
      return;
    }
    const toolbar = this.state.selectionToolbar;
    if (!toolbar?.valid || !toolbar.draft) return;
    if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      this.createAnnotation(toolbar.draft, false);
    }
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      this.createAnnotation(toolbar.draft, true);
    }
  };

  private onDocumentMouseDown = (event: MouseEvent): void => {
    if (!this.state.menu) return;
    const target = event.target as Element | null;
    if (target?.closest?.(".chapter-menu")) return;
    if (!target?.closest?.("header")) this.setState({ menu: null });
  };

  private openSpotlight = (): void => {
    if (this.state.sidePanelOpen && this.state.sidePanelView === "search") {
      this.spotlightInputRef.current?.focus();
      return;
    }
    this.openSidePanel("search");
    this.setState({ resultsOpen: false }, () => {
      setTimeout(() => this.spotlightInputRef.current?.focus(), 30);
    });
  };

  private toggleChapterPicker = (): void => {
    if (this.state.menu === "chapters") {
      this.setState({ menu: null });
      return;
    }
    if (this.state.sidePanelOpen) this.closeSidePanel(false);
    this.setState({ menu: "chapters" });
  };

  private closeSpotlight = (restoreOpener = true): void => {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.searchIndicatorTimer) clearTimeout(this.searchIndicatorTimer);
    this.searchAbort?.abort();
    this.searchToken = undefined;
    this.setState({
      sidePanelOpen: false,
      resultsOpen: false,
      query: "",
      results: [],
      resultsNote: "",
      searching: false,
      searchStale: false,
      activeSearchIndex: 0,
      referenceHint: null,
    });
    if (restoreOpener) this.restoreSidePanelFocus();
  };

  private searchCacheKey(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private rememberSearchResponse(
    key: string,
    results: SearchResult[],
  ): void {
    this.searchResponses.delete(key);
    this.searchResponses.set(key, results);
    if (this.searchResponses.size > 20) {
      const oldest = this.searchResponses.keys().next().value;
      if (oldest) this.searchResponses.delete(oldest);
    }
  }

  private applySearchOutput(results: SearchResult[], resultsNote = ""): void {
    const uiResults = results.map((result) => ({
      ...result,
      go: () => this.pickResult(result),
    }));
    this.setState({
      searching: false,
      searchStale: false,
      results: uiResults,
      resultsNote: resultsNote || (uiResults.length
        ? ""
        : "No ESV matches. Try a shorter phrase or a reference like “John 3:16”."),
      resultsOpen: true,
      activeSearchIndex: 0,
    });
  }

  private runSearch(query: string, bypassCache = false): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.searchIndicatorTimer) clearTimeout(this.searchIndicatorTimer);
    this.searchAbort?.abort();
    this.searchToken = undefined;

    const trimmed = query.trim();
    if (HAS_CJK.test(trimmed)) {
      this.setState({
        referenceHint: null,
        results: [],
        resultsOpen: true,
        resultsNote: "Search accepts English references and keywords.",
        searching: false,
        searchStale: false,
        activeSearchIndex: 0,
      });
      return;
    }

    const reference = scripture.parseReference(query);
    const referenceHint = reference ? {
      ...reference,
      label: scripture.refLabel(reference.bookId, reference.chapter, reference.verse),
      labelZh: scripture.refLabelZh(reference.bookId, reference.chapter, reference.verse),
    } : null;
    this.setState({
      referenceHint,
      resultsOpen: Boolean(referenceHint || trimmed.length >= 2),
      activeSearchIndex: 0,
    });
    if (referenceHint || trimmed.length < 2) {
      this.setState({
        results: [],
        resultsNote: "",
        searching: false,
        searchStale: false,
      });
      return;
    }

    const cacheKey = this.searchCacheKey(trimmed);
    const cached = bypassCache ? null : this.searchResponses.get(cacheKey);
    if (cached) {
      this.applySearchOutput(cached);
      return;
    }

    const local = scripture.localKeywordSearch(trimmed, 8);
    this.setState((state) => ({
      results: local.length
        ? local.map((result) => ({ ...result, go: () => this.pickResult(result) }))
        : state.results,
      resultsNote: "",
      searching: false,
      searchStale: !local.length && state.results.length > 0,
      resultsOpen: true,
      activeSearchIndex: 0,
    }));

    this.searchTimer = setTimeout(async () => {
      const token = Symbol("search");
      this.searchToken = token;
      const controller = new AbortController();
      this.searchAbort = controller;
      this.searchIndicatorTimer = setTimeout(() => {
        if (this.searchToken === token) this.setState({ searching: true });
      }, 120);
      try {
        const results = await esvSearchClient.search(trimmed, 20, controller.signal, (message) => {
          if (this.searchToken === token) this.setState({ searching: true, resultsNote: message });
        });
        if (this.searchToken !== token) return;
        this.rememberSearchResponse(cacheKey, results);
        this.applySearchOutput(results);
      } catch (error) {
        if (controller.signal.aborted || this.searchToken !== token) return;
        this.applySearchOutput(
          local,
          local.length
            ? "Local ESV search is unavailable. Showing matches from ESV chapters opened in this session."
            : "Local ESV search couldn’t be prepared. Check your connection and retry.",
        );
      } finally {
        if (this.searchIndicatorTimer) clearTimeout(this.searchIndicatorTimer);
      }
    }, 180);
  }

  private retrySearch = (): void => {
    if (this.state.query.trim()) this.runSearch(this.state.query, true);
  };

  private clearSearch = (): void => {
    this.setState({ query: "" });
    this.runSearch("");
    setTimeout(() => this.spotlightInputRef.current?.focus(), 0);
  };

  private searchOptionCount(): number {
    return (this.state.referenceHint ? 1 : 0) + this.state.results.length;
  }

  private activeSearchOptionId(): string {
    return `search-option-${this.state.activeSearchIndex}`;
  }

  private onSearchInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();

      const reference = scripture.parseReference(this.state.query);
      if (reference) {
        this.closeSpotlight();
        void this.openAt(reference.bookId, reference.chapter, { verse: reference.verse });
        return;
      }

      const result = this.state.results[this.state.activeSearchIndex];
      result?.go();
      return;
    }

    const count = this.searchOptionCount();
    if (!count) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      let activeSearchIndex = this.state.activeSearchIndex;
      if (event.key === "ArrowDown") activeSearchIndex = (activeSearchIndex + 1) % count;
      if (event.key === "ArrowUp") activeSearchIndex = (activeSearchIndex - 1 + count) % count;
      if (event.key === "Home") activeSearchIndex = 0;
      if (event.key === "End") activeSearchIndex = count - 1;
      this.setState({ activeSearchIndex });
    }
  };

  private trapFocus(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null): void {
    if (event.key !== "Tab") return;
    const focusables = container?.querySelectorAll<HTMLElement>(
      'input, textarea, button:not([tabindex="-1"]):not([disabled])',
    );
    if (!focusables?.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private onSidePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (this.state.narrow) this.trapFocus(event, this.sidePanelRef.current);
  };

  private restoreSidePanelFocus(): void {
    const opener = this.sidePanelOpener;
    this.sidePanelOpener = null;
    const focusTarget = opener?.isConnected && opener !== document.body
      ? opener
      : this.sidePanelTriggerRef.current;
    setTimeout(() => restoreFocus(focusTarget), 0);
  }

  private openSidePanel = (view: SidePanelView, activeId = this.state.activeId): void => {
    const wasOpen = this.state.sidePanelOpen;
    if (!wasOpen) {
      const activeElement = document.activeElement as HTMLElement | null;
      this.sidePanelOpener = activeElement && activeElement !== document.body ? activeElement : null;
    }
    this.setState((state) => ({
      sidePanelOpen: true,
      sidePanelView: view,
      menu: null,
      activeId: view === "notes" ? activeId : state.activeId,
      /* Opening onto a day that already has a page should show the page. The
         picker only leads when there is nothing else to read. */
      devotionCalendarOpen: view === "devotion"
        ? !hasContent(state.devotions[state.devotionDate])
        : state.devotionCalendarOpen,
      devotionMonth: view === "devotion" ? monthKey(state.devotionDate) : state.devotionMonth,
    }), () => {
      if (view === "search") {
        setTimeout(() => this.spotlightInputRef.current?.focus(), 30);
      } else if (view === "notes" && activeId) {
        setTimeout(() => this.sidePanelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 50);
      } else if (this.state.narrow && !wasOpen) {
        setTimeout(() => this.sidePanelRef.current?.querySelector<HTMLElement>("button")?.focus(), 30);
      }
    });
  };

  private closeSidePanel = (restoreOpener = true): void => {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.searchIndicatorTimer) clearTimeout(this.searchIndicatorTimer);
    this.searchAbort?.abort();
    this.searchToken = undefined;
    this.setState({
      sidePanelOpen: false,
      activeId: null,
      resultsOpen: false,
      query: "",
      results: [],
      resultsNote: "",
      searching: false,
      searchStale: false,
      activeSearchIndex: 0,
      referenceHint: null,
    });
    if (restoreOpener) this.restoreSidePanelFocus();
  };

  private toggleSidePanel = (): void => {
    if (this.state.sidePanelOpen) this.closeSidePanel();
    else this.openSidePanel(this.state.sidePanelView);
  };

  private openNotes = (activeId: string | null = this.state.activeId): void => {
    this.openSidePanel("notes", activeId);
  };

  private toggleDevotionCalendar = (): void => {
    this.setState((state) => ({
      devotionCalendarOpen: !state.devotionCalendarOpen,
      // Reopening always lands on the month you are already looking at.
      devotionMonth: state.devotionCalendarOpen ? state.devotionMonth : monthKey(state.devotionDate),
    }));
  };

  private stepDevotionMonth = (delta: 1 | -1): void => {
    this.setState((state) => ({
      devotionMonth: shiftMonth(state.devotionMonth, delta),
      devotionMonthDir: delta,
    }));
  };

  /** Choosing a day folds the calendar away so the writing gets the room. */
  private pickDevotionDate = (dateKey: string): void => {
    this.setState((state) => ({
      devotionDate: dateKey,
      devotionCalendarOpen: false,
      devotionMonth: monthKey(dateKey),
      devotionSaveState: "",
      devotions: state.devotions,
    }));
  };

  /** ⌘\ collapses the panel when open, otherwise opens Devotion. */
  private toggleDevotion = (): void => {
    if (this.state.sidePanelOpen) this.closeSidePanel();
    else this.openSidePanel("devotion");
  };

  /** The panel holds one photo at a time. Revoking on every replacement keeps
   * a long session of retries from leaking a decoded bitmap per attempt.
   *
   * Dropping the URL from state and revoking it are one operation, in that
   * order: revoking first leaves a mounted <img> pointing at a dead URL, and
   * the browser re-requests it before React gets to unmount it — a failure in
   * the console for a photo nobody is waiting on any more. The revoke rides
   * the commit callback so it lands after that element is gone. */
  private releaseDevotionSource(): void {
    const url = this.state.devotionImport.source?.url;
    this.devotionSourceBlob = null;
    if (!url) return;
    this.setState(
      (state) => ({ devotionImport: { ...state.devotionImport, source: null } }),
      () => URL.revokeObjectURL(url),
    );
  }

  /** Takes ownership of a page image: the blob is kept so a later save can
   * persist it, and a URL is minted for the panel to display. Paired with
   * {@link releaseDevotionSource}, which is what revokes that URL. */
  private adoptDevotionSource(page: { blob: Blob; width: number; height: number }): void {
    this.devotionSourceBlob = page;
    this.setState((state) => ({
      devotionImport: {
        ...state.devotionImport,
        source: { url: URL.createObjectURL(page.blob), width: page.width, height: page.height },
      },
    }));
  }

  private startDevotionPhoto = (photo: File, method: DevotionImportMethod): void => {
    const problem = photoValidationError(photo);
    if (problem) {
      this.releaseDevotionSource();
      this.setState({ devotionImport: { ...EMPTY_DEVOTION_IMPORT, phase: "error", error: problem } });
      return;
    }

    const token = Symbol("devotion-import");
    this.devotionImportAbort?.abort();
    const abort = new AbortController();
    this.devotionImportToken = token;
    this.devotionImportAbort = abort;
    this.releaseDevotionSource();
    this.setState({
      devotionCalendarOpen: false,
      devotionImport: {
        ...EMPTY_DEVOTION_IMPORT,
        phase: "recognizing",
        method,
        status: method === "cloud-vision" ? "Preparing vision import" : "Preparing private OCR",
      },
    });

    /* Runs alongside recognition rather than before it: the reader should see
       the page they handed over while it is being read, and a failure to make
       the preview must never be a failure to import. */
    void resizedPhoto(photo, SOURCE_PAGE_EDGE, 0.72)
      .then(({ blob, width, height }) => {
        const stillThisImport = this.devotionImportToken === token
          || (!this.devotionImportToken && this.state.devotionImport.phase === "review");
        if (!stillThisImport || this.state.devotionImport.source) return;
        this.adoptDevotionSource({ blob, width, height });
      })
      .catch(() => undefined);

    const onProgress = ({ progress, status }: { progress: number; status: string }) => {
      if (this.devotionImportToken !== token) return;
      this.setState((state) => ({
        devotionImport: { ...state.devotionImport, progress, status },
      }));
    };
    const recognition = method === "cloud-vision"
      ? importWithLocalOcrFallback(
        () => recognizeDevotionWithVision(photo, onProgress, abort.signal),
        () => recognizeDevotionPhoto(photo, onProgress),
        () => abort.signal.aborted,
        () => {
          onProgress({ progress: 0.12, status: "Vision unavailable — using private OCR" });
        },
      )
      : recognizeDevotionPhoto(photo, onProgress)
        .then((draft) => ({ draft, method }));

    void recognition.then(({ draft, method: completedWith }) => {
      if (this.devotionImportToken !== token) return;
      this.devotionImportToken = undefined;
      this.devotionImportAbort = undefined;
      /* Carries the photo across into review rather than resetting to the
         empty shape — the whole point of the check is having the page to
         check against. */
      this.setState((state) => ({
        devotionImport: {
          ...EMPTY_DEVOTION_IMPORT,
          phase: "review",
          method: completedWith,
          draft,
          source: state.devotionImport.source,
        },
      }));
    }).catch((error: unknown) => {
      if (this.devotionImportToken !== token) return;
      this.devotionImportToken = undefined;
      this.devotionImportAbort = undefined;
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "This photo could not be read.";
      this.releaseDevotionSource();
      this.setState({
        devotionImport: { ...EMPTY_DEVOTION_IMPORT, phase: "error", method, error: message },
      });
    });
  };

  private cancelDevotionImport = (): void => {
    this.devotionImportAbort?.abort();
    this.devotionImportAbort = undefined;
    this.devotionImportToken = undefined;
    this.releaseDevotionSource();
    this.setState({ devotionImport: EMPTY_DEVOTION_IMPORT });
  };

  private updateDevotionImport = (draft: DevotionImportDraft): void => {
    this.setState((state) => ({
      devotionImport: { ...state.devotionImport, draft, replacePending: false },
    }));
  };

  /** Lifting a block out of the draft keeps enough to put it back exactly
   * where it was, so "Remove" is a reversible edit rather than a small
   * irreversible loss of something the camera only saw once. */
  private removeDevotionBlock = (sectionId: string, blockId: string): void => {
    this.setState((state) => {
      const draft = state.devotionImport.draft;
      const section = draft?.template.sections.find((item) => item.id === sectionId);
      const index = section?.blocks.findIndex((block) => block.id === blockId) ?? -1;
      if (!draft || !section || index < 0) return null;
      const block = section.blocks[index];
      const answers = { ...draft.answers };
      const answer = answers[blockId] || "";
      delete answers[blockId];
      return {
        devotionImport: {
          ...state.devotionImport,
          replacePending: false,
          removedBlocks: [...state.devotionImport.removedBlocks, { sectionId, index, block, answer }],
          draft: {
            ...draft,
            answers,
            template: {
              ...draft.template,
              sections: draft.template.sections.map((item) => item.id === sectionId
                ? { ...item, blocks: item.blocks.filter((candidate) => candidate.id !== blockId) }
                : item),
            },
          },
        },
      };
    });
  };

  private restoreDevotionBlock = (blockId: string): void => {
    this.setState((state) => {
      const draft = state.devotionImport.draft;
      const removed = state.devotionImport.removedBlocks.find((item) => item.block.id === blockId);
      if (!draft || !removed) return null;
      return {
        devotionImport: {
          ...state.devotionImport,
          removedBlocks: state.devotionImport.removedBlocks.filter((item) => item.block.id !== blockId),
          draft: {
            ...draft,
            answers: removed.answer ? { ...draft.answers, [blockId]: removed.answer } : draft.answers,
            template: {
              ...draft.template,
              sections: draft.template.sections.map((section) => {
                if (section.id !== removed.sectionId) return section;
                const blocks = [...section.blocks];
                blocks.splice(Math.min(removed.index, blocks.length), 0, removed.block);
                return { ...section, blocks };
              }),
            },
          },
        },
      };
    });
  };

  private editImportedDevotion = (): void => {
    const entry = this.devotionEntry(this.state.devotionDate);
    if (!entry?.template) return;
    this.releaseDevotionSource();
    this.setState({
      devotionCalendarOpen: false,
      devotionImport: {
        ...EMPTY_DEVOTION_IMPORT,
        phase: "review",
        draft: {
          date: entry.date,
          template: entry.template,
          answers: { ...entry.answers },
        },
      },
    });
    /* The stored page comes back with the draft, so re-checking a layout weeks
       later is the same job as checking it the day it was imported. */
    void readDevotionSource(entry.date)
      .then((page) => {
        if (!page || this.state.devotionImport.phase !== "review") return;
        this.adoptDevotionSource(page);
      })
      .catch(() => undefined);
  };

  private saveDevotionImport = (): void => {
    const draft = this.state.devotionImport.draft;
    if (!draft || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return;
    if (this.state.devotions[draft.date] && !this.state.devotionImport.replacePending) {
      this.setState((state) => ({
        devotionImport: { ...state.devotionImport, replacePending: true },
      }));
      return;
    }
    this.commitDevotionImport(draft);
  };

  private confirmDevotionReplace = (): void => {
    const draft = this.state.devotionImport.draft;
    if (draft) this.commitDevotionImport(draft);
  };

  private commitDevotionImport(draft: DevotionImportDraft): void {
    const now = new Date().toISOString();
    const entry: DevotionEntry = {
      v: 2,
      date: draft.date,
      answers: draft.answers,
      ref: draft.template.bibleText,
      template: draft.template,
      createdAt: now,
      updatedAt: now,
    };
    const page = this.devotionSourceBlob;
    this.releaseDevotionSource();
    this.setState((state) => {
      const devotions = { ...state.devotions, [entry.date]: entry };
      this.persistDevotions(devotions);
      return {
        devotions,
        devotionDate: entry.date,
        devotionMonth: monthKey(entry.date),
        devotionCalendarOpen: false,
        devotionSaveState: "Imported",
        devotionImport: EMPTY_DEVOTION_IMPORT,
        devotionSourceDates: page
          ? new Set(state.devotionSourceDates).add(entry.date)
          : state.devotionSourceDates,
      };
    });
    /* Saving the page is best-effort by design. It is a convenience for
       re-checking a transcription; the answers are the record, and they are
       already committed above whatever storage decides to do here. */
    if (page) {
      void writeDevotionSource({ date: entry.date, savedAt: now, ...page }).catch(() => {
        this.setState((state) => {
          const dates = new Set(state.devotionSourceDates);
          dates.delete(entry.date);
          return { devotionSourceDates: dates };
        });
      });
    }
  }

  /** Opens the passage a printed reference names. A devotion page is a list of
   * places to read, and in a Bible app each of those should be one tap from
   * the text rather than something to retype into search. */
  private openDevotionReference = (reference: string): void => {
    const parsed = scripture.parseReference(devotionReferenceQuery(reference));
    if (!parsed) return;
    if (this.state.narrow) this.closeSidePanel();
    void this.openAt(parsed.bookId, parsed.chapter, { verse: parsed.verse });
  };

  /** Hands the panel an object URL for the kept page. Ownership passes to the
   * caller, which revokes it when the day changes. */
  private loadDevotionSource = async (dateKey: string): Promise<DevotionSourceView | null> => {
    const page = await readDevotionSource(dateKey).catch(() => null);
    if (!page) return null;
    return { url: URL.createObjectURL(page.blob), width: page.width, height: page.height };
  };

  private devotionEntry(dateKey: string): DevotionEntry | undefined {
    return this.state.devotions[dateKey];
  }

  private setDevotionAnswer = (promptId: string, value: string): void => {
    const { current, devotionDate } = this.state;
    const ref = current ? scripture.refLabel(current.bookId, current.chapter) : null;
    this.setState((state) => {
      const existing = state.devotions[devotionDate] || emptyEntry(devotionDate, ref);
      return {
        devotions: {
          ...state.devotions,
          [devotionDate]: {
            ...existing,
            answers: { ...existing.answers, [promptId]: value },
            updatedAt: new Date().toISOString(),
          },
        },
        devotionSaveState: "Saving…",
      };
    });
    this.scheduleDevotionSave();
  };

  private scheduleDevotionSave(): void {
    if (this.devotionSaveTimer) clearTimeout(this.devotionSaveTimer);
    this.devotionSaveTimer = setTimeout(() => {
      this.persistDevotions(this.state.devotions);
      this.setState({ devotionSaveState: "Saved" });
      if (this.clearDevotionSave) clearTimeout(this.clearDevotionSave);
      this.clearDevotionSave = setTimeout(() => this.setState({ devotionSaveState: "" }), 2_200);
    }, 350);
  }

  /** Blank days are dropped so they never light up the calendar. */
  private persistDevotions(devotions: DevotionStore): void {
    const kept: DevotionStore = {};
    Object.entries(devotions).forEach(([dateKey, entry]) => {
      if (hasContent(entry)) kept[dateKey] = entry;
    });
    this.writeJson(STORAGE.devotions, kept);
  }

  private clearDevotionEntry = (): void => {
    const { devotionDate } = this.state;
    const entry = this.state.devotions[devotionDate];
    if (!entry) return;
    this.pendingDevotionUndo = entry;
    this.pendingDevotionSourceUndo = null;
    /* Held in memory, not deleted, until the undo window closes — an undo that
       brought back the page but not its photo would be a partial restore. */
    void readDevotionSource(devotionDate)
      .then((page) => {
        if (this.pendingDevotionUndo?.date !== devotionDate) return;
        this.pendingDevotionSourceUndo = page;
        return page ? deleteDevotionSource(devotionDate) : undefined;
      })
      .catch(() => undefined);
    this.setState((state) => {
      const devotions = { ...state.devotions };
      delete devotions[devotionDate];
      this.persistDevotions(devotions);
      const devotionSourceDates = new Set(state.devotionSourceDates);
      devotionSourceDates.delete(devotionDate);
      return {
        devotions,
        devotionSourceDates,
        devotionSaveState: "",
        toast: { message: "Devotion cleared.", undo: true, kind: "devotion" as const },
      };
    });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.pendingDevotionSourceUndo = null;
      this.setState({ toast: null });
    }, 7_000);
  };

  private undoDevotionClear = (): void => {
    const entry = this.pendingDevotionUndo;
    const page = this.pendingDevotionSourceUndo;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (!entry) {
      this.setState({ toast: null });
      return;
    }
    this.pendingDevotionUndo = null;
    this.pendingDevotionSourceUndo = null;
    if (page) void writeDevotionSource(page).catch(() => undefined);
    this.setState((state) => {
      const devotions = { ...state.devotions, [entry.date]: entry };
      this.persistDevotions(devotions);
      const devotionSourceDates = new Set(state.devotionSourceDates);
      if (page) devotionSourceDates.add(entry.date);
      return { devotions, devotionSourceDates, toast: null };
    });
  };

  private pickResult(result: SearchResult): void {
    this.closeSpotlight();
    if (this.state.sourceId !== "mdesv") {
      scripture.setEnglishSource("mdesv");
      this.setState({ sourceId: "mdesv" }, () => {
        void this.openAt(result.bookId, result.chapter, { verse: result.verse });
      });
      return;
    }
    void this.openAt(result.bookId, result.chapter, { verse: result.verse });
  }

  private highlightSearchText(value: string): ReactNode {
    const terms = this.state.query
      .replace(/[“”‘’'".,;:!?()[\]{}]/g, " ")
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 1)
      .sort((left, right) => right.length - left.length);
    if (!terms.length) return value;
    const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
    return value.split(pattern).map((part, index) =>
      terms.some((term) => term.toLowerCase() === part.toLowerCase())
        ? <mark key={`${part}-${index}`}>{part}</mark>
        : part,
    );
  }

  private exportBackup = (): void => {
    const payload = {
      app: "bible-os",
      schema: 3,
      exportedAt: new Date().toISOString(),
      prefs: this.state.preferences,
      annotations: this.state.annotations,
      devotions: this.state.devotions,
      position: this.readJson<SavedPosition>(STORAGE.position),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "parallel-bible-backup.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 4_000);
    this.flash("Backup exported.");
  };

  private onImportFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as {
          annotations?: Annotation[];
          devotions?: DevotionStore;
          prefs?: Partial<Preferences>;
        };
        const annotations = Array.isArray(data.annotations) ? data.annotations : [];
        const preferences = { ...this.state.preferences, ...(data.prefs || {}) };
        // Schema 1 backups predate devotions; absent is not empty-on-purpose.
        const devotions = data.devotions && typeof data.devotions === "object" && !Array.isArray(data.devotions)
          ? data.devotions
          : this.state.devotions;
        this.persistAnnotations(annotations);
        this.persistDevotions(devotions);
        this.writeJson(STORAGE.preferences, preferences);
        this.setState({ annotations, devotions, preferences });
        this.flash(`Backup imported — ${annotations.length} entries.`);
      } catch {
        this.flash("That file could not be read.");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  };

  private flash(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.setState({ toast: { message, undo: false } });
    this.toastTimer = setTimeout(() => this.setState({ toast: null }), 3_400);
  }

  private commitKey = (): void => {
    const key = this.state.keyDraft.trim();
    if (!key) return;
    scripture.setEsvKey(key);
    scripture.setEnglishSource("esvapi");
    this.setState({ keyField: false, keyDraft: "", menu: null });
    this.reloadCurrent("Reading the ESV from api.esv.org.");
  };

  private reloadCurrent(message: string): void {
    this.searchResponses.clear();
    this.flash(message);
    const { current } = this.state;
    if (current) void this.openAt(current.bookId, current.chapter);
  }

  private segments(block: ParagraphBlock, language: Language): Segment[] {
    const side = block[language];
    if (!side.text) return [];
    const annotations = this.state.annotations.filter(
      (annotation): annotation is HighlightAnnotation =>
        annotation.kind === "highlight" && annotation.paraId === block.id,
    );
    const own = annotations.filter((annotation) => annotation.lang === language);
    const linked = annotations
      .filter((annotation) => annotation.lang !== language)
      .flatMap((annotation) => {
        const first = side.verses.find((verse) => verse.n === annotation.vs);
        const last = side.verses.find((verse) => verse.n === annotation.ve) || first;
        return first && last ? [{
          id: annotation.id,
          start: first.off,
          end: last.end,
          ref: scripture.refLabel(annotation.bookId, annotation.chapter, annotation.vs, annotation.ve),
        }] : [];
      });
    const cuts = new Set([0, side.text.length]);
    side.verses.forEach((verse) => cuts.add(verse.off));
    own.forEach((annotation) => {
      cuts.add(Math.max(0, Math.min(side.text.length, annotation.start)));
      cuts.add(Math.max(0, Math.min(side.text.length, annotation.end)));
    });
    linked.forEach((range) => {
      cuts.add(range.start);
      cuts.add(range.end);
    });

    const points = [...cuts].filter((point) => point >= 0 && point <= side.text.length).sort((a, b) => a - b);
    const output: Segment[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (end <= start) continue;
      const verse = side.verses.find((candidate) => start >= candidate.off && start < candidate.end)
        || side.verses.at(-1);
      const annotation = own.find((candidate) => candidate.start <= start && candidate.end >= end);
      const linkedRange = annotation
        ? undefined
        : linked.find((candidate) => candidate.start <= start && candidate.end >= end);
      const isVerseStart = Boolean(verse && start === verse.off);
      output.push({
        off: start,
        text: side.text.slice(start, end),
        vnum: verse?.n || null,
        showNum: this.state.preferences.showVerseNumbers && isVerseStart,
        verseKey: isVerseStart ? `${block.key}:${verse?.n}:${language}` : null,
        annotationId: annotation?.id || linkedRange?.id || null,
        linked: Boolean(linkedRange),
        linkTitle: linkedRange
          ? `Linked annotation — highlighted in the other translation at ${linkedRange.ref}`
          : null,
        aria: annotation
          ? `Highlight, ${scripture.refLabel(annotation.bookId, annotation.chapter, annotation.vs, annotation.ve)}`
          : null,
        dot: Boolean(annotation?.note && annotation.end <= end),
      });
    }
    return output;
  }

  private openAnnotation = (id: string): void => {
    this.setState({ editorMode: "write" }, () => this.openNotes(id));
  };

  private focusAnnotation(annotation: HighlightAnnotation): void {
    this.setState({ activeId: annotation.id, editorMode: "write" });
    const element = document.querySelector<HTMLElement>(`[data-pk="${annotation.paraId}"]`);
    if (element) this.scrollToElement(element);
    else void this.openAt(annotation.bookId, annotation.chapter, {
      verse: annotation.vs,
      paragraphId: annotation.paraId,
    });
  }

  private selectSource(source: EnglishSourceId): void {
    const key = scripture.getEsvKey();
    if (source === "esvapi" && !key) {
      this.setState({ keyField: true, keyDraft: "" });
      return;
    }
    scripture.setEnglishSource(source);
    this.setState({ menu: null, sourceId: source });
    this.reloadCurrent(source === "web" ? "Reading the public-domain English text." : "Reading the ESV.");
  }

  private handleSearchSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const reference = scripture.parseReference(this.state.query);
    if (reference) {
      this.closeSpotlight();
      void this.openAt(reference.bookId, reference.chapter, { verse: reference.verse });
    } else {
      const index = Math.min(this.state.activeSearchIndex, Math.max(0, this.state.results.length - 1));
      this.state.results[index]?.go();
    }
  };

  private pickChapter = (bookId: string, chapter: number): void => {
    this.setState({ menu: null });
    void this.openAt(bookId, chapter);
  };

  private renderChapterPicker(currentLabel: string, currentLabelZh: string): ReactNode {
    const {
      compact,
      current,
      menu,
      narrow,
      narrowLanguage,
    } = this.state;
    const active = current || { bookId: "MAT", chapter: 1 };
    return (
      <ChapterPicker
        compact={compact}
        currentBookId={active.bookId}
        currentChapter={active.chapter}
        currentLabel={currentLabel}
        currentLabelZh={currentLabelZh}
        narrow={narrow}
        narrowLanguage={narrowLanguage}
        onOpenChange={(open) => {
          if (open && this.state.sidePanelOpen) this.closeSidePanel(false);
          this.setState({ menu: open ? "chapters" : null });
        }}
        onPick={this.pickChapter}
        open={menu === "chapters"}
        readerScrimInset={0}
      />
    );
  }

  private renderTranslationSwitch(): ReactNode {
    return (
      <div aria-label="Translation" className="segmented translation-switch" role="group">
        {(["en", "zh"] as const).map((language) => (
          <button
            aria-pressed={this.state.narrowLanguage === language}
            className={this.state.narrowLanguage === language ? "active" : ""}
            key={language}
            onClick={() => this.setState({ narrowLanguage: language })}
            type="button"
          >
            {language === "en" ? "English" : "中文"}
          </button>
        ))}
      </div>
    );
  }

  private renderSettingsContent(sourceId: EnglishSourceId): ReactNode {
    const { keyDraft, keyField, narrow, preferences } = this.state;
    const sources: { id: EnglishSourceId; label: string; hint: string }[] = [
      { id: "web", label: "World English Bible", hint: "Public domain" },
      { id: "mdesv", label: "ESV — hosted copy", hint: "mdbible plain text, personal use" },
      {
        id: "esvapi",
        label: "ESV — api.esv.org",
        hint: scripture.getEsvKey() ? "Using your saved key" : "Needs your own key",
      },
    ];

    return (
      <div className="notes-content utility-settings">
        {narrow && (
          <section className="settings-section">
            <p className="menu-eyebrow">Translation</p>
            {this.renderTranslationSwitch()}
          </section>
        )}

        {!narrow && (
          <section className="settings-section">
            <p className="menu-eyebrow">Language display</p>
            {([
              ["both", "Both, side by side"],
              ["en", "English only"],
              ["zh", "Chinese only"],
            ] as [LanguageMode, string][]).map(([mode, label]) => (
              <button
                aria-checked={preferences.langMode === mode}
                className="menu-choice"
                key={mode}
                onClick={() => this.setPreferences({ langMode: mode })}
                role="radio"
                type="button"
              >
                {label}<span aria-hidden="true">{preferences.langMode === mode ? "●" : ""}</span>
              </button>
            ))}
          </section>
        )}

        <section className="settings-section">
          <p className="menu-eyebrow">English source</p>
          {sources.map((source) => (
            <button
              aria-checked={sourceId === source.id}
              className="source-choice"
              key={source.id}
              onClick={() => this.selectSource(source.id)}
              role="radio"
              type="button"
            >
              <span><span>{source.label}</span><small>{source.hint}</small></span>
              <span aria-hidden="true" className="choice-dot">{sourceId === source.id ? "●" : ""}</span>
            </button>
          ))}
          {keyField ? (
            <>
              <div className="key-entry">
                <input
                  aria-label="ESV API key"
                  onChange={(event) => this.setState({ keyDraft: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      this.commitKey();
                    }
                  }}
                  placeholder="Paste your ESV API key"
                  type="password"
                  value={keyDraft}
                />
                <button onClick={this.commitKey} type="button">Use</button>
              </div>
              <p className="key-note">
                Stays in this browser only. Free keys for non-commercial use at{" "}
                <a href="https://api.esv.org/" rel="noopener noreferrer" target="_blank">api.esv.org</a>.
              </p>
            </>
          ) : (
            <div className="key-actions">
              <button onClick={() => this.setState({ keyField: true, keyDraft: "" })} type="button">
                {scripture.getEsvKey() ? "Replace API key" : "Add an ESV API key"}
              </button>
              {scripture.getEsvKey() && (
                <button
                  className="danger-quiet"
                  onClick={() => {
                    scripture.setEsvKey("");
                    scripture.setEnglishSource("web");
                    this.setState({ keyField: false, keyDraft: "" });
                    this.reloadCurrent("Key forgotten — back to the public-domain text.");
                  }}
                  type="button"
                >
                  Forget key
                </button>
              )}
            </div>
          )}
        </section>

        <section className="settings-section">
          <p className="menu-eyebrow">Text size</p>
          <div className="size-control">
            <button
              aria-label="Decrease text size"
              onClick={() => {
                const index = SIZES.indexOf(preferences.size);
                this.setPreferences({ size: SIZES[Math.max(0, (index < 0 ? 3 : index) - 1)] });
              }}
              type="button"
            >A−</button>
            <div className="size-track"><span /></div>
            <button
              aria-label="Increase text size"
              onClick={() => {
                const index = SIZES.indexOf(preferences.size);
                this.setPreferences({ size: SIZES[Math.min(SIZES.length - 1, (index < 0 ? 3 : index) + 1)] });
              }}
              type="button"
            >A+</button>
          </div>
          <p className="menu-eyebrow">Line spacing</p>
          <div aria-label="Line spacing" className="spacing-control" role="group">
            {SPACING.map((option) => (
              <button
                aria-pressed={Math.abs(preferences.lh - option.value) < 0.01}
                className={Math.abs(preferences.lh - option.value) < 0.01 ? "active" : ""}
                key={option.label}
                onClick={() => this.setPreferences({ lh: option.value })}
                type="button"
              >{option.label}</button>
            ))}
          </div>
          <label className="toggle-row">
            Verse numbers
            <input
              checked={preferences.showVerseNumbers}
              onChange={() => this.setPreferences({ showVerseNumbers: !preferences.showVerseNumbers })}
              type="checkbox"
            />
          </label>
          <label className="toggle-row">
            Section headings
            <input
              checked={preferences.showHeadings}
              onChange={() => this.setPreferences({ showHeadings: !preferences.showHeadings })}
              type="checkbox"
            />
          </label>
        </section>
      </div>
    );
  }

  private renderSearchContent(): ReactNode {
    const {
      activeSearchIndex,
      query,
      referenceHint,
      results,
      resultsNote,
      resultsOpen,
      searchStale,
      searching,
    } = this.state;

    return (
      <div className="utility-search">
        <div className="spotlight-head">
          <form className="spotlight-form" onSubmit={this.handleSearchSubmit} role="search">
            <span aria-hidden="true" className="search-icon" />
            <input
              aria-activedescendant={this.searchOptionCount() ? this.activeSearchOptionId() : undefined}
              aria-autocomplete="list"
              aria-controls="search-results"
              aria-expanded={resultsOpen}
              aria-label="Search a passage reference or keyword"
              onChange={(event) => {
                this.setState({ query: event.target.value });
                this.runSearch(event.target.value);
              }}
              onKeyDown={this.onSearchInputKeyDown}
              placeholder="Search a passage or keyword"
              ref={this.spotlightInputRef}
              role="combobox"
              spellCheck={false}
              type="search"
              value={query}
            />
            {query && (
              <button aria-label="Clear search" className="search-clear" onClick={this.clearSearch} type="button">
                <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="13">
                  <path d="m7.5 7.5 9 9m0-9-9 9" />
                </svg>
              </button>
            )}
          </form>
        </div>

        <p aria-live="polite" className="sr-only" role="status">
          {searching
            ? "Searching the Bible"
            : referenceHint
              ? `Reference ready: ${referenceHint.label}`
              : results.length
                ? `${results.length} ESV search results`
                : resultsNote}
        </p>

        {!query && (
          <div className="search-welcome utility-search-welcome">
            <p>Find a passage, chapter, or word without leaving the reader.</p>
            <p className="search-shortcuts"><kbd>↑</kbd><kbd>↓</kbd> to move <span /> <kbd>↵</kbd> to open</p>
          </div>
        )}

        {searching && <span aria-hidden="true" className="search-progress" />}

        {resultsOpen && (
          <div
            aria-busy={searching}
            aria-label="Search results"
            className={`spotlight-results utility-search-results${searchStale ? " stale" : ""}`}
            id="search-results"
            role="listbox"
          >
            {referenceHint && (
              <button
                aria-selected={activeSearchIndex === 0}
                className={`reference-result${activeSearchIndex === 0 ? " active" : ""}`}
                id="search-option-0"
                onClick={() => {
                  this.closeSpotlight();
                  void this.openAt(referenceHint.bookId, referenceHint.chapter, { verse: referenceHint.verse });
                }}
                onMouseEnter={() => this.setState({ activeSearchIndex: 0 })}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span className="reference-arrow" aria-hidden="true">→</span>
                <span>
                  <span className="go-to">Open passage</span>
                  <span className="result-ref-large">{referenceHint.label}</span>
                  <span className="result-ref-zh">{referenceHint.labelZh}</span>
                </span>
                <kbd aria-hidden="true">↵</kbd>
              </button>
            )}
            {results.map((result, index) => {
              const optionIndex = index + (referenceHint ? 1 : 0);
              return (
                <button
                  aria-selected={activeSearchIndex === optionIndex}
                  className={`search-result${activeSearchIndex === optionIndex ? " active" : ""}`}
                  id={`search-option-${optionIndex}`}
                  key={`${result.ref}-${result.verse}`}
                  onClick={result.go}
                  onMouseEnter={() => this.setState({ activeSearchIndex: optionIndex })}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <span className="result-meta"><span>{result.ref}</span></span>
                  <span className="result-english">{this.highlightSearchText(result.en)}</span>
                </button>
              );
            })}
            {searching && !results.length && (
              <div aria-hidden="true" className="search-loading-state"><span /><span /><span /></div>
            )}
            {resultsNote && (
              <div className="results-note">
                <p>{resultsNote}</p>
                {resultsNote.startsWith("Search couldn’t") && (
                  <button onClick={this.retrySearch} type="button">Retry</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  private renderHeader(
    currentLabel: string,
    currentLabelZh: string,
  ): ReactNode {
    const { compact, menu, narrow, sidePanelOpen } = this.state;
    const headerBlocked = (narrow && sidePanelOpen) || (compact && menu === "chapters");

    return (
      <header className="app-header">
        <div className="header-grid">
          <div className="brand-block" inert={headerBlocked || undefined}>
            <a
              className="brand"
              href="#/"
              onClick={(event) => {
                event.preventDefault();
                void this.openAt("MAT", 1);
              }}
            >
              Bible OS
            </a>
          </div>

          <div inert={headerBlocked || undefined}>
            {this.renderChapterPicker(currentLabel, currentLabelZh)}
          </div>

          <button
            aria-expanded={sidePanelOpen}
            aria-haspopup={narrow ? "dialog" : undefined}
            aria-label={sidePanelOpen ? "Close Bible tools" : "Open Bible tools"}
            className="icon-button tools-panel-trigger"
            onClick={this.toggleSidePanel}
            ref={this.sidePanelTriggerRef}
            title="Bible tools"
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="16">
              <rect height="17" rx="2.5" width="19" x="2.5" y="3.5" />
              <path d="M15.5 3.5v17M18.5 9h0M18.5 12h0M18.5 15h0" />
            </svg>
          </button>
        </div>
      </header>
    );
  }

  private renderSegments(block: ParagraphBlock, language: Language): ReactNode {
    return this.segments(block, language).map((segment, index) => {
      const shared = {
        "data-lang": language,
        "data-off": segment.off,
        "data-para": block.id,
        "data-vk": segment.verseKey || undefined,
      };
      let text: ReactNode;
      if (segment.annotationId) {
        text = (
          <span
            {...shared}
            aria-label={segment.aria || undefined}
            className={segment.linked ? "linked-annotation" : "highlight"}
            data-ann={segment.annotationId}
            onClick={() => this.openAnnotation(segment.annotationId as string)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLSpanElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.openAnnotation(segment.annotationId as string);
              }
            }}
            role="button"
            tabIndex={0}
            title={segment.linkTitle || undefined}
          >
            {segment.text}
          </span>
        );
      } else {
        text = <span {...shared}>{segment.text}</span>;
      }

      return (
        <span
          className={`segment-wrap${this.state.landingVerseKey === `${block.key}:${segment.vnum}` ? " search-landing" : ""}`}
          key={`${language}-${segment.off}-${index}`}
        >
          {segment.showNum && <span aria-hidden="true" className="verse-number">{segment.vnum}</span>}
          {text}
          {segment.dot && segment.annotationId && (
            <span
              aria-label="Open note"
              className="note-dot"
              data-ann={segment.annotationId}
              onClick={() => this.openAnnotation(segment.annotationId as string)}
              onKeyDown={(event: ReactKeyboardEvent<HTMLSpanElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  this.openAnnotation(segment.annotationId as string);
                }
              }}
              role="button"
              tabIndex={0}
            />
          )}
        </span>
      );
    });
  }

  private renderChapter(chapter: LoadedChapter, first: boolean, showEnglish: boolean, showChinese: boolean): ReactNode {
    const titleClass = first ? "chapter-title first" : "chapter-title";
    const titleLabelZh = scripture.refLabelZh(chapter.bookId, chapter.chapter);
    if (chapter.status !== "ready" || !chapter.data) {
      return (
        <div
          className={`chapter-block ${chapter.status}`}
          data-chapter-key={chapter.key}
          key={chapter.key}
        >
          <div className={titleClass} data-ck={chapter.key}>
            <h2>
              {showEnglish && <span>{chapter.label}</span>}
              {showChinese && <span className="chapter-title-zh" lang="zh">{titleLabelZh}</span>}
            </h2>
          </div>
          {chapter.status === "error" ? (
            <div className="chapter-error" role="alert">
              <span>This chapter didn’t load.</span>
              <button onClick={() => this.retryChapter(chapter.key)} type="button">Retry</button>
            </div>
          ) : (
            <>
              <div
                aria-label={`Loading ${chapter.label}`}
                aria-live="polite"
                className="chapter-loading-state"
                role="status"
              >
                <span aria-hidden="true" className="chapter-loading-spinner" />
                <span>Loading verses</span>
              </div>
              <div className="reading-grid skeleton-grid">
                {showEnglish && <ReadingSkeleton paragraphs={[6, 5, 4]} />}
                {showChinese && <ReadingSkeleton paragraphs={[5, 4, 3]} />}
              </div>
            </>
          )}
        </div>
      );
    }

    /* An empty column is indistinguishable from a translation that has nothing
       to say here, so a request that never arrived says so and offers the way
       back rather than leaving the reader to wonder. */
    const missing = (chapter.data.missing || []).filter(
      (language) => language === "en" ? showEnglish : showChinese,
    );

    return (
      <div className="chapter-block ready" data-chapter-key={chapter.key} key={chapter.key}>
        {chapter.data.blocks.map((block) => {
          if (block.type === "title") {
            /* A fragment, not a wrapper: an element here would become the
               title's containing block and confine the sticky dock to it. */
            return (
              <Fragment key={block.id}>
                <div className={titleClass} data-ck={chapter.key}>
                  <h2>
                    {showEnglish && <span>{block.text}</span>}
                    {showChinese && <span className="chapter-title-zh" lang="zh">{titleLabelZh}</span>}
                  </h2>
                </div>
                {missing.length > 0 && (
                  <p className="chapter-partial" role="status">
                    <span>
                      {missing.includes("zh") && !missing.includes("en")
                        ? "The Chinese text didn’t arrive for this chapter."
                        : missing.includes("en") && !missing.includes("zh")
                          ? "The English text didn’t arrive for this chapter."
                          : "One of the translations didn’t arrive for this chapter."}
                    </span>
                    <button onClick={() => this.retryChapter(chapter.key)} type="button">Retry</button>
                  </p>
                )}
              </Fragment>
            );
          }
          if (block.type === "heading") {
            if (!this.state.preferences.showHeadings) return null;
            return (
              <div className="reading-grid heading-grid" key={block.id}>
                {showEnglish && <h3 data-ck={chapter.key}>{block.en}</h3>}
                {showChinese && <h3 lang="zh">{block.zh}</h3>}
              </div>
            );
          }
          return (
            <div className="reading-grid paragraph-grid" key={block.id}>
              {showEnglish && (
                <p className="scripture english" data-ck={chapter.key} data-pk={block.id} lang="en">
                  {this.renderSegments(block, "en")}
                </p>
              )}
              {showChinese && (
                <p className="scripture chinese" data-pk={block.id} lang="zh">
                  {this.renderSegments(block, "zh")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  private renderNotesContent(currentLabel: string, englishLabel: string): ReactNode {
    const { activeId, annotations, current, editorMode, saveState } = this.state;
    const currentKey = current ? `${current.bookId}/${current.chapter}` : null;
    const active = activeId
      ? annotations.find((annotation): annotation is HighlightAnnotation =>
        annotation.id === activeId && annotation.kind === "highlight",
      )
      : null;
    const chapterAnnotations = currentKey ? this.annotationsForChapter(currentKey) : [];

    return (
      <div className="notes-panel-view">
        <div className="notes-content">
          {active ? (
            <div>
              <button className="back-button" onClick={() => this.setState({ activeId: null })} type="button">
                ← All notes in this chapter
              </button>
              <p className="annotation-ref">
                {scripture.refLabel(active.bookId, active.chapter, active.vs, active.ve)}
              </p>
              <p className="annotation-language">
                {active.lang === "en" ? englishLabel : "和合本"} ·{" "}
                {scripture.refLabelZh(active.bookId, active.chapter, active.vs, active.ve)}
              </p>
              <blockquote className="annotation-quote">{active.quote}</blockquote>
              <p className="linked-explainer">
                Linked in the other translation at{" "}
                <span>{scripture.refLabelZh(active.bookId, active.chapter, active.vs, active.ve)}</span>
                {" "}— wording is not matched word for word.
              </p>
              <div aria-label="Note editor mode" className="segmented editor-mode" role="group">
                <button
                  aria-pressed={editorMode === "write"}
                  className={editorMode === "write" ? "active" : ""}
                  onClick={() => this.setState({ editorMode: "write" })}
                  type="button"
                >Write</button>
                <button
                  aria-pressed={editorMode === "preview"}
                  className={editorMode === "preview" ? "active" : ""}
                  onClick={() => this.setState({ editorMode: "preview" })}
                  type="button"
                >Preview</button>
              </div>
              {editorMode === "write" ? (
                <textarea
                  aria-label="Note"
                  className="note-editor"
                  onChange={(event) => this.updateNote(active.id, event.target.value)}
                  placeholder="Markdown welcome — **bold**, *italics*, # heading, - list, > quote, [link](https://…)"
                  value={active.note}
                />
              ) : (
                <div
                  className="note-preview"
                  dangerouslySetInnerHTML={{
                    __html: active.note ? markdown(active.note) : '<p class="empty-preview">Nothing to preview yet.</p>',
                  }}
                />
              )}
              <div className="note-editor-footer">
                <span aria-live="polite">{saveState}</span>
                <button onClick={() => this.deleteAnnotation(active.id)} type="button">Delete annotation</button>
              </div>
            </div>
          ) : (
            <div>
              <p className="notes-eyebrow">Chapter note · {currentLabel}</p>
              <textarea
                aria-label="Chapter note"
                className="chapter-note"
                onChange={(event) => currentKey && this.setChapterNote(currentKey, event.target.value)}
                placeholder="A note for this whole chapter"
                value={currentKey ? this.chapterNote(currentKey) : ""}
              />
              <p aria-live="polite" className="save-state">{saveState}</p>
              <p className="notes-eyebrow">Highlights</p>
              {chapterAnnotations.length ? chapterAnnotations.map((annotation) => (
                <button
                  className="annotation-list-item"
                  key={annotation.id}
                  onClick={() => this.focusAnnotation(annotation)}
                  type="button"
                >
                  <span className="annotation-list-meta">
                    <span>{scripture.refLabel(annotation.bookId, annotation.chapter, annotation.vs, annotation.ve)}</span>
                    <span>{annotation.lang === "en" ? englishLabel : "和合本"}</span>
                    {annotation.note && <span aria-label="has a note" className="note-present" />}
                  </span>
                  <span className="annotation-list-quote">
                    {annotation.quote.length > 110 ? `${annotation.quote.slice(0, 110)}…` : annotation.quote}
                  </span>
                  {annotation.note && (
                    <span className="annotation-list-note">
                      {annotation.note.replace(/\s+/g, " ").slice(0, 90)}{annotation.note.length > 90 ? "…" : ""}
                    </span>
                  )}
                </button>
              )) : (
                <p className="no-highlights">
                  No highlights in this chapter yet. Select any words and press <kbd>H</kbd> to highlight or{" "}
                  <kbd>N</kbd> to add a note.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="notes-footer">
          <span>Saved in this browser</span>
          <button onClick={this.exportBackup} type="button">Export backup</button>
          <button onClick={() => this.fileRef.current?.click()} type="button">Import</button>
        </div>
      </div>
    );
  }

  private renderSidePanelIcon(view: SidePanelView): ReactNode {
    if (view === "search") {
      return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
    }
    if (view === "settings") {
      return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M10 17h10M4 17h2" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>;
    }
    if (view === "notes") {
      return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M6 3.5h9l3 3V20H6z" /><path d="M14.5 3.5V7H18M9 11h6M9 15h6" /></svg>;
    }
    return <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><rect height="16" rx="2.5" width="18" x="3" y="5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;
  }

  private renderSidePanel(
    currentLabel: string,
    englishLabel: string,
    sourceId: EnglishSourceId,
  ): ReactNode {
    const { narrow, sidePanelOpen, sidePanelView } = this.state;
    if (!sidePanelOpen) return null;

    const destinations: { id: SidePanelView; label: string; shortcut?: string }[] = [
      { id: "search", label: "Search", shortcut: "⌘K" },
      { id: "settings", label: "Display" },
      { id: "notes", label: "Notes" },
      { id: "devotion", label: "Devotion" },
    ];
    const activeLabel = destinations.find((destination) => destination.id === sidePanelView)?.label || "Tools";
    let content: ReactNode;

    if (sidePanelView === "search") content = this.renderSearchContent();
    else if (sidePanelView === "settings") content = this.renderSettingsContent(sourceId);
    else if (sidePanelView === "notes") content = this.renderNotesContent(currentLabel, englishLabel);
    else {
      content = (
        <DevotionPanel
          calendarOpen={this.state.devotionCalendarOpen}
          canOpenReference={canOpenDevotionReference}
          date={this.state.devotionDate}
          entry={this.devotionEntry(this.state.devotionDate)}
          hasEntry={(dateKey) => hasContent(this.state.devotions[dateKey])}
          importUi={this.state.devotionImport}
          mode={this.state.devotionMode}
          month={this.state.devotionMonth}
          monthDirection={this.state.devotionMonthDir}
          onAnswerChange={this.setDevotionAnswer}
          onCancelImport={this.cancelDevotionImport}
          onClear={this.clearDevotionEntry}
          onConfirmReplace={this.confirmDevotionReplace}
          onEditImported={this.editImportedDevotion}
          onLoadSource={this.loadDevotionSource}
          onModeChange={(devotionMode) => this.setState({ devotionMode })}
          onOpenReference={this.openDevotionReference}
          onPhotoSelected={this.startDevotionPhoto}
          onPickDate={this.pickDevotionDate}
          onRemoveBlock={this.removeDevotionBlock}
          onRestoreBlock={this.restoreDevotionBlock}
          onSaveImport={this.saveDevotionImport}
          onStepMonth={this.stepDevotionMonth}
          onToggleCalendar={this.toggleDevotionCalendar}
          onUpdateImportDraft={this.updateDevotionImport}
          saveState={this.state.devotionSaveState}
          sourceAvailable={this.state.devotionSourceDates.has(this.state.devotionDate)}
        />
      );
    }

    const panel = (
      <FluidSurface
        ariaLabel={`Bible tools: ${activeLabel}`}
        ariaModal={narrow}
        className="notes-panel utility-panel"
        draggable={narrow}
        edge="right"
        expandWidth={narrow ? undefined : this.state.preferences.panelWidth}
        key="utility-panel"
        onClick={(event) => event.stopPropagation()}
        onDismiss={this.closeSidePanel}
        onKeyDown={this.onSidePanelKeyDown}
        ref={this.sidePanelRef}
        role={narrow ? "dialog" : "complementary"}
        showHandle={narrow}
        transitionOverride={this.state.resizingPanel ? { duration: 0 } : undefined}
      >
        {this.renderPanelResizer()}
        <div className="utility-panel-header">
          <div>
            <p>Bible tools</p>
            <h2>{activeLabel}</h2>
          </div>
          <button
            aria-label="Close Bible tools"
            className="utility-panel-close"
            onClick={() => this.closeSidePanel()}
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 14 14" width="14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        {/* The thumb is placed from the active index rather than measured from
            the active button. A shared-layout animation reads viewport boxes,
            and the panel is still animating open when the nav first mounts, so
            it measured a stale position and flew in from outside the track. */}
        <nav
          aria-label="Bible tools"
          className="utility-panel-nav"
          style={{
            "--tab-count": destinations.length,
            "--tab-index": Math.max(0, destinations.findIndex((destination) => destination.id === sidePanelView)),
          } as CSSProperties}
        >
          {/* A div, not a span: `.utility-panel-nav span` forces position
              relative for the tab labels and would drag the thumb into flow. */}
          <div aria-hidden="true" className="utility-tab-thumb" />
          {destinations.map((destination) => {
            const active = sidePanelView === destination.id;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={active ? "active" : ""}
                key={destination.id}
                onClick={() => this.openSidePanel(destination.id)}
                type="button"
              >
                {this.renderSidePanelIcon(destination.id)}
                <span>{destination.label}</span>
                {destination.shortcut && <kbd>{destination.shortcut}</kbd>}
              </button>
            );
          })}
        </nav>

        <div className="utility-panel-stage">
          <AnimatePresence initial={false}>
            <motion.div
              animate={{ opacity: 1 }}
              className={`utility-panel-view ${sidePanelView}`}
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key={sidePanelView}
              transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
        </div>
      </FluidSurface>
    );

    return narrow ? (
      <FluidBackdrop className="notes-backdrop utility-backdrop" onDismiss={() => this.closeSidePanel()}>
        {panel}
      </FluidBackdrop>
    ) : panel;
  }

  render(): ReactNode {
    const {
      chapters,
      compact,
      current,
      menu,
      narrow,
      selectionToolbar,
      sidePanelOpen,
      sourceId,
      toast,
    } = this.state;
    const compactPickerOpen = compact && menu === "chapters";
    const languages = this.languages();
    const showEnglish = languages.includes("en");
    const showChinese = languages.includes("zh");
    const esvStatus = scripture.esvState();
    const usingEsv = sourceId !== "web" && esvStatus.ok;
    const englishLabel = usingEsv ? scripture.englishSource() : "WEB";
    const currentLabel = current ? scripture.refLabel(current.bookId, current.chapter) : "Loading";
    const currentLabelZh = current ? scripture.refLabelZh(current.bookId, current.chapter) : "载入中";

    return (
      <FluidProvider>
      <div className="app-shell">
        <div className="app-main">
          <div className="reader-workspace">
            {this.renderHeader(currentLabel, currentLabelZh)}
            <div
              aria-hidden={compactPickerOpen ? true : undefined}
              className="reader-with-notes"
              inert={compactPickerOpen ? true : undefined}
            >
              <main
                aria-hidden={narrow && sidePanelOpen ? true : undefined}
                className={`reader${this.state.atCanonEnd ? " canon-end" : ""}`}
                inert={narrow && sidePanelOpen ? true : undefined}
              >
                <div className="reader-inner">
                  {this.state.atCanonStart && <p className="canon-edge">Beginning of the canon</p>}
                  {chapters.map((chapter, index) =>
                    this.renderChapter(chapter, index === 0, showEnglish, showChinese),
                  )}
                  {this.state.atCanonEnd && <p className="canon-edge">End of the canon</p>}
                  {!esvStatus.ok && <p className="source-notice" role="status">{esvStatus.message}</p>}
                </div>
              </main>
            </div>
          </div>
        </div>

        {/* The desktop layer reserves a flex column while the panel itself is
            fixed to the viewport. Scripture can then grow, trim, or load
            without moving the panel, while app-main still reflows around it. */}
        <div
          aria-hidden={compactPickerOpen ? true : undefined}
          className={`side-panel-layer${!narrow && sidePanelOpen ? " open" : ""}`}
          inert={compactPickerOpen ? true : undefined}
        >
          <AnimatePresence>{this.renderSidePanel(currentLabel, englishLabel, sourceId)}</AnimatePresence>
        </div>

        {selectionToolbar && (
          <div
            aria-label="Selection actions"
            className="selection-toolbar"
            role="toolbar"
            style={{ top: selectionToolbar.top, left: selectionToolbar.left }}
          >
            {selectionToolbar.valid && selectionToolbar.draft ? (
              <>
                <button onClick={() => this.createAnnotation(selectionToolbar.draft as HighlightDraft, false)} type="button">
                  Highlight <kbd>H</kbd>
                </button>
                <span aria-hidden="true" className="toolbar-divider" />
                <button onClick={() => this.createAnnotation(selectionToolbar.draft as HighlightDraft, true)} type="button">
                  Add note <kbd>N</kbd>
                </button>
              </>
            ) : (
              <span className="invalid-selection">
                Keep a selection inside one aligned paragraph — cross a paragraph and it needs its own annotation.
              </span>
            )}
          </div>
        )}

        {toast && (
          <div className="toast" role="status">
            {toast.message}
            {toast.undo && toast.kind === "devotion" && (
              <button onClick={this.undoDevotionClear} type="button">Undo</button>
            )}
            {toast.undo && toast.kind !== "devotion" && (
              <button
                onClick={() => {
                  const annotation = this.pendingUndo;
                  if (this.toastTimer) clearTimeout(this.toastTimer);
                  if (!annotation) {
                    this.setState({ toast: null });
                    return;
                  }
                  this.pendingUndo = null;
                  this.setState((state) => {
                    const annotations = [...state.annotations, annotation];
                    this.persistAnnotations(annotations);
                    return { annotations, toast: null };
                  });
                }}
                type="button"
              >Undo</button>
            )}
          </div>
        )}

        <input
          accept="application/json"
          aria-hidden="true"
          className="file-input"
          onChange={this.onImportFile}
          ref={this.fileRef}
          tabIndex={-1}
          type="file"
        />
      </div>
      </FluidProvider>
    );
  }
}

/* Grouped into paragraphs so a chapter that has not arrived still occupies the
   shape of scripture — the placeholder fills exactly what it reserves, and the
   reader never scrolls into a held-open void. */
function ReadingSkeleton({ paragraphs }: { paragraphs: number[] }) {
  return (
    <div aria-hidden="true" className="reading-skeleton">
      {paragraphs.map((lines, group) => (
        <div className="skeleton-paragraph" key={group}>
          {Array.from({ length: lines }, (_, index) => <span key={index} />)}
        </div>
      ))}
    </div>
  );
}
