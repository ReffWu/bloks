// The Plan page's routes, through the real server, against a stand-in
// for bloks.dev (test/helpers/fake-site.ts): the owner's own window
// reads the plan and an agent never does, the key never comes
// back to the page, the last good answer is kept for when the site
// cannot be reached, and a fresh look moves the gates with the plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness, type Harness } from "./helpers/server.ts";
import { startFakeSite, SITE_LICENCE, type FakeSite } from "./helpers/fake-site.ts";
import { controlledChain } from "./helpers/agent-chain.ts";

async function site(t: { after: (fn: () => unknown) => void }) {
  const s = await startFakeSite();
  t.after(() => s.close());
  return s;
}

/** A harness whose workspace holds the key, pointed at the stand-in. */
async function withKey(t: { after: (fn: () => unknown) => void }, s: FakeSite, licence: string | null = SITE_LICENCE): Promise<Harness & { home: string }> {
  const home = mkdtempSync(join(tmpdir(), "bloks-plan-"));
  mkdirSync(join(home, ".bloks"));
  writeFileSync(join(home, ".bloks/config.json"), JSON.stringify(licence ? { credits: { licence } } : {}));
  const h = await startHarness({ HOME: home, BLOKS_SITE_URL: s.base, BLOKS_CREDITS_URL: `${s.base}/api/ai` });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });
  return Object.assign(h, { home });
}

test("with no key, the plan is free and the offers are asked for as free, with no credential", async (t) => {
  const s = await site(t);
  const h = await withKey(t, s, null);
  const plan = await h.json("/api/plan");
  assert.equal(plan.licence.present, false);
  assert.equal(plan.licence.masked, null);
  assert.equal(plan.account, null);
  assert.equal(plan.accountState, "none");
  assert.deepEqual(s.offersAsked, ["free"]);
  assert.deepEqual(s.offersAuth, [undefined], "the offers are public and are never asked with a key");
  assert.deepEqual(s.bearers, [], "no account is asked for without a key");
  assert.deepEqual(
    plan.offers.map((o: any) => o.id),
    ["cloud", "team", "ai"],
  );
  assert.equal(plan.site, s.base);
});

test("the account is read with the key, and the key never comes back to the page", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud", interval: "year", renewsAt: "2026-11-21T00:00:00Z", since: "2026-03-02T00:00:00Z", email: "hamed@example.com" });
  const h = await withKey(t, s);
  const res = await h.fetch("/api/plan");
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(SITE_LICENCE), "the licence is never in the answer");
  const plan = JSON.parse(text);
  assert.equal(plan.licence.present, true);
  assert.equal(plan.licence.masked, `blok_live_••••${SITE_LICENCE.slice(-4)}`);
  assert.equal(plan.account.plan, "cloud");
  assert.equal(plan.account.interval, "year");
  assert.equal(plan.account.renewsAt, Date.parse("2026-11-21T00:00:00Z"));
  assert.equal(plan.account.email, "h••••@example.com", "an address the site forgot to mask is masked here");
  assert.equal(plan.account.price, null, "an answer that names no price shows none");
  assert.equal(plan.accountState, "live");
  assert.deepEqual(s.bearers, [SITE_LICENCE]);
  assert.deepEqual(s.offersAsked, ["cloud"], "offers are asked for the account's own plan");
  // a link that is not the site's survives as a link, and a nameless offer does not survive at all
  assert.deepEqual(
    plan.offers.map((o: any) => o.id),
    ["team", "ai", "hosting", "elsewhere"],
  );
  assert.equal(plan.offers.find((o: any) => o.id === "hosting").onSale, false);
  const log = h.logs();
  assert.ok(!log.includes(SITE_LICENCE), "nor in anything the server printed");
});

test("the plan's own price is drawn as the site words it, and anything less is no price", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "team", price: { amount: "P2\u202e", per: "month", extra: "ignored" } });
  const h = await withKey(t, s);
  assert.deepEqual((await h.json("/api/plan")).account.price, { amount: "P2", per: "month" }, "direction marks go, unknown fields go");
  s.setAccount(SITE_LICENCE, { plan: "team", price: { per: "month" } });
  assert.equal((await h.json("/api/plan?fresh=1")).account.price, null, "no amount is no price");
  s.setAccount(SITE_LICENCE, { plan: "team", price: "P2 a month" });
  assert.equal((await h.json("/api/plan?fresh=1")).account.price, null, "only the shape the site agreed");
});

