// The catalogue: ready teams and skills, kept in this repository.
//
// A team is the Markdown file server/team-file.ts reads; a skill is a
// SKILL.md in the open format (`name` and `description` at the top, the
// instructions below). `catalog/index.json` lists every item with its
// size and the sha256 of its bytes, and is generated from the files by
// scripts/build-catalog.mjs, never written by hand: a test rebuilds it
// and fails when the two disagree.
//
// The app reads that index from a URL (this repository's main branch
// unless the person points it elsewhere), and the index is what makes a
// download trustworthy. An item whose bytes do not hash to what the
// index says is refused, not installed with a warning: a file that
// changed between the index and the download is not the file anybody
// reviewed.
//
// Installing is the person's decision every time. What arrives is
// shown first as a plan, exactly what will be created (agents, a room,
// skills, routines), and what it creates starts careful: no connected
// apps, no browser, no tool servers, every routine paused.
//
// Everything here is pure. Fetching and the cache live in
// server/catalog-source.ts, and the routes in server/index.ts.
import { createHash } from "node:crypto";

import { diffLines, type DiffLine } from "./checkpoints.ts";
import { hashBody, standing, type Standing } from "./skill-registry.ts";
import { COLORS, parseTeamFile, SHAPES, TeamFileError, writeTeamFile, type TeamFile, type TeamFileMember, type TeamFileRoutine } from "./team-file.ts";

/** This repository's catalogue, as GitHub serves the raw files on main. */
export const CATALOG_URL = "https://raw.githubusercontent.com/hamedgitty/bloks/main/catalog/index.json";
/** How long a fetched index is trusted before asking again. */
export const CATALOG_TTL_MS = 30 * 60 * 1000;
export const CATALOG_INDEX_MAX_BYTES = 512 * 1024;
/** The largest single item: a team file is at most 64 KB and a skill's
 * file a little more than its 16,000 characters can take. */
export const CATALOG_ITEM_MAX_BYTES = 96 * 1024;
export const MAX_CATALOG_ITEMS = 400;
/** A link longer than this is not a link anybody typed or shared. */
export const MAX_LINK_CHARS = 2_048;

export type CatalogKind = "team" | "skill";

/** One item as the index lists it. */
export interface CatalogItem {
  id: string;
  kind: CatalogKind;
  title: string;
  summary: string;
  tags: string[];
  author?: string;
  version: string;
  /** Where the file is, relative to the index. */
  path: string;
  /** Bytes, and the sha256 of exactly those bytes. */
  size: number;
  sha256: string;
  /** A team's members as the list draws them, most senior first: the
   * faces the room will have, so a row shows who is in it rather than an
   * icon every team shares. Only a look; names and briefs stay in the
   * file the install reviews. */
  faces?: CatalogFace[];
}

export interface CatalogFace {
  color: string;
  shape: string;
}

/** As many faces as a row has room for. */
export const MAX_FACES = 4;

export interface CatalogIndex {
  bloksCatalog: 1;
  items: CatalogItem[];
}

export class CatalogError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Where an item lives inside the catalogue folder. Fixed by its kind and
 * id, so an index cannot point a download anywhere else. */
export function itemPath(kind: CatalogKind, id: string): string {
  return kind === "team" ? `teams/${id}.md` : `skills/${id}/SKILL.md`;
}

/** The item's own address: beside the index, on the same host. */
export function itemUrl(indexUrl: string, item: Pick<CatalogItem, "kind" | "id">): string {
  return new URL(itemPath(item.kind, item.id), indexUrl).toString();
}

