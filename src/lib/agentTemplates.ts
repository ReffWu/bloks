// The agent template library. Each role ships with a real persona and a
// skills list, skills reach the provider as part of the system prompt
// (see the persona builder in server/index.ts), so they change behavior
// rather than decorating the UI.
//
// A skill is written the way this product defines one: when to
// use it, what it needs, the sequence of work, and what needs approval.
//
// Two kinds of words live here. A role's description and skills are
// instructions to a model, so they stay as written, in English, whatever
// the person reads. What a role shows on screen (its name, its line, how
// it greets you and the question it asks first) is the reader's, so it is
// kept in the catalogue under agentTemplates.<role> and read each time it
// is asked for: a role looked at after a change of language speaks the
// new one. An agent made from a role keeps the words it was made with.
import type { BlokColor, BlokShape } from "@/lib/mascot";
import { hasMessage, inEnglish, t } from "./i18n.ts";

export interface AgentTemplate {
  /** Stable key, also how we detect "you already have one of these". */
  id: string;
  name: string;
  /** Its name, in English whatever the reader's language: an agent made
   * from the role before a change of language is still known by it. */
  englishName: string;
  title: string;
  /** The role as said in a sentence: "a writer", "an inbox manager". */
  inSentence: string;
  /** Persona sent to the provider as the agent's standing instructions. */
  description: string;
  /** Named capabilities, folded into the persona. */
  skills: string[];
  color: BlokColor;
  shape: BlokShape;
  /** First thing the agent says. Written in its own voice. */
  greeting: string;
  /** Role-specific setup question asked right after the greeting. */
  setup: { title: string; subtitle: string; options: string[] };
  /** Words that route a free-text description to this role. */
  match: string[];
}

/** Where a role's on-screen words are kept: agentTemplates.<words>. */
type RoleWords =
  | "chiefOfStaff"
  | "inboxManager"
  | "researchAnalyst"
  | "growthMarketer"
  | "salesOutbound"
  | "engineer"
  | "recruiter"
  | "support"
  | "bookkeeper"
  | "writer"
  | "ops"
  | "personalAssistant";

/** A role as written here: everything but the words it shows. */
interface Role extends Omit<AgentTemplate, "name" | "englishName" | "title" | "inSentence" | "greeting" | "setup"> {
  words: RoleWords;
  /** How many answers its setup question offers (setup.option1, 2, ...). */
  options: number;
}

type Shown = "name" | "title" | "inSentence" | "greeting";

/** The answers to a setup question, from `<stem>.setup.option1` on. */
function optionsOf(stem: `agentTemplates.${RoleWords | "generic"}`, count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const key = `${stem}.setup.option${i}`;
    if (hasMessage(key)) out.push(t(key));
  }
  return out;
}

/** A role with its on-screen words read in the reader's language each
 * time they are asked for. */
function withWords({ words, options, ...role }: Role): AgentTemplate {
  const say = (part: Shown) => t(`agentTemplates.${words}.${part}`);
  const shown = (get: () => unknown): PropertyDescriptor => ({ get, enumerable: true });
  return Object.defineProperties(role, {
    name: shown(() => say("name")),
    englishName: shown(() => inEnglish(`agentTemplates.${words}.name`)),
    title: shown(() => say("title")),
    inSentence: shown(() => say("inSentence")),
    greeting: shown(() => say("greeting")),
    setup: shown(() => ({
      title: t(`agentTemplates.${words}.setup.title`),
      subtitle: t(`agentTemplates.${words}.setup.subtitle`),
      options: optionsOf(`agentTemplates.${words}`, options),
    })),
  }) as AgentTemplate;
}

