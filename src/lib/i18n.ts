// The interface's words, in the reader's language.
//
// Every sentence a person reads lives in a catalogue under src/locales,
// keyed by what it means: English in en.json, which is the source, and one
// file per other language beside it (src/locales/README.md says how they
// are written). A key the English file does not have fails the typecheck,
// because the keys' type is read from en.json itself, so a misspelled
// key is caught where it is typed and a removed one everywhere it was used.
//
// A language that has not caught up says the English sentence, never the
// key: a half-translated screen is still a screen somebody can use.
//
// `t` is a plain function, not a hook, so a label built in a helper reads
// the same as one written in a component. A change of language re-renders
// the whole interface from its root (src/main.tsx), and anything that
// keeps words outside a render (a memo, a module constant) keeps the key
// and translates it when it draws.
//
// Numbers, dates and relative times go through Intl in the same locale,
// so "3 agents" and "3 Agenten" carry their numbers the way their readers
// write them.
import { createElement, Fragment, isValidElement, cloneElement, useSyncExternalStore, type ReactNode } from "react";
import en from "../locales/en.json" with { type: "json" };

/** The languages the interface can be read in, each named in itself. */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "ja", name: "日本語" },
  { code: "zh-CN", name: "简体中文" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];
/** What a person chose: a language, or whatever their system speaks. */
export type LanguageChoice = Language | "system";

type Catalogue = typeof en;
type RawKey = keyof Catalogue & string;
type PluralForm = "zero" | "one" | "two" | "few" | "many" | "other";
type PluralKey = `${string}_${PluralForm}`;
/** A plural sentence is one key with a form per count ("_one", "_other"),
 * asked for by its stem with a `count`. */
type PluralStem = RawKey extends infer K ? (K extends `${infer Stem}_other` ? Stem : never) : never;

/** Every key the interface may ask for: the English catalogue's keys,
 * with a plural's forms asked for by their stem. */
export type MessageKey = Exclude<RawKey, PluralKey> | PluralStem;

/** What fills a sentence's `{placeholders}`. Numbers are written the
 * reader's way (1,234 or 1.234); pass a string for one that must stay as
 * it is, like a port or a year. */
export type Params = Record<string, string | number>;

const ENGLISH: Record<string, string> = en;
const catalogues = new Map<Language, Record<string, string>>([["en", ENGLISH]]);

// One import per language, so a reader downloads their own catalogue and
// no other. Spelled out because the bundler can only split what it can see.
const LOADERS: Record<Exclude<Language, "en">, () => Promise<{ default: Record<string, string> }>> = {
  es: () => import("../locales/es.json", { with: { type: "json" } }),
  fr: () => import("../locales/fr.json", { with: { type: "json" } }),
  de: () => import("../locales/de.json", { with: { type: "json" } }),
  "pt-BR": () => import("../locales/pt-BR.json", { with: { type: "json" } }),
  ja: () => import("../locales/ja.json", { with: { type: "json" } }),
  "zh-CN": () => import("../locales/zh-CN.json", { with: { type: "json" } }),
};

let current: Language = "en";
const listeners = new Set<() => void>();

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}

/**
 * The supported language nearest to a list of BCP 47 tags, the way a
 * browser or an OS orders them: the first one we can speak wins, by its
 * language alone where the region is ours to choose (es-MX reads es,
 * pt-PT reads pt-BR, zh-TW reads the Simplified catalogue rather than
 * none). English when nothing matches.
 */
export function matchLanguage(tags: readonly string[] | undefined | null): Language {
  for (const raw of tags ?? []) {
    if (typeof raw !== "string" || !raw) continue;
    const tag = raw.replace(/_/g, "-").toLowerCase();
    const base = tag.split("-")[0];
    if (base === "en") return "en";
    if (base === "pt") return "pt-BR";
    if (base === "zh") return "zh-CN";
    const found = LANGUAGES.find((l) => l.code === base);
    if (found) return found.code;
  }
  return "en";
}

/** The language the interface is in now. */
export function getLanguage(): Language {
  return current;
}

/**
 * Switches the interface to `language`, loading its catalogue first, and
 * re-renders everything that listens. A catalogue that fails to load
 * leaves the interface in English rather than in pieces.
 */
export async function setLanguage(language: Language): Promise<void> {
  if (!catalogues.has(language) && language !== "en") {
    try {
      const loaded = await LOADERS[language]();
      catalogues.set(language, loaded.default ?? {});
    } catch {
      catalogues.set(language, {});
    }
  }
  if (current === language) return;
  current = language;
  for (const listener of [...listeners]) listener();
}

