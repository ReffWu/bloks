// A setting changed for the person, on their yes.
//
// An agent asked "turn off the nightly tidy" could only say where the
// switch is. Now it can put the change itself in front of the person: a
// card in the conversation with the setting's name, what it is now, what
// the agent would make it and why, and Change and Keep. Nothing changes
// until the person taps Change, and then it changes through the very
// request the Settings page sends, as the person, recorded as theirs.
//
// Which settings is a list, and the list is short on purpose. An agent's
// words are an input like any other (server/agent-cli.ts says why that
// matters), and a card is easy to tap. So only everyday preferences are
// on it: how agents remember and tidy, the morning brief, the proposing
// agent's own model, effort and notifications, and the effort new agents
// start on. Everything that decides what agents may do, what reaches a
// key or a device, who is in the workspace, what anything costs, or what
// could be lost is refused by name, with the page to send the person to
// instead. Anything else not on the list is refused too, with the list.
//
// Pure: the list, the reading of a value, the request each change makes
// and the refusals. The card, the waiting and the request itself are
// server/index.ts's.
import { BRIEF_SECTIONS } from "./brief.ts";
import { EFFORTS } from "./effort.ts";

/** One value a setting can take, with the catalogue key for its name. */
export interface Choice {
  value: string;
  label: string;
}

/** What the server knows now, read for the person's current values. */
export interface ProposalState {
  config: {
    recall?: { beforeTurn?: unknown };
    memory?: { tidy?: unknown };
    skills?: { learn?: unknown; propose?: unknown };
    compaction?: { micro?: unknown };
    changes?: { showShared?: unknown };
    agentDefaults?: Record<string, unknown>;
  };
  brief: { enabled: boolean; time: string; notify: boolean; allClear: boolean; layout: { order: string[]; pinned: string[]; hidden: string[] } };
  /** The agent proposing, which is the only agent an agent.* setting is about. */
  agent: {
    id: string;
    notifications: boolean;
    effort?: string;
    /** Its engine and model, and the models that engine offers. */
    model: { instanceId: string; model: string; options: Array<{ id: string; label?: string }> } | null;
  };
}

/** The request the Settings page itself sends for this change. */
export interface SettingsRequest {
  method: "PUT" | "PATCH";
  path: string;
  body: Record<string, unknown>;
}

export interface Proposable {
  id: string;
  /** Catalogue key for its name, as the page that holds it says it. */
  name: string;
  /** Where it lives, for `bloks open`: a Settings page or a place. */
  page: string;
  /** The row on that page, by its English label, when it has one. */
  row?: string;
  /** The values it takes; a time and a model are checked by their own
   * rules instead. */
  choices?: Choice[];
  kind: "choice" | "time" | "model";
  read(state: ProposalState): string;
  request(value: string, state: ProposalState): SettingsRequest;
}

const ON: Choice = { value: "on", label: "settingsProposal.on" };
const OFF: Choice = { value: "off", label: "common.off" };
const SWITCH = [ON, OFF];
const onOff = (on: boolean) => (on ? "on" : "off");
const EFFORT_CHOICES: Choice[] = [
  ...EFFORTS.map((value) => ({ value, label: `effort.${value}` })),
  { value: "default", label: "effort.useEngineSetting" },
];

/** A switch on Behaviour, saved the way the page saves it. */
function behaviourSwitch(id: string, name: string, row: string, read: (c: ProposalState["config"]) => boolean, body: (on: boolean) => Record<string, unknown>): Proposable {
  return {
    id,
    name,
    page: "behaviour",
    row,
    kind: "choice",
    choices: SWITCH,
    read: (state) => onOff(read(state.config)),
    request: (value) => ({ method: "PUT", path: "/api/config", body: body(value === "on") }),
  };
}

/** A switch of the brief's, saved the way Overview saves it. */
function briefSwitch(id: string, name: string, key: "enabled" | "notify" | "allClear"): Proposable {
  return {
    id,
    name,
    page: "overview",
    kind: "choice",
    choices: SWITCH,
    read: (state) => onOff(state.brief[key]),
    request: (value) => ({ method: "PATCH", path: "/api/briefs/settings", body: { [key]: value === "on" } }),
  };
}

