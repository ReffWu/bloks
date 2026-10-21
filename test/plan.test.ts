// The Plan page's sense of things (src/lib/plan.ts): which offers show on
// which plan, how a membership's status is said, and when a focus is
// somebody coming back from bloks.dev with a different plan.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RETURN_WINDOW_MS,
  cameBack,
  hostingWords,
  ladderFor,
  planChange,
  planKey,
  planName,
  shortDate,
  statusOf,
  type Account,
  type Offer,
  type PlanSnapshot,
} from "../src/lib/plan.ts";

const offer = (id: string, forPlans: string[], over: Partial<Offer> = {}): Offer => ({
  id,
  name: id,
  tagline: "",
  price: null,
  points: [],
  requires: [],
  for: forPlans,
  cta: { label: "Go", url: `https://bloks.dev/${id}` },
  onSale: true,
  ...over,
});

const account = (over: Partial<Account> = {}): Account => ({
  plan: "cloud",
  bundle: null,
  interval: "month",
  status: "active",
  renewsAt: null,
  cancelsAt: null,
  since: null,
  email: null,
  bloksAi: null,
  hosting: null,
  sharedRoom: null,
  topUps: null,
  ...over,
});

const OFFERS = [
  offer("team", ["free", "cloud"]),
  offer("hosting", ["cloud", "team"]),
  offer("ai", ["free", "cloud", "team"]),
  offer("cloud", ["free"]),
  offer("team-hosted", ["team"]),
  offer("everyone", []),
];

test("with no key, Bloks Cloud leads the ladder and the rest follow in the site's order", () => {
  assert.deepEqual(
    ladderFor("free", OFFERS).map((o) => o.id),
    ["cloud", "team", "ai", "everyone"],
  );
});

test("on Cloud: Team, Hosting and Bloks AI, and nothing Cloud already is", () => {
  assert.deepEqual(
    ladderFor("cloud", OFFERS, account()).map((o) => o.id),
    ["team", "hosting", "ai", "everyone"],
  );
});

test("on Team: Hosting, Bloks AI and Team Hosted, never Team again", () => {
  assert.deepEqual(
    ladderFor("team", [...OFFERS, offer("team", ["team"])], account({ plan: "team" })).map((o) => o.id),
    ["hosting", "ai", "team-hosted", "everyone"],
  );
});

test("what the account already has is not offered again", () => {
  const owned = account({ bloksAi: { active: true, renewsAt: null }, hosting: { tier: "standard", state: "running" } });
  assert.deepEqual(
    ladderFor("cloud", OFFERS, owned).map((o) => o.id),
    ["team", "everyone"],
  );
  const lapsed = account({ bloksAi: { active: false, renewsAt: null } });
  assert.ok(ladderFor("cloud", OFFERS, lapsed).some((o) => o.id === "ai"), "Bloks AI that lapsed is offered again");
  const bundled = account({ plan: "team", bundle: "team-hosted" });
  assert.ok(!ladderFor("team-hosted", [offer("team-hosted", ["team-hosted"])], bundled).length, "a bundle is not offered to itself");
});

test("nothing to show is an empty ladder, never a crash", () => {
  assert.deepEqual(ladderFor("cloud", null), []);
  assert.deepEqual(ladderFor("cloud", []), []);
});

test("the plan key is the bundle, then the plan, then what the gates say, and free without a key", () => {
  const snap = (over: Partial<PlanSnapshot>): PlanSnapshot =>
    ({ licence: { present: true, masked: "x", kept: true }, account: null, ownerPlan: null, ...over }) as PlanSnapshot;
  assert.equal(planKey(snap({ licence: { present: false, masked: null, kept: false } })), "free");
  assert.equal(planKey(snap({ account: account({ plan: "team", bundle: "team-hosted" }) })), "team-hosted");
  assert.equal(planKey(snap({ account: account({ plan: "team" }) })), "team");
  assert.equal(planKey(snap({ ownerPlan: "team" })), "team", "offline, the gates' plan stands in");
  assert.equal(planKey(snap({})), "cloud");
  assert.equal(planKey(null), "free");
});

