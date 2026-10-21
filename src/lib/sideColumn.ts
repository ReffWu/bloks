// The column a place keeps beside its page: the chat's list of agents,
// Settings' pages, Memory's and Plugins' own lists, Automations' lists.
// Every one is dragged to the width you want and folded away when you
// want the room, the same way, and every one remembers both on this
// device under its own name. How much list you want beside a page
// depends on the screen and on the page, not on the workspace.
//
// SideColumn.tsx draws one; this is what each remembers, and which one
// the title bar's toggle and ⌘B mean when a page is in view.
import { useCallback, useEffect, useSyncExternalStore } from "react";

export interface SideColumnSize {
  /** The narrowest a drag leaves it. */
  min: number;
  /** The widest. */
  max: number;
  /** Where it starts, and where a double click on its edge puts it back. */
  initial: number;
  /** Let go of a drag narrower than this and it folds away instead. */
  foldBelow: number;
}

/** What a page's column takes unless it asks for something else. */
export const SIDE_COLUMN: SideColumnSize = { min: 200, max: 400, initial: 260, foldBelow: 150 };

/** The chat's list, whose sizes were settled before the others had any. */
export const CHAT_COLUMN = "chat";
export const CHAT_SIZE: SideColumnSize = { min: 232, max: 440, initial: 288, foldBelow: 180 };

/** Automations' lists (watchers, intents, webhooks) are one column: the
 * tabs swap what it lists, not where it stands, so switching tabs never
 * moves the page beside it. */
export const AUTOMATIONS_LIST = "automations-list";
export const AUTOMATIONS_LIST_SIZE: SideColumnSize = { min: 200, max: 400, initial: 260, foldBelow: 150 };

/** How far an arrow key moves an edge that has focus. */
export const EDGE_STEP = 16;

export interface SideColumnState {
  width: number;
  open: boolean;
  /** Its edge is in hand: nothing animates while the pointer leads. */
  resizing: boolean;
}

export function clampColumn(size: SideColumnSize, width: number): number {
  return Math.round(Math.min(size.max, Math.max(size.min, width)));
}

/**
 * Where a drag of the edge leaves the column when it is let go at
 * `width`. Narrower than it can usefully be, it folds, and opens again
 * at the width it had before this drag rather than the minimum the drag
 * passed through on its way to folding.
 */
export function releaseColumn(size: SideColumnSize, before: number, width: number): { width: number; open: boolean } {
  if (width < size.foldBelow) return { width: clampColumn(size, before), open: false };
  return { width: clampColumn(size, width), open: true };
}

/** Where a column keeps itself. The chat's keys are older than this
 * file, and keep their names so its width survives the move. */
export function columnKeys(id: string): { width: string; open: string } {
  if (id === CHAT_COLUMN) return { width: "bloks-chat-sidebar-width", open: "bloks-chat-sidebar-open" };
  return { width: `bloks-side-${id}-width`, open: `bloks-side-${id}-open` };
}

function read<T>(key: string, parse: (raw: string) => T | undefined, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (parse(raw) ?? fallback);
  } catch {
    return fallback;
  }
}

interface Column {
  size: SideColumnSize;
  /** Whether a drawing has said what its sizes are, or they are a guess
   * made by something that only knew the id (the title bar). */
  sized: boolean;
  state: SideColumnState;
  listeners: Set<() => void>;
}

const columns = new Map<string, Column>();

function stored(id: string, size: SideColumnSize): SideColumnState {
  const keys = columnKeys(id);
  return {
    width: clampColumn(
      size,
      read(keys.width, (raw) => (Number.isFinite(Number(raw)) ? Number(raw) : undefined), size.initial),
    ),
    open: read(keys.open, (raw) => (raw === "false" ? false : raw === "true" ? true : undefined), true),
    resizing: false,
  };
}

