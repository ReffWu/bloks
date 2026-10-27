// A team as one Markdown file.
//
// The JSON manifest a room exports is exact and unreadable. A team worth
// sharing is one somebody wrote on purpose, so the file is prose first:
// a title, a line on what the team is for, and one section per member,
// headed by the role, with the member's brief as the body. The few things
// that are not prose ride as `key: value` lines at the top of a section.
//
//   ---
//   name: Launch crew
//   blurb: Ships a product launch, end to end.
//   ---
//
//   ## Launch lead
//   seniority: 5
//   look: blue star
//   skills:
//   - Review everything before it ships
//   - Keep the plan to one page
//
//   Runs the launch. Reviews what comes back and makes the call.
//
// Members carry no names, like the premade library: a name is assigned
// when the team is hired. A file that does carry one (`name:` in a
// section) keeps it as a suggestion.
//
// Two more things a team can carry, both optional, both written so a
// person reading the file sees exactly what hiring it would set up:
//
//   uses: launch-checklist, release-notes
//     library skills a member works with, by id. A catalogue install
//     fetches them, shows them for review and attaches them.
//
//   routine: weekdays 09:00 | Stand-up | One line each: what moved.
//     work on a schedule: in the block at the top for the room, or in a
//     member's section for that member alone. When, an optional name,
//     then what is said. Hired routines start paused.
//
// Everything is clamped to the same limits the import route applies, and
// a file that cannot be read says which line, rather than hiring half a
// team. The gallery on bloks.dev is checked with this same parser before
// anything reaches the hire dialog.
import {
  MAX_DESCRIPTION_CHARS,
  MAX_NAME_CHARS,
  MAX_SKILL_CHARS,
  MAX_SKILLS,
  MAX_TITLE_CHARS,
} from "./limits.ts";
import type { BlokColor, BlokShape } from "./store.ts";

export const TEAM_FILE_MAX_BYTES = 64 * 1024;
/** The most seats a room holds (server/bloks.ts). */
const MAX_TEAM_MEMBERS = 8;

export const COLORS: BlokColor[] = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral"];
export const SHAPES: BlokShape[] = ["star", "burst", "diamond", "bit", "triangle", "cloud", "drop", "invader"];

/** The most routines one file sets up, the room's and its members'
 * together: a team is a starting point, not a schedule to audit. */
export const MAX_TEAM_ROUTINES = 8;
/** A routine line is one line of a file; its prompt is kept to this. */
export const MAX_ROUTINE_LINE = 1_000;

/** Work on a schedule, as a line of a team file says it. `days` is 0 for
 * Sunday through 6, empty for every day; `time` is "HH:MM", 24 hour. */
export interface TeamFileRoutine {
  days: number[];
  time: string;
  name?: string;
  prompt: string;
}

export interface TeamFileMember {
  name?: string;
  title: string;
  description: string;
  skills: string[];
  /** Library skills, by id, this member is given at hire. */
  uses?: string[];
  /** This member's own routines. */
  routines?: TeamFileRoutine[];
  seniority: number;
  color: BlokColor;
  shape: BlokShape;
}

export interface TeamFile {
  name: string;
  blurb: string;
  members: TeamFileMember[];
  /** The room's routines: said to the whole room. */
  routines?: TeamFileRoutine[];
  /** For a catalogue: free words to find it by, who wrote it, and which
   * version this is. None of them changes what a hire sets up. */
  tags?: string[];
  author?: string;
  version?: string;
}

export class TeamFileError extends Error {}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max).trimEnd() : text);
/** No dashes of the long kinds, whatever an author typed; the house style. */
const plain = (text: string) => text.replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/\r/g, "");

/**
 * Reads a team file. Throws TeamFileError with a sentence a person can act
 * on; anything it returns is within every limit.
 */
