// Which language the interface is read in, chosen in Settings, General.
//
// The choice is the person's, the way the theme is: it follows them into
// every workspace, so it is kept in the page's storage and with the
// desktop app (electron/main.mjs, prefs:language), which hands it back to
// each workspace's page before it draws and builds the menu bar in it.
// "System" is the default and means whatever the OS or the browser speaks.
import { useSyncExternalStore } from "react";
import { getLanguage, isLanguage, matchLanguage, setLanguage, type Language, type LanguageChoice } from "./i18n.ts";

const STORAGE_KEY = "bloks-language";

export function storedLanguageChoice(): LanguageChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(value)) return value;
  } catch {
    /* storage unavailable: the system's language */
  }
  return "system";
}

/** The language the system asks for, of the ones Bloks speaks. */
export function systemLanguage(): Language {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return matchLanguage(nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []);
}

export function resolveLanguage(choice: LanguageChoice): Language {
  return choice === "system" ? systemLanguage() : choice;
}

let choice: LanguageChoice = "system";
const listeners = new Set<() => void>();

async function apply(next: LanguageChoice): Promise<void> {
  choice = next;
  const language = resolveLanguage(next);
  await setLanguage(language);
  // a screen reader says the page's words in the voice of the page's lang
  if (typeof document !== "undefined") document.documentElement.lang = language;
  for (const listener of [...listeners]) listener();
}

/**
 * Before the first render, so the first frame is already in the person's
 * language. Also listens for a choice made in another workspace's window,
 * and for the system's own language changing under "System".
 */
export async function startLanguage(): Promise<void> {
  await apply(storedLanguageChoice());
  window.bloks?.onLanguage?.((said) => {
    const next: LanguageChoice = isLanguage(said) ? said : "system";
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage refused: the language still changes for this window */
    }
    if (next !== choice) void apply(next);
  });
  window.addEventListener("languagechange", () => {
    if (choice === "system") void apply("system");
  });
}

/** A choice from Settings: kept, told to the desktop app, and applied at
 * once, menus included. */
export async function chooseLanguage(next: LanguageChoice): Promise<void> {
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode: the language still applies for this session */
  }
  void window.bloks?.prefsLanguage?.(next)?.catch?.(() => {});
  await apply(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The choice as Settings shows it ("System" or a language), and the
 * language it comes to. */
export function useLanguageChoice(): { choice: LanguageChoice; language: Language } {
  const said = useSyncExternalStore(subscribe, () => choice, () => choice);
  return { choice: said, language: getLanguage() };
}