/** One key for an item across both kinds, as routes and records use it. */
export function itemKey(item: Pick<CatalogItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Reads an index somebody served us. Every field is taken by name and
 * checked again, and an entry that does not survive is dropped rather
 * than failing the catalogue: one bad item should cost that item.
 */
export function parseIndex(value: unknown): CatalogItem[] {
  const list = (value as { items?: unknown })?.items;
  if (!Array.isArray(list)) throw new CatalogError("That is not a catalogue index.", 502);
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const raw of list.slice(0, MAX_CATALOG_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const kind = entry.kind === "team" || entry.kind === "skill" ? entry.kind : null;
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!kind || !SLUG.test(id) || seen.has(`${kind}:${id}`)) continue;
    if (entry.path !== itemPath(kind, id)) continue;
    const sha = typeof entry.sha256 === "string" ? entry.sha256.toLowerCase() : "";
    const size = typeof entry.size === "number" && Number.isInteger(entry.size) ? entry.size : -1;
    if (!HEX64.test(sha) || size <= 0 || size > CATALOG_ITEM_MAX_BYTES) continue;
    const title = text(entry.title, 80);
    if (!title) continue;
    seen.add(`${kind}:${id}`);
    const author = text(entry.author, 60);
    out.push({
      id,
      kind,
      title,
      summary: text(entry.summary, 280),
      tags: Array.isArray(entry.tags)
        ? [...new Set(entry.tags.map((t) => text(t, 24).toLowerCase()).filter(Boolean))].slice(0, 8)
        : [],
      ...(author ? { author } : {}),
      version: text(entry.version, 24) || "1",
      path: itemPath(kind, id),
      size,
      sha256: sha,
      ...(kind === "team" ? facesOf(entry.faces) : {}),
    });
  }
  return out;
}

/** The faces an index entry says a team has, kept only when each is a
 * colour and a shape Bloks draws: the list renders them as they come. */
function facesOf(value: unknown): { faces?: CatalogFace[] } {
  if (!Array.isArray(value)) return {};
  // a bounded look, then the good ones, then as many as a row draws: a
  // bad entry early in the list never pushes a good one out
  const faces = value
    .slice(0, MAX_FACES * 4)
    .filter((f): f is CatalogFace => (COLORS as string[]).includes((f as CatalogFace)?.color) && (SHAPES as string[]).includes((f as CatalogFace)?.shape))
    .slice(0, MAX_FACES)
    .map((f) => ({ color: f.color, shape: f.shape }));
  return faces.length ? { faces } : {};
}

/** Whether these bytes are the item the index describes. */
export function verifyItem(item: Pick<CatalogItem, "size" | "sha256">, bytes: Uint8Array): boolean {
  return bytes.byteLength === item.size && sha256Hex(bytes) === item.sha256;
}

// ── SKILL.md ──────────────────────────────────────────────────────────

/** A skill as its file says it. `name` is the id, as the open format has
 * it; `title` is what a person is shown. */
export interface SkillFile {
  name: string;
  title: string;
  description: string;
  body: string;
  version?: string;
  author?: string;
  tags: string[];
  license?: string;
}

/** Characters, as the skill library counts them (server/skills.ts). */
const MAX_SKILL_BODY = 16_000;

/**
 * Reads a SKILL.md. The top block is flat `key: value` lines, and an
 * optional `metadata:` block of indented ones beneath it, which is where
 * the open format keeps anything of a tool's own: here a title, a
 * version, an author and tags. `expectedId` holds a catalogue file to
 * the rule that a skill's name is its folder's.
 */
export function parseSkillFile(source: string, fallbackId = "skill", expectedId?: string): SkillFile {
  const textIn = source.replace(/^﻿/, "").replace(/\r/g, "");
  const match = textIn.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  const nested: Record<string, string> = {};
  let body = textIn.trim();
  if (match) {
    let inMeta = false;
    for (const line of match[1].split("\n")) {
      const flat = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      const indented = line.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (flat) {
        inMeta = flat[1].toLowerCase() === "metadata" && !flat[2].trim();
        if (!inMeta) meta[flat[1].toLowerCase()] = unquote(flat[2]);
      } else if (inMeta && indented) {
        nested[indented[1].toLowerCase()] = unquote(indented[2]);
      }
    }
    body = match[2].trim();
  }
  if (!body) throw new CatalogError("That skill has no instructions below its top block.");
  if ([...body].length > MAX_SKILL_BODY) {
    throw new CatalogError(`That skill is longer than the ${MAX_SKILL_BODY.toLocaleString("en-US")} characters a skill can be.`, 413);
  }
  const rawName = meta.name ?? "";
  if (expectedId !== undefined && rawName !== expectedId) {
    throw new CatalogError(`A catalogue skill's name is its folder's: expected "${expectedId}", found "${rawName}".`);
  }
  const name = SLUG.test(rawName) ? rawName : slug(rawName || fallbackId);
  const heading = body.match(/^#{1,3}\s+(.+)$/m)?.[1];
  const title = text(nested.title ?? meta.title ?? (SLUG.test(rawName) ? "" : rawName) ?? "", 80) || text(heading, 80) || humanize(name);
  const description = text(meta.description, 200);
  const tagsRaw = nested.tags ?? meta.tags ?? "";
  const tags = [...new Set(tagsRaw.replace(/^\[|\]$/g, "").split(",").map((t) => text(unquote(t), 24).toLowerCase()).filter(Boolean))].slice(0, 8);
  const version = text(nested.version ?? meta.version, 24);
  const author = text(nested.author ?? meta.author, 60);
  const license = text(meta.license, 60);
  return {
    name,
    title,
    description,
    body,
    tags,
    ...(version ? { version } : {}),
    ...(author ? { author } : {}),
    ...(license ? { license } : {}),
  };
}

/** A skill as a SKILL.md, the same shape the catalogue's files have. */
export function writeSkillFile(skill: Omit<SkillFile, "tags"> & { tags?: string[] }): string {
  const one = (value: string) => value.replace(/\s+/g, " ").trim();
  const lines = ["---", `name: ${skill.name}`, `description: ${one(skill.description) || one(skill.title)}`];
  if (skill.license) lines.push(`license: ${one(skill.license)}`);
  lines.push("metadata:", `  title: ${one(skill.title)}`, `  version: "${one(skill.version ?? "1")}"`);
  if (skill.author) lines.push(`  author: ${one(skill.author)}`);
  if (skill.tags?.length) lines.push(`  tags: ${skill.tags.map(one).join(", ")}`);
  lines.push("---", "", skill.body.trim(), "");
  return lines.join("\n");
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "skill"
  );
}