/** A section of the brief: shown, hidden or pinned to the top, with the
 * rest of the arrangement as it is, since the page sends it whole. */
function briefSection(section: string): Proposable {
  return {
    id: `brief.section.${section}`,
    name: `briefLayout.${section}`,
    page: "overview",
    kind: "choice",
    choices: [
      { value: "shown", label: "settingsProposal.shown" },
      { value: "hidden", label: "settingsProposal.hidden" },
      { value: "pinned", label: "briefCustomize.pinnedToTheTop" },
    ],
    read: ({ brief }) => (brief.layout.hidden.includes(section) ? "hidden" : brief.layout.pinned.includes(section) ? "pinned" : "shown"),
    request: (value, { brief }) => {
      const without = (list: string[]) => list.filter((key) => key !== section);
      return {
        method: "PATCH",
        path: "/api/briefs/settings",
        body: {
          layout: {
            order: brief.layout.order,
            pinned: value === "pinned" ? [...without(brief.layout.pinned), section] : without(brief.layout.pinned),
            hidden: value === "hidden" ? [...without(brief.layout.hidden), section] : without(brief.layout.hidden),
          },
        },
      };
    },
  };
}

/**
 * Everything an agent may propose. Adding to this list is adding to what
 * a card in a conversation can change on one tap, so a new entry belongs
 * here only when it is a preference: never a permission, a key, a person,
 * a device, money, or anything that could be lost (REFUSED below, which
 * test/agent-guide.test.ts holds every entry here against).
 */
export const PROPOSABLE: readonly Proposable[] = [
  behaviourSwitch("recall.beforeTurn", "settingsPages.behaviour.row.bringUpOtherConversations", "Bring up other conversations", (c) => c.recall?.beforeTurn !== false, (on) => ({ recall: { beforeTurn: on } })),
  behaviourSwitch("memory.tidy", "settingsPages.behaviour.row.tidyMemoryEveryNight", "Tidy memory every night", (c) => c.memory?.tidy !== false, (on) => ({ memory: { tidy: on } })),
  behaviourSwitch("compaction.micro", "settingsPages.behaviour.row.summariseAsYouGo", "Summarise as you go", (c) => c.compaction?.micro === true, (on) => ({ compaction: { micro: on } })),
  behaviourSwitch("changes.showShared", "settingsPages.behaviour.row.showOtherChangedFiles", "Show other changed files", (c) => c.changes?.showShared !== false, (on) => ({ changes: { showShared: on } })),
  {
    id: "skills.learn",
    name: "settingsPages.behaviour.row.suggestSkills",
    page: "behaviour",
    row: "Suggest skills",
    kind: "choice",
    choices: [OFF, { value: "suggest", label: "behaviourPage.learn.suggest" }, { value: "more", label: "behaviourPage.learn.more" }],
    // unset reads the switch it replaced, as the page and the server do
    read: ({ config }) => {
      const learn = config.skills?.learn;
      return learn === "off" || learn === "suggest" || learn === "more" ? learn : config.skills?.propose ? "suggest" : "off";
    },
    request: (value) => ({ method: "PUT", path: "/api/config", body: { skills: { learn: value } } }),
  },
  briefSwitch("brief.enabled", "briefPanel.aBriefEveryMorning", "enabled"),
  {
    id: "brief.time",
    name: "briefPanel.briefTime",
    page: "overview",
    kind: "time",
    read: ({ brief }) => brief.time,
    request: (value) => ({ method: "PATCH", path: "/api/briefs/settings", body: { time: value } }),
  },
  briefSwitch("brief.notify", "briefCustomize.notifyWhenTheBriefIs", "notify"),
  briefSwitch("brief.allClear", "briefCustomize.notifyOnAQuietMorning", "allClear"),
  ...BRIEF_SECTIONS.map(briefSection),
  {
    id: "agent.notifications",
    name: "settingsPanel.notifications",
    page: "agent",
    kind: "choice",
    choices: SWITCH,
    read: ({ agent }) => onOff(agent.notifications),
    request: (value, { agent }) => ({ method: "PATCH", path: `/api/bots/${agent.id}`, body: { notifications: value === "on" } }),
  },
  {
    id: "agent.effort",
    name: "settingsPanel.reasoningEffort",
    page: "agent",
    kind: "choice",
    choices: EFFORT_CHOICES,
    read: ({ agent }) => agent.effort ?? "default",
    request: (value, { agent }) => ({ method: "PATCH", path: `/api/bots/${agent.id}`, body: { effort: value === "default" ? null : value } }),
  },
  {
    // a model of the engine it is on already: which engine is a matter of
    // sign-ins and keys, and that is the person's
    id: "agent.model",
    name: "settingsPanel.model",
    page: "agent",
    kind: "model",
    read: ({ agent }) => agent.model?.model ?? "",
    request: (value, { agent }) => ({
      method: "PATCH",
      path: `/api/bots/${agent.id}`,
      body: { modelSelection: { instanceId: agent.model!.instanceId, model: value } },
    }),
  },
  {
    id: "newAgents.effort",
    name: "agentDefaults.reasoningEffort",
    page: "new-agents",
    row: "Effort",
    kind: "choice",
    choices: EFFORT_CHOICES,
    read: ({ config }) => (typeof config.agentDefaults?.effort === "string" ? config.agentDefaults.effort : "default"),
    // the page sends the whole section, every key it has, so the rest of
    // it (the folder, the model, the approvals) goes back exactly as it is
    request: (value, { config }) => {
      const next: Record<string, unknown> = { ...(config.agentDefaults ?? {}) };
      if (value === "default") delete next.effort;
      else next.effort = value;
      for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
      return { method: "PUT", path: "/api/config", body: { agentDefaults: next } };
    },
  },
];

