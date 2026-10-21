// The words of a move between this Mac and the hosted machine, apart from
// the screens (src/components/hosting/), so they can be tested alone.
//
// A move has six steps and says where it is in each of them in a word or
// two; while it sends, how much of it is across. What went wrong is the
// pipeline's own sentence (electron/hosting-move.mjs), shown as it came.
// The keys left behind are grouped by the Settings page they are entered
// on, so each page is one button.
import type { HostingMove, HostingMoveCounts, HostingMoveKey, HostingMoveStep } from "../types/bridge.d.ts";
import { SETTINGS_PAGE_LIST } from "./settingsPages.ts";

export const MOVE_STEPS: ReadonlyArray<{ step: HostingMoveStep; label: string }> = [
  { step: "pairing", label: "Pairing" },
  { step: "packing", label: "Packing" },
  { step: "sending", label: "Sending" },
  { step: "unpacking", label: "Unpacking" },
  { step: "checking", label: "Checking" },
  { step: "done", label: "Done" },
];

const ORDER = MOVE_STEPS.map((s) => s.step);

/** Where a step stands in a move: behind it, the one under way, or to come. */
export function stepState(move: Pick<HostingMove, "step" | "phase">, step: HostingMoveStep): "done" | "now" | "next" {
  if (move.phase === "done") return "done";
  const at = ORDER.indexOf(move.step);
  const here = ORDER.indexOf(step);
  return here < at ? "done" : here === at ? "now" : "next";
}

/** A size as the progress line says it: whole megabytes, one decimal
 * under ten, gigabytes past a thousand. */
export function sizeWords(bytes: number, unit: "MB" | "GB" = bytes >= 1e9 ? "GB" : "MB"): string {
  const n = unit === "GB" ? bytes / 1e9 : bytes / 1e6;
  return n >= 10 || n === 0 ? String(Math.round(n)) : n.toFixed(1);
}

/** "Sending 12 of 340 MB". */
export function sendingWords(sent: number, size: number): string {
  const unit = size >= 1e9 ? "GB" : "MB";
  return `Sending ${sizeWords(Math.min(sent, size), unit)} of ${sizeWords(size, unit)} ${unit}`;
}

/** A step's label in the list: Sending says how far, once it has begun. */
export function stepLabel(move: Pick<HostingMove, "step" | "phase" | "sent" | "size">, step: HostingMoveStep): string {
  const label = MOVE_STEPS.find((s) => s.step === step)?.label ?? step;
  if (step === "sending" && move.size > 0 && stepState(move, "sending") !== "next") return sendingWords(move.sent, move.size);
  return label;
}

/** Where it goes, in the move's own words. */
export function whereTo(move: Pick<HostingMove, "direction" | "to">): string {
  return move.direction === "to-hosted" ? "your hosted machine" : move.to.id ? `${move.to.name} on this Mac` : "this Mac";
}

/** The card's heading for a move as it stands. */
export function headline(move: Pick<HostingMove, "direction" | "from" | "to" | "phase">): string {
  const where = whereTo(move);
  switch (move.phase) {
    case "done":
      return move.direction === "to-hosted" ? `${move.from.name} is on your hosted machine` : `${move.from.name} is on this Mac`;
    case "failed":
      return `${move.from.name} did not move`;
    case "stopped":
      return `Moving ${move.from.name} is stopped`;
    case "later":
      return `Moving ${move.from.name} to ${where}, when you are ready`;
    default:
      return `Moving ${move.from.name} to ${where}`;
  }
}

/** The line under it. */
export function subline(move: Pick<HostingMove, "direction" | "from" | "phase" | "step">): string {
  const here = move.direction === "to-hosted" ? `${move.from.name} on this Mac` : `${move.from.name} on your hosted machine`;
  switch (move.phase) {
    case "done":
      return move.direction === "to-hosted"
        ? "It runs there from now on. The copy on this Mac stays, paused, until you remove it."
        : "It runs here from now on. Your hosted machine is left empty and still running.";
    case "failed":
      return "Both sides are as they were.";
    case "stopped":
    case "later":
      return `${here} runs as it did. Carrying on writes it out again and sends what is new.`;
    case "waiting":
      return "Buying Hosting was the go-ahead, so nothing is asked. Choose another workspace, or put it off.";
    default:
      return move.step === "unpacking" || move.step === "checking"
        ? "Putting it in place there. This part cannot be stopped, and takes a minute."
        : `${here} is paused while it is carried, so nothing it does is left behind.`;
  }
}

/** What a move carries, counted, in one line: "3 agents, 12 conversations
 * and 2 routines". What there are none of is left out. */
export function countsWords(counts: HostingMoveCounts | null | undefined): string {
  if (!counts) return "its agents, conversations, rooms, routines, watchers, workflows and memory";
  const parts = (
    [
      ["agents", "agent", "agents"],
      ["conversations", "conversation", "conversations"],
      ["rooms", "room", "rooms"],
      ["routines", "routine", "routines"],
      ["watchers", "watcher", "watchers"],
      ["workflows", "workflow", "workflows"],
      ["memoryFiles", "memory file", "memory files"],
    ] as const
  )
    .filter(([key]) => counts[key] > 0)
    .map(([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`);
  if (!parts.length) return "nothing yet";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** A Settings page by name. */
export function pageLabel(page: string): string {
  return SETTINGS_PAGE_LIST.find((p) => p.id === page)?.label ?? "Settings";
}

/** The keys to enter again, one group per Settings page, in the order the
 * keys came. With Bloks AI in the plan, its own key is not one of them:
 * agents run on it there already. */
export function keyGroups(keys: HostingMoveKey[] | null | undefined, bloksAi: boolean): Array<{ page: string; label: string; items: string[] }> {
  const groups: Array<{ page: string; label: string; items: string[] }> = [];
  for (const key of keys ?? []) {
    if (bloksAi && key.page === "plan") continue;
    let group = groups.find((g) => g.page === key.page);
    if (!group) {
      group = { page: key.page, label: pageLabel(key.page), items: [] };
      groups.push(group);
    }
    if (!group.items.includes(key.label)) group.items.push(key.label);
  }
  return groups;
}

export const BLOKS_AI_LINE = "Your plan includes Bloks AI, so agents already run on it there, with nothing to sign in to.";
export const STILL_PAID_LINE = "Hosting is still paid for. Change or end it in Settings, Plan.";
