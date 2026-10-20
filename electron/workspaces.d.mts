// Hand-written twin of workspaces.mjs, so the tests typecheck against
// the same shapes the main process uses.
import type { Mark } from "./workspace-marks.mjs";

export type WorkspaceKind = "personal" | "business" | "custom" | "joined";
export type NotifyLevel = "all" | "needs-me" | "nothing";

export interface WorkspaceEntry {
  id: string;
  kind: WorkspaceKind;
  name: string;
  team: boolean;
  mark: Mark | null;
  logo: string | null;
  dataDir: string | null;
  /** A time it runs out, "forever", or null for not muted. */
  mute: number | "forever" | null;
  notify: NotifyLevel;
  order: number;
  port: number | null;
  accent: string | null;
  members: number | null;
  createdAt: number;
  host?: { name: string; relayUrl: string; lan?: string };
  role?: "member" | "admin";
}

export interface Registry {
  version: number;
  current: string;
  prefs: { theme: "light" | "dark" | "system" | null; sameAccent: boolean; accent: string | null };
  workspaces: WorkspaceEntry[];
}

export const REGISTRY_VERSION: number;
export const PERSONAL_ID: string;
export const KINDS: readonly WorkspaceKind[];
export const NOTIFY_LEVELS: readonly NotifyLevel[];
export const MUTE_CHOICES: ReadonlyArray<{ id: string; label: string; ms: number | null }>;
export const NAME_MAX: number;

export function cleanName(name: unknown): string;
export function newId(random?: (n: number) => Buffer): string;
export function normalizeEntry(raw: unknown, index?: number): WorkspaceEntry | null;
export function parseRegistry(text: string | null): Registry;
export function settle(
  registry: Registry,
  options: { personalDataDir: string; now?: number; random?: () => number },
): Registry;
export function marksInUse(registry: Registry, except?: string | null): Mark[];
export function refusal(registry: Registry, input: { kind: string; name: string }, self?: string | null): string | null;
export function addWorkspace(
  registry: Registry,
  input: { kind: string; name: string; team?: boolean; mark?: Mark | null },
  options: { workspacesDir: string; now?: number; random?: () => number; id?: string },
): { registry: Registry; entry: WorkspaceEntry };
export function updateWorkspace(
  registry: Registry,
  id: string,
  patch: Partial<{
    name: string;
    kind: string;
    team: boolean;
    notify: string;
    role: "member" | "admin";
    mute: number | "forever" | null;
    mark: Mark;
    logo: string | null;
    port: number | null;
    accent: string | null;
    members: number | null;
  }>,
  options?: { random?: () => number },
): Registry;
export function accentOf(registry: Registry, id: string | null): string | null;
export function chooseAccent(registry: Registry, id: string | null, accent: unknown): Registry;
export function setSameAccent(registry: Registry, id: string | null, on: boolean, showing?: unknown): { registry: Registry; accent: string | null };
export function rerollMark(registry: Registry, id: string, options?: { random?: () => number }): Registry;
export function removeWorkspace(registry: Registry, id: string): { registry: Registry; removed: WorkspaceEntry };
export function reorder(registry: Registry, ids: string[]): Registry;
export function setCurrent(registry: Registry, id: string): Registry;
export function muteFor(choice: string | null, now?: number): number | "forever" | null;
export function isMuted(entry: Pick<WorkspaceEntry, "mute"> | null | undefined, now?: number): boolean;
export function muteState(
  entry: Pick<WorkspaceEntry, "mute">,
  now?: number,
): { muted: boolean; until: number | "forever" | null };
export function nextMuteEnd(entries: Array<Pick<WorkspaceEntry, "mute">>, now?: number): number | null;
export function allowsNotice(
  entry: Pick<WorkspaceEntry, "mute" | "notify"> | null | undefined,
  level: "needs-me" | "activity",
  now?: number,
): boolean;
export function countsOnBadge(entry: Pick<WorkspaceEntry, "mute" | "notify"> | null | undefined, now?: number): boolean;
export function badgeTotal(
  entries: Array<Pick<WorkspaceEntry, "id" | "mute" | "notify">>,
  counts: Record<string, number>,
  now?: number,
): number;
export function mergeDrains(
  states: Array<{ draining?: boolean; done?: boolean; running?: unknown[]; deadline?: number } | null>,
): { draining: boolean; done: boolean; running: unknown[]; deadline?: number } | null;
export function readRegistry(file: string): Registry;
export function writeRegistry(file: string, registry: Registry): void;
export function configuredPort(dataDir: string): number | null;
export function snapshot(
  registry: Registry,
  live?: Record<string, { status?: string; problem?: string | null; waiting?: number; logo?: string | null }>,
  now?: number,
): {
  available: true;
  current: string;
  workspaces: Array<{
    id: string;
    kind: WorkspaceKind;
    name: string;
    team: boolean;
    mark: Mark | null;
    logo: string | null;
    members: number | null;
    status: string;
    problem: string | null;
    waiting: number;
    notify: NotifyLevel;
    mute: { muted: boolean; until: number | "forever" | null };
    dataDir: string | null;
    host?: string;
    role?: "member" | "admin";
    lanOnly?: boolean;
  }>;
};
