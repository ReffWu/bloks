// The workspace's people, as the window sees them (server/members.ts).
//
// Shapes for the Members page and the join dialog, the calls they make,
// and one small bus for the server's "workspace." frames: the store hands
// them over as they arrive (src/state/store.tsx) and whatever is listening
// (the Members page, the switcher's badge) hears them. The bus also does
// the two things that must happen whether or not the page is open: a
// notification when somebody asks to join, and the waiting count the
// switcher shows.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/state/store";
import { openWorkspaceDialog } from "@/lib/workspaces";

export type WorkspaceRole = "admin" | "member";
export type Role = WorkspaceRole | "owner";

export interface WorkspaceMark {
  color: string;
  pattern: string;
}

export interface Workspace {
  id: string;
  name: string;
  kind: string;
  mark: WorkspaceMark;
}

export interface MemberLimit {
  monthlyUsd: number | null;
  aiPercent: number | null;
  maxSolo: number;
  engines: string[] | null;
}

export interface Member {
  id: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: number;
  invitedBy: string;
  device: "iphone" | "mac" | "browser" | null;
  devices: number;
  lastActive: number | null;
  soloAgents: number;
  spend?: { month: string; usd: number; aiPercent: number | null };
  limits?: MemberLimit;
}

export interface Invite {
  id: string;
  publicId: string;
  code: string;
  link: string;
  name: string | null;
  role: WorkspaceRole;
  createdAt: number;
  expiresAt: number;
  invitedBy: string;
  status: string;
  online: boolean;
}

export interface JoinRequest {
  inviteId: string;
  name: string;
  forName: string | null;
  role: WorkspaceRole;
  device: "iphone" | "mac" | "browser";
  at: number;
  password: "correct" | "none";
  phrase: string | null;
  via: "relay" | "lan";
  expiresAt: number;
}

export interface MembersData {
  workspace: Workspace;
  you: { role: Role; personId: string | null };
  owner: { name: string };
  members: Member[];
  invites?: Invite[];
  requests?: JoinRequest[];
  joining?: { password: { setAt: number } | null; approveEach: boolean; privateReadable: boolean };
  engines?: Array<{ id: string; name: string }>;
  privacy: { privateReadable: boolean; line: string };
  plan: "cloud" | "team" | null;
  limit: number | null;
  online: { available: boolean; why?: string };
}

export interface AgentAccessRow {
  id: string;
  name: string;
  color: string;
  shape: string | null;
  solo: boolean;
  access: { mode: "everyone" | "only" | "except"; people: string[]; admins: boolean } | null;
}

export const ROLE_NAME: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };
export const DEVICE_NAME = { iphone: "an iPhone", mac: "a Mac", browser: "a browser" } as const;

