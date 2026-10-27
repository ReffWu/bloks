// A team file applied to a workspace, the way a config file is applied
// to a server: as often as you like, changing only what differs.
//
// The hire dialog reads a team file (server/team-file.ts) once and builds
// new agents from it. `bloks-server team apply` reads the same file into a
// workspace that may already have the team: the room is found by its
// name, each member by the name the file gives it, or, for a member the
// file leaves unnamed (most are, like the premade library), by its role
// among the room's members. What matches is updated in place; what is
// missing is hired; what is the same is left alone, so a second apply of
// one file changes nothing at all.
//
// Two things are never done without being asked. Nothing is deleted or
// archived, ever: an agent in the room the file no longer lists is kept,
// and only `--prune` takes it out of the room, the agent itself staying
// in the workspace. And nothing that is not in the file is touched: an
// agent's engine, model, folder, approvals, keys and memory are the
// workspace's, and a hire gets the workspace's own defaults for a new
// agent, as one from the hire dialog does.
//
// The plan is a plain function of the file and the workspace as it is, so
// a dry run and the real thing cannot disagree, and the tests read it
// without a server.
import { MAX_DESCRIPTION_CHARS } from "./limits.ts";
import type { TeamFile, TeamFileMember } from "./team-file.ts";

/** Names given to agents a team file hires without one. Mirrored from
 * NAME_POOL in src/lib/teamLibrary.ts, which the hire dialog draws from,
 * so an agent hired here sounds like one hired there. */
export const NAME_POOL = [
  "Juno", "Miles", "Vera", "Rex", "Luna", "Onyx", "Piper", "Sage",
  "Ivy", "Jett", "Cleo", "Ember", "Zephyr", "Indigo", "Aria", "Felix",
  "Wren", "Kai", "Nyx", "Orion", "Skye", "Remy", "Dash", "Nova",
  "Marlow", "Quincy", "Sable", "Teo", "Freya", "Basil", "Opal", "Ridge",
] as const;

/** The most agents a room holds (server/bloks.ts MAX_MEMBERS). */
const ROOM_SEATS = 8;
const BRIEF_PREFIX = "The brief for this team: ";

export interface AgentNow {
  id: string;
  name: string;
  title: string;
  description: string;
  skills: string[];
  seniority: number;
  color: string;
  shape: string;
  archived: boolean;
  /** May be put in a room: not a member's solo agent. */
  placeable: boolean;
}

export interface RoomNow {
  id: string;
  name: string;
  memberIds: string[];
  leadId: string | null;
  archived: boolean;
  /** The last brief said in the room, if one was. */
  brief: string | null;
}

export interface TeamWorld {
  agents: AgentNow[];
  rooms: RoomNow[];
}

export type FieldName = "title" | "description" | "skills" | "seniority" | "color" | "shape";

export interface FieldChange {
  field: FieldName;
  from: string;
  to: string;
}

export type TeamChange =
  | { kind: "create-room"; name: string }
  | { kind: "hire"; seat: number; title: string; name?: string }
  | { kind: "update"; seat: number; agentId: string; name: string; fields: FieldChange[] }
  | { kind: "join"; seat: number; agentId: string; name: string }
  | { kind: "lead"; from: string | null; to: string }
  | { kind: "brief"; from: string | null; to: string }
  | { kind: "prune"; agentId: string; name: string };

export interface TeamPlan {
  room: { id: string | null; name: string };
  changes: TeamChange[];
  /** Members the file lists that are already exactly as it says. */
  unchanged: string[];
  /** Agents in the room the file does not list, kept unless pruned. */
  extra: Array<{ id: string; name: string }>;
  /** Who fills each of the file's seats: an agent's id, or null for a hire. */
  seats: Array<string | null>;
}

export class TeamPlanError extends Error {}

/** Which sections of the source say how their member looks. The parser
 * fills in a look for a section that says none, and applying that
 * default to an agent that already has a look of its own would repaint
 * it for nothing the file said. */
