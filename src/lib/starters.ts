// Three ways to begin a conversation that has nothing in it yet.
//
// A blank page asks the person to know what the agent is good for. These
// answer that in the agent's own line of work: the role it was made from
// (src/lib/agentTemplates.ts), found by its name first and then by what
// its title and instructions say, or three that suit any agent. Each one
// is only words for the message box. Nothing is sent until the person
// presses Enter, and a prompt that ends in ": " is waiting for them to
// finish the sentence.
import { AGENT_TEMPLATES, matchTemplate } from "./agentTemplates.ts";

export interface Starter {
  /** What the card says, a few words. */
  label: string;
  /** What lands in the message box. */
  prompt: string;
}

const BY_ROLE: Record<string, readonly [Starter, Starter, Starter]> = {
  "chief-of-staff": [
    { label: "Brief me on today", prompt: "Pull together what needs my attention today, and lead with the decisions only I can make." },
    { label: "Review my week", prompt: "Review my week so far: what moved, what slipped, and the biggest risk to next week." },
    { label: "Prep a meeting", prompt: "Help me prepare for my next meeting. Ask me who it is with and what it is about, then draft an agenda." },
  ],
  "inbox-manager": [
    { label: "Triage my inbox", prompt: "Sort my unread email into needs me, routine, and noise. Explain any judgment call in one line." },
    { label: "Draft routine replies", prompt: "Draft replies to the routine email waiting on me, in my voice, and hold them for my approval." },
    { label: "Find what is urgent", prompt: "Find anything in my inbox that is time sensitive, financial or legal, and bring it to me first." },
  ],
  "research-analyst": [
    { label: "Research a topic", prompt: "Research this and give me a one page brief with sources: " },
    { label: "Map the competition", prompt: "Map the main players in my space: what they ship, how they price, and how they position. Ask me which space first." },
    { label: "Check a claim", prompt: "Check this claim and tell me what the evidence actually supports: " },
  ],
  "growth-marketer": [
    { label: "Plan a campaign", prompt: "Help me plan a campaign. Ask me the goal, then give me the audience, message, channels and one success metric." },
    { label: "Write copy angles", prompt: "Write three angles for this, each with the hypothesis it tests: " },
    { label: "Audit a landing page", prompt: "Review this landing page for clarity, proof, and one obvious next step: " },
  ],
  "sales-outbound": [
    { label: "Research a prospect", prompt: "Research this company: what they do, what changed recently, and the best way in: " },
    { label: "Draft outreach", prompt: "Draft a short outreach email in my voice that mentions something specific about: " },
    { label: "Chase the quiet ones", prompt: "List the prospects who have gone quiet and draft the next follow up for each." },
  ],
  engineer: [
    { label: "Explain this codebase", prompt: "Give me a short tour of this codebase: what it does, how it is laid out, and where to start reading." },
    { label: "Review my changes", prompt: "Review the uncommitted changes in this folder for correctness bugs, most severe first." },
    { label: "Fix a bug", prompt: "Reproduce this bug, find the root cause, and tell me the fix before you change anything: " },
  ],
  recruiter: [
    { label: "Write a role brief", prompt: "Turn this hiring need into a scorecard with must haves, nice to haves, and the bar: " },
    { label: "Screen applicants", prompt: "Review these applicants for signal over pedigree and flag the ones worth my time." },
    { label: "Reach out to someone", prompt: "Write a short, human note to this candidate that mentions their actual work: " },
  ],
  support: [
    { label: "Triage open tickets", prompt: "Sort the open tickets by urgency and impact, and flag anything that looks systemic." },
    { label: "Draft a reply", prompt: "Draft a reply to this customer from documented behavior only, with no promised fix or date: " },
    { label: "Spot repeat issues", prompt: "Find the issues that keep coming up in recent tickets, and tell me which look like product bugs." },
  ],
  bookkeeper: [
    { label: "Code my expenses", prompt: "Categorize my recent transactions, and ask me about anything unclear instead of guessing." },
    { label: "Find missing receipts", prompt: "Find the charges with no receipt, and list the ones only I can track down." },
    { label: "Close the month", prompt: "Reconcile last month and tell me where the money actually went." },
  ],
  writer: [
    { label: "Draft from notes", prompt: "Turn these notes into a first draft in my voice: " },
    { label: "Tighten a piece", prompt: "Tighten this without flattening its voice, and show me what you changed and why: " },
    { label: "Learn my voice", prompt: "I will paste a few samples of my writing. Study them and tell me what makes them sound like me." },
  ],
  ops: [
    { label: "Run a health check", prompt: "Check the tools and systems I depend on, and tell me what is broken or drifting." },
    { label: "Clean up records", prompt: "Find duplicates, stale records and missing fields in my data, and propose a cleanup before changing anything." },
    { label: "Find a routine", prompt: "Look at what I keep doing by hand, and suggest one task worth turning into a routine." },
  ],
  "personal-assistant": [
    { label: "Book something", prompt: "Help me book something. Ask me what, when and my budget, then hold the best option for my approval." },
    { label: "Track my renewals", prompt: "List my subscriptions, licences and documents with their renewal dates, and remind me before each one lapses." },
    { label: "Clear my errands", prompt: "Here are the small things on my plate. Take what you can and tell me what needs me: " },
  ],
};

/** For an agent that came from no role: a way in that suits any job. */
const ANY_ROLE: readonly [Starter, Starter, Starter] = [
  { label: "What can you do?", prompt: "What are the three most useful things you could take off my plate this week? Keep it short." },
  { label: "Get to know me", prompt: "Ask me five quick questions so you understand how I work and what matters to me." },
  { label: "Start on a task", prompt: "Here is what I need help with today: " },
];

/** The three starters for an agent, by the role it most looks like. */
export function startersFor(agent: { name: string; title?: string; description?: string }): readonly Starter[] {
  const byName = AGENT_TEMPLATES.find((t) => t.name.toLowerCase() === agent.name.trim().toLowerCase());
  const role = byName ?? matchTemplate(`${agent.title ?? ""} ${agent.description ?? ""}`);
  return (role && BY_ROLE[role.id]) || ANY_ROLE;
}