/**
 * What an agent never proposes, by subject, and where to send the person
 * instead. The narrowest subjects come first, so "site permissions" is
 * sent to the browser's page rather than to the rules. Matched on the words of whatever was asked that is not exactly
 * one of the names above, so a name made up to look like a preference but
 * saying one of these is refused by name rather than passed over.
 */
export const REFUSED: ReadonlyArray<{ subject: string; words: RegExp; page: string }> = [
  { subject: "the Bloks browser's sites", words: /browser|site|domain|download/, page: "browser" },
  { subject: "Home Assistant", words: /home|hass|assistant|entit/, page: "home" },
  { subject: "the limit on agents writing to agents and the budget across tasks", words: /chain|turn.?limit|agent.?to.?agent|task.?budget/, page: "behaviour" },
  { subject: "approvals and rules", words: /approv|\brules?\b|permission|full.?access|\bdeny\b|\ballow(ed|list)?\b/, page: "rules" },
  { subject: "spending limits and budgets", words: /spend|budget|limit|allowance|cap\b/, page: "usage" },
  { subject: "the plan and billing", words: /plan\b|billing|licen[cs]e|subscription|invoice|payment|card|bloks.?ai|credit/, page: "plan" },
  { subject: "keys, secrets and sign-ins", words: /key|secret|token|password|credential|sign.?in|signin|login|log.?in|oauth|auth/, page: "apps" },
  { subject: "engines and their credentials", words: /engine|provider|endpoint|instance|codex.?speed/, page: "engines" },
  { subject: "members, invites and roles", words: /member|invite|role|admin|people|guest|join/, page: "workspace:members" },
  { subject: "phone access and pairing", words: /phone|pair|device|location|iphone|watch\b/, page: "devices" },
  { subject: "remote access and Bloks Cloud", words: /remote|relay|cloud|online|reachable|network|hosting/, page: "workspace:online" },
  { subject: "backups and restore", words: /backup|back.?up|restore|passphrase/, page: "backups" },
  { subject: "moving or exporting a workspace", words: /\bmov(e|ing)\b|\bexport|write.?out|training/, page: "backups" },
  // deleting, sent to where each thing is deleted
  { subject: "deleting anything", words: /(delete|remove|erase|wipe).*workspace/, page: "workspace:general" },
  { subject: "deleting anything", words: /(delete|remove|erase|forget|wipe|archive|clear).*skill/, page: "plugins:skills" },
  { subject: "deleting anything", words: /(delete|remove|erase|forget|wipe|clear).*(memor|note)/, page: "memory" },
  { subject: "deleting anything", words: /delete|remove|erase|forget|wipe|archive|clear/, page: "agent" },
  { subject: "security", words: /secur|sandbox|container|docker|ssh|workplace|computer|vm\b|box\b|terminal|folder|cwd/, page: "security" },
];