function column(id: string, size?: SideColumnSize): Column {
  let found = columns.get(id);
  if (!found) {
    const guess = size ?? (id === CHAT_COLUMN ? CHAT_SIZE : SIDE_COLUMN);
    found = { size: guess, sized: Boolean(size) || id === CHAT_COLUMN, state: stored(id, guess), listeners: new Set() };
    columns.set(id, found);
  } else if (size && !found.sized) {
    // read again against the real sizes, so a width saved past the
    // guess's limits is not cut down to them
    found.size = size;
    found.sized = true;
    found.state = { ...stored(id, size), resizing: found.state.resizing };
  }
  return found;
}

function set(id: string, next: Partial<SideColumnState>, save = true) {
  const col = column(id);
  col.state = { ...col.state, ...next };
  if (save) {
    const keys = columnKeys(id);
    try {
      localStorage.setItem(keys.width, String(col.state.width));
      localStorage.setItem(keys.open, String(col.state.open));
    } catch {
      /* private mode: holds for this visit */
    }
  }
  for (const listener of col.listeners) listener();
}

export function setColumnWidth(id: string, width: number, save = true) {
  set(id, { width: clampColumn(column(id).size, width), open: true }, save);
}

export function setColumnOpen(id: string, open: boolean) {
  set(id, { open });
}

export function toggleColumn(id: string) {
  set(id, { open: !column(id).state.open });
}

export function setColumnResizing(id: string, resizing: boolean) {
  set(id, { resizing }, false);
}

/** A drag let go: folded or sized, and saved either way. */
export function releaseColumnAt(id: string, before: number, width: number) {
  set(id, { ...releaseColumn(column(id).size, before, width), resizing: false });
}

/** A column's width and whether it is open. `size` is the drawing's; the
 * title bar, which only knows an id, leaves it out. */
export function useSideColumn(id: string, size?: SideColumnSize): SideColumnState {
  column(id, size);
  const subscribe = useCallback(
    (listener: () => void) => {
      const listeners = column(id).listeners;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    [id],
  );
  return useSyncExternalStore(subscribe, () => column(id).state);
}

// ── which one is in view ──────────────────────────────────────────────

// The page columns on screen, in the order they came; the last is the one
// the title bar's toggle and ⌘B fold. The chat's list is not one of them:
// it is mounted everywhere for the phone's drawer, so the title bar asks
// whether the chat is the place instead.
const inView: string[] = [];
const viewListeners = new Set<() => void>();
const emitView = () => {
  for (const listener of viewListeners) listener();
};

/** Says this column is the page's while the component calling it is. */
export function useColumnInView(id: string, on = true) {
  useEffect(() => {
    if (!on) return;
    inView.push(id);
    emitView();
    return () => {
      const at = inView.lastIndexOf(id);
      if (at >= 0) inView.splice(at, 1);
      emitView();
    };
  }, [id, on]);
}

/** The column the page in view keeps, if it keeps one. */
export function usePageColumn(): string | null {
  return useSyncExternalStore(
    (listener) => {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    () => inView.at(-1) ?? null,
  );
}

// ── whether there is room for one ─────────────────────────────────────

// Below this a window is a phone's, where a page has no room for a column
// beside it and each page lays its list out its own way; folding is for
// windows wide enough to have the choice. Tailwind's md, as every page's
// layout reads it.
const WIDE = "(min-width: 768px)";

export function useColumnsFit(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(WIDE);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

/** Folded away on a window that has room for it: the page then shows its
 * sections its own way, as tabs or a switch, or not at all. */
export function useColumnFolded(id: string, size?: SideColumnSize): boolean {
  const { open } = useSideColumn(id, size);
  return useColumnsFit() && !open;
}

/** Where focus goes from `at` on an arrow key in a row of `count` items,
 * or null for a key that is not for walking. */
export function stepFocus(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return at < 0 ? 0 : Math.min(count - 1, at + 1);
  if (key === "ArrowLeft") return at < 0 ? 0 : Math.max(0, at - 1);
  return null;
}