function humanize(id: string): string {
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ── what a file is ────────────────────────────────────────────────────

/**
 * Whether a file from a link or a drop is a team or a skill. The name
 * decides when it says (a SKILL.md, a .team.md); otherwise the top block
 * does (a team has a blurb or member sections, a skill a description).
 */
export function detectKind(source: string, filename = ""): CatalogKind {
  const name = filename.toLowerCase();
  if (/(^|\/)skill\.md$/.test(name)) return "skill";
  if (/\.team\.md$/.test(name) || /(^|\/)teams\//.test(name)) return "team";
  const top = source.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  if (/^blurb\s*:/m.test(top)) return "team";
  if (/^description\s*:/m.test(top)) return "skill";
  try {
    parseTeamFile(source);
    return "team";
  } catch {
    return "skill";
  }
}

// ── links ─────────────────────────────────────────────────────────────

/**
 * A link someone pasted, or a bloks://install link carried, as the one
 * address worth fetching, or why not. Only https: a team or a skill is
 * text that ends up in every turn, and a plain http link can be changed
 * by anybody on the way. A file's page on GitHub becomes its raw file,
 * since that is what was meant.
 */
export function normalizeLink(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "Paste a link to a team or a skill." };
  if (value.length > MAX_LINK_CHARS) return { ok: false, error: "That link is too long." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "That is not a link." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Only https links can be installed from." };
  if (url.username || url.password) return { ok: false, error: "A link with a sign-in in it is not installed from." };
  url.hash = "";
  if (url.hostname === "github.com") {
    // github.com/owner/repo/blob/ref/path, the page a person copies
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && (parts[2] === "blob" || parts[2] === "raw")) {
      url = new URL(`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join("/")}`);
    }
  }
  if (!/\.md$/i.test(url.pathname)) return { ok: false, error: "Link to the file itself: a team's .md file or a skill's SKILL.md." };
  return { ok: true, url: url.toString() };
}

/** The file's name, from the end of its link. */
export function linkFilename(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "";
    // a SKILL.md is named for its folder
    return /^skill\.md$/i.test(last) && parts.length > 1 ? `${parts.at(-2)}/${last}` : last;
  } catch {
    return "";
  }
}

// ── building the index (scripts/build-catalog.mjs, and its test) ─────

export interface CatalogFile {
  /** Relative to the catalogue folder, with forward slashes. */
  path: string;
  bytes: Uint8Array;
}

const LONG_DASH = /[\u2013\u2014]/;
/** Shapes of things that are never in a catalogue item: keys, tokens,
 * and an address that would be somebody's. */
