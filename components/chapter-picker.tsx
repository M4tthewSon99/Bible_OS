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
  ListBox,
  ListBoxItem,
  ListBoxSection,
} from "react-aria-components";
import { motion } from "motion/react";
import {
  AnimatePresence,
  FluidSurface,
  SurfacePortal,
} from "@/components/fluid-surfaces";
import { BY_ID, ORDER } from "@/lib/bible-books";
import { restoreFocus } from "@/lib/focus";
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
  /** Width reserved by a companion desktop rail, such as Devotion. */
  readerScrimInset?: number;
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
  readerScrimInset = 0,
}: ChapterPickerProps): ReactNode {
  const [activeTestament, setActiveTestament] = useState(() => scripture.bookTestament(currentBookId));
  const [selectedBookId, setSelectedBookId] = useState(currentBookId);
  const [step, setStep] = useState<PickerStep>("books");
  const [direction, setDirection] = useState<PickerDirection>(1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bookListRef = useRef<HTMLDivElement>(null);
  const newTestamentRef = useRef<HTMLElement>(null);
  const selectedBookRef = useRef<HTMLDivElement>(null);
  const chapterListRef = useRef<HTMLDivElement>(null);
  const currentChapterRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);

  const oldBooks = ALL_BOOKS.filter((book) => scripture.bookTestament(book.id) === "old");
  const newBooks = ALL_BOOKS.filter((book) => scripture.bookTestament(book.id) === "new");
  const selectedBook = BY_ID[selectedBookId] || BY_ID[currentBookId];

  const updateActiveTestament = () => {
    const list = bookListRef.current;
    const newTestament = newTestamentRef.current;
    if (!list || !newTestament) return;
    setActiveTestament(
      newTestament.getBoundingClientRect().top <= list.getBoundingClientRect().top
        ? "new"
        : "old",
    );
  };

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      setActiveTestament(scripture.bookTestament(currentBookId));
      setSelectedBookId(currentBookId);
      setStep("books");
      setDirection(1);
      const scrollTimer = window.setTimeout(() => {
        const list = bookListRef.current;
        const book = selectedBookRef.current;
        if (list && book) {
          list.scrollTop = Math.max(0, book.offsetTop - list.clientHeight / 3);
          updateActiveTestament();
        }
      }, 80);
      return () => {
        window.clearTimeout(scrollTimer);
      };
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const focusTimer = window.setTimeout(() => restoreFocus(triggerRef.current), 0);
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
    </ListBoxItem>
  ));

  const renderBooks = () => (
    <div className="picker-books-pane">
      <div className="picker-testament-label">
        {activeTestament === "old" ? "Old Testament" : "New Testament"}
      </div>
      <ListBox
        aria-label="Books"
        className="picker-book-list"
        onSelectionChange={(keys) => {
          if (keys === "all") return;
          const [bookId] = Array.from(keys);
          if (bookId) chooseBook(String(bookId));
        }}
        onScroll={updateActiveTestament}
        ref={bookListRef}
        selectedKeys={compact ? [] : [selectedBookId]}
        selectionMode="single"
      >
        {oldBooks.length > 0 && (
          <ListBoxSection id="old-testament">
            <Header className="sr-only">Old Testament</Header>
            {renderBookItems(oldBooks)}
          </ListBoxSection>
        )}
        {newBooks.length > 0 && (
          <ListBoxSection className="new-testament-section" id="new-testament" ref={newTestamentRef}>
            <Header className="sr-only">New Testament</Header>
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
  const readerSurfaceStyle = readerScrimInset > 0
    ? {
      left: `calc((100vw - ${readerScrimInset}px) / 2)`,
      width: `min(548px, calc(100vw - ${readerScrimInset + 32}px))`,
      marginLeft: `max(-274px, calc((100vw - ${readerScrimInset + 32}px) / -2))`,
    }
    : undefined;

  return (
    <div className="chapter-picker">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+I"
        className="current-label"
        onClick={() => onOpenChange(!open)}
        ref={triggerRef}
        title="Choose a book and chapter (⌘I)"
        type="button"
      >
        <span aria-atomic="true" aria-live="polite" className="sr-only">
          {showEnglish ? currentLabel : currentLabelZh}
        </span>
        <span aria-hidden="true" className="chapter-label-stage">
          {showEnglish && <span className="current-label-en">{currentLabel}</span>}
          {showChinese && <span className="current-label-zh" lang="zh">{currentLabelZh}</span>}
        </span>
      </button>

      {/* Dims the reader behind the picker at every width — without it a
          near-white panel floats on a near-white page and the scripture runs
          straight into its edges. Kept in its own portal and presence tree:
          as a sibling inside the menu's AnimatePresence it counted as an
          extra child and stalled the menu's own enter animation. */}
      <SurfacePortal>
        <AnimatePresence>
          {open && (
            <motion.div
              animate={{ opacity: 1 }}
              aria-hidden="true"
              className="reader-scrim compact-menu-backdrop"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="picker-scrim"
              onClick={() => onOpenChange(false)}
              style={readerScrimInset > 0 ? { right: readerScrimInset } : undefined}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            />
          )}
        </AnimatePresence>
      </SurfacePortal>

      <SurfacePortal enabled={compact}>
        <AnimatePresence>
          {open && (
            <>
              <FluidSurface
                className="menu chapter-menu"
                edge={compact ? "bottom" : "center"}
                key="chapter-menu"
                material="solid"
                onClick={(event) => event.stopPropagation()}
                onDismiss={() => onOpenChange(false)}
                onKeyDown={trapCompactFocus}
                showHandle={compact}
                style={readerSurfaceStyle}
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
                            renderBooks()
                          ) : renderChapters(true)}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  ) : (
                    <div className="picker-desktop-body">
                      {renderBooks()}
                      {renderChapters(false)}
                    </div>
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