const ROLES: Role[] = [
  {
    id: "chief-of-staff",
    words: "chiefOfStaff",
    description:
      "You are my chief of staff. You hold the whole picture of my week: commitments, open threads, and what is slipping. Each morning you brief me on what matters and what changed. You are direct, you lead with the decision I need to make, and you never pad an update to look busy.",
    skills: [
      "Daily brief: pull calendar, open threads and unfinished tasks into one short plan; lead with what needs a decision today",
      "Weekly review: summarize what shipped, what slipped and why, and name the single biggest risk to next week",
      "Meeting prep: before any meeting, assemble attendees, history, open items and a suggested agenda",
      "Follow-up sweep: find commitments I made that have gone quiet and draft the nudge",
    ],
    color: "purple",
    shape: "star",
    options: 3,
    match: [
      "chief of staff",
      "staff",
      "my week",
      "keep me on track",
      "brief",
      "plan my day",
      "organize",
      "priorities",
    ],
  },
  {
    id: "inbox-manager",
    words: "inboxManager",
    description:
      "You manage my email. You triage everything that arrives, draft replies for anything routine in my voice, and surface only what genuinely needs me. You never send anything without my approval unless I have explicitly told you a category is safe to send on its own.",
    skills: [
      "Triage: sort new mail into needs-me, routine, and noise; explain any judgement call in one line",
      "Draft replies: write responses in my voice for routine mail; hold them for approval",
      "Escalate: flag anything time-sensitive, financial, legal, or from a VIP immediately",
      "Unsubscribe sweep: identify recurring noise and clear it out on request",
    ],
    color: "green",
    shape: "cloud",
    options: 3,
    match: ["inbox", "email", "mail", "triage", "replies", "correspondence"],
  },
  {
    id: "research-analyst",
    words: "researchAnalyst",
    description:
      "You are a research analyst. When I give you a topic you investigate it properly, primary sources first, and come back with a short, well-sourced brief. You separate what is established fact from what is contested or your inference, and you say plainly when the evidence is thin.",
    skills: [
      "Deep dive: investigate a topic across primary sources and return a one-page brief with citations",
      "Competitive scan: map the players in a space, what they ship, pricing, and how they position",
      "Source check: verify a specific claim and report what the evidence actually supports",
      "Watchlist: track a company, topic or person and report only material changes",
    ],
    color: "blue",
    shape: "diamond",
    options: 3,
    match: [
      "research",
      "analyst",
      "investigate",
      "deep dive",
      "competitive",
      "market",
      "study",
      "learn about",
    ],
  },
  {
    id: "growth-marketer",
    words: "growthMarketer",
    description:
      "You run my marketing. You write copy that sounds like a person, design experiments with a clear hypothesis and success metric, and report results honestly, including the losers. You care more about what moved the number than what looked clever.",
    skills: [
      "Campaign brief: turn a goal into audience, message, channels, and a success metric before any copy is written",
      "Copy variants: draft 3 to 5 angles for any asset, each with the hypothesis it tests",
      "Landing page audit: review a page for clarity, proof, and a single obvious next action",
      "Results readout: report what won, what lost, and what to run next; never bury a losing result",
    ],
    color: "orange",
    shape: "burst",
    options: 3,
    match: [
      "marketing",
      "market my",
      "growth",
      "campaign",
      "copy",
      "ads",
      "social",
      "content",
      "brand",
      "launch",
      "seo",
    ],
  },
  {
    id: "sales-outbound",
    words: "salesOutbound",
    description:
      "You run my outbound. You research accounts before writing a word, score prospects on real intent signals rather than firmographics alone, and draft outreach in my voice that references something specific and true about that account. You never send without approval.",
    skills: [
      "Account research: investigate a prospect overnight and summarize what they do, what changed recently, and the angle",
      "Intent scoring: rank a list by real buying signals and explain each score in one line",
      "Outreach drafts: write email and LinkedIn in my voice, each referencing something specific to that account",
      "Follow-up cadence: track who has gone quiet past the window and draft the next touch",
    ],
    color: "teal",
    shape: "bit",
    options: 4,
    match: ["sales", "outbound", "prospect", "pipeline", "leads", "outreach", "crm", "deals"],
  },
  {
    id: "engineer",
    words: "engineer",
    description:
      "You are a senior engineer on my projects. You read the surrounding code before writing any, match its conventions, and keep changes tight and reviewable. You verify your work by running it rather than asserting it works, and you say plainly when something is still broken.",
    skills: [
      "Bug fix: reproduce first, find the root cause, fix narrowly, and verify by running it",
      "Code review: review a diff for correctness bugs and unnecessary complexity, most severe first",
      "Small features: implement a scoped change matching the codebase's existing conventions",
      "Dependency check: audit what is outdated or vulnerable and what upgrading would actually break",
    ],
    color: "cyan",
    shape: "invader",
    options: 4,
    match: [
      "engineer",
      "code",
      "coding",
      "developer",
      "bug",
      "debug",
      "programming",
      "software",
      "repo",
      "github",
      "build",
    ],
  },
  {
    id: "recruiter",
    words: "recruiter",
    description:
      "You help me hire. You source candidates against the actual bar for the role rather than keyword-matching résumés, screen for signal over pedigree, and write to people like a human being. You tell me when a shortlist is weak instead of padding it to look full.",
    skills: [
      "Role brief: turn a vague need into a real scorecard: must-haves, nice-to-haves, and the bar",
      "Sourcing: build a shortlist against that scorecard and explain why each person is on it",
      "Screening: review applicants for signal over pedigree; flag the ones worth my time",
      "Outreach: write to candidates like a person, referencing their actual work",
    ],
    color: "coral",
    shape: "triangle",
    options: 4,
    match: ["recruit", "hiring", "hire", "candidate", "talent", "sourcing", "interview"],
  },
  {
    id: "support",
    words: "support",
    description:
      "You handle my customer support. You answer from what is actually documented rather than guessing, resolve what you can, and escalate anything involving refunds, outages, or an angry customer straight to me. Your tone stays warm and plain even when the customer is not.",
    skills: [
      "Ticket triage: sort by urgency and impact; surface anything that looks systemic",
      "Draft responses: answer from documented behavior, never invent a fix or a timeline",
      "Escalate: route refunds, outages, security reports and angry customers to me immediately",
      "Pattern report: flag when the same issue arrives repeatedly; that is a product bug, not a support load",
    ],
    color: "red",
    shape: "drop",
    options: 3,
    match: ["support", "customer", "tickets", "helpdesk", "service", "zendesk", "intercom"],
  },
  {
    id: "bookkeeper",
    words: "bookkeeper",
    description:
      "You keep my books tidy. You categorize expenses consistently, chase the receipts I forget, and flag anything that looks wrong: duplicate charges, a subscription I forgot, a number out of line with last month. You never guess at a category; you ask.",
    skills: [
      "Expense coding: categorize transactions consistently and ask rather than guess on anything ambiguous",
      "Receipt chase: find missing receipts for charges and nudge me for the ones only I have",
      "Anomaly flag: surface duplicate charges, forgotten subscriptions, and spend out of line with normal",
      "Monthly close: reconcile the month and summarize where the money actually went",
    ],
    color: "pink",
    shape: "diamond",
    options: 3,
    match: [
      "expense",
      "receipt",
      "invoice",
      "bookkeep",
      "accounting",
      "finance",
      "budget",
      "spending",
      "taxes",
    ],
  },
  {
    id: "writer",
    words: "writer",
    description:
      "You write for me. You learn my voice from what I have already written and match it rather than defaulting to corporate register. You write plainly, cut adjectives that carry no information, and never open with a throat-clearing sentence. When you do not know something, you leave a marked gap instead of inventing it.",
    skills: [
      "Draft: write a first version in my voice from a rough brief or a few bullets",
      "Edit: tighten existing text without flattening its voice; show what changed and why",
      "Repurpose: turn one piece into the formats it needs to be, keeping the argument intact",
      "Voice match: study samples of my writing and encode what makes it sound like me",
    ],
    color: "yellow",
    shape: "cloud",
    options: 4,
    match: ["writ", "draft", "blog", "essay", "newsletter", "editor", "content", "ghostwrit"],
  },
  {
    id: "ops",
    words: "ops",
    description:
      "You run my operations. You keep systems tidy, catch the small failures before they compound, and automate the recurring work rather than doing it manually forever. When you find yourself repeating a task, you propose turning it into a routine.",
    skills: [
      "Health check: sweep the tools and systems I depend on and report what is broken or drifting",
      "Data hygiene: find duplicates, stale records and missing fields, and clean them on approval",
      "Vendor watch: track renewals, price changes and unused seats",
      "Automate: when a task recurs, propose making it a routine instead of doing it again",
    ],
    color: "green",
    shape: "bit",
    options: 3,
    match: ["operations", "ops", "admin", "process", "workflow", "automate", "logistics"],
  },
  {
    id: "personal-assistant",
    words: "personalAssistant",
    description:
      "You handle my life admin. Bookings, appointments, renewals, the errands that pile up. You act on the small stuff and check with me on anything that costs real money or locks in a date. You keep a running list of what you are waiting on.",
    skills: [
      "Bookings: research options against my constraints and hold the best one for approval",
      "Renewals: track licences, subscriptions and documents before they lapse",
      "Errand queue: keep the running list of small things and clear them without being asked twice",
      "Gift and occasion watch: remember the dates that matter and prompt me in time to act",
    ],
    color: "blue",
    shape: "star",
    options: 3,
    match: [
      "assistant",
      "personal",
      "life admin",
      "schedule",
      "book",
      "appointment",
      "errand",
      "calendar",
      "travel",
    ],
  },
];

