// Settings, as data: every page, the group it sits in, the words people
// search for, and where an old page id goes now.
//
// Kept apart from the screens so the reducer, the command palette and the
// tests read one list. A page id is an address other parts of the app
// open (`toggleAppSettings` with a `page`), and the server's settings
// mirror names the same pages, so an id that moves is never dropped: it
// is redirected here, and everything that opens it lands somewhere real.
//
// Pages whose id starts with "workspace:" are the workspace's own (its
// name, its members, whether it is online). The rest belong to the
// person, or to how agents work here.

import { inEnglish, t, type MessageKey } from "./i18n.ts";

export type SettingsGroupId = "account" | "workspace" | "agents" | "integrations" | "connections" | "data" | "help";

/** A page as it is written down: its words as catalogue keys, so they
 * are read in the reader's language each time they are drawn. */
interface SettingsPageSpec {
  id: string;
  label: MessageKey;
  group: SettingsGroupId;
  /** One line under the page's title. */
  description: MessageKey;
  /** Words people search for that the label does not say, in English.
   * They stay here as they are, so an English word finds its page in
   * every language. */
  keywords: string;
  /** The same words for a translator to give in their own language,
   * whose English is `keywords`. */
  keywordsKey: MessageKey;
  /** The rows the page draws, so a search can name the row it found and
   * take you to it. */
  rows?: readonly MessageKey[];
  /** Only drawn where the desktop app has workspaces. */
  workspace?: boolean;
}

export interface SettingsPageInfo {
  id: string;
  /** The page's name, in the reader's language. */
  readonly label: string;
  group: SettingsGroupId;
  /** One line under the page's title, in the reader's language. */
  readonly description: string;
  /** Words people search for that the label does not say, in English. */
  keywords: string;
  keywordsKey: MessageKey;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  /** The labels of the rows the page draws, in the reader's language. */
  readonly rows: readonly string[];
  /** The same rows as keys. */
  rowMessages: readonly MessageKey[];
  /** Only drawn where the desktop app has workspaces. */
  workspace?: boolean;
}

// The words are read when they are asked for, not when this module loads,
// so a page named here follows a change of language like everything else.
function page(spec: SettingsPageSpec): SettingsPageInfo {
  const rowMessages = spec.rows ?? [];
  return {
    id: spec.id,
    group: spec.group,
    keywords: spec.keywords,
    keywordsKey: spec.keywordsKey,
    labelKey: spec.label,
    descriptionKey: spec.description,
    rowMessages,
    workspace: spec.workspace,
    get label() {
      return t(spec.label);
    },
    get description() {
      return t(spec.description);
    },
    get rows() {
      return rowMessages.map((key) => t(key));
    },
  };
}

/** The groups, in the order the list shows them. The workspace's group is
 * titled with the workspace's own name where it is drawn. */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; label: MessageKey }> = [
  { id: "account", label: "settingsPages.group.account" },
  { id: "workspace", label: "settingsPages.group.workspace" },
  { id: "agents", label: "settingsPages.group.agents" },
  { id: "integrations", label: "settingsPages.group.integrations" },
  { id: "connections", label: "settingsPages.group.connections" },
  { id: "data", label: "settingsPages.group.data" },
  { id: "help", label: "settingsPages.group.help" },
];

