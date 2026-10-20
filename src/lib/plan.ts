// The Plan page's sense of things: which plan this is, what its status
// says in a few words, which offers are worth showing, and when to look
// again after somebody went to bloks.dev in their browser.
//
// The answers themselves come from bloks.dev, through this computer's
// own server (GET /api/plan, server/plan-account.ts), already read
// defensively there. Nothing in this file holds a price: an offer's price
// is whatever words the site sent, and is drawn as it came.

export type PaidPlan = "cloud" | "team" | "ai";
/** What the site files offers under: no licence is "free", and a bundle
 * (Hosting on Team, say) has a name of its own. */
export type PlanKey = "free" | PaidPlan | "hosted" | "team-hosted" | (string & {});

export interface OfferPrice {
  amount: string;
  per: string;
  note: string | null;
  yearly: { amount: string; per: string; note: string | null } | null;
}

export interface Offer {
  id: string;
  name: string;
  tagline: string;
  price: OfferPrice | null;
  points: string[];
  /** Plans an offer needs underneath it ("cloud", "team"). */
  requires: string[];
  for: string[];
  cta: { label: string; url: string } | null;
  /** False for something not on sale yet: shown, never bought. */
  onSale: boolean;
}

export interface Account {
  plan: PaidPlan;
  bundle: string | null;
  interval: "month" | "year" | null;
  status: string;
  renewsAt: number | null;
  cancelsAt: number | null;
  since: number | null;
  /** Masked by the site already. */
  email: string | null;
  bloksAi: { active: boolean; renewsAt: number | null } | null;
  hosting: { tier: string | null; state: string | null } | null;
  sharedRoom: boolean | null;
  topUps: number | null;
}

/** GET /api/plan, as this computer's server answers it. */
export interface PlanSnapshot {
  licence: { present: boolean; masked: string | null; kept: boolean };
  account: Account | null;
  /** live: just asked. cached: the last answer, since bloks.dev could not
   * be reached. refused: bloks.dev does not know this key. none: no key. */
  accountState: "live" | "cached" | "refused" | "unavailable" | "none";
  accountAt: number | null;
  problem: string | null;
  offers: Offer[] | null;
  offersState: "live" | "cached" | "unavailable";
  offersAt: number | null;
  /** Where plans are read about, for the one quiet link when offers
   * could not be had. */
  site: string;
  /** The plan the gates in this workspace go by right now. */
  ownerPlan: "cloud" | "team" | null;
  members: { count: number; limit: number };
}

export const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  cloud: "Bloks Cloud",
  team: "Bloks Team",
  ai: "Bloks AI",
  hosted: "Bloks Hosting",
  "team-hosted": "Bloks Team Hosted",
};

export function planName(key: string | null | undefined): string {
  if (!key) return PLAN_NAMES.free;
  return PLAN_NAMES[key] ?? key.replace(/(^|-)([a-z])/g, (_, gap: string, c: string) => `${gap ? " " : ""}${c.toUpperCase()}`);
}

/** The plan the site files this account under: its bundle when it has
 * one, its plan otherwise, and "free" with no key at all. */
export function planKey(snapshot: Pick<PlanSnapshot, "account" | "licence" | "ownerPlan"> | null | undefined): PlanKey {
  if (!snapshot?.licence.present) return "free";
  if (snapshot.account) return snapshot.account.bundle ?? snapshot.account.plan;
  // a key the site could not be asked about: what the gates go by
  return snapshot.ownerPlan ?? "cloud";
}

/** Whether something already owned is what this offer sells. */
function owned(offer: Offer, account: Account | null): boolean {
  if (!account) return false;
  const id = offer.id.toLowerCase();
  if (id === account.plan || (account.bundle && id === account.bundle.toLowerCase())) return true;
  if (account.bloksAi?.active && (id === "ai" || id === "bloks-ai")) return true;
  const tier = account.hosting?.tier?.toLowerCase();
  if (tier && (id === "hosting" || id === "hosted" || id === tier || id === `hosting-${tier}`)) return true;
  return false;
}

/**
 * The offers worth showing on this plan, in the order the site gave
 * them. The site already chose them for the plan it was asked about;
 * this only takes away what the person already has (Bloks AI, Hosting,
 * the plan itself), and anything filed for other plans, in case an older
 * answer was kept. With no key, Bloks Cloud leads: it is the first step.
 */
