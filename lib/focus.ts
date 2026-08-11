/**
 * Tracks whether the reader is currently driving with a pointer or the
 * keyboard, and mirrors it onto `<html data-modality>`.
 *
 * The browser's own :focus-visible heuristic counts *any* keypress as
 * keyboard intent, so dismissing a mouse-opened menu with Escape lights a
 * focus ring on the trigger you never navigated to. The keys below are
 * deliberately limited to navigation and activation — Escape is not one of
 * them, so escaping a menu leaves the modality exactly as it was.
 *
 * Defaults to "keyboard": if anything here fails, rings stay visible.
 */
const KEYBOARD_KEYS = new Set([
  "Tab",
  "Enter",
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function isPointerModality(): boolean {
  return document.documentElement.dataset.modality === "pointer";
}

/**
 * Hands focus back after a surface closes.
 *
 * With a pointer, focus goes nowhere: the reader dismissed the surface and a
 * trigger that still held focus would re-open it on the next Enter or Space.
 * On the keyboard the trigger must get focus back, or Tab would restart from
 * the top of the document.
 */
export function restoreFocus(target: HTMLElement | null): void {
  if (isPointerModality()) {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    return;
  }
  target?.focus({ preventScroll: true });
}

export function trackInputModality(): () => void {
  const set = (mode: "pointer" | "keyboard") => {
    document.documentElement.dataset.modality = mode;
  };

  const onPointerDown = () => set("pointer");
  const onKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (KEYBOARD_KEYS.has(event.key)) set("keyboard");
  };

  set("keyboard");
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    delete document.documentElement.dataset.modality;
  };
}