/** For tests and for a catalogue that arrived some other way. */
export function addCatalogue(language: Language, words: Record<string, string>): void {
  if (language === "en") Object.assign(ENGLISH, words);
  else catalogues.set(language, { ...(catalogues.get(language) ?? {}), ...words });
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The language, as a hook: a component that calls it draws again when
 * the language changes, even inside a memo. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

// ── locale, for Intl ───────────────────────────────────────────────────

function systemTags(): readonly string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  if (nav?.languages?.length) return nav.languages;
  return nav?.language ? [nav.language] : [];
}

/**
 * The locale numbers and dates are written in. The system's own while it
 * speaks the chosen language, so an English reader in London keeps 14:15
 * and an Austrian reading German keeps theirs; the language's own
 * otherwise.
 */
export function formatLocale(language: Language = current): string {
  const base = language.split("-")[0];
  const own = systemTags().find((tag) => tag.toLowerCase().split(/[-_]/)[0] === base);
  if (own) {
    try {
      return Intl.getCanonicalLocales(own.replace(/_/g, "-"))[0] ?? language;
    } catch {
      /* a tag Intl cannot read: the language's own below */
    }
  }
  return language;
}

const formatters = new Map<string, unknown>();
function made<T>(kind: string, options: object | undefined, make: (locale: string) => T): T {
  const locale = formatLocale();
  const key = `${kind}|${locale}|${options ? JSON.stringify(options) : ""}`;
  let found = formatters.get(key) as T | undefined;
  if (!found) {
    found = make(locale);
    formatters.set(key, found);
  }
  return found;
}

export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return made("number", options, (l) => new Intl.NumberFormat(l, options)).format(n);
}

export function formatDate(at: number | Date, options?: Intl.DateTimeFormatOptions): string {
  return made("date", options, (l) => new Intl.DateTimeFormat(l, options)).format(at);
}

/** "3 minutes ago", "in 2 days": `value` in `unit`s, negative for the past. */
export function formatRelative(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options: Intl.RelativeTimeFormatOptions = { numeric: "auto" },
): string {
  return made("relative", options, (l) => new Intl.RelativeTimeFormat(l, options)).format(value, unit);
}

/** "Ana, Ben and Cleo", with the reader's own "and". */
export function formatList(items: readonly string[], options: Intl.ListFormatOptions = { type: "conjunction" }): string {
  return made("list", options, (l) => new Intl.ListFormat(l, options)).format(items);
}

function pluralForm(count: number, language: Language): PluralForm {
  return made("plural", { language }, () => new Intl.PluralRules(language)).select(count) as PluralForm;
}

// ── the words ──────────────────────────────────────────────────────────

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The sentence for `key` in `language`, or English's, or undefined. */
function lookup(key: string, params: Params | undefined): string | undefined {
  const own = catalogues.get(current) ?? {};
  const count = params?.count;
  if (typeof count === "number" && (`${key}_other` in ENGLISH || `${key}_other` in own)) {
    return (
      own[`${key}_${pluralForm(count, current)}`] ??
      own[`${key}_other`] ??
      ENGLISH[`${key}_${pluralForm(count, "en")}`] ??
      ENGLISH[`${key}_other`]
    );
  }
  return own[key] ?? ENGLISH[key];
}

function fill(text: string, params: Params | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === "number" ? formatNumber(value) : value;
  });
}

/**
 * The sentence for `key`, in the reader's language, with `{name}` filled
 * from `params`. A `count` picks a plural's form. Falls back to English,
 * and to the key itself only if English lacks it too, which the typecheck
 * already refuses.
 */
export function t(key: MessageKey, params?: Params): string {
  const text = lookup(key, params);
  return text === undefined ? key : fill(text, params);
}

/**
 * `t` for a sentence with something drawn inside it: a link, a bold
 * name, a key cap. Each `{name}` takes a string, a number or an element,
 * in the place the translation puts it, so a language that orders the
 * sentence differently moves the link with the words.
 */
export function tr(key: MessageKey, params: Record<string, ReactNode>): ReactNode {
  const plain: Params = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number") plain[name] = value;
  }
  const text = lookup(key, plain);
  if (text === undefined) return key;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > at) parts.push(text.slice(at, index));
    const value = params[match[1]];
    if (value === undefined) parts.push(match[0]);
    else if (typeof value === "number") parts.push(formatNumber(value));
    else if (isValidElement(value)) parts.push(cloneElement(value, { key: `${match[1]}-${index}` }));
    else parts.push(value);
    at = index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return createElement(Fragment, null, ...parts);
}

/** Whether `key` is one the English catalogue has, plural stems included:
 * for words chosen at run time, like a status read off the server. */
export function hasMessage(key: string): key is MessageKey {
  return key in ENGLISH || `${key}_other` in ENGLISH;
}