export function ladderFor(key: PlanKey, offers: readonly Offer[] | null | undefined, account: Account | null = null): Offer[] {
  if (!offers?.length) return [];
  const shown = offers.filter((o) => (o.for.length === 0 || o.for.includes(key)) && !owned(o, account));
  if (key !== "free") return shown;
  const cloud = shown.findIndex((o) => o.id === "cloud");
  return cloud > 0 ? [shown[cloud]!, ...shown.slice(0, cloud), ...shown.slice(cloud + 1)] : shown;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 21", or "Nov 21, 2027" when it is not this year. Read in UTC, as
 * the site writes its dates, so a renewal never lands a day early. */
export function shortDate(at: number, now = Date.now()): string {
  const d = new Date(at);
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === new Date(now).getUTCFullYear() ? day : `${day}, ${d.getUTCFullYear()}`;
}

/** "March 2026", for how long somebody has been a member. */
export function monthYear(at: number): string {
  const d = new Date(at);
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${long[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type StatusTone = "on" | "wait" | "issue" | "off";

/**
 * The membership's state, as the calm pill on the plan card says it, and
 * the one line beside it. Past due is the one that asks for something:
 * the card on file needs updating, and the page offers the way.
 */
export function statusOf(account: Account, now = Date.now()): { tone: StatusTone; label: string; line: string | null; needsCard: boolean } {
  const status = account.status;
  if (status === "past_due" || status === "unpaid" || status === "incomplete") {
    return { tone: "issue", label: "Past due", line: "The last payment didn't go through. Update your card to keep your plan.", needsCard: true };
  }
  if (status === "canceled" || status === "cancelled" || status === "incomplete_expired") {
    return { tone: "off", label: "Ended", line: account.cancelsAt ? `Ended on ${shortDate(account.cancelsAt, now)}.` : null, needsCard: false };
  }
  if (account.cancelsAt && account.cancelsAt > now) {
    return { tone: "wait", label: `Cancels ${shortDate(account.cancelsAt, now)}`, line: "It stays on until then, and won't renew.", needsCard: false };
  }
  if (status === "paused") return { tone: "off", label: "Paused", line: null, needsCard: false };
  const trial = status === "trialing";
  const label = trial ? "Trial" : "Active";
  return {
    tone: "on",
    label: account.renewsAt ? `${label}, renews ${shortDate(account.renewsAt, now)}` : label,
    line: null,
    needsCard: false,
  };
}

export function intervalWords(interval: Account["interval"]): string | null {
  return interval === "month" ? "Monthly" : interval === "year" ? "Yearly" : null;
}

/** Hosting's machine state, in a word or two. */
export function hostingWords(hosting: Account["hosting"]): string | null {
  if (!hosting) return null;
  const tier = hosting.tier ? planName(hosting.tier) : "Hosting";
  const state = hosting.state ? hosting.state.replace(/[_-]+/g, " ") : null;
  return state ? `${tier}, ${state}` : tier;
}

// ── coming back from the browser ───────────────────────────────────────

/** How long after opening bloks.dev a return to the window still counts
 * as coming back from it. Long enough for a checkout with a card found
 * in a drawer; short enough that tomorrow's focus is just a focus. */
export const RETURN_WINDOW_MS = 45 * 60_000;

/** Whether this focus is somebody coming back from bloks.dev. */
export function cameBack(openedAt: number | null, now = Date.now()): boolean {
  return openedAt !== null && now >= openedAt && now - openedAt <= RETURN_WINDOW_MS;
}

const RANK: Record<string, number> = { free: 0, ai: 1, cloud: 2, hosted: 3, team: 4, "team-hosted": 5 };

/**
 * What to say when a fresh look finds a different plan, or null when
 * nothing moved. Going up is news worth a small moment; going down is
 * said plainly and without one.
 */
export function planChange(before: PlanKey | null, after: PlanKey): { words: string; up: boolean } | null {
  if (before === null || before === after) return null;
  const up = (RANK[after] ?? 2) >= (RANK[before] ?? 0);
  if (after === "free") return { words: "Your plan has ended. Bloks keeps working with your own keys.", up: false };
  return { words: `You're on ${planName(after)} now`, up };
}