export function parseTeamFile(source: string): TeamFile {
  if (Buffer.byteLength(source, "utf8") > TEAM_FILE_MAX_BYTES) throw new TeamFileError("That file is too large to be a team.");
  const text = plain(source).replace(/^\uFEFF/, "");
  const lines = text.split("\n");
  let at = 0;
  const head: Record<string, string> = {};
  // the one key at the top that may come more than once
  const roomRoutines: TeamFileRoutine[] = [];
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    const close = end === -1 ? lines.findIndex((l, i) => i > 0 && l.trim() === "---") : end;
    if (close === -1) throw new TeamFileError("The block at the top opens with --- but never closes.");
    for (const [offset, line] of lines.slice(1, close).entries()) {
      const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (key === "routine") roomRoutines.push(parseRoutineLine(m[2], `the routine on line ${offset + 2}`));
      else head[key] = m[2].trim();
    }
    at = close + 1;
  }
  // a "# Title" line also names the team, for files written without the block
  let name = head.name ?? "";
  const members: TeamFileMember[] = [];
  let current: { head: string; lineNo: number; body: string[] } | null = null;
  const sections: Array<{ head: string; lineNo: number; body: string[] }> = [];
  const intro: string[] = [];
  for (let i = at; i < lines.length; i++) {
    const line = lines[i];
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    if (h1 && !current && !name) {
      name = h1[1].trim();
      continue;
    }
    if (h2) {
      current = { head: h2[1].trim(), lineNo: i + 1, body: [] };
      sections.push(current);
      continue;
    }
    if (current) current.body.push(line);
    else intro.push(line);
  }
  name = clip(name.trim(), MAX_NAME_CHARS);
  if (!name) throw new TeamFileError("Give the team a name: `name:` at the top, or a `# Title` line.");
  const blurb = clip((head.blurb ?? head.description ?? intro.join(" ").replace(/\s+/g, " ")).trim(), 280);
  if (sections.length < 2) throw new TeamFileError("A team needs at least two members, each a `## Role` section.");
  if (sections.length > MAX_TEAM_MEMBERS) throw new TeamFileError(`A room holds up to ${MAX_TEAM_MEMBERS} members; this file has ${sections.length}.`);

  for (const [index, section] of sections.entries()) {
    const fields: Record<string, string> = {};
    const skills: string[] = [];
    const uses: string[] = [];
    const routines: TeamFileRoutine[] = [];
    const body: string[] = [];
    // which list a run of bullets belongs to, while one is open
    let inList: "skills" | "uses" | null = null;
    let inBody = false;
    const where = `the ${section.head} section (line ${section.lineNo})`;
    for (const [offset, raw] of section.body.entries()) {
      const line = raw.trimEnd();
      if (!inBody) {
        const bullet = line.match(/^\s*[-*]\s+(.+)$/);
        if (inList && bullet) {
          (inList === "skills" ? skills : uses).push(bullet[1].trim());
          continue;
        }
        const field = line.match(/^([A-Za-z]+):\s*(.*)$/);
        if (field && MEMBER_FIELDS.includes(field[1].toLowerCase())) {
          const key = field[1].toLowerCase();
          const value = field[2].trim();
          inList = key === "skills" || key === "uses" ? key : null;
          if (key === "skills") skills.push(...value.split(/\s*;\s*/).filter(Boolean));
          else if (key === "uses") uses.push(...value.split(/[\s,;]+/).filter(Boolean));
          else if (key === "routine") routines.push(parseRoutineLine(value, `the routine on line ${section.lineNo + offset + 1}`));
          else fields[key] = value;
          continue;
        }
        if (!line.trim()) {
          inList = null;
          continue;
        }
        inBody = true;
      }
      body.push(raw);
    }
    const seniorityRaw = fields.seniority ?? "";
    const seniority = seniorityRaw ? Number(seniorityRaw) : 1;
    if (!Number.isInteger(seniority) || seniority < 1 || seniority > 5) {
      throw new TeamFileError(`Seniority in ${where} should be a whole number from 1 to 5.`);
    }
    const look = (fields.look ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const color = (fields.color?.toLowerCase() ?? look.find((w) => (COLORS as string[]).includes(w))) as BlokColor | undefined;
    const shape = (fields.shape?.toLowerCase() ?? look.find((w) => (SHAPES as string[]).includes(w))) as BlokShape | undefined;
    if (color && !COLORS.includes(color)) throw new TeamFileError(`The color in ${where} should be one of ${COLORS.join(", ")}.`);
    if (shape && !SHAPES.includes(shape)) throw new TeamFileError(`The shape in ${where} should be one of ${SHAPES.join(", ")}.`);
    const description = clip(body.join("\n").trim(), MAX_DESCRIPTION_CHARS);
    if (!description) throw new TeamFileError(`Say what the member in ${where} does, as a line or two under its heading.`);
    // A skill id is a slug, the same rule the library files by, so one
    // that is not cannot name a file outside it.
    const badUse = uses.find((id) => !SKILL_ID.test(id));
    if (badUse) throw new TeamFileError(`"${badUse}" in ${where} is not a skill id: lowercase letters, digits and dashes.`);
    members.push({
      ...(fields.name ? { name: clip(fields.name, MAX_NAME_CHARS) } : {}),
      title: clip(section.head, MAX_TITLE_CHARS),
      description,
      skills: skills.map((s) => clip(s, MAX_SKILL_CHARS)).filter(Boolean).slice(0, MAX_SKILLS),
      ...(uses.length ? { uses: [...new Set(uses)].slice(0, MAX_SKILLS) } : {}),
      ...(routines.length ? { routines } : {}),
      seniority,
      color: color ?? COLORS[index % COLORS.length],
      shape: shape ?? SHAPES[index % SHAPES.length],
    });
  }
  const routineCount = roomRoutines.length + members.reduce((n, m) => n + (m.routines?.length ?? 0), 0);
  if (routineCount > MAX_TEAM_ROUTINES) {
    throw new TeamFileError(`A team sets up at most ${MAX_TEAM_ROUTINES} routines; this file has ${routineCount}.`);
  }
  // A room reviews under its most senior member. A file where two tie at
  // the top is fine; one with nobody above 1 still gets a lead: the first.
  if (members.every((m) => m.seniority === 1)) members[0].seniority = 5;
  const tags = (head.tags ?? "")
    .split(/\s*,\s*/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[a-z0-9][a-z0-9 -]{0,23}$/.test(t))
    .slice(0, 8);
  return {
    name,
    blurb,
    members,
    ...(roomRoutines.length ? { routines: roomRoutines } : {}),
    ...(tags.length ? { tags } : {}),
    ...(head.author ? { author: clip(head.author, 60) } : {}),
    ...(head.version ? { version: clip(head.version, 24) } : {}),
  };
}

