// Bloks AI through the real server: offered only while a Cloud licence is
// active or the host was started with a token, the Bloks engine in the
// picker with its one model, a run that answers, a used-up allowance that
// leaves a standing refusal (the composer's notice) and rests nothing,
// what is left for Settings and the phone, and a new licence that forgets
// the old token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHarness, type Harness } from "./helpers/server.ts";
import { messagesOf, waitFor } from "./helpers/turns.ts";
import { startFakeCredits, type FakeCredits } from "./helpers/fake-credits.ts";

const LICENCE = `blok_live_${"c".repeat(32)}`;
const OTHER = `blok_live_${"d".repeat(32)}`;

async function service(t: { after: (fn: () => unknown) => void }) {
  const fake = await startFakeCredits();
  t.after(() => fake.close());
  return fake;
}

/** A token the fake will accept, traded for directly. */
async function tokenFrom(fake: FakeCredits): Promise<string> {
  const res = await fetch(`${fake.base}/token`, { method: "POST", headers: { authorization: `Bearer ${LICENCE}` } });
  return ((await res.json()) as { token: string }).token;
}

async function harness(t: { after: (fn: () => unknown) => void }, env: Record<string, string>) {
  const h = await startHarness(env);
  t.after(() => h.stop());
  return h;
}

async function agentOnCredits(h: Harness) {
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Penny" }) });
  const ok = await h.fetch(`/api/bots/${bot.id}`, {
    method: "PATCH",
    body: JSON.stringify({ modelSelection: { instanceId: "bloks", model: "bloks-ai" } }),
  });
  assert.equal(ok.status, 200);
  return bot as { id: string; threadId: string };
}

const say = (h: Harness, bot: { id: string }, text: string) =>
  h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text }) });

test("without a Cloud licence or a token, credits are not offered and the engine is not there", async (t) => {
  const fake = await service(t);
  const h = await harness(t, { BLOKS_CREDITS_URL: fake.base });
  const { instances } = await h.json("/api/instances");
  assert.ok(!instances.some((i: any) => i.instanceId === "bloks"));
  const status = await h.json("/api/credits");
  assert.equal(status.offered, false);
  assert.equal(status.leftPercent, null);
  assert.deepEqual(fake.bearers, [], "nothing is asked of the service");
});

test("a host started with a token runs agents on Bloks AI, and a used-up allowance stands until it is topped up", async (t) => {
  const fake = await service(t);
  const token = await tokenFrom(fake);
  const h = await harness(t, { BLOKS_CREDITS_URL: fake.base, BLOKS_CREDITS_TOKEN: token });

  const engine = await waitFor(async () => {
    const { instances } = await h.json("/api/instances");
    const found = instances.find((i: any) => i.instanceId === "bloks");
    return found?.snapshot?.state === "available" && found.models.options.length ? found : null;
  });
  assert.ok(engine, "the Bloks engine is in the picker");
  assert.deepEqual(engine.models.options, [{ id: "bloks-ai", label: "Bloks AI" }], "one model, whatever the service lists");
  assert.equal(engine.displayName, "Bloks AI");

  const status = await h.json("/api/credits");
  assert.equal(status.offered, true);
  assert.equal(status.fromEnvironment, true);
  assert.equal(status.leftPercent, 62);
  assert.equal(status.low, false);
  assert.equal(status.checkoutUrl, `${fake.root}/credits`);
  assert.equal(status.refused, null);

  const bot = await agentOnCredits(h);
  assert.equal((await say(h, bot, "first words")).status < 300, true);
  const answered = await waitFor(async () => (await messagesOf(h, bot)).find((m) => m.role === "bot" && /bloks ai says/.test(m.text ?? "")));
  assert.ok(answered, "the run answered on Bloks AI");

  fake.empty("Bloks AI is used up for this month. Top up to keep going.");
  await say(h, bot, "second words");
  const notice = await waitFor(async () =>
    (await messagesOf(h, bot)).find((m) => m.kind === "notice" && /Bloks AI is used up/.test(m.text ?? "")),
  );
  assert.ok(notice, "the refusal is said in the service's words");
  const refused = await waitFor(async () => (await h.json("/api/credits")).refused);
  assert.equal(refused?.message, "Bloks AI is used up for this month. Top up to keep going.");
  const config = await h.json("/api/config");
  assert.equal(config.credits.refused?.message, refused?.message, "the composer reads it with the rest of the settings");

  // A top-up. The next read clears the refusal, and the engine was never
  // rested, so the next run goes at once.
  fake.refill(50);
  const after = await h.json("/api/credits?fresh=1");
  assert.equal(after.leftPercent, 50);
  assert.equal(after.refused, null);
  await waitFor(async () => !(await h.json("/api/bots")).bots.find((b: any) => b.id === bot.id)?.busy);
  await say(h, bot, "third words");
  // (the run is told an earlier attempt failed, so the words it echoes
  // start with that note; what matters is that it answered at all)
  const again = await waitFor(async () => {
    const all = await messagesOf(h, bot);
    const asked = all.findIndex((m) => m.role === "user" && m.text === "third words");
    return asked >= 0 && all.slice(asked).find((m) => m.role === "bot" && m.kind === "text" && /bloks ai says/.test(m.text ?? ""));
  });
  assert.ok(again, "no rest after an empty balance: topping up is felt at once");

  assert.ok(!h.logs().includes(token), "the token never reaches the log");
});