test("a bundle files the offers under its own name", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "team", bundle: "team-hosted", hosting: { tier: "standard", state: "running" } });
  const h = await withKey(t, s);
  const plan = await h.json("/api/plan");
  assert.equal(plan.account.bundle, "team-hosted");
  assert.deepEqual(plan.account.hosting, { tier: "standard", state: "running" });
  assert.deepEqual(s.offersAsked, ["team-hosted"]);
});

// the owner's own paired devices read it too (test/plan-remote.test.ts)
test("a website and a device nobody paired never read the plan", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud" });
  const h = await withKey(t, s);
  assert.equal((await h.fetchAs("https://evil.example", "/api/plan")).status, 403);
  const remote = await h.fetchRemote("/api/plan");
  assert.ok(remote.status === 401 || remote.status === 403, `a request from the network was answered ${remote.status}`);
  assert.ok(!JSON.stringify(remote.body).includes(SITE_LICENCE));
  assert.equal((await h.fetchAs("https://evil.example", "/api/plan/manage", { method: "POST" })).status, 403);
  assert.equal((await h.fetchAs("https://evil.example", "/api/plan/licence", { method: "DELETE" })).status, 403);
  assert.deepEqual(s.bearers, [], "nothing reached the site for them");
});

test("an agent's credential never reads the plan, opens billing or removes the key", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "team" });
  const f = await controlledChain(t, { credits: { licence: SITE_LICENCE } }, { BLOKS_SITE_URL: s.base, BLOKS_CREDITS_URL: `${s.base}/api/ai` });
  const bot = await f.hire("Penny");
  const turn = await f.begin(bot);
  for (const [path, method] of [
    ["/api/plan", "GET"],
    ["/api/plan?fresh=1", "GET"],
    ["/api/plan/manage", "POST"],
    ["/api/plan/licence", "DELETE"],
  ] as const) {
    const res = await f.agent(turn, path, undefined, method);
    assert.equal(res.status, 403, `${method} ${path} answered an agent`);
    assert.ok(!(await res.text()).includes(SITE_LICENCE));
  }
  assert.deepEqual(s.bearers, [], "an agent's ask never reached bloks.dev");
  // and the owner's window still can
  assert.equal((await f.h.json("/api/plan")).account.plan, "team");
  await f.finish(turn, bot);
});

test("with bloks.dev unreachable, the last good answers are kept and dated, never the key on disk", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "team", renewsAt: "2026-12-01T00:00:00Z" });
  const h = await withKey(t, s);
  const live = await h.json("/api/plan?fresh=1");
  assert.equal(live.accountState, "live");
  s.down(true);
  const kept = await h.json("/api/plan?fresh=1");
  assert.equal(kept.accountState, "cached");
  assert.equal(kept.account.plan, "team");
  assert.equal(kept.accountAt, live.accountAt);
  assert.match(kept.problem, /reach bloks\.dev/);
  assert.equal(kept.offersState, "cached");
  assert.deepEqual(
    kept.offers.map((o: any) => o.id),
    live.offers.map((o: any) => o.id),
  );
  const cache = readFileSync(join(h.home, ".bloks", "plan-cache.json"), "utf8");
  assert.ok(!cache.includes(SITE_LICENCE), "the cache holds a fingerprint of the key, not the key");
  // billing cannot be opened offline, and says so in words
  const manage = await h.fetch("/api/plan/manage", { method: "POST" });
  assert.equal(manage.status, 502);
  assert.match((await manage.json()).error, /reach bloks\.dev/);
});

test("a key the site does not know is said plainly, and its old account is not shown as if it stood", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud" });
  const h = await withKey(t, s);
  assert.equal((await h.json("/api/plan?fresh=1")).accountState, "live");
  s.setAccount(SITE_LICENCE, null);
  const refused = await h.json("/api/plan?fresh=1");
  assert.equal(refused.accountState, "refused");
  assert.equal(refused.account, null);
  assert.match(refused.problem, /doesn't know this key/);
  s.down(true);
  const after = await h.json("/api/plan?fresh=1");
  assert.equal(after.account, null, "a refused key's old account is not brought back from the cache");
});

