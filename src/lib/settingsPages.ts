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

export type SettingsGroupId = "account" | "workspace" | "agents" | "integrations" | "connections" | "data" | "help";

export interface SettingsPageInfo {
  id: string;
  label: string;
  group: SettingsGroupId;
  /** One line under the page's title. */
  description: string;
  /** Words people search for that the label does not say. */
  keywords: string;
  /** The labels of the rows the page draws, so a search can name the row
   * it found and take you to it. */
  rows?: readonly string[];
  /** Only drawn where the desktop app has workspaces. */
  workspace?: boolean;
}

/** The groups, in the order the list shows them. The workspace's group is
 * titled with the workspace's own name where it is drawn. */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; label: string }> = [
  { id: "account", label: "Account" },
  { id: "workspace", label: "Workspace" },
  { id: "agents", label: "Agents" },
  { id: "integrations", label: "Integrations" },
  { id: "connections", label: "Connections" },
  { id: "data", label: "Data" },
  { id: "help", label: "Bloks" },
];

export const SETTINGS_PAGE_LIST: readonly SettingsPageInfo[] = [
  {
    id: "plan",
    label: "Plan",
    group: "account",
    description: "Your membership, what it includes, and where it can go next.",
    keywords: "plan billing subscription licence license key cloud team hosting bloks ai upgrade renew renewal cancel invoice card payment membership manage",
    rows: ["Manage billing", "Your name", "Workspaces online", "Members", "Bloks AI", "Bloks key", "Replace key", "Remove key from this computer", "Let background work use Bloks AI"],
  },
  {
    id: "general",
    label: "General",
    group: "account",
    description: "How Bloks looks, and the shortcut that reaches it from anywhere.",
    keywords: "appearance theme dark light system accent colour color width transcript narrow medium wide sidebar conversations threads shortcut hotkey quick ask your name owner call me",
    rows: ["Your name", "Theme", "Accent", "Same accent in every workspace", "Transcript width", "Show conversations in the sidebar", "Quick ask shortcut"],
  },
  {
    id: "about-you",
    label: "About you",
    group: "account",
    description: "What every agent knows about you, so you don't repeat yourself.",
    keywords: "profile context personal instructions about me preferences",
    rows: ["What every agent knows about you"],
  },
  {
    id: "workspace:general",
    label: "General",
    group: "workspace",
    description: "Its name, its mark and who uses it.",
    keywords: "workspace name mark logo kind business personal team solo delete",
    rows: ["Name", "Kind", "Who uses it", "Mark", "Delete workspace"],
    workspace: true,
  },
  {
    id: "workspace:members",
    label: "Members",
    group: "workspace",
    description: "The people who can use this workspace.",
    keywords: "members people invite join admin team password approve",
    rows: ["Invite someone"],
    workspace: true,
  },
  {
    id: "workspace:online",
    label: "Reachable online",
    group: "workspace",
    description: "This workspace's own space at Bloks Cloud, for your phone and the people you invite.",
    keywords: "online offline relay cloud space remote anywhere address",
    rows: ["Online", "Status", "Address", "Workspaces online"],
    workspace: true,
  },
  {
    id: "workspace:notifications",
    label: "Notifications",
    group: "workspace",
    description: "When this workspace may interrupt you, here and in the Dock.",
    keywords: "notifications banners mute quiet dock badge alerts",
    rows: ["Tell me about", "Mute"],
    workspace: true,
  },
  {
    id: "engines",
    label: "Engines and keys",
    group: "agents",
    description: "The AI tools and API keys your agents think with.",
    keywords: "engines models providers claude codex gemini grok openai api key cli sign in bloks ai endpoints pause speed",
    rows: ["Your engines", "Pauses", "Codex speed", "How your engines are doing", "Your endpoints"],
  },
  {
    id: "new-agents",
    label: "New agents",
    group: "agents",
    description: "Where every new agent starts.",
    keywords: "defaults folder hire approvals model effort",
    rows: ["Folder", "Approvals", "Model", "Effort"],
  },
  {
    id: "behaviour",
    label: "Behaviour",
    group: "agents",
    description: "How agents remember, take turns and recover, for every agent here.",
    keywords:
      "behavior working with agents skills suggest recall remember memory other conversations tidy nightly archive turn limit consecutive chain replies stuck silent tool call incident incidents desk failure lead retry interrupt queue messages while working steer correction files changes compaction compact summarise summarize idle cache long tokens",
    rows: [
      "Suggest skills",
      "Bring up other conversations",
      "Tidy memory every night",
      "Messages while an agent works",
      "Agent-to-agent limit",
      "Stop stuck tool calls",
      "Show other changed files",
      "Incident desk",
      "Who leads incidents",
      "Compact long chats",
      "Summarise as you go",
      "Compact while idle",
    ],
  },
  {
    id: "rules",
    label: "Rules and approvals",
    group: "agents",
    description: "When agents ask first, and what they never do.",
    keywords: "deny allow permissions safety approval gate full access auto ask conservative suggestions always allow habit",
    rows: ["How much agents ask", "Your rules"],
  },
  {
    id: "security",
    label: "Security checkup",
    group: "agents",
    description: "What can reach your keys, accounts and computer.",
    keywords: "security safety checkup audit risk full access pairing devices email webhooks secrets browser computer file permissions signed out",
  },
  {
    id: "voices",
    label: "Voices",
    group: "agents",
    description: "Give agents a voice and take calls with them.",
    keywords: "speech elevenlabs openai tts call audio",
    rows: ["ElevenLabs API key", "OpenAI API key"],
  },
  {
    id: "plugins",
    label: "Plugins",
    group: "integrations",
    description: "Manage apps, MCP servers and skills.",
    keywords: "apps connectors composio mcp servers skills agents tools integrations gmail slack github",
  },
  {
    id: "apps",
    label: "Apps and keys",
    group: "integrations",
    description: "Accounts and tools shared by every agent, and using Bloks from other apps.",
    keywords: "composio connect key api key claude desktop cursor mcp other apps secrets secret saved token password forget environment variable",
    rows: ["Composio Connect key", "Composio API key", "Saved secrets", "Use Bloks from other AI apps"],
  },
  {
    id: "devices",
    label: "Phone and devices",
    group: "connections",
    description: "Reach this computer from your phone and other devices.",
    keywords: "iphone pairing remote relay qr phone access",
    rows: ["Phones and devices"],
  },
  {
    id: "chat",
    label: "Chat and email",
    group: "connections",
    description: "Talk to your agents from Telegram, Slack, Discord, WhatsApp or email.",
    keywords: "telegram slack discord whatsapp email mail",
    rows: ["Telegram", "Slack", "Discord", "WhatsApp", "Email"],
  },
  {
    id: "computers",
    label: "Computers",
    group: "connections",
    description: "A private computer for agents, on this computer or in the cloud.",
    keywords: "vm virtual machine local box boat sandbox desktop cloud computer sleep idle",
    rows: ["Local VM", "Boat API key", "Sleep idle cloud computers after"],
  },
  {
    id: "past-sessions",
    label: "Past conversations",
    group: "data",
    description: "Bring in your Claude Code and Codex conversations, so your agents start with the history.",
    keywords: "import sessions history transcripts claude code codex resume continue chats conversations projects",
  },
  {
    id: "bring-setup",
    label: "Bring your setup",
    group: "data",
    description: "Import instructions, skills and MCP servers from tools you already use. Keys stay behind.",
    keywords: "import migrate claude code codex openclaw hermes claude.md agents.md skills mcp memory rules move switch",
  },
  {
    id: "record",
    label: "Record",
    group: "data",
    description: "Everything that happened, signed and in order.",
    keywords: "ledger audit history log record signed",
  },
  {
    id: "backups",
    label: "Backups",
    group: "data",
    description: "Copies of your workspace, daily or when you ask.",
    keywords: "backup restore archive copy export move new computer undo history passphrase encrypt seal daily automatic hosted",
    rows: ["Back up every day", "Include Undo history", "Seal with a passphrase", "Back up now", "Write out this workspace"],
  },
  {
    id: "about",
    label: "About and updates",
    group: "help",
    description: "Version, updates and feedback.",
    keywords: "version update feedback diagnostics bug report",
    rows: ["Check for updates", "Something broken, or missing?", "Diagnostics"],
  },
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
  const out: SettingsMatch[] = [];
  for (const page of pages) {
    const rows = page.rows ?? [];
    const haystack = `${page.label} ${page.description} ${page.keywords} ${rows.join(" ")}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    // a row that holds every word is named; the page's own label saying
    // them already is enough, and naming rows then would only be noise
    const labelSays = words.every((w) => page.label.toLowerCase().includes(w));
    const named = labelSays ? [] : rows.filter((row) => words.every((w) => row.toLowerCase().includes(w))).slice(0, 2);
    out.push({ page, rows: named });
  }
  return out;
}

/** A row's address on its page, from its label: what a search result
 * scrolls to, and what SettingRow writes on itself. */
export function rowKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