const MEMBER_FIELDS = ["name", "seniority", "look", "color", "shape", "skills", "uses", "routine"];
const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** Every way a day is written that reads as that day: "mon", "monday",
 * "mondays", "tues", "thurs". "monsoon" starts like one and is not. */
const DAY_WORD = /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)$|^(sun|mon|tues|wednes|thurs|fri|satur)days?$/;

/**
 * One routine line: when, an optional name, and what is said, split by
 * `|`. When is a time on a 24 hour clock after the days it runs on:
 * `daily 08:30`, `weekdays 09:00`, `weekends 10:00`, `mon wed fri 17:00`,
 * `fridays 16:00`. Said back with where it is when it does not read.
 */
export function parseRoutineLine(raw: string, where = "a routine"): TeamFileRoutine {
  const parts = raw.split("|").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || !parts.at(-1)) {
    throw new TeamFileError(`Write ${where} as when | what to say, or when | a name | what to say.`);
  }
  const when = parts[0].toLowerCase().replace(/,/g, " ").replace(/\s+and\s+/g, " ").replace(/\s+/g, " ").trim();
  const timeMatch = when.match(/(?:^|\s)(?:at\s+)?(\d{1,2}):(\d{2})$/);
  const hours = timeMatch ? Number(timeMatch[1]) : NaN;
  const minutes = timeMatch ? Number(timeMatch[2]) : NaN;
  if (!timeMatch || hours > 23 || minutes > 59) {
    throw new TeamFileError(`Give ${where} a time on a 24 hour clock, such as weekdays 09:00.`);
  }
  const dayWords = when
    .slice(0, timeMatch.index)
    .split(" ")
    .filter((w) => w && w !== "every" && w !== "on");
  let days: number[] = [];
  for (const word of dayWords) {
    if (word === "daily" || word === "day") continue;
    if (word === "weekdays") days.push(1, 2, 3, 4, 5);
    else if (word === "weekends") days.push(0, 6);
    else if (DAY_WORD.test(word)) days.push(DAY_NAMES.indexOf(word.slice(0, 3)));
    else throw new TeamFileError(`"${word}" in ${where} is not a day. Use daily, weekdays, weekends or day names.`);
  }
  days = [...new Set(days)].sort();
  if (days.length === 7) days = [];
  const name = parts.length === 3 ? clip(oneLine(parts[1]), 60) : "";
  const prompt = clip(oneLine(parts.at(-1)!), MAX_ROUTINE_LINE);
  return {
    days,
    time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    ...(name ? { name } : {}),
    prompt,
  };
}

/** A routine back as the line it was read from. */
export function writeRoutineLine(routine: TeamFileRoutine): string {
  const same = (list: number[]) => routine.days.length === list.length && routine.days.every((d, i) => d === list[i]);
  const when = !routine.days.length
    ? "daily"
    : same([1, 2, 3, 4, 5])
      ? "weekdays"
      : same([0, 6])
        ? "weekends"
        : routine.days.map((d) => DAY_NAMES[d]).join(" ");
  // a bar inside the words would read as the next part of the line
  const bare = (text: string) => oneLine(text).replace(/\|/g, "/");
  return [`${when} ${routine.time}`, ...(routine.name ? [bare(routine.name)] : []), bare(routine.prompt)].join(" | ");
}

