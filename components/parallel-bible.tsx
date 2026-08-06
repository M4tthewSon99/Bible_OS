"use client";

import {
  Component,
  createRef,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import {
  AnimatePresence,
  FluidBackdrop,
  FluidProvider,
  FluidSurface,
  SurfacePortal,
} from "@/components/fluid-surfaces";
import * as scripture from "@/lib/bible-source";
import type {
  Annotation,
  ChapterData,
  EnglishSourceId,
  HighlightAnnotation,
  HighlightDraft,
  Language,
  LanguageMode,
  ParagraphBlock,
  Preferences,
  SearchResult,
  Testament,
} from "@/lib/types";

const STORAGE = {
  preferences: "bibleos.prefs.v1",
  annotations: "bibleos.annotations.v1",
  position: "bibleos.position.v1",
};
const SIZES = [16, 17, 18, 19, 21, 23, 25];
const SPACING = [
  { label: "Snug", value: 1.55 },
  { label: "Normal", value: 1.72 },
  { label: "Roomy", value: 1.95 },
];
const MAX_LOADED = 8;
const HAS_CJK = /[\u3400-\u9fff]/;

interface LoadedChapter {
  key: string;
  bookId: string;
  chapter: number;
  status: "loading" | "ready" | "error";
  label: string;
  data?: ChapterData;
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
}

interface State {
  chapters: LoadedChapter[];
  current: CurrentChapter | null;
  preferences: Preferences;
  narrowLanguage: Language;
  narrow: boolean;
  compact: boolean;
  annotations: Annotation[];
  notesOpen: boolean;
  activeId: string | null;
  editorMode: "write" | "preview";
  saveState: string;
  menu: "settings" | "chapters" | null;
  navTestament: Testament;
  navOpenBooks: string[];
  sourceId: EnglishSourceId;
  keyField: boolean;
  keyDraft: string;
  query: string;
  spotlightOpen: boolean;
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
  loadingMore: boolean;
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
    },
    narrowLanguage: "en",
    narrow: false,
    compact: false,
    annotations: [],
    notesOpen: false,
    activeId: null,
    editorMode: "write",
    saveState: "",
    menu: null,
    navTestament: "new",
    navOpenBooks: [],
    sourceId: "web",
    keyField: false,
    keyDraft: "",
    query: "",
    spotlightOpen: false,
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
    loadingMore: false,
    atCanonStart: false,
    atCanonEnd: false,
  };

  private readonly fileRef = createRef<HTMLInputElement>();
  private readonly spotlightInputRef = createRef<HTMLInputElement>();
  private readonly searchTriggerRef = createRef<HTMLButtonElement>();
  private readonly spotlightRef = createRef<HTMLDivElement>();
  private readonly notesTriggerRef = createRef<HTMLButtonElement>();
  private readonly notesPanelRef = createRef<HTMLDivElement>();
  private readonly navListRef = createRef<HTMLDivElement>();
  private readonly navBookRef = createRef<HTMLDivElement>();
  private anchor: number | null = null;
  private busy: "next" | "prev" | null = null;
  private navScrollPending = false;
  private clearSave?: ReturnType<typeof setTimeout>;
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
  private searchOpener: HTMLElement | null = null;
  private notesOpener: HTMLElement | null = null;
  private readonly searchResponses = new Map<
    string,
    Awaited<ReturnType<typeof scripture.keywordSearch>>
  >();
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private wentDeep = false;

  componentDidMount(): void {
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("hashchange", this.onHash);
    document.addEventListener("selectionchange", this.onSelectionChange);
    document.addEventListener("mousedown", this.onDocumentMouseDown, true);

    this.setState({
      narrow: window.innerWidth < 1100,
      compact: window.innerWidth < 760,
      sourceId: scripture.englishSourceId(),
    });
    this.applyCssVariables();

    void scripture.ready().then(() => {
      const preferences = this.readJson<Partial<Preferences>>(STORAGE.preferences);
      const annotations = this.readJson<Annotation[]>(STORAGE.annotations);
      const position = this.readJson<SavedPosition>(STORAGE.position);
      this.setState(
        (state) => ({
          preferences: { ...state.preferences, ...(preferences || {}) },
          annotations: Array.isArray(annotations) ? annotations : [],
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
    window.removeEventListener("hashchange", this.onHash);
    document.removeEventListener("selectionchange", this.onSelectionChange);
    document.removeEventListener("mousedown", this.onDocumentMouseDown, true);
    if (this.scrollTick !== null) cancelAnimationFrame(this.scrollTick);
    [
      this.clearSave,
      this.positionTimer,
      this.saveTimer,
      this.searchTimer,
      this.searchIndicatorTimer,
      this.landingTimer,
      this.selectionTimer,
      this.toastTimer,
    ].forEach((timer) => timer && clearTimeout(timer));
    this.searchAbort?.abort();
    document.body.classList.remove("search-open");
    document.body.classList.remove("modal-open");
  }

  componentDidUpdate(): void {
    this.applyCssVariables();
    document.body.classList.toggle(
      "modal-open",
      this.state.spotlightOpen || (this.state.narrow && this.state.notesOpen),
    );
    if (this.navScrollPending) {
      const list = this.navListRef.current;
      const book = this.navBookRef.current;
      if (list && book) {
        this.navScrollPending = false;
        list.scrollTop = Math.max(0, book.offsetTop - list.clientHeight / 3);
      }
    }
    if (this.anchor !== null) {
      const delta = document.documentElement.scrollHeight - this.anchor;
      this.anchor = null;
      if (Math.abs(delta) > 2) window.scrollBy(0, delta);
    }

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

    if (this.state.spotlightOpen) {
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
    } catch {
      this.patchChapter(key, { status: "error" });
    }
  };

  private patchChapter(key: string, patch: Partial<LoadedChapter>): void {
    this.setState((state) => ({
      chapters: state.chapters.map((chapter) => chapter.key === key ? { ...chapter, ...patch } : chapter),
    }));
  }

  private retryChapter = (key: string): void => {
    const chapter = this.state.chapters.find((candidate) => candidate.key === key);
    if (!chapter) return;
    this.patchChapter(key, { status: "loading" });
    void this.fetchInto(key, chapter.bookId, chapter.chapter);
  };

  private extend = async (direction: "next" | "prev"): Promise<void> => {
    if (this.busy === direction) return;
    const { chapters } = this.state;
    if (!chapters.length || chapters.length >= MAX_LOADED) return;
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

    this.busy = direction;
    const key = `${reference.bookId}/${reference.chapter}`;
    const entry: LoadedChapter = {
      key,
      bookId: reference.bookId,
      chapter: reference.chapter,
      status: "loading",
      label: scripture.refLabel(reference.bookId, reference.chapter),
    };
    if (direction === "prev") this.anchor = document.documentElement.scrollHeight;
    this.setState((state) => ({
      chapters: direction === "next" ? [...state.chapters, entry] : [entry, ...state.chapters],
      loadingMore: direction === "next",
    }));

    try {
      const data = await scripture.getChapter(reference.bookId, reference.chapter);
      if (direction === "prev") this.anchor = document.documentElement.scrollHeight;
      this.patchChapter(key, { status: "ready", data });
    } catch {
      this.patchChapter(key, { status: "error" });
    } finally {
      this.busy = null;
      this.setState({ loadingMore: false }, () => this.trimLoaded(direction));
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
    if (direction === "next") this.anchor = document.documentElement.scrollHeight;
    this.setState({ chapters: keep });
  }

  private onScroll = (): void => {
    if (this.scrollTick !== null) return;
    this.scrollTick = requestAnimationFrame(() => {
      this.scrollTick = null;
      const documentElement = document.documentElement;
      const y = window.scrollY;
      const movingUp = y < (this.lastY ?? y) - 1;
      if (y > 700) this.wentDeep = true;
      if (y + window.innerHeight > documentElement.scrollHeight - 1_400) void this.extend("next");
      if (movingUp && y < 420 && this.wentDeep) void this.extend("prev");
      this.lastY = y;
      this.trackPosition();
    });
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
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  private onResize = (): void => {
    const narrow = window.innerWidth < 1100;
    const compact = window.innerWidth < 760;
    if (narrow !== this.state.narrow || compact !== this.state.compact) {
      this.setState({ narrow, compact });
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

    const position = {
      top: Math.max(64, rectangle.top - 46),
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
    if (openPanel && !this.state.notesOpen) {
      this.notesOpener = document.activeElement as HTMLElement | null;
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
        notesOpen: openPanel || state.notesOpen,
        activeId: openPanel ? id : state.activeId,
        editorMode: "write",
      };
    }, () => {
      window.getSelection()?.removeAllRanges();
      if (openPanel) {
        setTimeout(() => this.notesPanelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 60);
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (this.state.spotlightOpen) this.closeSpotlight();
      else this.openSpotlight();
      return;
    }
    if (event.key === "Escape") {
      if (this.state.spotlightOpen) this.closeSpotlight();
      else if (this.state.selectionToolbar) this.setState({ selectionToolbar: null });
      else if (this.state.menu) this.setState({ menu: null });
      else if (typing) target.blur();
      else if (this.state.notesOpen) this.closeNotes();
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
    if (!this.state.menu && !this.state.resultsOpen) return;
    const target = event.target as Element | null;
    if (!target?.closest?.("header")) this.setState({ menu: null, resultsOpen: false });
  };

  private openSpotlight = (): void => {
    if (this.state.spotlightOpen) {
      this.spotlightInputRef.current?.focus();
      return;
    }
    this.searchOpener = document.activeElement as HTMLElement | null;
    document.body.classList.add("search-open");
    this.setState({ spotlightOpen: true }, () => {
      setTimeout(() => this.spotlightInputRef.current?.focus(), 30);
    });
  };

  private closeSpotlight = (): void => {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.searchIndicatorTimer) clearTimeout(this.searchIndicatorTimer);
    this.searchAbort?.abort();
    this.searchToken = undefined;
    document.body.classList.remove("search-open");
    const opener = this.searchOpener || this.searchTriggerRef.current;
    this.setState({
      spotlightOpen: false,
      resultsOpen: false,
      query: "",
      results: [],
      resultsNote: "",
      searching: false,
      searchStale: false,
      activeSearchIndex: 0,
      referenceHint: null,
    });
    setTimeout(() => opener?.focus(), 0);
  };

  private searchCacheKey(query: string): string {
    return `${this.state.sourceId}:${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
  }

  private rememberSearchResponse(
    key: string,
    output: Awaited<ReturnType<typeof scripture.keywordSearch>>,
  ): void {
    this.searchResponses.delete(key);
    this.searchResponses.set(key, output);
    if (this.searchResponses.size > 20) {
      const oldest = this.searchResponses.keys().next().value;
      if (oldest) this.searchResponses.delete(oldest);
    }
  }

  private applySearchOutput(output: Awaited<ReturnType<typeof scripture.keywordSearch>>): void {
    const results = output.results.map((result) => ({
      ...result,
      go: () => this.pickResult(result),
    }));
    const resultsNote = output.scope === "cache"
      ? "Showing matches from chapters opened in this session."
      : output.scope === "partial"
        ? "Full search is unavailable. Results currently cover chapters opened in this session."
      : output.scope === "error"
        ? "Search couldn’t reach the full Bible index."
        : results.length
          ? ""
          : "No exact matches. Try a shorter phrase or a reference like “John 3:16”.";
    this.setState({
      searching: false,
      searchStale: false,
      results,
      resultsNote,
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
        const output = await scripture.keywordSearch(trimmed, 8, controller.signal);
        if (this.searchToken !== token) return;
        this.rememberSearchResponse(cacheKey, output);
        this.applySearchOutput(output);
      } catch (error) {
        if (controller.signal.aborted || this.searchToken !== token) return;
        this.applySearchOutput({ results: local, scope: local.length ? "cache" : "error" });
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

  private onSpotlightKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    this.trapFocus(event, this.spotlightRef.current);
  };

  private trapFocus(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null): void {
    if (event.key !== "Tab") return;
    const focusables = container?.querySelectorAll<HTMLElement>(
      'input, button:not([tabindex="-1"]):not([disabled])',
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

  private onNotesKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (this.state.narrow) this.trapFocus(event, this.notesPanelRef.current);
  };

  private openNotes = (activeId: string | null = this.state.activeId): void => {
    if (!this.state.notesOpen) this.notesOpener = document.activeElement as HTMLElement | null;
    this.setState({ notesOpen: true, activeId }, () => {
      if (this.state.narrow) {
        setTimeout(() => this.notesPanelRef.current?.querySelector<HTMLElement>("button")?.focus(), 30);
      }
    });
  };

  private closeNotes = (): void => {
    const opener = this.notesOpener;
    this.setState({ notesOpen: false, activeId: null }, () => {
      setTimeout(() => {
        const target = opener?.isConnected ? opener : this.notesTriggerRef.current;
        target?.focus();
      }, 0);
    });
  };

  private toggleNotes = (): void => {
    if (this.state.notesOpen) this.closeNotes();
    else this.openNotes();
  };

  private pickResult(result: SearchResult): void {
    this.closeSpotlight();
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

  private markdown(source: string): string {
    const escape = (value: string) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const inline = (value: string) => escape(value)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    const output: string[] = [];
    let list: "ul" | "ol" | null = null;
    const closeList = () => {
      if (list) output.push(`</${list}>`);
      list = null;
    };

    source.replace(/\r/g, "").split("\n").forEach((raw) => {
      const line = raw.trimEnd();
      if (!line.trim()) {
        closeList();
        return;
      }
      let match = line.match(/^(#{1,3})\s+(.*)$/);
      if (match) {
        closeList();
        output.push(`<h${match[1].length}>${inline(match[2])}</h${match[1].length}>`);
        return;
      }
      match = line.match(/^>\s?(.*)$/);
      if (match) {
        closeList();
        output.push(`<blockquote>${inline(match[1])}</blockquote>`);
        return;
      }
      match = line.match(/^[-*+]\s+(.*)$/);
      if (match) {
        if (list !== "ul") {
          closeList();
          output.push("<ul>");
          list = "ul";
        }
        output.push(`<li>${inline(match[1])}</li>`);
        return;
      }
      match = line.match(/^\d+[.)]\s+(.*)$/);
      if (match) {
        if (list !== "ol") {
          closeList();
          output.push("<ol>");
          list = "ol";
        }
        output.push(`<li>${inline(match[1])}</li>`);
        return;
      }
      closeList();
      output.push(`<p>${inline(line)}</p>`);
    });
    closeList();
    return output.join("");
  }

  private exportBackup = (): void => {
    const payload = {
      app: "bible-os",
      schema: 1,
      exportedAt: new Date().toISOString(),
      prefs: this.state.preferences,
      annotations: this.state.annotations,
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
          prefs?: Partial<Preferences>;
        };
        const annotations = Array.isArray(data.annotations) ? data.annotations : [];
        const preferences = { ...this.state.preferences, ...(data.prefs || {}) };
        this.persistAnnotations(annotations);
        this.writeJson(STORAGE.preferences, preferences);
        this.setState({ annotations, preferences });
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

  private toggleChapterPicker = (): void => {
    if (this.state.menu === "chapters") {
      this.navScrollPending = false;
      this.setState({ menu: null });
      return;
    }
    const bookId = this.state.current?.bookId || "MAT";
    this.navScrollPending = true;
    this.setState({
      menu: "chapters",
      navTestament: scripture.bookTestament(bookId),
      navOpenBooks: [bookId],
    });
  };

  private pickChapter = (bookId: string, chapter: number): void => {
    this.navScrollPending = false;
    this.setState({ menu: null, navOpenBooks: [bookId] });
    void this.openAt(bookId, chapter);
  };

  private toggleNavBook = (bookId: string): void => {
    this.setState((state) => ({
      navOpenBooks: state.navOpenBooks.includes(bookId)
        ? state.navOpenBooks.filter((id) => id !== bookId)
        : [...state.navOpenBooks, bookId],
    }));
  };

  private renderChapterPicker(currentLabel: string, currentLabelZh: string): ReactNode {
    const { compact, current, menu, narrow, narrowLanguage, navOpenBooks, navTestament } = this.state;
    const open = menu === "chapters";
    const showEnglish = !narrow || narrowLanguage === "en";
    const showChinese = !narrow || narrowLanguage === "zh";

    return (
      <div className="chapter-picker">
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          className="current-label"
          onClick={this.toggleChapterPicker}
          title="Choose a book and chapter"
          type="button"
        >
          {showEnglish && <span aria-live="polite" className="current-label-en">{currentLabel}</span>}
          {showChinese && <span aria-live="polite" className="current-label-zh" lang="zh">{currentLabelZh}</span>}
        </button>

        <SurfacePortal enabled={compact}>
        <AnimatePresence>
        {open && (
          <>
          {compact && <div aria-hidden="true" className="compact-menu-backdrop" onClick={() => this.setState({ menu: null })} />}
          <FluidSurface
            ariaLabel="Choose a book and chapter"
            className="menu chapter-menu"
            edge={compact ? "bottom" : "popover"}
            key="chapter-menu"
            onClick={(event) => event.stopPropagation()}
            onDismiss={() => this.setState({ menu: null })}
            role="menu"
            showHandle={compact}
          >
            <div aria-label="Testament" className="testament-tabs" role="tablist">
              {([["old", "Old Testament"], ["new", "New Testament"]] as [Testament, string][]).map(
                ([testament, label]) => (
                  <button
                    aria-selected={navTestament === testament}
                    key={testament}
                    onClick={() => this.setState({ navTestament: testament })}
                    role="tab"
                    type="button"
                  >
                    {label}
                  </button>
                ),
              )}
            </div>

            <div className="book-list" ref={this.navListRef}>
              {scripture.booksIn(navTestament).map((book) => {
                const expanded = navOpenBooks.includes(book.id);
                return (
                  <div className="book-row" key={book.id} ref={book.id === current?.bookId ? this.navBookRef : undefined}>
                    <button
                      aria-expanded={expanded}
                      aria-label={book.name}
                      className={expanded ? "book-name open" : "book-name"}
                      onClick={() => this.toggleNavBook(book.id)}
                      type="button"
                    >
                      <span>{book.name}</span>
                      <span className="book-zh" lang="zh">{book.zh}</span>
                    </button>
                    <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        animate={{
                          height: "auto",
                          opacity: 1,
                          pointerEvents: "auto",
                          transition: {
                            height: { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] },
                            opacity: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] },
                          },
                        }}
                        className="chapter-grid-wrap"
                        exit={{
                          height: 0,
                          opacity: 0,
                          pointerEvents: "none",
                          transition: {
                            // Fade the complete grid first; collapsing the now-invisible
                            // surface afterwards avoids visibly clipping individual rows.
                            opacity: { duration: 0.1, ease: [0.2, 0.8, 0.2, 1] },
                            height: { delay: 0.08, duration: 0.2, ease: [0.2, 0.8, 0.2, 1] },
                          },
                        }}
                        initial={{ height: 0, opacity: 0 }}
                      >
                        <div className="chapter-grid">
                          {Array.from({ length: book.chapters }, (_, index) => index + 1).map((chapter) => {
                            const here = current?.bookId === book.id && current.chapter === chapter;
                            return (
                              <button
                                aria-current={here ? "page" : undefined}
                                aria-label={`${book.name} ${chapter}`}
                                className={here ? "chapter-number current" : "chapter-number"}
                                key={chapter}
                                onClick={() => this.pickChapter(book.id, chapter)}
                                type="button"
                              >
                                {chapter}
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </FluidSurface>
          </>
        )}
        </AnimatePresence>
        </SurfacePortal>
      </div>
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

  private renderHeader(
    currentLabel: string,
    currentLabelZh: string,
    sourceId: EnglishSourceId,
  ): ReactNode {
    const {
      activeSearchIndex,
      annotations,
      compact,
      keyDraft,
      keyField,
      menu,
      narrow,
      notesOpen,
      preferences,
      query,
      referenceHint,
      results,
      resultsNote,
      resultsOpen,
      searchStale,
      searching,
      spotlightOpen,
    } = this.state;
    const sources: { id: EnglishSourceId; label: string; hint: string }[] = [
      { id: "web", label: "World English Bible", hint: "Public domain" },
    { id: "mdesv", label: "ESV — hosted copy", hint: "mdbible plain text, personal use" },
      {
        id: "esvapi",
        label: "ESV — api.esv.org",
        hint: scripture.getEsvKey() ? "Using your saved key" : "Needs your own key",
      },
    ];
    const highlightCount = annotations.filter((annotation) => annotation.kind === "highlight").length;

    return (
      <>
        <header
          className="app-header"
          inert={spotlightOpen || (narrow && notesOpen) ? true : undefined}
        >
        <div className="header-grid">
          <div className="brand-block">
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

          {this.renderChapterPicker(currentLabel, currentLabelZh)}

          <div className="header-actions">
            {narrow && !compact && this.renderTranslationSwitch()}

            <button
              aria-haspopup="dialog"
              aria-label="Search passages and keywords"
              className="icon-button search-trigger"
              onClick={this.openSpotlight}
              ref={this.searchTriggerRef}
              title="Search (⌘K)"
              type="button"
            >
              <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
            </button>

            <div className="menu-wrap">
              <button
                aria-expanded={menu === "settings"}
                aria-haspopup="menu"
                aria-label="Display settings"
                className="icon-button"
                onClick={() => this.setState({ menu: menu === "settings" ? null : "settings" })}
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              <SurfacePortal enabled={compact}>
              <AnimatePresence>
              {menu === "settings" && (
                <>
                {compact && <div aria-hidden="true" className="compact-menu-backdrop" onClick={() => this.setState({ menu: null })} />}
                <FluidSurface
                  ariaLabel="Display settings"
                  className="menu settings-menu"
                  edge={compact ? "bottom" : "popover"}
                  key="settings-menu"
                  onClick={(event) => event.stopPropagation()}
                  onDismiss={() => this.setState({ menu: null })}
                  role="menu"
                  showHandle={compact}
                >
                  <div className="settings-section">
                    {!narrow && (
                      <>
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
                          role="menuitemradio"
                          type="button"
                        >
                          {label}<span>{preferences.langMode === mode ? "●" : ""}</span>
                        </button>
                      ))}
                      </>
                    )}
                      <div className={`source-section${narrow ? " first" : ""}`}>
                        <p className="menu-eyebrow">English source</p>
                        {sources.map((source) => (
                          <button
                            aria-checked={sourceId === source.id}
                            className="source-choice"
                            key={source.id}
                            onClick={() => this.selectSource(source.id)}
                            role="menuitemradio"
                            type="button"
                          >
                            <span>
                              <span>{source.label}</span>
                              <small>{source.hint}</small>
                            </span>
                            <span className="choice-dot">{sourceId === source.id ? "●" : ""}</span>
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
                      </div>
                    </div>
                  <div className="settings-section">
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
                  </div>
                </FluidSurface>
                </>
              )}
              </AnimatePresence>
              </SurfacePortal>
            </div>

            <button
              aria-expanded={notesOpen}
              aria-label="Notes"
              className="icon-button notes-button"
              onClick={this.toggleNotes}
              ref={this.notesTriggerRef}
              type="button"
            >
              <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M9 13h6" />
                <path d="M9 17h6" />
              </svg>
              {highlightCount > 0 && <span>{highlightCount}</span>}
            </button>
          </div>
        </div>
        {narrow && compact && <div className="translation-row">{this.renderTranslationSwitch()}</div>}
      </header>

      <SurfacePortal>
      <AnimatePresence>
      {spotlightOpen && (
        <FluidBackdrop className="spotlight-backdrop" onDismiss={this.closeSpotlight}>
          <FluidSurface
            ariaLabel="Search"
            ariaModal
            className="spotlight"
            edge={compact ? "bottom" : "center"}
            key="search-surface"
            onClick={(event) => event.stopPropagation()}
            onDismiss={this.closeSpotlight}
            onKeyDown={this.onSpotlightKeyDown}
            ref={this.spotlightRef}
            role="dialog"
            showHandle={compact}
          >
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
                    ? `${results.length} search results`
                    : resultsNote}
            </p>

            {!query && (
              <div className="search-welcome">
                <p className="search-shortcuts"><kbd>↑</kbd><kbd>↓</kbd> to move <span /> <kbd>↵</kbd> to open</p>
              </div>
            )}

            {searching && <span aria-hidden="true" className="search-progress" />}

            {resultsOpen && (
              <div
                aria-busy={searching}
                aria-label="Search results"
                className={`spotlight-results${searchStale ? " stale" : ""}`}
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
                      <span className="result-meta">
                        <span>{result.ref}</span>
                        <span lang="zh">{result.refZh}</span>
                      </span>
                      <span className="result-english">{this.highlightSearchText(result.en)}</span>
                      <span className="result-chinese" lang="zh">{result.zh}</span>
                    </button>
                  );
                })}
                {searching && !results.length && (
                  <div aria-hidden="true" className="search-loading-state">
                    <span /><span /><span />
                  </div>
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
          </FluidSurface>
        </FluidBackdrop>
      )}
      </AnimatePresence>
      </SurfacePortal>
      </>
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
    if (chapter.status !== "ready" || !chapter.data) {
      return (
        <div className="chapter-block" key={chapter.key}>
          <div className={titleClass} data-ck={chapter.key}><h2>{chapter.label}</h2></div>
          {chapter.status === "error" ? (
            <div className="chapter-error" role="alert">
              <span>This chapter didn’t load.</span>
              <button onClick={() => this.retryChapter(chapter.key)} type="button">Retry</button>
            </div>
          ) : (
            <div className="reading-grid skeleton-grid">
              {showEnglish && <ReadingSkeleton lines={4} />}
              {showChinese && <ReadingSkeleton lines={3} />}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="chapter-block" key={chapter.key}>
        {chapter.data.blocks.map((block) => {
          if (block.type === "title") {
            return (
              <div className={titleClass} data-ck={chapter.key} key={block.id}>
                <h2>{block.text}</h2>
              </div>
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

  private renderNotes(currentLabel: string, englishLabel: string): ReactNode {
    const { activeId, annotations, current, editorMode, narrow, saveState } = this.state;
    if (!this.state.notesOpen) return null;
    const currentKey = current ? `${current.bookId}/${current.chapter}` : null;
    const active = activeId
      ? annotations.find((annotation): annotation is HighlightAnnotation =>
        annotation.id === activeId && annotation.kind === "highlight",
      )
      : null;
    const chapterAnnotations = currentKey ? this.annotationsForChapter(currentKey) : [];

    const panel = (
      <FluidSurface
        ariaLabel="Notes"
        ariaModal={narrow}
        className="notes-panel"
        draggable={narrow}
        edge="right"
        expandWidth={narrow ? undefined : 392}
        key="notes-panel"
        onClick={(event) => event.stopPropagation()}
        onDismiss={this.closeNotes}
        onKeyDown={this.onNotesKeyDown}
        ref={this.notesPanelRef}
        role={narrow ? "dialog" : "complementary"}
        showHandle={narrow}
      >
        <div className="notes-header">
          <span>Notes · {currentLabel}</span>
          <button
            aria-label="Close notes"
            onClick={this.closeNotes}
            type="button"
          >×</button>
        </div>
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
                    __html: active.note ? this.markdown(active.note) : '<p class="empty-preview">Nothing to preview yet.</p>',
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
              <p className="notes-eyebrow">Chapter note</p>
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
      </FluidSurface>
    );

    return narrow ? (
      <FluidBackdrop className="notes-backdrop" onDismiss={this.closeNotes}>
        {panel}
      </FluidBackdrop>
    ) : panel;
  }

  render(): ReactNode {
    const { chapters, current, narrow, notesOpen, selectionToolbar, sourceId, spotlightOpen, toast } = this.state;
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
        {this.renderHeader(currentLabel, currentLabelZh, sourceId)}
        <div
          aria-hidden={spotlightOpen ? true : undefined}
          className="reader-with-notes"
          inert={spotlightOpen ? true : undefined}
        >
          <main
            aria-hidden={narrow && notesOpen ? true : undefined}
            className="reader"
            inert={narrow && notesOpen ? true : undefined}
          >
            <div className="reader-inner">
              <div className="translation-labels">
                {showEnglish && <span>{englishLabel}</span>}
                {showChinese && <span lang="zh">和合本</span>}
              </div>
              {this.state.atCanonStart && <p className="canon-edge">Beginning of the canon</p>}
              {chapters.map((chapter, index) =>
                this.renderChapter(chapter, index === 0, showEnglish, showChinese),
              )}
              {this.state.loadingMore && <p className="canon-edge loading">Loading the next chapter</p>}
              {this.state.atCanonEnd && <p className="canon-edge">End of the canon</p>}
              {!esvStatus.ok && <p className="source-notice" role="status">{esvStatus.message}</p>}
              {usingEsv ? (
                <p className="copyright">
                  Scripture quotations marked “ESV” are from the ESV® Bible (The Holy Bible, English Standard
                  Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission.
                  All rights reserved. Chinese text is the Chinese Union Version (和合本), public domain.{" "}
                  <a href="https://www.esv.org/" rel="noopener noreferrer" target="_blank">www.esv.org</a>
                </p>
              ) : (
                <p className="copyright">
                  English: World English Bible, public domain. Chinese: Chinese Union Version (和合本), public
                  domain. Switch the English source in the language menu to read the ESV.
                </p>
              )}
            </div>
          </main>
          <AnimatePresence>{this.renderNotes(currentLabel, englishLabel)}</AnimatePresence>
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
            {toast.undo && (
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

function ReadingSkeleton({ lines }: { lines: number }) {
  return (
    <div aria-hidden="true" className="reading-skeleton">
      {Array.from({ length: lines }, (_, index) => <span key={index} />)}
    </div>
  );
}