export const SETTINGS_PAGE_LIST: readonly SettingsPageInfo[] = [
  page({
    id: "plan",
    group: "account",
    label: "settingsPages.plan.label",
    description: "settingsPages.plan.description",
    keywords:
      "plan billing subscription licence license key copy replace remove cloud team hosting bloks ai allowance upgrade renew renewal cancel invoice card payment membership manage",
    keywordsKey: "settingsPages.plan.keywords",
    rows: [
      "settingsPages.plan.row.manageBilling",
      "settingsPages.plan.row.bloksKey",
      "settingsPages.plan.row.workspacesOnline",
      "settingsPages.plan.row.members",
      "settingsPages.plan.row.bloksAi",
      "settingsPages.plan.row.moveToManagedHosting",
      "settingsPages.plan.row.letBackgroundWorkUseBloksAi",
    ],
  }),
  page({
    id: "general",
    group: "account",
    label: "settingsPages.general.label",
    description: "settingsPages.general.description",
    keywords:
      "appearance theme dark light system accent colour color width transcript narrow medium wide sidebar conversations threads shortcut hotkey quick ask your name owner call me language translate translation locale",
    keywordsKey: "settingsPages.general.keywords",
    rows: [
      "settingsPages.general.row.yourName",
      "settingsPages.general.row.theme",
      "settingsPages.general.row.accent",
      "settingsPages.general.row.sameAccentInEveryWorkspace",
      "settingsPages.general.row.transcriptWidth",
      "settingsPages.general.row.showConversationsInTheSidebar",
      "settingsPages.general.row.quickAskShortcut",
      "settingsPages.general.row.language",
    ],
  }),
  page({
    id: "about-you",
    group: "account",
    label: "settingsPages.aboutYou.label",
    description: "settingsPages.aboutYou.description",
    keywords: "profile context personal instructions about me preferences",
    keywordsKey: "settingsPages.aboutYou.keywords",
    rows: ["settingsPages.aboutYou.row.whatEveryAgentKnowsAboutYou"],
  }),
  page({
    id: "workspace:general",
    group: "workspace",
    label: "settingsPages.workspaceGeneral.label",
    description: "settingsPages.workspaceGeneral.description",
    keywords: "workspace name mark logo kind business personal team solo delete",
    keywordsKey: "settingsPages.workspaceGeneral.keywords",
    rows: [
      "settingsPages.workspaceGeneral.row.name",
      "settingsPages.workspaceGeneral.row.kind",
      "settingsPages.workspaceGeneral.row.whoUsesIt",
      "settingsPages.workspaceGeneral.row.mark",
      "settingsPages.workspaceGeneral.row.deleteWorkspace",
    ],
    workspace: true,
  }),
  page({
    id: "workspace:members",
    group: "workspace",
    label: "settingsPages.workspaceMembers.label",
    description: "settingsPages.workspaceMembers.description",
    keywords: "members people invite join admin team password approve",
    keywordsKey: "settingsPages.workspaceMembers.keywords",
    rows: ["settingsPages.workspaceMembers.row.inviteSomeone"],
    workspace: true,
  }),
  page({
    id: "workspace:online",
    group: "workspace",
    label: "settingsPages.workspaceOnline.label",
    description: "settingsPages.workspaceOnline.description",
    keywords: "online offline relay cloud space remote anywhere address",
    keywordsKey: "settingsPages.workspaceOnline.keywords",
    rows: [
      "settingsPages.workspaceOnline.row.online",
      "settingsPages.workspaceOnline.row.status",
      "settingsPages.workspaceOnline.row.address",
      "settingsPages.workspaceOnline.row.workspacesOnline",
    ],
    workspace: true,
  }),
  page({
    id: "workspace:notifications",
    group: "workspace",
    label: "settingsPages.workspaceNotifications.label",
    description: "settingsPages.workspaceNotifications.description",
    keywords: "notifications banners mute quiet dock badge alerts",
    keywordsKey: "settingsPages.workspaceNotifications.keywords",
    rows: ["settingsPages.workspaceNotifications.row.tellMeAbout", "settingsPages.workspaceNotifications.row.mute"],
    workspace: true,
  }),
  page({
    id: "engines",
    group: "agents",
    label: "settingsPages.engines.label",
    description: "settingsPages.engines.description",
    keywords:
      "engines models providers claude codex gemini grok cursor cline openai api key cli sign in bloks ai endpoints pause speed path",
    keywordsKey: "settingsPages.engines.keywords",
    rows: [
      "settingsPages.engines.row.yourEngines",
      "settingsPages.engines.row.pauses",
      "settingsPages.engines.row.codexSpeed",
      "settingsPages.engines.row.howYourEnginesAreDoing",
      "settingsPages.engines.row.yourEndpoints",
    ],
  }),
  page({
    id: "new-agents",
    group: "agents",
    label: "settingsPages.newAgents.label",
    description: "settingsPages.newAgents.description",
    keywords: "defaults folder hire approvals model effort",
    keywordsKey: "settingsPages.newAgents.keywords",
    rows: [
      "settingsPages.newAgents.row.folder",
      "settingsPages.newAgents.row.approvals",
      "settingsPages.newAgents.row.model",
      "settingsPages.newAgents.row.effort",
    ],
  }),
  page({
    id: "behaviour",
    group: "agents",
    label: "settingsPages.behaviour.label",
    description: "settingsPages.behaviour.description",
    keywords:
      "behavior working with agents skills suggest suggestions learn learning improve revise recall remember memory other conversations tidy nightly archive turn limit consecutive chain replies stuck silent tool call background subagents tasks finish stop incident incidents desk failure lead retry interrupt queue messages while working steer correction files changes rooms room auto route router who answers pick small model compaction compact summarise summarize idle cache long tokens",
    keywordsKey: "settingsPages.behaviour.keywords",
    rows: [
      "settingsPages.behaviour.row.suggestSkills",
      "settingsPages.behaviour.row.bringUpOtherConversations",
      "settingsPages.behaviour.row.tidyMemoryEveryNight",
      "settingsPages.behaviour.row.messagesWhileAnAgentWorks",
      "settingsPages.behaviour.row.agentToAgentLimit",
      "settingsPages.behaviour.row.stopStuckToolCalls",
      "settingsPages.behaviour.row.showOtherChangedFiles",
      "settingsPages.behaviour.row.backgroundWorkAnAgentStarts",
      "settingsPages.behaviour.row.autoPicksWith",
      "settingsPages.behaviour.row.incidentDesk",
      "settingsPages.behaviour.row.whoLeadsIncidents",
      "settingsPages.behaviour.row.compactLongChats",
      "settingsPages.behaviour.row.summariseAsYouGo",
      "settingsPages.behaviour.row.compactWhileIdle",
    ],
  }),
  page({
    id: "rules",
    group: "agents",
    label: "settingsPages.rules.label",
    description: "settingsPages.rules.description",
    keywords:
      "deny allow permissions safety approval gate full access auto ask conservative suggestions always allow habit",
    keywordsKey: "settingsPages.rules.keywords",
    rows: ["settingsPages.rules.row.howMuchAgentsAsk", "settingsPages.rules.row.yourRules"],
  }),
  page({
    id: "security",
    group: "agents",
    label: "settingsPages.security.label",
    description: "settingsPages.security.description",
    keywords:
      "security safety checkup audit risk full access pairing devices email webhooks secrets browser computer file permissions signed out",
    keywordsKey: "settingsPages.security.keywords",
  }),
  page({
    id: "voices",
    group: "agents",
    label: "settingsPages.voices.label",
    description: "settingsPages.voices.description",
    keywords: "speech elevenlabs openai fish audio xai grok chatterbox local tts call audio",
    keywordsKey: "settingsPages.voices.keywords",
    rows: [
      "settingsPages.voices.row.elevenlabsApiKey",
      "settingsPages.voices.row.openaiApiKey",
      "settingsPages.voices.row.fishAudioApiKey",
      "settingsPages.voices.row.xaiApiKey",
      "settingsPages.voices.row.chatterboxServer",
    ],
  }),
  page({
    id: "plugins",
    group: "integrations",
    label: "settingsPages.plugins.label",
    description: "settingsPages.plugins.description",
    keywords: "apps connectors composio mcp servers skills agents tools integrations gmail slack github",
    keywordsKey: "settingsPages.plugins.keywords",
  }),
  page({
    id: "apps",
    group: "integrations",
    label: "settingsPages.apps.label",
    description: "settingsPages.apps.description",
    keywords:
      "composio connect key api key claude desktop cursor mcp other apps secrets secret saved token password forget environment variable",
    keywordsKey: "settingsPages.apps.keywords",
    rows: [
      "settingsPages.apps.row.composioConnectKey",
      "settingsPages.apps.row.composioApiKey",
      "settingsPages.apps.row.savedSecrets",
      "settingsPages.apps.row.useBloksFromOtherAiApps",
    ],
  }),
  page({
    id: "devices",
    group: "connections",
    label: "settingsPages.devices.label",
    description: "settingsPages.devices.description",
    keywords: "iphone pairing remote relay qr phone access location where gps city place",
    keywordsKey: "settingsPages.devices.keywords",
    rows: ["settingsPages.devices.row.phoneAccess", "settingsPages.devices.row.whereYourBloksRuns", "settingsPages.devices.row.location"],
  }),
  page({
    id: "chat",
    group: "connections",
    label: "settingsPages.chat.label",
    description: "settingsPages.chat.description",
    keywords: "telegram signal signal-cli slack discord whatsapp email mail groups",
    keywordsKey: "settingsPages.chat.keywords",
    rows: [
      "settingsPages.chat.row.telegram",
      "settingsPages.chat.row.signal",
      "settingsPages.chat.row.slack",
      "settingsPages.chat.row.discord",
      "settingsPages.chat.row.whatsapp",
      "settingsPages.chat.row.signalGroups",
      "settingsPages.chat.row.email",
    ],
  }),
  page({
    id: "home",
    group: "connections",
    label: "settingsPages.home.label",
    description: "settingsPages.home.description",
    keywords:
      "home assistant smart home lights locks climate thermostat covers garage alarm sensors entities automation webhook voice assist hass",
    keywordsKey: "settingsPages.home.keywords",
    rows: [
      "settingsPages.home.row.connection",
      "settingsPages.home.row.whatAgentsCanSee",
      "settingsPages.home.row.agentsThatCanUseIt",
      "settingsPages.home.row.startAnAgentFromHomeAssistant",
    ],
  }),
  page({
    id: "computers",
    group: "connections",
    label: "settingsPages.computers.label",
    description: "settingsPages.computers.description",
    keywords: "vm virtual machine local box boat sandbox desktop cloud computer sleep idle",
    keywordsKey: "settingsPages.computers.keywords",
    rows: [
      "settingsPages.computers.row.localVm",
      "settingsPages.computers.row.boatApiKey",
      "settingsPages.computers.row.sleepIdleCloudComputersAfter",
    ],
  }),
  page({
    id: "browser",
    group: "connections",
    label: "settingsPages.browser.label",
    description: "settingsPages.browser.description",
    keywords:
      "browser web sites allow deny block list ask first auto downloads sign out cookies password card upload take over",
    keywordsKey: "settingsPages.browser.keywords",
    rows: [
      "settingsPages.browser.row.asks",
      "settingsPages.browser.row.sitesAgentsMayUse",
      "settingsPages.browser.row.sitesAgentsNeverUse",
      "settingsPages.browser.row.downloads",
      "settingsPages.browser.row.signOutOfEverySite",
    ],
  }),
  page({
    id: "past-sessions",
    group: "data",
    label: "settingsPages.pastSessions.label",
    description: "settingsPages.pastSessions.description",
    keywords: "import sessions history transcripts claude code codex resume continue chats conversations projects",
    keywordsKey: "settingsPages.pastSessions.keywords",
  }),
  page({
    id: "bring-setup",
    group: "data",
    label: "settingsPages.bringSetup.label",
    description: "settingsPages.bringSetup.description",
    keywords:
      "import migrate claude code codex cursor openclaw hermes claude.md agents.md subagents commands prompts skills mcp memory rules telegram slack discord move switch undo",
    keywordsKey: "settingsPages.bringSetup.keywords",
  }),
  page({
    id: "record",
    group: "data",
    label: "settingsPages.record.label",
    description: "settingsPages.record.description",
    keywords: "ledger audit history log record signed",
    keywordsKey: "settingsPages.record.keywords",
  }),
  page({
    id: "backups",
    group: "data",
    label: "settingsPages.backups.label",
    description: "settingsPages.backups.description",
    keywords:
      "backup restore archive copy export move new computer undo history passphrase encrypt seal daily automatic hosted",
    keywordsKey: "settingsPages.backups.keywords",
    rows: [
      "settingsPages.backups.row.backUpEveryDay",
      "settingsPages.backups.row.includeUndoHistory",
      "settingsPages.backups.row.sealWithAPassphrase",
      "settingsPages.backups.row.backUpNow",
      "settingsPages.backups.row.writeOutThisWorkspace",
    ],
  }),
  page({
    id: "training",
    group: "data",
    label: "settingsPages.training.label",
    description: "settingsPages.training.description",
    keywords: "export training fine tune fine-tuning dataset jsonl openai sharegpt trajectory runs tool calls model data",
    keywordsKey: "settingsPages.training.keywords",
    rows: [
      "settingsPages.training.row.shape",
      "settingsPages.training.row.eachRecordIs",
      "settingsPages.training.row.metadata",
      "settingsPages.training.row.dates",
      "settingsPages.training.row.engines",
      "settingsPages.training.row.onlyFinishedWell",
      "settingsPages.training.row.onlyNotCorrected",
      "settingsPages.training.row.onlyThumbsUp",
      "settingsPages.training.row.takeOutNames",
      "settingsPages.training.row.shortenToolResults",
      "settingsPages.training.row.capEachRecord",
    ],
  }),
  page({
    id: "about",
    group: "help",
    label: "settingsPages.about.label",
    description: "settingsPages.about.description",
    keywords: "version update feedback diagnostics bug report server headless workspace server bloks-server",
    keywordsKey: "settingsPages.about.keywords",
    rows: [
      "settingsPages.about.row.checkForUpdates",
      "settingsPages.about.row.workspaceServer",
      "settingsPages.about.row.somethingBrokenOrMissing",
      "settingsPages.about.row.diagnostics",
    ],
  }),
];

