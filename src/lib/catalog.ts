// The catalogue as the page sees it (server/catalog.ts has the whole
// story): the shapes the routes answer with, and the small pure parts of
// browsing, which are searching, filtering by tag and counting.
import type { BlokColor, BlokShape } from "@/lib/mascot";

/** A line of a diff, as server/checkpoints.ts returns it and DiffLines
 * draws it. */
export interface DiffLine {
  kind: "same" | "add" | "del" | "gap";
  text: string;
}

export type CatalogKind = "team" | "skill";

export type CatalogState = "available" | "current" | "outdated" | "edited" | "edited-and-outdated" | "yours" | "bundled";

export interface CatalogStanding {
  state: CatalogState;
  says: string;
  action: string | null;
  destructive: boolean;
}

export interface CatalogRow {
  id: string;
  kind: CatalogKind;
  title: string;
  summary: string;
  tags: string[];
  author?: string;
  version: string;
  size: number;
  sha256: string;
  /** A team's members as their faces, most senior first. */
  faces?: Array<{ color: string; shape: string }>;
  standing: CatalogStanding;
  /** Kept on this computer, so it installs without a connection. */
  offline: boolean;
}

export interface CatalogAnswer {
  items: CatalogRow[];
  updates: number;
  fetchedAt: number;
  offline: boolean;
  error?: string;
  source: { url: string; custom: boolean };
}

export interface TeamRoutine {
  days: number[];
  time: string;
  name?: string;
  prompt: string;
}

export interface TeamMember {
  name?: string;
  title: string;
  description: string;
  skills: string[];
  uses?: string[];
  routines?: TeamRoutine[];
  seniority: number;
  color: BlokColor;
  shape: BlokShape;
}

export interface TeamFile {
  name: string;
  blurb: string;
  members: TeamMember[];
  routines?: TeamRoutine[];
  tags?: string[];
  author?: string;
  version?: string;
}

export interface SkillFile {
  name: string;
  title: string;
  description: string;
  body: string;
  version?: string;
  author?: string;
  tags: string[];
}

export interface PlannedSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  state: "install" | "installed" | "kept" | "missing";
  says: string;
  usedBy: string[];
}

export interface PlannedRoutine {
  target: string;
  name?: string;
  summary: string;
  prompt: string;
}

export interface TeamPlan {
  kind: "team";
  room: { name: string };
  agents: Array<Pick<TeamMember, "title" | "description" | "skills" | "seniority" | "color" | "shape"> & { uses: string[] }>;
  skills: PlannedSkill[];
  routines: PlannedRoutine[];
}

export interface SkillPlan {
  kind: "skill";
  skill: { id: string; name: string; description: string; body: string; version: string };
  standing: CatalogStanding;
  diff: DiffLine[] | null;
}

export interface TeamChange {
  kind: "added" | "removed" | "changed";
  what: "member" | "routine" | "team";
  title: string;
  says: string;
}

interface ReviewBase {
  token: string;
  origin: "catalogue" | "link" | "file";
  item?: Omit<CatalogRow, "standing" | "offline">;
  url?: string;
  host?: string;
  filename?: string;
  sha256: string;
  text: string;
}

export interface TeamReview extends ReviewBase {
  kind: "team";
  team: TeamFile;
  plan: TeamPlan;
  update: {
    roomId: string;
    roomName: string;
    version: string;
    installedAt: number;
    same: boolean;
    changes: TeamChange[];
    diff: DiffLine[] | null;
  } | null;
}

export interface SkillReview extends ReviewBase {
  kind: "skill";
  skill: SkillFile;
  plan: SkillPlan;
}

export type Review = TeamReview | SkillReview;

export interface InstallResult {
  kind: CatalogKind;
  roomId?: string;
  botIds: string[];
  skillIds: string[];
  routineIds: string[];
  notes: string[];
}

/** Items of one kind matching a search and every chosen tag. The search
 * reads the title, the line, the tags and the author, all words in any
 * order, so "sales follow" finds the follow-up plan. */
export function filterCatalog(items: CatalogRow[], kind: CatalogKind, query: string, tags: string[]): CatalogRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (item.kind !== kind) return false;
    if (tags.some((t) => !item.tags.includes(t))) return false;
    const hay = `${item.title} ${item.summary} ${item.tags.join(" ")} ${item.author ?? ""} ${item.id}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The tags worth filtering one kind by, most used first, then by name.
 * A tag on one item is something search finds already, so once there
 * are a few shared ones the rest are left off the row. */
export function tagsOf(items: CatalogRow[], kind: CatalogKind, most = 12): string[] {
  const counts = new Map<string, number>();
  for (const item of items) if (item.kind === kind) for (const t of item.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shared = sorted.filter(([, n]) => n > 1);
  return (shared.length >= 4 ? shared : sorted).slice(0, most).map(([t]) => t);
}

/** How many of one kind have an update waiting. */
export function updatesOf(items: CatalogRow[], kind?: CatalogKind): number {
  return items.filter((i) => (!kind || i.kind === kind) && i.standing.state === "outdated").length;
}

/** "Updated 5 minutes ago", for the line that says how old an offline copy is. */
export function fetchedWords(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
