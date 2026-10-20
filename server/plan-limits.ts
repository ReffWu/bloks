// What each plan allows, in one place, so the room door (server/index.ts)
// and the workspace door (server/members.ts) read the same numbers.
//
// Two different kinds of people are counted here, and they are not the
// same thing. `members` is how many people one shared room holds through
// the room's own invite (the old share flow): Bloks Cloud has that, for
// one room. `workspaceMembers` is people let into the whole workspace by a
// workspace invite, which is Bloks Team's alone.

export type Plan = "cloud" | "team";

export const PLAN_LIMITS = {
  cloud: { rooms: 1, members: 2, workspaceMembers: 0 },
  team: { rooms: Number.POSITIVE_INFINITY, members: 10, workspaceMembers: 10 },
} as const;

/** The most people besides the owner a workspace may hold. No plan at all
 * holds nobody: a workspace with other people in it is Bloks Team's. */
export function workspaceMemberLimit(plan: Plan | null): number {
  return plan ? PLAN_LIMITS[plan].workspaceMembers : 0;
}

/** Whether the workspace's members are let in right now. Nothing is ever
 * deleted when they are not: the same people come back with the plan. */
export function membersActive(plan: Plan | null): boolean {
  return plan === "team";
}

/**
 * Whether a room may be shared with guests of its own (the old share
 * flow). Team always. Cloud only for a licence the relay says holds a
 * shared room: those bought before rooms became Team's. A relay too old
 * to say (`sharedRoom` null or absent) keeps what Cloud always had. No
 * plan, no sharing. Rooms shared already keep their guests either way:
 * this only decides who new comes in.
 */
export function roomSharingAllowed(plan: Plan | null, sharedRoom: boolean | null | undefined): boolean {
  if (plan === "team") return true;
  if (plan === "cloud") return sharedRoom !== false;
  return false;
}

/** What the owner hears when a room cannot take anybody new because
 * sharing rooms is Team's on their licence. */
export const ROOM_SHARING_WORDS = "Sharing rooms needs Bloks Team.";

/** What a member hears while the owner is not on Bloks Team. */
export function pausedWords(owner: string): string {
  return `${owner}'s workspace needs Bloks Team for members right now.`;
}

/** What the owner or an admin hears when they try to let somebody in. */
export function teamRequiredWords(workspace: string): string {
  return `Inviting people to ${workspace} needs Bloks Team.`;
}
