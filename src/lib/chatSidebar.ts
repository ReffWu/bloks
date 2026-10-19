// How wide the chat's own sidebar is, and whether it is open. Kept on this
// device, like the old rail choice: how much list you want in view depends
// on the screen, not on the workspace. The rail's Chat button and ⌘B fold
// it; dragging its edge sizes it, and dragging it narrow enough folds it.
import { useSyncExternalStore } from "react";

export const CHAT_SIDEBAR = { min: 232, max: 440, initial: 288, foldBelow: 180 } as const;

const WIDTH_KEY = "bloks-chat-sidebar-width";
const OPEN_KEY = "bloks-chat-sidebar-open";

function read<T>(key: string, parse: (raw: string) => T | undefined, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (parse(raw) ?? fallback);
  } catch {
    return fallback;
  }
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(CHAT_SIDEBAR.max, Math.max(CHAT_SIDEBAR.min, width)));
}

let state = {
  width: clampWidth(
    read(WIDTH_KEY, (raw) => (Number.isFinite(Number(raw)) ? Number(raw) : undefined), CHAT_SIDEBAR.initial),
  ),
  open: read(OPEN_KEY, (raw) => (raw === "false" ? false : raw === "true" ? true : undefined), true),
};
const listeners = new Set<() => void>();

function set(next: Partial<typeof state>, save = true) {
  state = { ...state, ...next };
  if (save) {
    try {
      localStorage.setItem(WIDTH_KEY, String(state.width));
      localStorage.setItem(OPEN_KEY, String(state.open));
    } catch {
      /* private mode: holds for this visit */
    }
  }
  for (const listener of listeners) listener();
}

export function setChatSidebarWidth(width: number, save = true) {
  set({ width: clampWidth(width), open: true }, save);
}

export function setChatSidebarOpen(open: boolean) {
  set({ open });
}

export function toggleChatSidebar() {
  set({ open: !state.open });
}

export function useChatSidebar() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