test("Manage billing answers the portal's link, or Link's, and is asked only when pressed", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud" });
  const h = await withKey(t, s);
  await h.json("/api/plan");
  const before = s.bearers.length;
  const portal = await h.json("/api/plan/manage", { method: "POST" });
  assert.deepEqual(portal, { url: `${s.base}/portal/session-1`, manageAt: "portal" }, "anything but Link is the portal the site opened");
  assert.equal(s.bearers.length, before + 1);
  s.manageAt("link");
  assert.deepEqual(await h.json("/api/plan/manage", { method: "POST" }), { url: "https://app.link.com/recurring", manageAt: "link" });
});

test("a fresh look that finds Bloks Team opens the members' door at once", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud" });
  const h = await withKey(t, s);
  const first = await h.json("/api/plan?fresh=1");
  assert.equal(first.ownerPlan, "cloud");
  assert.equal(first.members.limit, 0);
  // the person came back from a checkout on bloks.dev
  s.setAccount(SITE_LICENCE, { plan: "team" });
  const back = await h.json("/api/plan?fresh=1");
  assert.equal(back.account.plan, "team");
  assert.equal(back.ownerPlan, "team", "the gates go by the plan the site just said");
  assert.equal(back.members.limit, 10);
});

test("removing the key forgets it here, takes the plan back to free, and leaves the site alone", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud" });
  const h = await withKey(t, s);
  await h.json("/api/plan");
  const removed = await h.json("/api/plan/licence", { method: "DELETE" });
  assert.deepEqual(removed, { removed: true });
  const config = readFileSync(join(h.home, ".bloks", "config.json"), "utf8");
  assert.ok(!config.includes(SITE_LICENCE), "the key is gone from this workspace's settings");
  const plan = await h.json("/api/plan");
  assert.equal(plan.licence.present, false);
  assert.equal(plan.account, null);
  assert.equal((await h.json("/api/plan/licence", { method: "DELETE" })).removed, false, "removing nothing is not an error");
});

test("the way into a hosted workspace is a link asked with the key, sealed for this computer and opened here", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud", hosting: { tier: "standard", state: "active" } });
  const h = await withKey(t, s);
  const res = await h.fetch("/api/plan/hosting/link", { method: "POST", body: "{}" });
  assert.equal(res.status, 200);
  const made = await res.json();
  assert.match(made.link, /^https:\/\/bloks\.dev\/pair#[A-Za-z0-9_-]+$/);
  assert.match(made.webLink, /^https:\/\/bloks\.dev\/web\/#/);
  assert.equal(made.host, "Sam");
  assert.ok(made.expiresAt > Date.now());
  assert.deepEqual(s.bearers, [SITE_LICENCE], "asked with the key");
  assert.match(s.linkKeys[0], /^B[A-Za-z0-9_-]{86}$/, "and a one-time key of this computer's own");
  // a fresh key each time: an old answer opens nothing new
  await h.fetch("/api/plan/hosting/link", { method: "POST", body: "{}" });
  assert.notEqual(s.linkKeys[1], s.linkKeys[0]);
});

test("a hosted workspace that is waking is said to be waking, for the page to ask again", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud", hosting: { tier: "lite", state: "active" } });
  s.wakingFor(1);
  const h = await withKey(t, s);
  const res = await h.fetch("/api/plan/hosting/link", { method: "POST", body: "{}" });
  assert.equal(res.status, 503);
  const said = await res.json();
  assert.equal(said.waking, true);
  assert.match(said.error, /waking up/);
  assert.equal((await h.fetch("/api/plan/hosting/link", { method: "POST", body: "{}" })).status, 200, "and the next ask finds it awake");
});

test("only this computer's own window asks for the way in: never a website, the network, or with no key", async (t) => {
  const s = await site(t);
  s.setAccount(SITE_LICENCE, { plan: "cloud", hosting: { tier: "standard", state: "active" } });
  const h = await withKey(t, s);
  assert.equal((await h.fetchAs("https://evil.example", "/api/plan/hosting/link", { method: "POST", body: "{}" })).status, 403);
  const remote = await h.fetchRemote("/api/plan/hosting/link", { method: "POST", body: "{}" });
  assert.ok(remote.status === 401 || remote.status === 403, `the network was answered ${remote.status}`);
  assert.deepEqual(s.bearers, []);
  const none = await withKey(t, s, null);
  assert.equal((await none.fetch("/api/plan/hosting/link", { method: "POST", body: "{}" })).status, 409);
});