test("a status is said calmly, and past due asks for the card", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const renews = Date.parse("2026-11-21T00:00:00Z");
  assert.deepEqual(statusOf(account({ renewsAt: renews }), now), { tone: "on", label: "Active, renews Nov 21", line: null, needsCard: false });
  const due = statusOf(account({ status: "past_due", renewsAt: renews }), now);
  assert.equal(due.label, "Past due");
  assert.equal(due.needsCard, true);
  assert.equal(due.tone, "issue");
  const cancelling = statusOf(account({ cancelsAt: renews }), now);
  assert.equal(cancelling.label, "Cancels Nov 21");
  assert.equal(cancelling.needsCard, false);
  assert.equal(statusOf(account({ status: "canceled", cancelsAt: Date.parse("2026-09-01T00:00:00Z") }), now).label, "Ended");
  assert.equal(statusOf(account({ status: "trialing", renewsAt: renews }), now).label, "Trial, renews Nov 21");
  assert.equal(shortDate(Date.parse("2027-01-05T00:00:00Z"), now), "Jan 5, 2027", "another year says its year");
});

test("plans are named the way Bloks names them", () => {
  assert.equal(planName("cloud"), "Bloks Cloud");
  assert.equal(planName("team"), "Bloks Team");
  assert.equal(planName("team-hosted"), "Bloks Team Hosted");
  assert.equal(planName(null), "Self-hosted");
  assert.equal(planName("studio-plus"), "Studio Plus", "a plan the app has not heard of is still said readably");
});

test("a hosted machine is named by its tier and its state is said in words", () => {
  assert.equal(hostingWords(null), null);
  const lite = hostingWords({ tier: "lite", state: "provisioning" })!;
  assert.equal(lite.name, "Hosting Lite");
  assert.match(lite.line, /sleeps when idle/);
  assert.deepEqual([lite.label, lite.tone], ["Setting up", "wait"]);
  const standard = hostingWords({ tier: "standard", state: "active" })!;
  assert.equal(standard.name, "Hosting Standard");
  assert.deepEqual([standard.label, standard.tone], ["Running", "on"]);
  assert.deepEqual(
    [hostingWords({ tier: "lite", state: "grace" })!.label, hostingWords({ tier: "lite", state: "grace" })!.tone],
    ["Stops soon", "issue"],
    "a cancelled machine still runs for a while, and says so",
  );
  assert.equal(hostingWords({ tier: "standard", state: "stopped" })!.tone, "off");
  const unknown = hostingWords({ tier: "plus", state: "being_moved" })!;
  assert.deepEqual([unknown.name, unknown.label], ["Hosting", "Being moved"], "something newer is said as it came");
});

test("a focus is a return from bloks.dev only for a while after going there", () => {
  const opened = 1_000_000;
  assert.equal(cameBack(null, opened), false, "nothing was opened");
  assert.equal(cameBack(opened, opened + 5_000), true);
  assert.equal(cameBack(opened, opened + RETURN_WINDOW_MS), true);
  assert.equal(cameBack(opened, opened + RETURN_WINDOW_MS + 1), false, "tomorrow's focus is just a focus");
  assert.equal(cameBack(opened, opened - 1), false);
});

test("a fresh look says a change once, up with a moment and down plainly", () => {
  assert.equal(planChange("cloud", "cloud"), null);
  assert.equal(planChange(null, "team"), null, "a first look is not a change");
  assert.deepEqual(planChange("cloud", "team"), { words: "You're on Bloks Team now", up: true });
  assert.deepEqual(planChange("free", "cloud"), { words: "You're on Bloks Cloud now", up: true });
  assert.equal(planChange("team", "cloud")?.up, false);
  assert.equal(planChange("cloud", "free")?.up, false);
  assert.match(planChange("cloud", "free")!.words, /own keys/);
});