test("activating Cloud keeps the licence for credits, and a different licence forgets the old token", async (t) => {
  const fake = await service(t);
  const h = await harness(t, { BLOKS_CREDITS_URL: fake.base, BLOKS_RELAY_URL: fake.root });
  const activate = (key: string) => h.fetch("/api/relay/activate", { method: "POST", body: JSON.stringify({ key }) });
  assert.equal((await activate(LICENCE)).status, 200);

  const saved = () => JSON.parse(readFileSync(join(h.home, ".bloks", "config.json"), "utf8"));
  const first = await waitFor(() => saved().credits?.token);
  assert.equal(first, fake.issued[0]);
  assert.equal(saved().credits.licence, LICENCE);
  const { instances } = await h.json("/api/instances");
  assert.ok(instances.some((i: any) => i.instanceId === "bloks"), "offered once Cloud is active");
  assert.equal((await h.json("/api/credits")).leftPercent, 62);

  assert.equal((await activate(OTHER)).status, 200);
  const second = await waitFor(() => (saved().credits?.token !== first ? saved().credits?.token : null));
  assert.equal(second, fake.issued[1]);
  assert.deepEqual(fake.traded, [LICENCE, OTHER]);

  // A paired phone or a page elsewhere never hands a key in.
  const remote = await h.fetchRemote("/api/credits/connect", { method: "POST", body: JSON.stringify({ key: LICENCE }) });
  assert.notEqual(remote.status, 200);
  assert.ok(!h.logs().includes(LICENCE) && !h.logs().includes(OTHER), "a licence never reaches the log");
});

test("a Cloud key activated before credits existed is asked for once more, here", async (t) => {
  const fake = await service(t);
  const h = await harness(t, { BLOKS_CREDITS_URL: fake.base });
  // Cloud is active, but the licence was spent and not kept
  await h.fetch("/api/relay", { method: "PUT", body: JSON.stringify({ agentToken: "a", clientToken: "b", enabled: true, url: "http://127.0.0.1:9" }) });
  const status = await h.json("/api/credits");
  assert.equal(status.offered, true);
  assert.equal(status.needsKey, true);
  const wrong = await h.fetch("/api/credits/connect", { method: "POST", body: JSON.stringify({ key: "nope" }) });
  assert.equal(wrong.status, 400);
  const connected = await h.json("/api/credits/connect", { method: "POST", body: JSON.stringify({ key: LICENCE }) });
  assert.equal(connected.needsKey, false);
  assert.equal(connected.leftPercent, 62);
});