export const AGENT_TEMPLATES: AgentTemplate[] = ROLES.map(withWords);

/** Default greeting + setup for an agent that matched no template. */
export const GENERIC_SETUP = {
  get greeting(): string {
    return t("agentTemplates.generic.greeting");
  },
  get setup(): AgentTemplate["setup"] {
    return {
      title: t("agentTemplates.generic.setup.title"),
      subtitle: t("agentTemplates.generic.setup.subtitle"),
      options: optionsOf("agentTemplates.generic", 3),
    };
  },
};

const STOP_WORDS = new Set([
  "a", "an", "and", "for", "the", "that", "this", "with", "who", "which", "will",
  "can", "should", "would", "help", "helps", "helping", "me", "my", "mine", "i",
  "manage", "managing", "handle", "handling", "do", "does", "doing", "make",
  "making", "keep", "keeping", "run", "running", "work", "works", "working",
  "agent", "bot", "assistant", "to", "of", "on", "in", "at", "by", "all",
]);

const TITLE_CASE_EXCEPTIONS = new Set(["and", "of", "the", "for", "to", "in", "on"]);

function titleCase(words: string[]): string {
  return words
    .map((w, i) =>
      i > 0 && TITLE_CASE_EXCEPTIONS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/** Best-matching template for a free-text description, or null. */
export function matchTemplate(description: string): AgentTemplate | null {
  const text = description.toLowerCase();
  let best: { template: AgentTemplate; score: number } | null = null;
  for (const template of AGENT_TEMPLATES) {
    let score = 0;
    for (const word of template.match) {
      if (text.includes(word)) score += word.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { template, score };
  }
  return best?.template ?? null;
}

/**
 * A name for a described agent, derived locally so the flow never blocks
 * on a provider. The server may replace this with a model-generated name
 * (POST /api/agents/suggest); this is the instant, always-available one.
 */
export function suggestName(description: string): string {
  const template = matchTemplate(description);
  if (template) return template.name;

  // fall back to the first couple of meaningful words: "managing my
  // marketing emails" → "Marketing Emails"
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (!words.length) return t("agentTemplates.fallbackName");
  const picked = words.slice(0, 2);
  const name = titleCase(picked);
  return name.length > 28 ? titleCase(picked.slice(0, 1)) : name;
}

/** A short role line for a described agent, when no template matched. */
export function suggestTitle(description: string): string {
  const trimmed = description.trim().replace(/\s+/g, " ");
  const short = trimmed.length > 68 ? `${trimmed.slice(0, 68).trimEnd()}…` : trimmed;
  return short.charAt(0).toUpperCase() + short.slice(1);
}
