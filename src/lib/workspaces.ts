// The workspaces on this computer, as the window sees them.
//
// The list belongs to the main process (electron/workspaces.mjs); this
// keeps one copy of it for every component that draws a workspace, and
// says the small things those components say the same way: "Just me" or
// how many people, how long a mute lasts, which number key reaches which
// workspace. Outside the desktop app there are no workspaces, and every
// piece of this answers as if there were one.
import { useSyncExternalStore } from "react";
import type { WorkspaceInfo, WorkspacesState } from "@/types/bridge";

let state: WorkspacesState = { available: false };
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function start() {
  if (started) return;
  started = true;
  const bridge = typeof window === "undefined" ? undefined : window.bloks;
  if (!bridge?.workspacesState) return;
  bridge.onWorkspaces?.((next) => {
    state = next;
    emit();
  });
  void bridge
    .workspacesState()
    .then((next) => {
      state = next;
      emit();
    })
    .catch(() => {});
}

const subscribe = (l: () => void) => {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
};
const read = () => state;

export function useWorkspaces(): WorkspacesState {
  return useSyncExternalStore(subscribe, read, read);
}

/** The workspace this window shows, when there are workspaces. */
export function currentWorkspace(s: WorkspacesState): WorkspaceInfo | null {
  return s.available ? (s.workspaces.find((w) => w.id === s.current) ?? null) : null;
}

/** "Just me", how many people, or "Team" before anyone has counted. A
 * workspace you joined says what you are there instead. */
export function peopleLabel(ws: Pick<WorkspaceInfo, "team" | "members" | "kind"> & { role?: "member" | "admin" }): string {
  if (ws.kind === "joined") return ws.role === "admin" ? "Admin" : "Member";
  if (!ws.team) return "Just me";
  if (ws.members === null) return "Team";
  return ws.members === 1 ? "1 member" : `${ws.members} members`;
}

/** The plain line a joined workspace reached only on its owner's own
 * network carries, or your hosted one, or null. */
export function reachLine(ws: Pick<WorkspaceInfo, "kind" | "host"> & { lanOnly?: boolean }): string | null {
  if (ws.kind === "hosted") return "Runs on your hosted machine, reached through Bloks Cloud. It keeps working when this computer is off.";
  if (ws.kind !== "joined" || !ws.lanOnly) return null;
  return `Reached only on ${ws.host ? `${ws.host}'s` : "its owner's"} network. Away from it, this workspace waits until you are back.`;
}

/** What the kind is called on its own line, under a name. */
export function kindLabel(ws: Pick<WorkspaceInfo, "kind" | "team">): string {
  if (ws.kind === "joined") return "Joined workspace";
  if (ws.kind === "hosted") return "Hosted workspace";
  return ws.team ? "Team workspace" : "Just me";
}

/** The mute menu's choices, in the order it lists them; the main process
 * holds the same list (electron/workspaces.mjs MUTE_CHOICES). */
export const MUTE_CHOICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "15m", label: "For 15 minutes" },
  { id: "1h", label: "For 1 hour" },
  { id: "3h", label: "For 3 hours" },
  { id: "8h", label: "For 8 hours" },
  { id: "24h", label: "For 24 hours" },
  { id: "forever", label: "Until I turn it back on" },
];

/** How a mute reads beside its switch: "Until 3:40 PM", "Until tomorrow,
 * 9:00 AM", "Until you turn it back on", or null when not muted. */
export function muteLabel(mute: WorkspaceInfo["mute"], now = Date.now()): string | null {
  if (!mute.muted) return null;
  if (mute.until === "forever" || mute.until === null) return "Until you turn it back on";
  const at = new Date(mute.until);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date(now);
  const sameDay = at.toDateString() === today.toDateString();
  if (sameDay) return `Until ${time}`;
  const tomorrow = new Date(now + 86_400_000);
  if (at.toDateString() === tomorrow.toDateString()) return `Until tomorrow, ${time}`;
  return `Until ${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** The workspace ⌘1 to ⌘9 reach: the nth in the list, as the switcher
 * lists them. */
export function workspaceForKey(s: WorkspacesState, digit: number): WorkspaceInfo | null {
  if (!s.available || digit < 1 || digit > 9) return null;
  return s.workspaces[digit - 1] ?? null;
}

/** Whether anything is worth a dot beside a workspace in the switcher:
 * something waiting there, while you are somewhere else. */
export function hasWaiting(ws: WorkspaceInfo, current: string): boolean {
  return ws.id !== current && ws.waiting > 0;
}

// ── the dialogs a workspace opens from anywhere ────────────────────────
// New workspace and Join a workspace open from the switcher, the command
// palette and the settings, so whether each is open lives here rather
// than in any one of them (the way confirm() works, ui/confirm.tsx).

type Dialog = "new" | "join" | null;
let dialog: Dialog = null;
const dialogListeners = new Set<() => void>();
const subscribeDialog = (l: () => void) => {
  dialogListeners.add(l);
  return () => dialogListeners.delete(l);
};

export function openWorkspaceDialog(which: Dialog) {
  dialog = which;
  dialogListeners.forEach((l) => l());
}

export function useWorkspaceDialog(): Dialog {
  return useSyncExternalStore(subscribeDialog, () => dialog, () => dialog);
}

/** A workspace action's answer, as an error to show or nothing. */
export async function act(work: Promise<{ error?: string } | undefined> | undefined): Promise<string | null> {
  try {
    const said = await work;
    return said?.error ?? null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