/**
 * Where an old address goes now. Bloks Cloud became Plan (the key, the
 * membership and Bloks AI in one place); the workspace's Engines and keys
 * and Usage were only ever links to pages Settings already has.
 */
export const SETTINGS_REDIRECTS: Readonly<Record<string, string>> = {
  cloud: "plan",
  "bloks-cloud": "plan",
  billing: "plan",
  "workspace:plan": "plan",
  "workspace:engines": "engines",
  "workspace:usage": "plan",
  "workspace:settings": "workspace:general",
  workspace: "workspace:general",
};

const KNOWN = new Set(SETTINGS_PAGE_LIST.map((p) => p.id));

/** The page an id opens: itself, where it moved, or General for one that
 * never existed. */
export function resolveSettingsPage(id: string | null | undefined): string {
  const asked = typeof id === "string" ? id.trim() : "";
  const moved = SETTINGS_REDIRECTS[asked] ?? asked;
  return KNOWN.has(moved) ? moved : "general";
}

export function settingsPage(id: string): SettingsPageInfo | undefined {
  return SETTINGS_PAGE_LIST.find((p) => p.id === id);
}

/** Whether a Settings page id is one of the workspace's own. */
export const isWorkspaceSettingsPage = (id: string | null | undefined) => Boolean(id?.startsWith("workspace:"));