export const membersApi = {
  list: (): Promise<MembersData> => api("/api/workspace/members"),
  invite: (body: { name?: string; role: WorkspaceRole }): Promise<{ invite: Invite; online: MembersData["online"] }> =>
    api("/api/workspace/invites", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => api(`/api/workspace/invites/${id}`, { method: "DELETE" }),
  updateInvite: (id: string, patch: { name?: string; role?: WorkspaceRole }): Promise<{ invite: Invite }> =>
    api(`/api/workspace/invites/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  approve: (id: string): Promise<{ person: Member }> => api(`/api/workspace/requests/${id}/approve`, { method: "POST" }),
  decline: (id: string) => api(`/api/workspace/requests/${id}/decline`, { method: "POST" }),
  setRole: (id: string, role: WorkspaceRole) => api(`/api/workspace/members/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  setLimits: (id: string, limits: Partial<MemberLimit>): Promise<{ person: Member }> =>
    api(`/api/workspace/members/${id}`, { method: "PATCH", body: JSON.stringify({ limits }) }),
  remove: (id: string) => api(`/api/workspace/members/${id}`, { method: "DELETE" }),
  setPassword: (password: string) => api("/api/workspace/joining/password", { method: "PUT", body: JSON.stringify({ password }) }),
  clearPassword: () => api("/api/workspace/joining/password", { method: "DELETE" }),
  setJoining: (patch: { approveEach?: boolean; privateReadable?: boolean }) =>
    api("/api/workspace/joining", { method: "PATCH", body: JSON.stringify(patch) }),
  setIdentity: (body: { name: string; kind: string; mark: WorkspaceMark }) =>
    api("/api/workspace/identity", { method: "PUT", body: JSON.stringify(body) }),
  access: (): Promise<{ agents: AgentAccessRow[]; rooms: Array<{ id: string; name: string; audience: "everyone" | "some"; members: string[] }> }> =>
    api("/api/workspace/access"),
  setAgentAccess: (botId: string, body: { mode: "everyone" | "only" | "except"; people?: string[]; admins?: boolean }) =>
    api(`/api/workspace/agents/${botId}/access`, { method: "PATCH", body: JSON.stringify(body) }),
};

// ── the join dialog's calls (server/join-client.ts) ───────────────────

export interface FoundInvite {
  publicId: string;
  workspace: string;
  mark: WorkspaceMark;
  inviter: string;
  role: WorkspaceRole;
  expiresAt: number | null;
  password: boolean | null;
}

export interface JoinFailure {
  ok: false;
  status: number;
  code: string;
  error: string;
  triesLeft?: number;
  retryAfter?: number;
}

export interface Welcome {
  workspace: Workspace;
  inviter: string;
  approvedBy: string;
  role: WorkspaceRole;
  agents: Array<{ id: string; name: string; title: string; color: string; shape: string | null }>;
  agentCount: number;
}

/** What a joined workspace is reached with: the same profile the remote
 * proxy takes (electron/remote.mjs), plus who and where. */
export interface JoinCredentials {
  relayUrl: string | null;
  relayToken: string | null;
  deviceId: string;
  deviceToken: string;
  personId: string;
  role: WorkspaceRole;
  hostKey: string;
  lan: string | null;
  workspace: Workspace | null;
}

export type JoinAnswer =
  | { ok: true; status: "waiting"; phrase: string }
  | { ok: true; status: "approved"; phrase: string; welcome: Welcome; credentials: JoinCredentials }
  | JoinFailure;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const parsed = await res.json().catch(() => ({ ok: false, code: "offline", error: "This Mac's Bloks did not answer." }));
  return parsed as T;
}

export const joinApi = {
  lookup: (input: string) => post<{ ok: true; session: string; invite: FoundInvite; via: "relay" | "lan" } | JoinFailure>("/api/joining/lookup", { input }),
  claim: (session: string, name: string, password?: string) => post<JoinAnswer>("/api/joining/claim", { session, name, password }),
  status: (session: string) => post<JoinAnswer>("/api/joining/status", { session }),
  cancel: (session: string) => post<{ ok: boolean }>("/api/joining/cancel", { session }),
};

// ── codes, as typed ────────────────────────────────────────────────────

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** The eight characters of a code in whatever was typed, or null. The
 * server reads input the same way (server/invites.ts normalizeCode). */
export function codeIn(raw: string): string | null {
  const text = raw.includes("#") ? (raw.split("#")[1] ?? "").split("~")[0] : raw;
  const code = text.toUpperCase().replace(/[\s\-_.\u2010-\u2015\u2212]/g, "");
  if (code.length !== 8 || [...code].some((c) => !ALPHABET.includes(c))) return null;
  return code;
}

/** Whether some text is a Bloks workspace invite: a code, or a link to
 * one. A room invite's link (bloks.dev/join#...) is not. */
export function looksLikeInvite(text: string): boolean {
  const t = text.trim();
  if (t.length > 300) return false;
  if (/^(https?:\/\/)?bloks\.dev\/j\/[a-z0-9]{6}#/i.test(t) || /^bloks:\/\/join#/i.test(t)) return codeIn(t) !== null;
  return !t.includes("/") && codeIn(t) !== null;
}

export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

// ── the frame bus ──────────────────────────────────────────────────────

type Frame = { kind: string; [key: string]: unknown };
const listeners = new Set<(frame: Frame) => void>();
let waiting = 0;
const waitingListeners = new Set<() => void>();

function setWaiting(n: number) {
  if (n === waiting) return;
  waiting = n;
  waitingListeners.forEach((l) => l());
}

/** Called by the store for every "workspace." frame. `news` is false for
 * frames replayed after a reconnect, which must not notify twice. */
export function workspaceFrame(frame: Frame, news: boolean) {
  if (frame.kind === "workspace.waiting" && typeof frame.count === "number") setWaiting(frame.count);
  if (news && frame.kind === "workspace.request") {
    const request = frame.request as JoinRequest;
    const first = request.name.split(" ")[0] || request.name;
    void window.bloks?.notifyShow({
      title: `${first} wants to join ${String(frame.workspace ?? "your workspace")}`,
      body: `Check four words with ${first}, then let them in.`,
      target: "workspace:members",
      urgent: true,
    });
  }
  if (news && frame.kind === "workspace.locked") {
    const invite = frame.invite as { name: string | null };
    void window.bloks?.notifyShow({
      title: "An invite was closed",
      body: `Somebody tried the wrong join password five times${invite.name ? ` on the invite for ${invite.name}` : ""}. That invite no longer works.`,
      target: "workspace:members",
      urgent: false,
    });
  }
  listeners.forEach((l) => l(frame));
}

/** Hears every "workspace." frame while mounted. */
export function useWorkspaceFrames(handler: (frame: Frame) => void) {
  useEffect(() => {
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [handler]);
}

/** How many people are waiting to be let in, for the switcher's badge and
 * the Members row's "1 waiting". Asked once, then kept by frames. */
export function useWaitingCount(): number {
  useEffect(() => {
    api("/api/workspace/waiting")
      .then((r: { count?: number }) => setWaiting(r.count ?? 0))
      .catch(() => {});
  }, []);
  return useSyncExternalStore(
    (l) => {
      waitingListeners.add(l);
      return () => waitingListeners.delete(l);
    },
    () => waiting,
    () => waiting,
  );
}

// ── words ──────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60_000;

/** "Oct 2", or "Oct 2, 2025" when not this year. */
export function shortDate(at: number, now = Date.now()): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "active today", "active yesterday", "active Oct 2". */
export function activeWords(at: number | null, now = Date.now()): string | null {
  if (!at) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (at >= start.getTime()) return "active today";
  if (at >= start.getTime() - DAY) return "active yesterday";
  return `active ${shortDate(at, now)}`;
}

/** "expires in 23 h", "expires in 12 min". */
export function expiresIn(at: number, now = Date.now()): string {
  const left = at - now;
  if (left <= 0) return "expired";
  const minutes = Math.round(left / 60_000);
  if (minutes < 60) return `expires in ${Math.max(1, minutes)} min`;
  return `expires in ${Math.round(minutes / 60)} h`;
}

/** "tomorrow at 9:41 PM", "today at 11:02 AM". */
export function whenWords(at: number, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = Math.floor((d.getTime() - today.getTime()) / DAY);
  if (day === 0) return `today at ${time}`;
  if (day === 1) return `tomorrow at ${time}`;
  return `${shortDate(at, now)} at ${time}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase();
}

/** A person's avatar tint, steady per id: a handful of quiet hues that
 * read on both themes. Never an agent's colour, so a person is never
 * mistaken for an agent. */
const TINTS = ["#2a3d66", "#4a2f5e", "#5e3a22", "#26364f", "#1f4a44", "#4f3326", "#3a3f66", "#523046"];
export function tintOf(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

// ── opening the join dialog from anywhere ─────────────────────────────

let joinInput = "";

/** Opens the join dialog (the switcher's, src/lib/workspaces.ts), filled
 * in with a link or code when there is one: a bloks://join link from
 * bloks.dev or a scanned QR. */
export function openJoinDialog(input = "") {
  joinInput = input;
  openWorkspaceDialog("join");
}

/** The link or code the dialog was opened with, given once. */
export function takeJoinInput(): string {
  const input = joinInput;
  joinInput = "";
  return input;
}

// ── names of the people in the workspace ─────────────────────────────

let names: Record<string, string> = {};
let namesAsked = false;
const nameListeners = new Set<() => void>();

function loadNames() {
  api("/api/workspace/members")
    .then((data: MembersData) => {
      names = Object.fromEntries(data.members.map((m) => [m.id, m.name]));
      nameListeners.forEach((l) => l());
    })
    .catch(() => {});
}
listeners.add((frame) => {
  if (frame.kind === "workspace.people" && Array.isArray(frame.members)) {
    names = Object.fromEntries((frame.members as Array<{ id: string; name: string }>).map((m) => [m.id, m.name]));
    nameListeners.forEach((l) => l());
  }
});

/** A person's name by id, for a message they wrote in a team
 * conversation; "A former member" for somebody no longer here. */
export function usePersonName(): (id: string) => string {
  useEffect(() => {
    if (!namesAsked) {
      namesAsked = true;
      loadNames();
    }
  }, []);
  const current = useSyncExternalStore(
    (l) => {
      nameListeners.add(l);
      return () => nameListeners.delete(l);
    },
    () => names,
    () => names,
  );
  return (id: string) => current[id] ?? "A former member";
}
