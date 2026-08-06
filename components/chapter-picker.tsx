"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Button,
  Dialog,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  SearchField,
} from "react-aria-components";
import { motion } from "motion/react";
import {
  AnimatePresence,
  FluidSurface,
  SurfacePortal,
} from "@/components/fluid-surfaces";
import { BY_ID, ORDER } from "@/lib/bible-books";
import * as scripture from "@/lib/bible-source";
import type { Book, Language } from "@/lib/types";

interface ChapterPickerProps {
  compact: boolean;
  currentBookId: string;
  currentChapter: number;
  currentLabel: string;
  currentLabelZh: string;
  narrow: boolean;
  narrowLanguage: Language;
  onOpenChange: (open: boolean) => void;
  onPick: (bookId: string, chapter: number) => void;
  open: boolean;
}

type PickerStep = "books" | "chapters";
type PickerDirection = -1 | 1;

const ALL_BOOKS = ORDER.map((bookId) => BY_ID[bookId]);
const STEP_SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 38,
  mass: 1,
};

const stepVariants = {
  enter: (direction: PickerDirection) => ({ opacity: 0, x: direction * 30 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: PickerDirection) => ({ opacity: 0, x: direction * -30 }),
};

function normalizeBookQuery(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function bookMatches(book: Book, query: string): boolean {
  const needle = normalizeBookQuery(query);
  if (!needle) return true;
  const haystack = normalizeBookQuery(`${book.name} ${book.zh} ${book.aliases.join(" ")}`);
  return haystack.includes(needle);
}

export function ChapterPicker({
  compact,
  currentBookId,
  currentChapter,
  currentLabel,
  currentLabelZh,
  narrow,
  narrowLanguage,
  onOpenChange,
  onPick,
  open,
}: ChapterPickerProps): ReactNode {
  const [query, setQuery] = useState("");
  const [selectedBookId, setSelectedBookId] = useState(currentBookId);
  const [step, setStep] = useState<PickerStep>("books");
  const [direction, setDirection] = useState<PickerDirection>(1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const bookListRef = useRef<HTMLDivElement>(null);
  const selectedBookRef = useRef<HTMLDivElement>(null);
  const chapterListRef = useRef<HTMLDivElement>(null);
  const currentChapterRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);

  const directReference = scripture.parseReference(query);
  const visibleBooks = directReference
    ? [BY_ID[directReference.bookId]]
    : ALL_BOOKS.filter((book) => bookMatches(book, query));
  const oldBooks = visibleBooks.filter((book) => scripture.bookTestament(book.id) === "old");
  const newBooks = visibleBooks.filter((book) => scripture.bookTestament(book.id) === "new");
  const selectedBook = BY_ID[selectedBookId] || BY_ID[currentBookId];

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      setQuery("");
      setSelectedBookId(currentBookId);
      setStep("books");
      setDirection(1);
      const focusTimer = window.setTimeout(() => searchInputRef.current?.focus(), 40);
      const scrollTimer = window.setTimeout(() => {
        const list = bookListRef.current;
        const book = selectedBookRef.current;
        if (list && book) list.scrollTop = Math.max(0, book.offsetTop - list.clientHeight / 3);
      }, 80);
      return () => {
        window.clearTimeout(focusTimer);
        window.clearTimeout(scrollTimer);
      };
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const focusTimer = window.setTimeout(() => triggerRef.current?.focus(), 0);
      return () => window.clearTimeout(focusTimer);
    }
  }, [currentBookId, open]);

  useEffect(() => {
    if (!open || selectedBookId !== currentBookId) return;
    const scrollTimer = window.setTimeout(() => {
      const list = chapterListRef.current;
      const chapter = currentChapterRef.current;
      if (list && chapter) list.scrollTop = Math.max(0, chapter.offsetTop - list.clientHeight / 3);
    }, 80);
    return () => window.clearTimeout(scrollTimer);
  }, [currentBookId, currentChapter, open, selectedBookId, step]);

  const chooseBook = (bookId: string) => {
    setSelectedBookId(bookId);
    if (compact) {
      setDirection(1);
      setStep("chapters");
    }
  };

  const chooseChapter = (chapter: number) => {
    onOpenChange(false);
    onPick(selectedBook.id, chapter);
  };

  const goBack = () => {
    setDirection(-1);
    setStep("books");
    window.setTimeout(() => searchInputRef.current?.focus(), 40);
  };

  const submitQuery = () => {
    if (directReference) {
      onOpenChange(false);
      onPick(directReference.bookId, directReference.chapter);
      return;
    }
    if (visibleBooks.length === 1) chooseBook(visibleBooks[0].id);
  };

  const trapCompactFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!compact || event.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input, button:not([disabled]), [role="option"][tabindex="0"]',
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
  };

  const renderSearch = () => (
    <div className="picker-search-wrap">
      <SearchField
        aria-label="Filter books or enter a reference"
        className="picker-search"
        onChange={setQuery}
        onSubmit={submitQuery}
        value={query}
      >
        <svg aria-hidden="true" className="picker-search-icon" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <Input autoFocus placeholder="Filter books or enter a reference" ref={searchInputRef} />
        <Button aria-label="Clear book filter" className="picker-clear" slot="clear">
          <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="13">
            <path d="m7 7 10 10M17 7 7 17" />
          </svg>
        </Button>
      </SearchField>

      {directReference && (
        <Button className="picker-direct" onPress={submitQuery}>
          <span className="picker-direct-action">Go to</span>
          <span>
            <strong>{scripture.refLabel(directReference.bookId, directReference.chapter, directReference.verse)}</strong>
            <small lang="zh">{scripture.refLabelZh(directReference.bookId, directReference.chapter, directReference.verse)}</small>
          </span>
          <span aria-hidden="true" className="picker-direct-return">↵</span>
        </Button>
      )}
    </div>
  );

  const renderBookItems = (books: Book[]) => books.map((book) => (
    <ListBoxItem
      className="book-option"
      data-current={book.id === selectedBookId || undefined}
      id={book.id}
      key={book.id}
      ref={book.id === currentBookId ? selectedBookRef : undefined}
      textValue={`${book.name} ${book.zh}`}
    >
      <span>{book.name}</span>
      <span className="book-option-zh" lang="zh">{book.zh}</span>
      <svg aria-hidden="true" className="book-option-check" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="13">
        <path d="m5 12 4 4L19 6" />
      </svg>
    </ListBoxItem>
  ));

  const renderBooks = () => (
    <div className="picker-books-pane">
      <ListBox
        aria-label="Books"
        className="picker-book-list"
        onSelectionChange={(keys) => {
          if (keys === "all") return;
          const [bookId] = Array.from(keys);
          if (bookId) chooseBook(String(bookId));
        }}
        ref={bookListRef}
        renderEmptyState={() => (
          <div className="picker-empty">
            <strong>No matching book</strong>
            <span>Try a name such as John or <span lang="zh">约翰福音</span>.</span>
          </div>
        )}
        selectedKeys={compact ? [] : [selectedBookId]}
        selectionMode="single"
      >
        {oldBooks.length > 0 && (
          <ListBoxSection id="old-testament">
            <Header>Old Testament</Header>
            {renderBookItems(oldBooks)}
          </ListBoxSection>
        )}
        {newBooks.length > 0 && (
          <ListBoxSection id="new-testament">
            <Header>New Testament</Header>
            {renderBookItems(newBooks)}
          </ListBoxSection>
        )}
      </ListBox>
    </div>
  );

  const renderChapters = (showBack: boolean) => (
    <div className="picker-chapters-pane">
      <div className={`picker-chapter-heading${showBack ? " with-back" : ""}`}>
        {showBack && (
          <Button aria-label="Back to books" className="picker-back" onPress={goBack}>
            <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Button>
        )}
        <span className="picker-book-title">
          <strong>{selectedBook.name}</strong>
          <small lang="zh">{selectedBook.zh}</small>
        </span>
      </div>

      <ListBox
        aria-label={`${selectedBook.name} chapters`}
        className="picker-chapter-list"
        layout="grid"
        onSelectionChange={(keys) => {
          if (keys === "all") return;
          const [chapter] = Array.from(keys);
          if (chapter) chooseChapter(Number(chapter));
        }}
        orientation="horizontal"
        ref={chapterListRef}
        selectedKeys={compact ? [] : selectedBookId === currentBookId ? [String(currentChapter)] : []}
        selectionMode="single"
      >
        {Array.from({ length: selectedBook.chapters }, (_, index) => index + 1).map((chapter) => (
          <ListBoxItem
            aria-label={`${selectedBook.name} ${chapter}`}
            className="chapter-option"
            data-current={selectedBookId === currentBookId && chapter === currentChapter || undefined}
            id={String(chapter)}
            key={chapter}
            ref={selectedBookId === currentBookId && chapter === currentChapter ? currentChapterRef : undefined}
            textValue={String(chapter)}
          >
            {chapter}
          </ListBoxItem>
        ))}
      </ListBox>
    </div>
  );

  const showEnglish = !narrow || narrowLanguage === "en";
  const showChinese = !narrow || narrowLanguage === "zh";

  return (
    <div className="chapter-picker">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="current-label"
        onClick={() => onOpenChange(!open)}
        ref={triggerRef}
        type="button"
      >
        {showEnglish && <span aria-live="polite" className="current-label-en">{currentLabel}</span>}
        {showChinese && <span aria-live="polite" className="current-label-zh" lang="zh">{currentLabelZh}</span>}
      </button>

      <SurfacePortal enabled={compact}>
        <AnimatePresence>
          {open && (
            <>
              {compact && <div aria-hidden="true" className="compact-menu-backdrop" onClick={() => onOpenChange(false)} />}
              <FluidSurface
                className="menu chapter-menu"
                edge={compact ? "bottom" : "popover"}
                key="chapter-menu"
                onClick={(event) => event.stopPropagation()}
                onDismiss={() => onOpenChange(false)}
                onKeyDown={trapCompactFocus}
                showHandle={compact}
              >
                <Dialog
                  aria-label="Choose a book and chapter"
                  className="chapter-picker-dialog"
                  ref={dialogRef}
                >
                  {compact ? (
                    <div className="compact-picker-viewport">
                      <AnimatePresence custom={direction} initial={false}>
                        <motion.div
                          animate="center"
                          className="compact-picker-stage"
                          custom={direction}
                          exit="exit"
                          initial="enter"
                          key={step}
                          transition={STEP_SPRING}
                          variants={stepVariants}
                        >
                          {step === "books" ? (
                            <>
                              {renderSearch()}
                              {renderBooks()}
                            </>
                          ) : renderChapters(true)}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  ) : (
                    <>
                      {renderSearch()}
                      <div className="picker-desktop-body">
                        {renderBooks()}
                        {renderChapters(false)}
                      </div>
                    </>
                  )}
                </Dialog>
              </FluidSurface>
            </>
          )}
        </AnimatePresence>
      </SurfacePortal>
    </div>
  );
}