/** Every way somebody might write a setting's name, made one. */
const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A proposable setting by its id, or by its name written another way
 * (recall.beforeTurn, recall-before-turn, "Bring up other conversations"). */
export function proposable(asked: string): Proposable | null {
  const want = flat(asked);
  return PROPOSABLE.find((p) => flat(p.id) === want || (p.row && flat(p.row) === want)) ?? null;
}

/** Why an agent may not propose this, in words it can act on: where to
 * send the person, and the command that puts the button in front of
 * them. Null when the setting is on the list. */
export function refusal(asked: string): string | null {
  // one of the list's own names, exactly: those were chosen, and a word in
  // one ("clear" in brief.allClear) is not a subject
  if (proposable(asked)) return null;
  const words = asked.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const said = asked.slice(0, 80);
  for (const refused of REFUSED) {
    if (refused.words.test(words) || refused.words.test(flat(asked))) {
      return `"${said}" touches ${refused.subject}, which only the person changes, so an agent never proposes it. Send them there: run \`bloks open ${refused.page}\` and say in a sentence what you would change and why. Nothing has changed.`;
    }
  }
  return `"${said}" is not a setting an agent can propose. The ones it can are ${PROPOSABLE.map((p) => p.id).join(", ")}. For anything else, find where it lives with \`bloks where <words>\` and send the person there with \`bloks open <page-id>\`. Nothing has changed.`;
}

/** A value as the setting takes it, or why not. */
export function readValue(setting: Proposable, raw: unknown, state: ProposalState): { ok: true; value: string } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "boolean" ? (raw ? "on" : "off") : "";
  if (!text) return { ok: false, error: `${setting.id} needs a value` };
  if (setting.kind === "time") {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { ok: false, error: `${setting.id} is a time of day like 08:00` };
    return { ok: true, value: `${match[1]!.padStart(2, "0")}:${match[2]}` };
  }
  if (setting.kind === "model") {
    const model = state.agent.model;
    if (!model) return { ok: false, error: "your engine offers no models to choose between here" };
    const found = model.options.find((o) => o.id === text || o.label?.toLowerCase() === text.toLowerCase());
    if (!found) {
      return { ok: false, error: `your engine has no model "${text.slice(0, 60)}". It offers: ${model.options.map((o) => o.id).join(", ") || "none it lists"}` };
    }
    return { ok: true, value: found.id };
  }
  const lower = text.toLowerCase();
  const said = lower === "true" || lower === "yes" || lower === "enabled" ? "on" : lower === "false" || lower === "no" || lower === "disabled" ? "off" : lower;
  const choice = setting.choices!.find((c) => c.value === said);
  if (!choice) return { ok: false, error: `${setting.id} is one of ${setting.choices!.map((c) => c.value).join(", ")}` };
  return { ok: true, value: choice.value };
}

/** A value's words: its choice's catalogue key, or the value itself for a
 * time or a model, which say themselves. */
export function valueLabel(setting: Proposable, value: string, state?: ProposalState): { key?: string; text: string } {
  const choice = setting.choices?.find((c) => c.value === value);
  if (choice) return { key: choice.label, text: value };
  if (setting.kind === "model") {
    const option = state?.agent.model?.options.find((o) => o.id === value);
    return { text: option?.label || value || "the engine's default" };
  }
  return { text: value };
}

/** Longest reason a card carries: a sentence or two, not an essay. */
export const MAX_WHY = 280;

/** What a settings proposal card carries (Message.card.settingsProposal). */
export interface ProposalCard {
  id: string;
  /** The conversation the card is in, which its answer is posted against. */
  laneId: string;
  setting: string;
  /** Catalogue key for the setting's name, and its English. */
  nameKey: string;
  name: string;
  /** Where it lives, in words, and the page an `open` would take. */
  path: string;
  page: string;
  current: { key?: string; text: string };
  proposed: { key?: string; text: string };
  /** The value itself, applied on Change. */
  value: string;
  why?: string;
  botId: string;
  agentName: string;
  /** Set once the agent has been told how it went. */
  told?: boolean;
  /** What happened, in the agent's words, once it did. */
  outcome?: "changed" | "kept" | "failed";
  error?: string;
}
