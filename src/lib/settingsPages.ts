// Settings, as data: every page, the group it sits in, the words people
// search for, and where an old page id goes now.
//
// Kept apart from the screens so the reducer, the command palette and the
// tests read one list. The list itself is server/settings-index.ts, so
// the server answers an agent's "where is that" from the same pages the
// person sees. A page id is an address other parts of the app open
// (`toggleAppSettings` with a `page`), and the server's settings
// mirror names the same pages, so an id that moves is never dropped: it
// is redirected here, and everything that opens it lands somewhere real.
//
// Pages whose id starts with "workspace:" are the workspace's own (its
// name, its members, whether it is online). The rest belong to the
// person, or to how agents work here.

import { inEnglish, t, type MessageKey } from "./i18n.ts";
import {
  SETTINGS_GROUP_INDEX,
  SETTINGS_PAGE_INDEX,
  SETTINGS_REDIRECTS,
  type SettingsGroupId,
} from "../../server/settings-index.ts";

export type { SettingsGroupId };

/** A page as it is written down: its words as catalogue keys, so they
 * are read in the reader's language each time they are drawn. */
interface SettingsPageSpec {
  id: string;
  label: MessageKey;
  group: SettingsGroupId;
  /** One line under the page's title. */
  description: MessageKey;
  /** Words people search for that the label does not say, in English.
   * They stay here as they are, so an English word finds its page in
   * every language. */
  keywords: string;
  /** The same words for a translator to give in their own language,
   * whose English is `keywords`. */
  keywordsKey: MessageKey;
  /** The rows the page draws, so a search can name the row it found and
   * take you to it. */
  rows?: readonly MessageKey[];
  /** Only drawn where the desktop app has workspaces. */
  workspace?: boolean;
}

export interface SettingsPageInfo {
  id: string;
  /** The page's name, in the reader's language. */
  readonly label: string;
  group: SettingsGroupId;
  /** One line under the page's title, in the reader's language. */
  readonly description: string;
  /** Words people search for that the label does not say, in English. */
  keywords: string;
  keywordsKey: MessageKey;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  /** The labels of the rows the page draws, in the reader's language. */
  readonly rows: readonly string[];
  /** The same rows as keys. */
  rowMessages: readonly MessageKey[];
  /** Only drawn where the desktop app has workspaces. */
  workspace?: boolean;
}

// The words are read when they are asked for, not when this module loads,
// so a page named here follows a change of language like everything else.
function page(spec: SettingsPageSpec): SettingsPageInfo {
  const rowMessages = spec.rows ?? [];
  return {
    id: spec.id,
    group: spec.group,
    keywords: spec.keywords,
    keywordsKey: spec.keywordsKey,
    labelKey: spec.label,
    descriptionKey: spec.description,
    rowMessages,
    workspace: spec.workspace,
    get label() {
      return t(spec.label);
    },
    get description() {
      return t(spec.description);
    },
    get rows() {
      return rowMessages.map((key) => t(key));
    },
  };
}

// Every key in the shared list held to this catalogue's keys: a key the
// English file does not have fails the typecheck here, as it would have
// when the list lived in this file.
const SPECS: readonly SettingsPageSpec[] = SETTINGS_PAGE_INDEX;

/** The groups, in the order the list shows them. The workspace's group is
 * titled with the workspace's own name where it is drawn. */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; label: MessageKey }> = SETTINGS_GROUP_INDEX;

export const SETTINGS_PAGE_LIST: readonly SettingsPageInfo[] = SPECS.map(page);

export { SETTINGS_REDIRECTS };

const KNOWN = new Set(SETTINGS_PAGE_LIST.map((p) => p.id));

/** The page an id opens: itself, where it moved, or General for one that
 * never existed. */
export function resolveSettingsPage(id: string | null | undefined): string {
  const asked = typeof id === "string" ? id.trim() : "";
  const moved = SETTINGS_REDIRECTS[asked] ?? asked;
  return KNOWN.has(moved) ? moved : "general";
}

export function settingsPage(id: string): SettingsPageInfo | undefined {
  return SETTINGS_PAGE_LIST.find((p) => p.id === id);
}

/** Whether a Settings page id is one of the workspace's own. */
export const isWorkspaceSettingsPage = (id: string | null | undefined) => Boolean(id?.startsWith("workspace:"));

export interface SettingsMatch {
  page: SettingsPageInfo;
  /** Rows on the page whose own label matched, at most two. */
  rows: string[];
}

/**
 * The pages a search finds, in the list's order. Every word has to be
 * somewhere on the page (its label, its line, its words or a row), the
 * way the command palette reads a query, and the rows that say the words
 * themselves come back too, so the list can offer them by name.
 */
export function searchSettings(query: string, pages: readonly SettingsPageInfo[] = SETTINGS_PAGE_LIST): SettingsMatch[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return pages.map((page) => ({ page, rows: [] }));
  const says = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const out: SettingsMatch[] = [];
  for (const page of pages) {
    // the reader's words and the English ones both find a page, so a
    // word learned from a guide or a screenshot works in any language
    const rows = page.rowMessages.map((key) => ({ shown: t(key), english: inEnglish(key) }));
    const haystack = [
      page.label,
      page.description,
      t(page.keywordsKey),
      inEnglish(page.labelKey),
      inEnglish(page.descriptionKey),
      page.keywords,
      ...rows.flatMap((row) => [row.shown, row.english]),
    ].join(" ");
    if (!says(haystack)) continue;
    // a row that holds every word is named; the page's own label saying
    // them already is enough, and naming rows then would only be noise
    const labelSays = says(page.label) || says(inEnglish(page.labelKey));
    const named = labelSays ? [] : rows.filter((row) => says(row.shown) || says(row.english)).slice(0, 2).map((row) => row.shown);
    out.push({ page, rows: named });
  }
  return out;
}

/** A row's address on its page, from its label: what a search result
 * scrolls to, and what SettingRow writes on itself. Always the English
 * label's, so the address stays the same in every language; a label in
 * another language is found among the rows listed above. */
export function rowKey(label: string): string {
  return (englishRow(label) ?? label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function englishRow(label: string): string | undefined {
  for (const page of SETTINGS_PAGE_LIST) {
    for (const key of page.rowMessages) if (t(key) === label) return inEnglish(key);
  }
  return undefined;
}