test("background work stays off credits until the person turns it on", async (t) => {
  const fake = await service(t);
  const h = await harness(t, { BLOKS_CREDITS_URL: fake.base });
  assert.equal((await h.json("/api/config")).credits.background, false, "off by default");
  const bad = await h.fetch("/api/credits", { method: "PATCH", body: JSON.stringify({ background: "yes" }) });
  assert.equal(bad.status, 400);
  const on = await h.json("/api/credits", { method: "PATCH", body: JSON.stringify({ background: true }) });
  assert.equal(on.background, true);
  assert.equal((await h.json("/api/config")).credits.background, true);
});

test("Claude Code is never put on Bloks AI: the settings route refuses it with a sentence", async (t) => {
  const fake = await service(t);
  const h = await harness(t, { BLOKS_CREDITS_URL: fake.base });
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ada" }) });
  const patch = (body: unknown) => h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(body) });
  const refused = await patch({ engineAccess: "credits" });
  assert.equal(refused.status, 400);
  const { error } = (await refused.json()) as { error: string };
  assert.equal(error, "Claude Code runs on your own Claude plan or key, so it cannot run on Bloks AI. To use Bloks AI, pick Bloks AI as this agent's engine.");
  // and anything else is refused too
  assert.equal((await patch({ engineAccess: "free" })).status, 400);
  // its own sign-in is what there is, so an older phone saying so is fine
  assert.equal((await patch({ engineAccess: "own" })).status, 200);
  assert.equal((await patch({ engineAccess: null })).status, 200);
  const agent = (await h.json("/api/bots")).bots.find((b: any) => b.id === bot.id);
  assert.equal("engineAccess" in agent, false, "no agent carries it");
});

test("the nightly tidy leaves an agent on credits alone until background work may spend them; Tidy now always may", async (t) => {
  const fake = await service(t);
  const token = await tokenFrom(fake);
  const clockHome = mkdtempSync(join(tmpdir(), "bloks-credits-clock-"));
  t.after(() => rmSync(clockHome, { recursive: true, force: true }));
  const clockFile = join(clockHome, "offset");
  writeFileSync(clockFile, "0");
  const h = await harness(t, {
    BLOKS_CREDITS_URL: fake.base,
    BLOKS_CREDITS_TOKEN: token,
    NODE_OPTIONS: `--import=${new URL("./helpers/scheduler-clock.mjs", import.meta.url).href}`,
    BLOKS_TEST_CLOCK_FILE: clockFile,
  });
  // the brief should not be made by the clock passing eight
  await h.fetch("/api/briefs/settings", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  const bot = await agentOnCredits(h);
  const remember = (text: string) => h.fetch(`/api/bots/${bot.id}/memory`, { method: "PUT", body: JSON.stringify({ text }) });
  await remember("- Opens at seven.\n- Closes at three.\n- Sourdough on Fridays.\n- Rye on Tuesdays.\n");
  await waitFor(async () => (await h.json("/api/instances")).instances.find((i: any) => i.instanceId === "bloks" && i.snapshot.state === "available"));
  const tidyAsked = () => fake.completions.length;

  const now = new Date();
  const night = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 2, 30).getTime() - now.getTime();
  writeFileSync(clockFile, String(night(1)));
  const first = await waitFor(async () => (await h.json(`/api/bots/${bot.id}/memory/tidy`)).runs[0], 20_000);
  assert.ok(first, "the night came");
  assert.match(first.note ?? "", /No engine could read it/);
  assert.equal(tidyAsked(), 0, "nothing was spent on work nobody asked for");

  await h.fetch("/api/credits", { method: "PATCH", body: JSON.stringify({ background: true }) });
  await remember("- Opens at seven.\n- Closes at four now.\n- Sourdough on Fridays.\n- Rye on Tuesdays.\n");
  writeFileSync(clockFile, String(night(2)));
  const second = await waitFor(async () => (await h.json(`/api/bots/${bot.id}/memory/tidy`)).runs.length >= 2, 20_000);
  assert.ok(second);
  assert.equal(tidyAsked(), 1, "allowed, the night's tidy runs on credits");

  await h.fetch("/api/credits", { method: "PATCH", body: JSON.stringify({ background: false }) });
  await h.fetch(`/api/bots/${bot.id}/memory/tidy`, { method: "POST" });
  assert.equal(tidyAsked(), 2, "Tidy now is asked for, so it may");
});
