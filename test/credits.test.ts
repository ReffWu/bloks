// Bloks AI, from the app's side: a licence traded for a token once, the
// token renewed when the service refuses it, the Bloks engine with its one
// model answering through the generic driver with its tags on every call,
// and a used-up allowance said in the service's own words
// (server/credits.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CREDITS_SPEC,
  CreditsAccount,
  creditsCheckoutUrl,
  serviceWords,
  type CreditsSaved,
  type CompatAccess,
} from "../server/credits.ts";
import { openAiCompatDriver } from "../server/drivers/openai-compat.ts";
import type { RuntimeEvent } from "../server/contracts.ts";
import { readAiBalance } from "../server/bloks-ai.ts";
import { startFakeCredits, UPSTREAM_MODEL, type FakeCredits } from "./helpers/fake-credits.ts";

const LICENCE = `blok_live_${"a".repeat(32)}`;

function memoryStore(start: CreditsSaved = {}) {
  let saved: CreditsSaved = { ...start };
  return {
    read: () => ({ ...saved }),
    write(patch: { licence?: string | null; token?: string | null }) {
      const next: Record<string, unknown> = { ...saved, ...patch };
      for (const key of Object.keys(next)) if (next[key] === null) delete next[key];
      saved = next as CreditsSaved;
    },
    get saved() {
      return saved;
    },
  };
}

async function withService(t: { after: (fn: () => Promise<void> | void) => void }, opts?: Parameters<typeof startFakeCredits>[0]) {
  const service = await startFakeCredits(opts);
  const before = process.env.BLOKS_CREDITS_URL;
  process.env.BLOKS_CREDITS_URL = service.base;
  t.after(async () => {
    if (before === undefined) delete process.env.BLOKS_CREDITS_URL;
    else process.env.BLOKS_CREDITS_URL = before;
    await service.close();
  });
  return service;
}

function accessFor(account: CreditsAccount): CompatAccess {
  return {
    token: () => account.token(),
    refresh: (rejected) => account.refresh(rejected),
    problem: () => account.problem,
  };
}

async function engine(service: FakeCredits, account: CreditsAccount) {
  const driver = openAiCompatDriver(CREDITS_SPEC, accessFor(account));
  const instance = await driver.create({
    instanceId: "bloks",
    displayName: "Bloks",
    environment: {},
    enabled: true,
    config: driver.decodeConfig({ url: `${service.base}/v1` }),
  });
  const events: RuntimeEvent[] = [];
  instance.adapter.onEvent((event) => events.push(event));
  const turn = async (threadId: string, text: string, extra: Partial<Parameters<typeof instance.adapter.sendTurn>[0]> = {}) => {
    const from = events.length;
    await instance.adapter.sendTurn({ threadId, text, ...extra });
    for (let i = 0; i < 200; i++) {
      if (events.slice(from).some((e) => e.type === "turn.completed")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    return events.slice(from);
  };
  return { instance, turn };
}

test("the licence is traded once, and the token is what every call sends", async (t) => {
  const service = await withService(t);
  const store = memoryStore({ licence: LICENCE });
  const account = new CreditsAccount({ store, envToken: () => null });
  const first = await account.token();
  const second = await account.token();
  assert.equal(first, service.issued[0]);
  assert.equal(second, first, "a kept token is used again, not traded for again");
  assert.deepEqual(service.traded, [LICENCE]);
  assert.equal(store.saved.token, first, "kept with the other keys");
});

test("a dozen calls refused together trade the licence once", async (t) => {
  const service = await withService(t);
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const old = (await account.token())!;
  service.revoke(old);
  const fresh = await Promise.all(Array.from({ length: 12 }, () => account.refresh(old)));
  assert.equal(new Set(fresh).size, 1);
  assert.equal(service.traded.length, 2);
});

test("a new licence forgets the token that came from the old one", async (t) => {
  await withService(t);
  const store = memoryStore({ licence: LICENCE });
  const account = new CreditsAccount({ store, envToken: () => null });
  await account.token();
  account.setLicence(`blok_live_${"b".repeat(32)}`);
  assert.equal(store.saved.token, undefined);
  assert.equal(store.saved.licence, `blok_live_${"b".repeat(32)}`);
  // the same licence again keeps what it has
  const token = await account.token();
  account.setLicence(`blok_live_${"b".repeat(32)}`);
  assert.equal(store.saved.token, token);
});

test("a host started with a token uses it as given, and cannot trade for another", async (t) => {
  const service = await withService(t);
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => "env-token-1" });
  assert.equal(await account.token(), "env-token-1");
  assert.equal(await account.refresh("env-token-1"), null);
  assert.match(account.problem ?? "", /started with was not accepted/);
  assert.deepEqual(service.traded, [], "the licence is never spent while the environment speaks");
});

