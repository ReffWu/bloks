// Who may see what in a workspace with other people in it.
//
// Every rule about people and conversations is here, as plain functions
// over plain data, so the whole model can be read in one sitting and a
// test can walk it. The server asks these; nothing else decides.
//
// The model, as the owner decided it:
//
//   A team agent (every agent, unless it is solo) has one shared team
//   conversation. Who is in it is the agent's access list: everyone in the
//   workspace (the default), only some people, or everyone but some. The
//   owner always is; admins are too unless the owner says otherwise.
//
//   Rooms are decided per room: everyone, or chosen people. Anybody in a
//   room meets every agent in it there and can talk to it there, whatever
//   the agent's own access list says.
//
//   Anybody who can reach a team agent (its team conversation, or a room
//   it is in) can also talk to it one to one. That private conversation
//   is theirs: by default nobody else reads it, the owner included. The
//   owner may turn on "Owner and admins can read members' private
//   conversations" for the workspace, and the app tells members which way
//   it is set. The owner's own conversations with an agent are the
//   owner's, as they always were.
//
//   A solo agent is its maker's alone: not listed for anyone else, its
//   conversations theirs, and only they can put it in a room.
//
//   Approvals: in a team conversation or a room, the person whose message
//   started the work, the owner and the admins. In a private conversation
//   or a solo agent, its person (and the owner, for the owner's own).
//
//   Messages on someone's behalf: in a team conversation or a room, the
//   owner or an admin may tell an agent to message someone, and it posts
//   into that person's private conversation with it, marked as sent on
//   their behalf. Only to people who can reach the agent, and never at a
//   member's request: members do not message each other through agents.
import type { WorkspaceRole } from "./people.ts";

/** Somebody asking: the owner, or a member of the workspace. */
export type Who = { kind: "owner" } | { kind: "member"; personId: string; role: WorkspaceRole };

export interface AgentAccess {
  mode: "everyone" | "only" | "except";
  people: string[];
  admins?: boolean;
}

export interface AgentShape {
  id: string;
  solo?: { by: string };
  access?: AgentAccess;
}

export interface LaneShape {
  id: string;
  team?: boolean;
  personId?: string;
}

export interface RoomShape {
  id: string;
  /** The agents in the room. */
  agentIds: string[];
  audience: "everyone" | "some";
  /** Who was chosen, for a room of "some". */
  peopleIds: string[];
}

export interface World {
  rooms: RoomShape[];
  /** "Owner and admins can read members' private conversations". */
  privateReadable: boolean;
}

const isAdmin = (who: Who) => who.kind === "member" && who.role === "admin";
const idOf = (who: Who) => (who.kind === "owner" ? "owner" : who.personId);

/** Whether somebody is in a team agent's shared conversation. */
export function inTeamConversation(agent: AgentShape, who: Who): boolean {
  if (agent.solo) return agent.solo.by === idOf(who);
  if (who.kind === "owner") return true;
  const access = agent.access;
  if (!access || access.mode === "everyone") return true;
  if (isAdmin(who) && access.admins !== false) return true;
  return access.mode === "only" ? access.people.includes(who.personId) : !access.people.includes(who.personId);
}

/** Whether somebody is in a room. The owner is in every room. */
export function inRoom(room: RoomShape, who: Who): boolean {
  if (who.kind === "owner") return true;
  return room.audience === "everyone" || room.peopleIds.includes(who.personId);
}

/** Whether somebody can reach an agent at all: talk to it somewhere, and
 * so open a private conversation with it. */
export function canReach(agent: AgentShape, who: Who, world: World): boolean {
  if (agent.solo) return agent.solo.by === idOf(who);
  if (inTeamConversation(agent, who)) return true;
  return world.rooms.some((room) => room.agentIds.includes(agent.id) && inRoom(room, who));
}

/** Whether an agent is in somebody's list of agents: what they can open
 * directly. A team agent met only in a room is listed too, since they can
 * talk to it one to one; its team conversation stays closed to them. */
export function listed(agent: AgentShape, who: Who, world: World): boolean {
  if (agent.solo) return agent.solo.by === idOf(who);
  return canReach(agent, who, world);
}

/** How somebody may use one of an agent's conversations: write (read and
 * talk), read only, or not at all. */
export function laneAccess(agent: AgentShape, lane: LaneShape, who: Who, world: World): "write" | "read" | null {
  if (agent.solo) return agent.solo.by === idOf(who) ? "write" : null;
  if (lane.team) return inTeamConversation(agent, who) ? "write" : null;
  if (lane.personId) {
    if (who.kind === "member" && who.personId === lane.personId) return canReach(agent, who, world) ? "write" : null;
    if (world.privateReadable && (who.kind === "owner" || isAdmin(who))) return "read";
    return null;
  }
  // one of the owner's own conversations
  return who.kind === "owner" ? "write" : null;
}

/** Whether somebody may answer a card in a conversation or a room.
 * `askedFor` is whose message started the work. */
export function mayAnswer(
  where: { agent: AgentShape; lane: LaneShape } | { room: RoomShape },
  card: { askedFor?: string },
  who: Who,
  world: World,
): boolean {
  if ("room" in where) {
    if (!inRoom(where.room, who)) return false;
    return who.kind === "owner" || isAdmin(who) || card.askedFor === idOf(who);
  }
  const access = laneAccess(where.agent, where.lane, who, world);
  if (access !== "write") return false;
  // private and solo conversations are their person's to decide
  if (where.agent.solo || where.lane.personId || (!where.lane.team && who.kind === "owner")) return true;
  return who.kind === "owner" || isAdmin(who) || card.askedFor === idOf(who);
}

/** Whether an agent may message a person on somebody's behalf: asked by
 * the owner or an admin, from a team conversation or a room, to somebody
 * who can reach the agent. */
export function mayMessageOnBehalf(
  agent: AgentShape,
  from: { asker: Who; where: "team" | "room" | "private" | "owner" | "solo" },
  target: Who,
  world: World,
): boolean {
  if (agent.solo) return false;
  if (from.where !== "team" && from.where !== "room") return false;
  if (from.asker.kind !== "owner" && !isAdmin(from.asker)) return false;
  if (target.kind === "owner") return false;
  return canReach(agent, target, world);
}

/** The line every member is shown about who reads their private
 * conversations, so it is never a surprise either way. */
export function privacyLine(privateReadable: boolean, owner: string): string {
  return privateReadable
    ? `${owner} and the admins can read your private conversations with agents here. They are stored on ${owner}'s computer.`
    : `Your private conversations with agents here are yours: nobody else reads them, ${owner} included. They are stored on ${owner}'s computer.`;
}
