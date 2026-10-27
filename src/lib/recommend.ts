// Who to suggest, based on what somebody says they do.
//
// A first run that ends at a blank agent asks the newcomer to invent the
// product for themselves. Naming the work first is a much easier
// question to answer, and the answer is enough to propose three agents
// that are obviously useful rather than three that are merely available.
//
// The mapping is deliberately plain data. It is a starting point that
// gets edited constantly as we learn what people actually pick, and a
// clever scoring function would make that editing harder, not easier.
import { t } from "./i18n.ts";

/** The kinds of work somebody can claim, in the order they are offered.
 * Each reads its label and hint in the reader's language when drawn. */
export const WORK_TYPES = [
  {
    id: "building",
    get label() { return t("recommend.building.label"); },
    get hint() { return t("recommend.building.hint"); },
  },
  {
    id: "writing",
    get label() { return t("recommend.writing.label"); },
    get hint() { return t("recommend.writing.hint"); },
  },
  {
    id: "selling",
    get label() { return t("recommend.selling.label"); },
    get hint() { return t("recommend.selling.hint"); },
  },
  {
    id: "marketing",
    get label() { return t("recommend.marketing.label"); },
    get hint() { return t("recommend.marketing.hint"); },
  },
  {
    id: "support",
    get label() { return t("recommend.support.label"); },
    get hint() { return t("recommend.support.hint"); },
  },
  {
    id: "research",
    get label() { return t("recommend.research.label"); },
    get hint() { return t("recommend.research.hint"); },
  },
  {
    id: "running",
    get label() { return t("recommend.running.label"); },
    get hint() { return t("recommend.running.hint"); },
  },
  {
    id: "admin",
    get label() { return t("recommend.admin.label"); },
    get hint() { return t("recommend.admin.hint"); },
  },
] as const;

export type WorkTypeId = (typeof WORK_TYPES)[number]["id"];

/** Template ids worth proposing for each kind of work, best first. */
const BY_WORK: Record<WorkTypeId, string[]> = {
  building: ["engineer", "research-analyst", "writer"],
  writing: ["writer", "research-analyst", "personal-assistant"],
  selling: ["sales-outbound", "inbox-manager", "chief-of-staff"],
  marketing: ["growth-marketer", "writer", "research-analyst"],
  support: ["support", "inbox-manager", "ops"],
  research: ["research-analyst", "writer", "personal-assistant"],
  running: ["chief-of-staff", "ops", "bookkeeper"],
  admin: ["inbox-manager", "personal-assistant", "chief-of-staff"],
};

/** What anyone gets who tells us nothing. Broad on purpose. */
const FALLBACK = ["personal-assistant", "research-analyst", "writer"];

/**
 * Template ids to propose, best first and never repeated.
 *
 * Interleaved rather than concatenated: somebody who says they both
 * write and sell should see the writer and the closer near the top, not
 * three writing agents followed by three sales ones.
 */
export function recommendedFor(chosen: readonly string[], limit = 3): string[] {
  const lists = chosen
    .filter((id): id is WorkTypeId => id in BY_WORK)
    .map((id) => BY_WORK[id]);
  if (lists.length === 0) return FALLBACK.slice(0, limit);

  const out: string[] = [];
  for (let rank = 0; rank < 3 && out.length < limit; rank++) {
    for (const list of lists) {
      const candidate = list[rank];
      if (candidate && !out.includes(candidate)) out.push(candidate);
      if (out.length >= limit) break;
    }
  }
  // a very narrow answer can run out before the limit; top up broadly
  for (const spare of FALLBACK) {
    if (out.length >= limit) break;
    if (!out.includes(spare)) out.push(spare);
  }
  return out.slice(0, limit);
}