export function statedLooks(source: string): boolean[] {
  const sections = source.replace(/\r/g, "").split(/^##\s+.+$/m).slice(1);
  // read as parseTeamFile reads a section: its fields and skill bullets,
  // blank lines between them included, until the first line of prose
  return sections.map((body) => {
    for (const line of body.split("\n")) {
      if (!line.trim() || /^\s*[-*]\s+/.test(line)) continue;
      const field = line.match(/^([A-Za-z]+):/);
      if (!field || !["name", "seniority", "look", "color", "shape", "skills"].includes(field[1].toLowerCase())) return false;
      if (["look", "color", "shape"].includes(field[1].toLowerCase())) return true;
    }
    return false;
  });
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const listText = (list: readonly string[]) => list.join("; ");

/** The member a team file crowns: the most senior, the first among equals. */
function leadSeat(members: readonly TeamFileMember[]): number {
  let best = 0;
  members.forEach((m, i) => {
    if (m.seniority > members[best].seniority) best = i;
  });
  return best;
}

/**
 * What applying `team` to `world` would change. `looks` says, per member,
 * whether the file stated its look (statedLooks); `prune` takes members
 * the file does not list out of the room.
 */
export function planTeam(team: TeamFile, world: TeamWorld, opts: { looks?: boolean[]; prune?: boolean } = {}): TeamPlan {
  const room = world.rooms.find((r) => !r.archived && same(r.name, team.name)) ?? null;
  const byId = new Map(world.agents.map((a) => [a.id, a]));
  const inRoom = (room?.memberIds ?? []).map((id) => byId.get(id)).filter((a): a is AgentNow => Boolean(a));
  const changes: TeamChange[] = [];
  const unchanged: string[] = [];
  const taken = new Set<string>();
  const seats: Array<string | null> = [];

  // Two seats cannot both be one agent, so a name given twice is a file
  // mistake, said before anything is touched.
  const named = team.members.map((m) => m.name?.trim().toLowerCase()).filter(Boolean);
  const twice = named.find((n, i) => named.indexOf(n) !== i);
  if (twice) throw new TeamPlanError(`Two members of the file are both called ${team.members.find((m) => m.name?.toLowerCase() === twice)!.name}.`);

  if (!room) changes.push({ kind: "create-room", name: team.name });

  // Named members first: a name is an identity, and a role is only a
  // guess at one, so a named seat is never lost to an unnamed one that
  // happens to share its title.
  const order = team.members.map((_, i) => i).sort((a, b) => Number(Boolean(team.members[b].name)) - Number(Boolean(team.members[a].name)));
  const found = new Map<number, AgentNow>();
  for (const seat of order) {
    const member = team.members[seat];
    let agent: AgentNow | undefined;
    if (member.name) {
      agent =
        inRoom.find((a) => !taken.has(a.id) && same(a.name, member.name!)) ??
        world.agents.find((a) => !a.archived && a.placeable && !taken.has(a.id) && same(a.name, member.name!));
    } else {
      agent = inRoom.find((a) => !taken.has(a.id) && same(a.title, member.title));
    }
    if (agent) {
      taken.add(agent.id);
      found.set(seat, agent);
    }
  }

  team.members.forEach((member, seat) => {
    const agent = found.get(seat);
    seats.push(agent?.id ?? null);
    if (!agent) {
      changes.push({ kind: "hire", seat, title: member.title, ...(member.name ? { name: member.name } : {}) });
      return;
    }
    const fields: FieldChange[] = [];
    const differ = (field: FieldName, now: string, want: string) => {
      if (now !== want) fields.push({ field, from: now, to: want });
    };
    differ("title", agent.title, member.title);
    differ("description", agent.description.slice(0, MAX_DESCRIPTION_CHARS), member.description);
    differ("skills", listText(agent.skills), listText(member.skills));
    differ("seniority", String(agent.seniority), String(member.seniority));
    if (opts.looks?.[seat] !== false) {
      differ("color", agent.color, member.color);
      differ("shape", agent.shape, member.shape);
    }
    const joining = !room || !room.memberIds.includes(agent.id);
    if (joining) changes.push({ kind: "join", seat, agentId: agent.id, name: agent.name });
    if (fields.length) changes.push({ kind: "update", seat, agentId: agent.id, name: agent.name, fields });
    if (!joining && !fields.length) unchanged.push(agent.name);
  });

  const extra = inRoom.filter((a) => !taken.has(a.id)).map((a) => ({ id: a.id, name: a.name }));
  if (opts.prune) for (const a of extra) changes.push({ kind: "prune", agentId: a.id, name: a.name });
  const seated = team.members.length + (opts.prune ? 0 : extra.length);
  if (seated > ROOM_SEATS) {
    throw new TeamPlanError(
      `The room would have ${seated} agents, and a room holds ${ROOM_SEATS}. ${extra.map((a) => a.name).join(", ")} ${extra.length === 1 ? "is" : "are"} in it but not in the file: take them out with --prune, or add them to the file.`,
    );
  }

  // The lead as the file has it, crowned on this room alone, so ranking
  // the team here never moves the lead of another room an agent is in.
  const lead = leadSeat(team.members);
  const leadId = seats[lead];
  const leadName = leadId ? byId.get(leadId)!.name : (team.members[lead].name ?? `the new ${team.members[lead].title}`);
  if (!room || room.leadId !== leadId || leadId === null) {
    const was = room?.leadId ? byId.get(room.leadId)?.name ?? null : null;
    changes.push({ kind: "lead", from: was, to: leadName });
  }

  if (team.blurb && (room?.brief ?? null) !== team.blurb) changes.push({ kind: "brief", from: room?.brief ?? null, to: team.blurb });

  return { room: { id: room?.id ?? null, name: room?.name ?? team.name }, changes, unchanged, extra: opts.prune ? [] : extra, seats };
}

/** The last brief said in a room's transcript, the way apply says one. */
export function briefOf(messages: ReadonlyArray<{ role: string; kind: string; text?: string }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "bot" && m.kind === "text" && m.text?.startsWith(BRIEF_PREFIX)) return m.text.slice(BRIEF_PREFIX.length);
  }
  return null;
}