test("with neither a licence nor a token there is nothing to send, and it says so", async (t) => {
  await withService(t);
  const account = new CreditsAccount({ store: memoryStore(), envToken: () => null });
  assert.equal(await account.token(), null);
  assert.match(account.problem ?? "", /Bloks Cloud key/);
  assert.equal(account.canConnect(), false);
});

test("a licence the service does not know is said in the service's words", async (t) => {
  await withService(t);
  const account = new CreditsAccount({ store: memoryStore({ licence: "not-a-licence" }), envToken: () => null });
  assert.equal(await account.token(), null);
  assert.equal(account.problem, "That licence is not one we know.");
});

test("a trade that failed is not tried again on every look, but a new licence is tried at once", async (t) => {
  await withService(t);
  let clock = 1_000_000;
  let asked = 0;
  const counting: typeof fetch = (...args) => {
    asked++;
    return fetch(...args);
  };
  const store = memoryStore({ licence: "not-a-licence" });
  const account = new CreditsAccount({ store, envToken: () => null, now: () => clock, fetch: counting });
  assert.equal(await account.token(), null);
  assert.equal(await account.token(), null);
  assert.equal(asked, 1, "the service refused the first and was not asked again");
  account.setLicence(LICENCE);
  assert.ok(await account.token(), "a new licence goes straight away");
  store.write({ token: null, licence: "still-not-one" });
  assert.equal(await account.token(), null);
  clock += 31_000;
  store.write({ licence: LICENCE });
  assert.ok(await account.token(), "and a failed one is tried again after a pause");
});

test("what is left is read as shares, and a revoked token is renewed for it", async (t) => {
  const service = await withService(t, { leftPercent: 40 });
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const first = (await account.token())!;
  service.revoke(first);
  const balance = await account.balance();
  assert.equal(balance.leftPercent, 40);
  assert.equal(balance.monthlyLeftPercent, 40);
  assert.equal(balance.topUps, 1);
  assert.equal(balance.renewsAt, Date.parse("2026-11-19T00:00:00Z"));
  assert.equal(service.traded.length, 2, "one renewal, then the balance");
  // the amount and the model a careless service added are not even read
  const said = JSON.stringify(balance);
  assert.ok(!said.includes("41.17") && !said.includes(UPSTREAM_MODEL));
});

test("a balance answer is read field by field, and one without a share left is refused", () => {
  assert.deepEqual(
    readAiBalance('{"plan":"solo","usedPercent":38,"monthlyLeftPercent":"x","topUps":-2,"renewsAt":1763510400,"low":"yes","balance":12.5,"currency":"usd"}', 7),
    {
      plan: "solo",
      usedPercent: 38,
      leftPercent: 62,
      monthlyLeftPercent: null,
      topUps: 0,
      renewsAt: 1763510400000,
      low: false,
      members: null,
      team: null,
      at: 7,
    },
  );
  assert.equal(readAiBalance('{"leftPercent":140}').leftPercent, 100, "a share is a share");
  assert.throws(() => readAiBalance('{"balance":12.5}'), /without what is left/, "an amount is not a share");
  assert.throws(() => readAiBalance("<html>"), /without what is left/);
});

test("the service's own words are found in each shape it uses, and an HTML page is not words", () => {
  assert.equal(serviceWords('{"error":{"message":"No more"}}'), "No more");
  assert.equal(serviceWords('{"error":"No more"}'), "No more");
  assert.equal(serviceWords('{"message":"No more"}'), "No more");
  assert.equal(serviceWords("plain words"), "plain words");
  assert.equal(serviceWords("<html><body>502</body></html>"), "");
  assert.equal(serviceWords("x".repeat(1000)).length, 300);
});

test("the checkout page sits beside the service, on the same site", () => {
  const before = process.env.BLOKS_CREDITS_URL;
  try {
    delete process.env.BLOKS_CREDITS_URL;
    assert.equal(creditsCheckoutUrl(), "https://bloks.dev/credits");
    process.env.BLOKS_CREDITS_URL = "http://127.0.0.1:9/api/ai/";
    assert.equal(creditsCheckoutUrl(), "http://127.0.0.1:9/credits");
  } finally {
    if (before === undefined) delete process.env.BLOKS_CREDITS_URL;
    else process.env.BLOKS_CREDITS_URL = before;
  }
});