/** Writes a team back out as a file someone would want to read. */
export function writeTeamFile(team: {
  name: string;
  blurb?: string;
  members: Array<Partial<TeamFileMember> & { title?: string }>;
  routines?: TeamFileRoutine[];
  tags?: string[];
  author?: string;
  version?: string;
}): string {
  const out: string[] = ["---", `name: ${oneLine(team.name) || "A team"}`];
  if (team.blurb?.trim()) out.push(`blurb: ${oneLine(team.blurb)}`);
  if (team.tags?.length) out.push(`tags: ${team.tags.map(oneLine).join(", ")}`);
  if (team.author?.trim()) out.push(`author: ${oneLine(team.author)}`);
  if (team.version?.trim()) out.push(`version: ${oneLine(team.version)}`);
  for (const routine of team.routines ?? []) out.push(`routine: ${writeRoutineLine(routine)}`);
  out.push("---", "");
  for (const member of team.members) {
    out.push(`## ${oneLine(member.title || member.name || "Member")}`);
    if (member.name) out.push(`name: ${oneLine(member.name)}`);
    out.push(`seniority: ${member.seniority ?? 1}`);
    if (member.color || member.shape) out.push(`look: ${[member.color, member.shape].filter(Boolean).join(" ")}`);
    const skills = (member.skills ?? []).map(oneLine).filter(Boolean);
    if (skills.length) {
      out.push("skills:");
      for (const skill of skills) out.push(`- ${skill}`);
    }
    if (member.uses?.length) out.push(`uses: ${member.uses.join(", ")}`);
    for (const routine of member.routines ?? []) out.push(`routine: ${writeRoutineLine(routine)}`);
    out.push("", plain(member.description?.trim() || "Works on whatever the lead hands over."), "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function oneLine(text: string): string {
  return plain(text).replace(/\s+/g, " ").trim();
}

// ── the gallery ───────────────────────────────────────────────────────

export const GALLERY_URL = "https://bloks.dev/teams/index.json";
export const GALLERY_MAX_BYTES = 1024 * 1024;

export interface GalleryTeam extends TeamFile {
  slug: string;
  author?: string;
}

/**
 * The gallery's index as teams, each read with the same parser a file
 * from a friend gets. An entry that does not parse is left out rather
 * than shown broken; the gallery is ours, but the rule is the same.
 */
export function parseGallery(value: unknown): GalleryTeam[] {
  const list = Array.isArray((value as { teams?: unknown })?.teams) ? (value as { teams: unknown[] }).teams : [];
  const out: GalleryTeam[] = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, 200)) {
    const entry = raw as Record<string, unknown>;
    const slug = typeof entry?.slug === "string" ? entry.slug : "";
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) || seen.has(slug) || typeof entry.file !== "string") continue;
    try {
      const team = parseTeamFile(entry.file);
      seen.add(slug);
      out.push({ slug, ...team, ...(typeof entry.author === "string" ? { author: entry.author.slice(0, 60) } : {}) });
    } catch {
      /* not shown */
    }
  }
  return out;
}

/** A JSON manifest from an older export, read as a team file would be. */
export function teamFromManifest(value: unknown): TeamFile {
  const manifest = value as { name?: unknown; members?: unknown };
  if (!manifest || !Array.isArray(manifest.members)) throw new TeamFileError("That is not a team file.");
  const rows = manifest.members as Array<Record<string, unknown>>;
  return parseTeamFile(
    writeTeamFile({
      name: typeof manifest.name === "string" ? manifest.name : "A team",
      members: rows.map((row) => ({
        ...(typeof row.name === "string" ? { name: row.name } : {}),
        title: typeof row.title === "string" && row.title ? row.title : typeof row.name === "string" ? row.name : "Member",
        description: typeof row.description === "string" ? row.description : "",
        skills: Array.isArray(row.skills) ? row.skills.filter((s): s is string => typeof s === "string") : [],
        seniority: typeof row.seniority === "number" ? Math.max(1, Math.min(5, Math.round(row.seniority))) : 1,
        ...(COLORS.includes(row.color as BlokColor) ? { color: row.color as BlokColor } : {}),
        ...(SHAPES.includes(row.shape as BlokShape) ? { shape: row.shape as BlokShape } : {}),
      })),
    }),
  );
}