export const briefText = (brief: string) => `${BRIEF_PREFIX}${brief}`;

/** Names for `count` hires, none of them one the workspace already uses. */
export function drawNames(count: number, taken: Iterable<string>, random: () => number = Math.random): string[] {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const free: string[] = NAME_POOL.filter((n) => !used.has(n.toLowerCase()));
  const shuffled = free.map((n) => [random(), n] as const).sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    let name: string | undefined = shuffled[i];
    for (let n = 2; !name; n++) {
      const tried = `${NAME_POOL[i % NAME_POOL.length]} ${n}`;
      if (!used.has(tried.toLowerCase())) name = tried;
    }
    used.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

/** The plan as lines a person reads in a terminal, a diff of the team:
 * `+` for what is added, `~` for what changes, `-` for what goes. */
export function planLines(plan: TeamPlan): string[] {
  const lines: string[] = [];
  const short = (text: string) => {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > 70 ? `${line.slice(0, 69).trimEnd()}...` : line || "(none)";
  };
  for (const change of plan.changes) {
    switch (change.kind) {
      case "create-room":
        lines.push(`+ room ${change.name}`);
        break;
      case "hire":
        lines.push(`+ hire ${change.name ?? "a new agent"} as ${change.title}`);
        break;
      case "join":
        lines.push(`+ ${change.name} joins the room`);
        break;
      case "update":
        lines.push(`~ ${change.name}`);
        for (const f of change.fields) {
          lines.push(`    - ${f.field}: ${short(f.from)}`);
          lines.push(`    + ${f.field}: ${short(f.to)}`);
        }
        break;
      case "lead":
        lines.push(`~ lead: ${change.from ?? "by seniority"} -> ${change.to}`);
        break;
      case "brief":
        lines.push(`~ brief: ${short(change.to)}`);
        break;
      case "prune":
        lines.push(`- ${change.name} leaves the room (the agent is kept)`);
        break;
    }
  }
  for (const name of plan.unchanged) lines.push(`  ${name}, unchanged`);
  for (const a of plan.extra) lines.push(`  ${a.name} is in the room but not in the file; kept (--prune --yes takes them out)`);
  return lines;
}