test("the Bloks engine has one model, Bloks AI, whatever the service lists, and answers through it", async (t) => {
  const service = await withService(t, { models: ["bloks-auto", UPSTREAM_MODEL, "upstream-model-c"] });
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const { instance, turn } = await engine(service, account);
  const snapshot = await instance.snapshot();
  assert.equal(snapshot.state, "available");
  assert.deepEqual(instance.models, { default: "bloks-ai", options: [{ id: "bloks-ai", label: "Bloks AI" }] });
  // an agent saved on a model the service used to list still asks for Bloks AI
  const events = await turn("lane-1", "hello there", { model: "claude-sonnet-5" });
  const said = events.find((e) => e.type === "item.completed" && e.itemType === "assistant_text");
  assert.ok(said && "text" in said && /bloks ai says: hello there/.test(String(said.text)));
  assert.ok(events.some((e) => e.type === "turn.completed" && e.ok));
  assert.ok(service.bearers.every((b) => b === service.issued[0]), "the token is the bearer on every call");
  assert.equal(service.completions[0]?.model, "bloks-ai");
  const started = events.find((e) => e.type === "session.started");
  assert.equal(started && "model" in started ? started.model : null, "bloks-ai");
  assert.ok(!JSON.stringify(events).includes(UPSTREAM_MODEL), "what ran underneath never reaches an event");
});

test("every call carries the turn's work tag, and a member's tag when there is one", async (t) => {
  const service = await withService(t);
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const { instance, turn } = await engine(service, account);
  await turn("lane-1", "build it", { tags: { work: "coding" } });
  await turn("lane-2", "from a teammate", { tags: { work: "general", member: "m_0123456789abcdef01234567" } });
  await instance.generateText!("summarise this");
  await instance.generateText!("draft an agent", { work: "general" });
  assert.deepEqual(service.tags, [
    { work: "coding", member: null },
    { work: "general", member: "m_0123456789abcdef01234567" },
    { work: "automation", member: null },
    { work: "general", member: null },
  ]);
});

test("another provider on the same driver never sends the tags", async (t) => {
  const service = await withService(t);
  // a key the fake accepts, held the ordinary way rather than renewed
  const key = (await new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null }).token())!;
  const driver = openAiCompatDriver({ ...CREDITS_SPEC, kind: "plain", fixedModels: false });
  const instance = await driver.create({
    instanceId: "plain",
    displayName: "Plain",
    environment: { PLAIN_API_KEY: key },
    enabled: true,
    config: driver.decodeConfig({ url: `${service.base}/v1` }),
  });
  await instance.adapter.sendTurn({ threadId: "lane-x", text: "hi", model: "m", tags: { work: "coding", member: "m_0123456789abcdef01234567" } }).catch(() => {});
  for (let i = 0; i < 100 && !service.tags.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(service.tags[0], { work: null, member: null });
});

test("a token refused mid-session is renewed once and the call goes through", async (t) => {
  const service = await withService(t);
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const { turn } = await engine(service, account);
  assert.ok((await turn("lane-1", "first")).some((e) => e.type === "turn.completed" && e.ok));
  service.revoke(service.issued[0]);
  const events = await turn("lane-1", "second");
  assert.ok(events.some((e) => e.type === "turn.completed" && e.ok), "answered after one renewal");
  assert.equal(service.issued.length, 2);
  assert.equal(service.bearers.at(-1), service.issued[1]);
});

test("a used-up allowance ends the turn with the service's words, marked as credits", async (t) => {
  const service = await withService(t);
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const { turn } = await engine(service, account);
  service.empty("Bloks AI is used up for now. Top up at bloks.dev.");
  const events = await turn("lane-1", "anything");
  const error = events.find((e) => e.type === "runtime.error");
  assert.ok(error && error.type === "runtime.error");
  assert.equal(error.message, "Bloks AI is used up for now. Top up at bloks.dev.");
  assert.equal(error.credits, "empty");
  assert.ok(events.some((e) => e.type === "turn.completed" && !e.ok));
});

test("without a token the engine is unavailable and says what to do", async (t) => {
  const service = await withService(t);
  const account = new CreditsAccount({ store: memoryStore(), envToken: () => null });
  const { instance } = await engine(service, account);
  const snapshot = await instance.snapshot();
  assert.equal(snapshot.state, "unavailable");
  assert.match(String(snapshot.state === "unavailable" ? snapshot.reason : ""), /Bloks Cloud key/);
});
