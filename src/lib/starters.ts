// Three ways to begin a conversation that has nothing in it yet.
//
// A blank page asks the person to know what the agent is good for. These
// answer that in the agent's own line of work: the role it was made from
// (src/lib/agentTemplates.ts), found by its name first and then by what
// its title and instructions say, or three that suit any agent. Each one
// is only words for the message box. Nothing is sent until the person
// presses Enter, and a prompt that ends in ": " is waiting for them to
// finish the sentence.
//
// Both the card and its prompt are the person's own words, in their
// language, so each lives in the catalogue as starters.<role>.<n>.label
// and .prompt, read when the starters are asked for.
import { AGENT_TEMPLATES, matchTemplate } from "./agentTemplates.ts";
import { t } from "./i18n.ts";

export interface Starter {
  /** What the card says, a few words. */
  label: string;
  /** What lands in the message box. */
  prompt: string;
}

/** Where a role's three starters are kept: starters.<role>.<1|2|3>. */
type StarterRole =
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
  | "personalAssistant"
  | "anyRole";

const BY_ROLE: Record<string, StarterRole> = {
  "chief-of-staff": "chiefOfStaff",
  "inbox-manager": "inboxManager",
  "research-analyst": "researchAnalyst",
  "growth-marketer": "growthMarketer",
  "sales-outbound": "salesOutbound",
  engineer: "engineer",
  recruiter: "recruiter",
  support: "support",
  bookkeeper: "bookkeeper",
  writer: "writer",
  ops: "ops",
  "personal-assistant": "personalAssistant",
};

/** For an agent that came from no role (starters.anyRole): a way in
 * that suits any job. */
const ANY_ROLE: StarterRole = "anyRole";

/** The three starters for an agent, by the role it most looks like. */
export function startersFor(agent: { name: string; title?: string; description?: string }): readonly Starter[] {
  // by the role's name as the reader sees it, or as it was in English, for
  // an agent made before a change of language
  const named = agent.name.trim().toLowerCase();
  const byName = AGENT_TEMPLATES.find((role) => role.name.toLowerCase() === named || role.englishName.toLowerCase() === named);
  const role = byName ?? matchTemplate(`${agent.title ?? ""} ${agent.description ?? ""}`);
  const words = (role && BY_ROLE[role.id]) || ANY_ROLE;
  return ([1, 2, 3] as const).map((n) => ({
    label: t(`starters.${words}.${n}.label`),
    prompt: t(`starters.${words}.${n}.prompt`),
  }));
}
