// Bloks credits, from the app's side: a licence traded for a token once,
// the token renewed when the service refuses it, the Bloks engine reading
// its models and answering through the generic driver, and an empty
// balance said in the service's own words (server/credits.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CREDITS_SPEC,
  CreditsAccount,
  creditsCheckoutUrl,
  readBalance,
  serviceWords,
  type CreditsSaved,
  type CompatAccess,
} from "../server/credits.ts";
import { openAiCompatDriver } from "../server/drivers/openai-compat.ts";
import type { RuntimeEvent } from "../server/contracts.ts";
import { startFakeCredits, type FakeCredits } from "./helpers/fake-credits.ts";

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
  const turn = async (threadId: string, text: string) => {
    const from = events.length;
    await instance.adapter.sendTurn({ threadId, text });
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

test("the balance is read as the service says it, and a revoked token is renewed for it", async (t) => {
  const service = await withService(t, { balance: 3.25 });
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const first = (await account.token())!;
  service.revoke(first);
  const balance = await account.balance();
  assert.equal(balance.balance, 3.25);
  assert.equal(balance.currency, "USD");
  assert.equal(balance.lowAt, 2);
  assert.equal(balance.autoReload, false);
  assert.equal(service.traded.length, 2, "one renewal, then the balance");
});

test("a balance answer is read field by field, and one without a balance is refused", () => {
  assert.deepEqual(readBalance('{"balance":1.5,"currency":"eur","lowAt":"x","autoReload":"yes"}', 7), {
    balance: 1.5,
    currency: "EUR",
    lowAt: null,
    autoReload: false,
    at: 7,
  });
  assert.throws(() => readBalance('{"currency":"usd"}'), /without a balance/);
  assert.throws(() => readBalance("<html>"), /without a balance/);
});

test("the service's own words are found in each shape it uses, and markup is not words", () => {
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

test("the Bloks engine lists the service's models and answers through it", async (t) => {
  const service = await withService(t, { models: ["claude-sonnet-5", "gpt-6-luna", "text-embedding-4"] });
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const { instance, turn } = await engine(service, account);
  const snapshot = await instance.snapshot();
  assert.equal(snapshot.state, "available");
  assert.deepEqual(
    instance.models.options.map((o) => o.id),
    ["claude-sonnet-5", "gpt-6-luna"],
    "the live list, with what is not a chat model left out",
  );
  const events = await turn("lane-1", "hello there");
  const said = events.find((e) => e.type === "item.completed" && e.itemType === "assistant_text");
  assert.ok(said && "text" in said && /credits says: hello there/.test(String(said.text)));
  assert.ok(events.some((e) => e.type === "turn.completed" && e.ok));
  assert.ok(service.bearers.every((b) => b === service.issued[0]), "the token is the bearer on every call");
  assert.equal(service.completions[0]?.model, "claude-sonnet-5");
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

test("an empty balance ends the turn with the service's words, marked as credits", async (t) => {
  const service = await withService(t);
  const account = new CreditsAccount({ store: memoryStore({ licence: LICENCE }), envToken: () => null });
  const { turn } = await engine(service, account);
  service.empty("You are out of Bloks credits. Add more at the checkout.");
  const events = await turn("lane-1", "anything");
  const error = events.find((e) => e.type === "runtime.error");
  assert.ok(error && error.type === "runtime.error");
  assert.equal(error.message, "You are out of Bloks credits. Add more at the checkout.");
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