const SECRET_SHAPES: Array<[RegExp, string]> = [
  [/\b(sk|ck|ak|gsk|xai)[-_][A-Za-z0-9_-]{12,}/, "an API key"],
  [/\bblok_live_[0-9a-f]{32}\b/, "a Bloks key"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
];

/** The house voice for a skill: when, what not, what comes back, and
 * what needs a person. A catalogue skill without them is a draft. */
const SKILL_LINES: Array<[RegExp, string]> = [
  [/^Use this when/m, "open with \"Use this when\""],
  [/^1\.\s/m, "number its steps"],
  [/^Not for:/m, "say what it is not for (\"Not for:\")"],
  [/^Return:/m, "say what it returns (\"Return:\")"],
  [/^Approval:/m, "say what needs approval (\"Approval:\")"],
];

/**
 * The index for a set of files, and everything wrong with them. A file
 * that does not read is a problem, not an omission, so the index can
 * never quietly lose an item somebody contributed.
 */
export function buildIndex(files: CatalogFile[]): { index: CatalogIndex; problems: string[] } {
  const problems: string[] = [];
  const items: CatalogItem[] = [];
  const teams: Array<{ id: string; team: TeamFile }> = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const teamMatch = file.path.match(/^teams\/([^/]+)\.md$/);
    const skillMatch = file.path.match(/^skills\/([^/]+)\/SKILL\.md$/);
    if (!teamMatch && !skillMatch) {
      problems.push(`${file.path}: not where an item goes (teams/<id>.md or skills/<id>/SKILL.md)`);
      continue;
    }
    const id = (teamMatch ?? skillMatch)![1];
    if (!SLUG.test(id)) {
      problems.push(`${file.path}: the id "${id}" should be lowercase letters, digits and dashes`);
      continue;
    }
    if (file.bytes.byteLength > CATALOG_ITEM_MAX_BYTES) {
      problems.push(`${file.path}: larger than ${CATALOG_ITEM_MAX_BYTES / 1024} KB`);
      continue;
    }
    let source: string;
    try {
      source = decoder.decode(file.bytes);
    } catch {
      problems.push(`${file.path}: not UTF-8 text`);
      continue;
    }
    if (LONG_DASH.test(source)) problems.push(`${file.path}: uses a long dash; the house style is a comma or a full stop`);
    for (const [shape, what] of SECRET_SHAPES) if (shape.test(source)) problems.push(`${file.path}: contains what looks like ${what}`);
    const base = { id, path: itemPath(teamMatch ? "team" : "skill", id), size: file.bytes.byteLength, sha256: sha256Hex(file.bytes) };
    if (teamMatch) {
      let team: TeamFile;
      try {
        team = parseTeamFile(source);
      } catch (e) {
        problems.push(`${file.path}: ${e instanceof TeamFileError ? e.message : String(e)}`);
        continue;
      }
      if (!team.blurb) problems.push(`${file.path}: give it a blurb, the line people read in the list`);
      if (!team.version) problems.push(`${file.path}: give it a version`);
      if (!team.author) problems.push(`${file.path}: give it an author`);
      teams.push({ id, team });
      items.push({
        ...base,
        kind: "team",
        title: team.name,
        summary: team.blurb,
        tags: team.tags ?? [],
        ...(team.author ? { author: team.author } : {}),
        version: team.version ?? "1",
        faces: [...team.members]
          .sort((a, b) => b.seniority - a.seniority)
          .slice(0, MAX_FACES)
          .map((m) => ({ color: m.color, shape: m.shape })),
      });
    } else {
      let skill: SkillFile;
      try {
        skill = parseSkillFile(source, id, id);
      } catch (e) {
        problems.push(`${file.path}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!skill.description) problems.push(`${file.path}: give it a description, the line that says when to use it`);
      if (!skill.version) problems.push(`${file.path}: give it a version under metadata`);
      if (!skill.author) problems.push(`${file.path}: give it an author under metadata`);
      for (const [line, what] of SKILL_LINES) if (!line.test(skill.body)) problems.push(`${file.path}: ${what}`);
      items.push({
        ...base,
        kind: "skill",
        title: skill.title,
        summary: skill.description,
        tags: skill.tags,
        ...(skill.author ? { author: skill.author } : {}),
        version: skill.version ?? "1",
      });
    }
  }
  // a team that names a skill the catalogue does not have would install
  // with a gap nobody chose
  const skillIds = new Set(items.filter((i) => i.kind === "skill").map((i) => i.id));
  for (const { id, team } of teams) {
    for (const member of team.members) {
      for (const use of member.uses ?? []) {
        if (!skillIds.has(use)) problems.push(`teams/${id}.md: ${member.title} uses "${use}", which is not in skills/`);
      }
    }
  }
  items.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "team" ? -1 : 1));
  // the fields in reading order: what it is first, how to check it last
  const ordered = items.map(({ id, kind, title, summary, tags, author, version, faces, path, size, sha256 }) => ({
    id,
    kind,
    title,
    summary,
    tags,
    ...(author ? { author } : {}),
    version,
    ...(faces?.length ? { faces } : {}),
    path,
    size,
    sha256,
  }));
  return { index: { bloksCatalog: 1, items: ordered }, problems };
}

/** The index as it is written to disk: stable, so a rebuild with no
 * change in the files is no change in git. */
export function serializeIndex(index: CatalogIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

// ── the review: what an install would create ──────────────────────────

/** A skill as the library holds it, for comparing against. */
export interface HeldSkill {
  id: string;
  name: string;
  body: string;
  source: "builtin" | "user";
  registry?: string;
  version?: string;
  sha256?: string;
}

/** A skill a team uses, as the plan reports it. */
export interface PlannedSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  /** install: new to this workspace, and will be added.
   *  installed: already here, the same as the catalogue's.
   *  kept: here already and different; yours is used, nothing replaced.
   *  missing: nowhere to get it from; the member goes without. */
  state: "install" | "installed" | "kept" | "missing";
  says: string;
  /** Who in the team uses it. */
  usedBy: string[];
}

export interface PlannedRoutine {
  /** "room", or the title of the member it is for. */
  target: string;
  name?: string;
  summary: string;
  prompt: string;
  days: number[];
  time: string;
}

export interface TeamPlan {
  kind: "team";
  room: { name: string };
  agents: Array<Pick<TeamFileMember, "title" | "description" | "skills" | "seniority" | "color" | "shape"> & { uses: string[] }>;
  skills: PlannedSkill[];
  routines: PlannedRoutine[];
}

export interface SkillPlan {
  kind: "skill";
  skill: { id: string; name: string; description: string; body: string; version: string };
  standing: Standing;
  /** Against the copy here, when there is one. */
  diff: DiffLine[] | null;
}

const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** When a routine runs, in the words the routines page uses. */
export function routineSummary(routine: Pick<TeamFileRoutine, "days" | "time">): string {
  const same = (list: number[]) => routine.days.length === list.length && routine.days.every((d, i) => d === list[i]);
  if (!routine.days.length) return `Every day at ${routine.time}`;
  if (same([1, 2, 3, 4, 5])) return `Weekdays at ${routine.time}`;
  if (same([0, 6])) return `Weekends at ${routine.time}`;
  if (routine.days.length === 1) return `Every ${DAY_LONG[routine.days[0]]} at ${routine.time}`;
  return `${routine.days.map((d) => DAY_LONG[d].slice(0, 3)).join(", ")} at ${routine.time}`;
}

/** Every routine a team sets up, the room's first. */
export function teamRoutines(team: TeamFile): PlannedRoutine[] {
  const one = (target: string, r: TeamFileRoutine): PlannedRoutine => ({
    target,
    ...(r.name ? { name: r.name } : {}),
    summary: routineSummary(r),
    prompt: r.prompt,
    days: r.days,
    time: r.time,
  });
  return [
    ...(team.routines ?? []).map((r) => one("room", r)),
    ...team.members.flatMap((m) => (m.routines ?? []).map((r) => one(m.title, r))),
  ];
}

/**
 * What hiring this team creates. `available` is the skills that can be
 * fetched for it (from the catalogue, already checked against the
 * index), and `held` the library as it is now.
 */
export function teamPlan(team: TeamFile, available: Map<string, SkillFile>, held: HeldSkill[]): TeamPlan {
  const used = new Map<string, string[]>();
  for (const member of team.members) for (const id of member.uses ?? []) used.set(id, [...(used.get(id) ?? []), member.title]);
  const skills: PlannedSkill[] = [...used.entries()].map(([id, usedBy]) => {
    const here = held.find((s) => s.id === id);
    const offered = available.get(id);
    if (here && (!offered || hashBody(here.body) === hashBody(offered.body))) {
      return { id, name: here.name, description: offered?.description ?? "", body: here.body, state: "installed", says: "Already in your skills", usedBy };
    }
    if (here) {
      return {
        id,
        name: here.name,
        description: offered!.description,
        body: here.body,
        state: "kept",
        says: here.source === "builtin" ? "Bloks has its own skill with this name, and it is used" : "You have a skill with this name, and yours is used",
        usedBy,
      };
    }
    if (offered) {
      return { id, name: offered.title, description: offered.description, body: offered.body, state: "install", says: "New, from the catalogue", usedBy };
    }
    return { id, name: humanize(id), description: "", body: "", state: "missing", says: "Not in the catalogue, so it is left out", usedBy };
  });
  return {
    kind: "team",
    room: { name: team.name },
    agents: team.members.map((m) => ({
      title: m.title,
      description: m.description,
      skills: m.skills,
      seniority: m.seniority,
      color: m.color,
      shape: m.shape,
      uses: m.uses ?? [],
    })),
    skills,
    routines: teamRoutines(team),
  };
}

/** What installing this skill would do to the library. */
export function skillPlan(skill: SkillFile, held: HeldSkill[], fromCatalogue: boolean): SkillPlan {
  const version = skill.version ?? "1";
  const here = held.find((s) => s.id === skill.name) ?? null;
  const entry = { id: skill.name, name: skill.title, description: skill.description, version, tags: skill.tags, body: skill.body, sha256: hashBody(skill.body) };
  // A skill from a link has no catalogue history to compare with: any
  // copy here is somebody's own as far as this install can tell.
  const said = standing(entry, here, fromCatalogue ? here : null);
  return {
    kind: "skill",
    skill: { id: skill.name, name: skill.title, description: skill.description, body: skill.body, version },
    standing: said,
    diff: here && hashBody(here.body) !== entry.sha256 ? diffLines(here.body.trim(), skill.body.trim()) : null,
  };
}

/**
 * Where a catalogue skill stands against the library, in the skill
 * registry's own terms (server/skill-registry.ts), so an edited copy is
 * never offered as an update. Without the file in hand (not fetched
 * yet, and offline) the version is what can be compared.
 */
export function skillItemStanding(item: CatalogItem, here: HeldSkill | null, offered: SkillFile | null): Standing {
  const sha = offered
    ? hashBody(offered.body)
    : here?.registry === item.id && here.version === item.version && here.sha256
      ? here.sha256
      : `version:${item.version}`;
  const entry = { id: item.id, name: item.title, description: item.summary, version: item.version, tags: item.tags, body: offered?.body ?? "", sha256: sha };
  return standing(entry, here, here);
}

/** Where a catalogue team stands: not here, here as offered, or here at
 * an older version, which is an update with what changed. */
export function teamItemStanding(item: CatalogItem, installed: { sha256: string; version: string } | null): Standing {
  if (!installed) return { state: "available", says: "Not installed", action: "Install", destructive: false };
  if (installed.sha256 === item.sha256) {
    return { state: "current", says: `Installed, version ${installed.version}`, action: null, destructive: false };
  }
  return { state: "outdated", says: `Version ${item.version} is available`, action: "Update", destructive: false };
}

// ── updates ───────────────────────────────────────────────────────────

/** One thing that changed between the team installed and the one on
 * offer, in a sentence. */
export interface TeamChange {
  kind: "added" | "removed" | "changed";
  what: "member" | "routine" | "team";
  title: string;
  says: string;
}

const routineKey = (target: string, r: TeamFileRoutine) => `${target.toLowerCase()}|${r.days.join(",")}|${r.time}|${r.prompt}`;

/**
 * What changed between the team as installed and the team on offer,
 * member by member (matched by role) and routine by routine, plus the
 * line diff of the two files for anybody who wants the detail.
 */
export function teamChanges(before: { text: string; team: TeamFile }, after: { text: string; team: TeamFile }): { changes: TeamChange[]; diff: DiffLine[] | null } {
  const changes: TeamChange[] = [];
  const key = (title: string) => title.trim().toLowerCase();
  const was = new Map(before.team.members.map((m) => [key(m.title), m]));
  const now = new Map(after.team.members.map((m) => [key(m.title), m]));
  if (before.team.blurb !== after.team.blurb || before.team.name !== after.team.name) {
    changes.push({ kind: "changed", what: "team", title: after.team.name, says: "The team's name or line changed" });
  }
  for (const [k, member] of now) {
    const old = was.get(k);
    if (!old) {
      changes.push({ kind: "added", what: "member", title: member.title, says: "A new member joins the room" });
      continue;
    }
    const parts: string[] = [];
    if (old.description !== member.description) parts.push("what it does");
    if (old.skills.join("\n") !== member.skills.join("\n")) parts.push("its skills");
    if ((old.uses ?? []).join(",") !== (member.uses ?? []).join(",")) parts.push("the library skills it uses");
    if (old.seniority !== member.seniority) parts.push("its seniority");
    if (parts.length) changes.push({ kind: "changed", what: "member", title: member.title, says: `Changes ${listWords(parts)}` });
  }
  for (const [k, member] of was) {
    if (!now.has(k)) changes.push({ kind: "removed", what: "member", title: member.title, says: "No longer in the team. Your agent stays in the room; remove it yourself if you like" });
  }
  const routinesOf = (team: TeamFile) => {
    const map = new Map<string, { target: string; routine: TeamFileRoutine }>();
    for (const r of team.routines ?? []) map.set(routineKey("room", r), { target: "room", routine: r });
    for (const m of team.members) for (const r of m.routines ?? []) map.set(routineKey(m.title, r), { target: m.title, routine: r });
    return map;
  };
  const oldRoutines = routinesOf(before.team);
  const newRoutines = routinesOf(after.team);
  for (const [k, { target, routine }] of newRoutines) {
    if (!oldRoutines.has(k)) changes.push({ kind: "added", what: "routine", title: routine.name ?? routineSummary(routine), says: `A new routine for ${target === "room" ? "the room" : target}, added paused` });
  }
  for (const [k, { target, routine }] of oldRoutines) {
    if (!newRoutines.has(k)) changes.push({ kind: "removed", what: "routine", title: routine.name ?? routineSummary(routine), says: `No longer in the team. The routine for ${target === "room" ? "the room" : target} stays on your calendar` });
  }
  return { changes, diff: diffLines(before.text.trim(), after.text.trim()) };
}

function listWords(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// ── sharing back ──────────────────────────────────────────────────────

/** What a hire adds to each member's description, which is the person's
 * own project and not part of the team they would share. */
const BRIEF_SUFFIX = /\n*What this team is working on:[\s\S]*$/;

/**
 * Text cleaned for leaving this machine: the secrets this workspace
 * holds, anything shaped like a key, email addresses, phone numbers and
 * the person's home folder. What is left is the job, not the person.
 */
export function scrubForSharing(input: string, secrets: Array<string | undefined | null> = []): string {
  let out = input.replace(BRIEF_SUFFIX, "");
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.split(secret).join("[removed]");
  for (const [shape] of SECRET_SHAPES) out = out.replace(new RegExp(shape.source, "g"), "[removed]");
  return out
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email removed]")
    .replace(/(?<![\w:./-])\+?\d[\d ().-]{7,}\d(?![\w/])/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone removed]" : m))
    .replace(/\/(Users|home)\/[^/\s]+/g, "~")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/g, "~");
}

/** A team as the file a contributor adds to catalog/teams, cleaned. */
export function teamForSharing(
  team: { name: string; blurb?: string; members: Array<Partial<TeamFileMember> & { title?: string }>; routines?: TeamFileRoutine[] },
  secrets: Array<string | undefined | null> = [],
): string {
  const clean = (value: string) => scrubForSharing(value, secrets).trim();
  return writeTeamFile({
    name: clean(team.name),
    ...(team.blurb ? { blurb: clean(team.blurb) } : {}),
    version: "1",
    members: team.members.map((m) => ({
      title: clean(m.title ?? "Member"),
      description: clean(m.description ?? ""),
      skills: (m.skills ?? []).map(clean).filter(Boolean),
      ...(m.uses?.length ? { uses: m.uses } : {}),
      ...(m.routines?.length ? { routines: m.routines.map((r) => ({ ...r, prompt: clean(r.prompt), ...(r.name ? { name: clean(r.name) } : {}) })) } : {}),
      seniority: m.seniority ?? 1,
      ...(m.color ? { color: m.color } : {}),
      ...(m.shape ? { shape: m.shape } : {}),
    })),
    ...(team.routines?.length ? { routines: team.routines.map((r) => ({ ...r, prompt: clean(r.prompt), ...(r.name ? { name: clean(r.name) } : {}) })) } : {}),
  });
}
