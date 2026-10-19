// The terminal's layout and preferences as React reads them: one copy
// each for the page, kept in step with every other window of the app
// through the storage event, so a font size changed in a popped out
// terminal is the font size back in the main window too.
import { useSyncExternalStore } from "react";
import {
  TERMINAL_HEIGHT_KEY,
  TERMINAL_LAYOUT_KEY,
  createTerminalLayout,
  type TerminalLayout,
} from "./terminalLayout";
import { TERMINAL_PREFS_KEY, createTerminalPrefs, type TerminalPrefs } from "./terminalPrefs";

const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};

function shared<T>(store: { get(): T; set(next: T): void; sync(): void }, keys: string[]) {
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((listener) => listener());
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== null && !keys.includes(event.key)) return;
      store.sync();
      tell();
    });
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const update = (change: (current: T) => T) => {
    store.set(change(store.get()));
    tell();
  };
  return { subscribe, get: store.get, update };
}

const layout = shared<TerminalLayout>(createTerminalLayout(storage), [TERMINAL_LAYOUT_KEY, TERMINAL_HEIGHT_KEY]);
const prefs = shared<TerminalPrefs>(createTerminalPrefs(storage), [TERMINAL_PREFS_KEY]);

export function useTerminalLayout(): [TerminalLayout, (change: (current: TerminalLayout) => TerminalLayout) => void] {
  return [useSyncExternalStore(layout.subscribe, layout.get), layout.update];
}

export function useTerminalPrefs(): [TerminalPrefs, (change: (current: TerminalPrefs) => TerminalPrefs) => void] {
  return [useSyncExternalStore(prefs.subscribe, prefs.get), prefs.update];
}
