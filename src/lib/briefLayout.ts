// How the person arranges the morning brief (server/brief.ts): the order
// of its sections, which are pinned to the top and which are hidden.
//
// The server is the one that arranges it (arrangeSections), and it hands
// the page the sections already in order. What is here is only the
// editing: moving one a step, pinning, hiding, and the layout to send
// back, which is the list as it now stands. Pinned sections stay in a
// group of their own at the top, so a step never moves one across.

import type { MessageKey } from "./i18n.ts";

export interface LayoutSection {
  key: string;
  pinned: boolean;
  hidden: boolean;
}

export interface BriefLayout {
  order: string[];
  pinned: string[];
  hidden: string[];
}

/** The brief's own sections, in the order a server too old to arrange
 * them shows them. */
export const DEFAULT_SECTIONS = ["waiting", "failed", "agents", "memory"] as const;

/** What a section is called, for the ones that are the brief's own: the
 * catalogue key, so the name follows the reader's language. */
export const SECTION_NAMES: Record<string, MessageKey> = {
  waiting: "briefLayout.waiting",
  failed: "briefLayout.failed",
  agents: "briefLayout.agents",
  memory: "briefLayout.memory",
};

/** Pinned first, keeping each group's order: what the server does too. */
function grouped(sections: LayoutSection[]): LayoutSection[] {
  return [...sections.filter((s) => s.pinned), ...sections.filter((s) => !s.pinned)];
}

/** One step up (-1) or down (1), within its group. At the edge of its
 * group it stays where it is. */
export function moveSection(sections: LayoutSection[], key: string, by: -1 | 1): LayoutSection[] {
  const list = grouped(sections);
  const at = list.findIndex((s) => s.key === key);
  const to = at + by;
  if (at < 0 || to < 0 || to >= list.length || list[to].pinned !== list[at].pinned) return list;
  const next = [...list];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** Pinned goes to the bottom of the pinned group, unpinned to the top of
 * the rest: the nearest place to where it was. */
export function togglePin(sections: LayoutSection[], key: string): LayoutSection[] {
  const list = grouped(sections);
  const found = list.find((s) => s.key === key);
  if (!found) return list;
  const rest = list.filter((s) => s.key !== key);
  const moved = { ...found, pinned: !found.pinned };
  const pinnedCount = rest.filter((s) => s.pinned).length;
  return [...rest.slice(0, pinnedCount), moved, ...rest.slice(pinnedCount)];
}

export function toggleHidden(sections: LayoutSection[], key: string): LayoutSection[] {
  return grouped(sections).map((s) => (s.key === key ? { ...s, hidden: !s.hidden } : s));
}

/** The layout to save: the list as it stands, all of it. */
export function layoutOf(sections: LayoutSection[]): BriefLayout {
  const list = grouped(sections);
  return {
    order: list.map((s) => s.key),
    pinned: list.filter((s) => s.pinned).map((s) => s.key),
    hidden: list.filter((s) => s.hidden).map((s) => s.key),
  };
}
