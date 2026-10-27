// Bring your setup, the parts of the review that are not drawing: how
// items group by what they become, and what one choice sends back.
//
// The server reads every file again on import and takes from the window
// only which items, where, how a clash is settled and the values the
// person typed or said to copy (server/setup-import.ts). So what is
// built here is a list of decisions, never content.

export type SetupKind = "agent" | "instructions" | "memory" | "skill" | "mcp" | "setting" | "rule" | "fact" | "channel";
export type SetupDestination = "agent" | "brief" | "memory" | "skills" | "mcp" | "engine" | "rules" | "about" | "channel";

export interface SecretSlot {
  id: string;
  name: string;
  where: "env" | "header" | "token";
  copyFrom?: string;
  ref?: string;
  required?: boolean;
}

export interface SetupItem {
  key: string;
  source: string;
  kind: SetupKind;
  title: string;
  from: string;
  preview: string;
  chars: number;
  digest: string;
  notes: string[];
  status: "new" | "changed" | "imported";
  destinations: SetupDestination[];
  suggested: { to: SetupDestination; botId?: string };
  picked: boolean;
  conflict?: { kind: "skill" | "agent" | "mcp"; name: string; canReplace: boolean };
  secrets?: SecretSlot[];
  sameAs?: string;
  skill?: { name: string; description: string };
  mcp?: { name: string; transport: "stdio" | "http"; needs: string[] };
  rule?: { effect: "allow" | "deny"; summary: string };
  agent?: { name: string; title: string; model?: string; skills: string[]; servers: string[]; refuses: string[] };
  setting?: { engine: string; engineName: string; model?: string; effort?: string };
  channel?: { platform: string; name: string; perAgent: boolean };
}

export interface SetupSource {
  id: string;
  name: string;
  folder: string;
  agentName: string;
  items: SetupItem[];
  skipped: Array<{ from: string; why: string }>;
}

export interface SetupRun {
  id: string;
  at: number;
  items: number;
}

export interface SetupReview {
  sources: SetupSource[];
  fresh: number;
  /** The newest import that can still be undone. Absent from an older server. */
  lastRun?: SetupRun | null;
}

/** What the person has chosen for one item. */
export interface Choice {
  on: boolean;
  to: SetupDestination;
  botId?: string;
  /** For an item whose name is taken. */
  conflict?: "both" | "replace";
  /** By slot: what they typed, and whether they said to copy the other tool's. */
  typed?: Record<string, string>;
  copy?: Record<string, boolean>;
}

/** The groups, in the order a person would set things up by hand: who
 * the agents are, what they know, what they can use, what they may do,
 * what they know about you, and where they can be reached. */
export const GROUPS: Array<{ id: string; label: string; kinds: SetupKind[] }> = [
  { id: "agents", label: "Agents", kinds: ["agent"] },
  { id: "knowledge", label: "Instructions and memory", kinds: ["instructions", "memory"] },
  { id: "skills", label: "Skills", kinds: ["skill"] },
  { id: "servers", label: "MCP servers", kinds: ["mcp"] },
  { id: "models", label: "Models", kinds: ["setting"] },
  { id: "rules", label: "Rules", kinds: ["rule"] },
  { id: "about", label: "About you", kinds: ["fact"] },
  { id: "chat", label: "Chat apps", kinds: ["channel"] },
];

export interface Group {
  id: string;
  label: string;
  entries: Array<{ item: SetupItem; source: SetupSource }>;
}

/** Every item, grouped by what it becomes, each group in source order.
 * Groups with nothing in them are left out. */
export function groupReview(review: SetupReview): Group[] {
  return GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    entries: review.sources.flatMap((source) => source.items.filter((item) => group.kinds.includes(item.kind)).map((item) => ({ item, source }))),
  })).filter((group) => group.entries.length > 0);
}

export function choicesFrom(review: SetupReview): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const source of review.sources) {
    for (const item of source.items) {
      out[item.key] = {
        on: item.picked,
        to: item.suggested.to,
        botId: item.suggested.botId,
        // never over somebody else's thing unless they say so
        ...(item.conflict ? { conflict: "both" as const } : {}),
      };
    }
  }
  return out;
}

/** A slot a ticked item cannot go without and that has no answer yet. */
export function missingSecrets(item: SetupItem, choice: Choice): SecretSlot[] {
  return (item.secrets ?? []).filter((slot) => slot.required && !choice.copy?.[slot.id] && !choice.typed?.[slot.id]?.trim());
}

/** What the window sends for one ticked item. A typed value goes only
 * when it has something in it; a copy only when its box was ticked. */
export function pickFor(item: SetupItem, choice: Choice) {
  const secrets: Record<string, { copy: true } | { value: string }> = {};
  for (const slot of item.secrets ?? []) {
    if (choice.copy?.[slot.id] && slot.copyFrom) secrets[slot.id] = { copy: true };
    else if (choice.typed?.[slot.id]?.trim()) secrets[slot.id] = { value: choice.typed[slot.id].trim() };
  }
  return {
    key: item.key,
    digest: item.digest,
    to: choice.to,
    ...(choice.botId ? { botId: choice.botId } : {}),
    ...(item.conflict && choice.conflict ? { conflict: choice.conflict } : {}),
    ...(Object.keys(secrets).length ? { secrets } : {}),
  };
}

/** The line a clash is introduced with. */
export function conflictLine(item: SetupItem): string {
  const c = item.conflict;
  if (!c) return "";
  const what = c.kind === "skill" ? "A skill" : c.kind === "agent" ? "An agent" : "An MCP server";
  return `${what} called ${c.name} is already here.`;
}

/** Where a ticked item ends up, in a line, for the kinds with nothing to choose. */
export function landingLine(item: SetupItem): string {
  switch (item.kind) {
    case "skill":
      return "Added to Skills. Attach it to an agent to use it.";
    case "mcp":
      return "Added to MCP servers. Attach it to an agent to use it.";
    case "rule":
      return `Becomes a rule: ${item.rule?.summary ?? item.preview}.`;
    case "fact":
      return "Suggested in About you.";
    case "agent": {
      const a = item.agent;
      const parts = [a?.model ? `runs on ${a.model}` : "", a?.skills.length ? `with ${a.skills.length === 1 ? "its skill" : "its skills"} if Bloks has them` : ""].filter(Boolean);
      return `Becomes an agent${parts.length ? `, ${parts.join(", ")}` : ""}.`;
    }
    case "channel":
      return item.channel?.perAgent ? "" : `Connects ${item.channel?.name ?? "it"} for shared rooms, switched off.`;
    default:
      return "";
  }
}