export interface SettingsMatch {
  page: SettingsPageInfo;
  /** Rows on the page whose own label matched, at most two. */
  rows: string[];
}

/**
 * The pages a search finds, in the list's order. Every word has to be
 * somewhere on the page (its label, its line, its words or a row), the
 * way the command palette reads a query, and the rows that say the words
 * themselves come back too, so the list can offer them by name.
 */
export function searchSettings(query: string, pages: readonly SettingsPageInfo[] = SETTINGS_PAGE_LIST): SettingsMatch[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return pages.map((page) => ({ page, rows: [] }));
  const says = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const out: SettingsMatch[] = [];
  for (const page of pages) {
    // the reader's words and the English ones both find a page, so a
    // word learned from a guide or a screenshot works in any language
    const rows = page.rowMessages.map((key) => ({ shown: t(key), english: inEnglish(key) }));
    const haystack = [
      page.label,
      page.description,
      t(page.keywordsKey),
      inEnglish(page.labelKey),
      inEnglish(page.descriptionKey),
      page.keywords,
      ...rows.flatMap((row) => [row.shown, row.english]),
    ].join(" ");
    if (!says(haystack)) continue;
    // a row that holds every word is named; the page's own label saying
    // them already is enough, and naming rows then would only be noise
    const labelSays = says(page.label) || says(inEnglish(page.labelKey));
    const named = labelSays ? [] : rows.filter((row) => says(row.shown) || says(row.english)).slice(0, 2).map((row) => row.shown);
    out.push({ page, rows: named });
  }
  return out;
}

/** A row's address on its page, from its label: what a search result
 * scrolls to, and what SettingRow writes on itself. Always the English
 * label's, so the address stays the same in every language; a label in
 * another language is found among the rows listed above. */
export function rowKey(label: string): string {
  return (englishRow(label) ?? label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function englishRow(label: string): string | undefined {
  for (const page of SETTINGS_PAGE_LIST) {
    for (const key of page.rowMessages) if (t(key) === label) return inEnglish(key);
  }
  return undefined;
}
