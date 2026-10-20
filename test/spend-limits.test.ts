// A monthly spending limit on the person's own keys
// (server/spend-limits.ts): what it counts, when it speaks, what it
// says when it stops a turn, and that it stops one. Every completion is
// served by a loopback fixture, so nothing here reaches a provider.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";

import { monthBounds, monthKey, monthSpend, providerCreditNotice, readLimit, spendNotices, spendRefusal, spendStatus } from "../server/spend-limits.ts";
import { openAiCompatDriver } from "../server/drivers/openai-compat.ts";
import { PROVIDER_SPECS } from "../server/providers.ts";
import { CREDITS_SPEC } from "../server/credits.ts";
import type { RuntimeEvent } from "../server/contracts.ts";
import type { UsageBucket } from "../server/usage.ts";
import { startHarness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();

test("a month is the calendar month, in local time", () => {
  assert.equal(monthKey(new Date(2026, 9, 31, 23, 59)), "2026-10");
  assert.equal(monthKey(new Date(2026, 10, 1, 0, 1)), "2026-11");
  const { start, end } = monthBounds(new Date(2026, 11, 15));
  assert.equal(start, new Date(2026, 11, 1).getTime());
  assert.equal(end, new Date(2027, 0, 1).getTime(), "December's next month is January");
});

test("a limit is dollars above nothing, to the cent, or null to take it off", () => {
  assert.equal(readLimit(20), 20);
  assert.equal(readLimit("$12.345"), 12.35);
  assert.equal(readLimit(" 7 "), 7);
  assert.equal(readLimit(null), null);
  for (const bad of [0, -5, "", "ten", Number.NaN, Infinity, 100_001, undefined, {}]) {
    assert.equal(readLimit(bad), undefined, String(bad));
  }
});

test("only what the engine priced, this month, counts against its limit", () => {
  const b = (over: Partial<UsageBucket>): UsageBucket => ({
    date: "2026-10-05", botId: "ada", provider: "grok", turns: 1, input: 10, output: 1, cost: 0, costKnown: false, ...over,
  });
  const buckets = [
    b({ cost: 1.25, costKnown: true }),
    b({ cost: 0.5, costKnown: true, botId: "bo" }),
    b({ cost: 9, costKnown: true, date: "2026-09-30" }),
    b({ cost: 9, costKnown: true, provider: "openrouter" }),
    b({ input: 5_000 }),
  ];
  assert.deepEqual(monthSpend(buckets, "grok", "2026-10"), { spent: 1.75, priced: true });
  assert.deepEqual(monthSpend([b({ input: 5_000 })], "grok", "2026-10"), { spent: 0, priced: false }, "tokens alone are no price");
});

test("at the limit stops, past four fifths warns, and a month spent too fast is said early", () => {
  assert.equal(spendStatus(10, 10, at(9, 5)).level, "stop");
  assert.equal(spendStatus(10, 12, at(9, 5)).reached, true);
  assert.equal(spendStatus(10, 12, at(9, 5)).usedPercent, 100, "a share never reads past 100");
  assert.equal(spendStatus(10, 8, at(9, 28)).level, "warn");
  // a third of the month gone and half the limit spent is on pace to run out
  assert.equal(spendStatus(10, 5, at(9, 11)).level, "info");
  // the first days of a month say nothing about pace, however busy
  assert.equal(spendStatus(10, 5, at(9, 2)).level, null);
  // under a quarter is nobody's news
  assert.equal(spendStatus(10, 2, at(9, 4)).level, null);
  // spending slower than the month goes by is fine
  assert.equal(spendStatus(10, 4, at(9, 20)).level, null);
  assert.equal(spendStatus(10, 10, at(9, 5)).resetsAt, new Date(2026, 10, 1).getTime());
});

test("a limit's notice is a share and a date with spending in its name, and never an amount", () => {
  assert.deepEqual(spendNotices("grok", null, 50, at(9, 5)), [], "no limit, no notice");
  assert.deepEqual(spendNotices("grok", 10, 1, at(9, 5)), []);
  const [stop] = spendNotices("grok", 10, 10.5, at(9, 5));
  assert.deepEqual(stop, {
    id: "grok:spend:stop:2026-10",
    source: "grok",
    level: "stop",
    title: "Spending limit reached",
    usedPercent: 100,
    resetsAt: new Date(2026, 10, 1).getTime(),
    kind: "spend",
  });
  const [near] = spendNotices("grok", 10, 8.4, at(9, 28));
  assert.deepEqual([near.id, near.title, near.usedPercent], ["grok:spend:warn:2026-10", "Approaching spending limit", 84]);
  const [pace] = spendNotices("grok", 10, 5, at(9, 11));
  assert.deepEqual([pace.level, pace.title], ["info", "Approaching spending limit"]);
  assert.doesNotMatch(JSON.stringify([stop, near, pace]), /\$|10\.5|8\.4/, "an amount reached a notice");
  // the provider's own refusal for money, which has no reset anybody knows
  assert.deepEqual(providerCreditNotice("grok", 1234), {
    id: "grok:credit:stop:1234", source: "grok", level: "stop", title: "Spending limit reached", usedPercent: 100, resetsAt: null,
  });
});

test("a refused turn says whose limit, how much, and the two ways on", () => {
  const text = spendRefusal("Grok", 20, new Date(2026, 10, 1).getTime(), "en-US");
  assert.equal(
    text,
    "Grok has reached its $20.00 spending limit for October, so new turns on it are paused. Raise the limit on the Usage page to carry on, or it starts again on November 1.",
  );
  assert.doesNotMatch(text, /[\u2013\u2014]/, "no dashes in what a person reads");
});

// ── a provider that prices its answers ─────────────────────────────────

/** A provider that answers every request with one reply, priced at
 * `cost` dollars when it is a number, or refuses with `status`. */
async function provider(t: TestContext, answer: () => { cost?: number; status?: number; stream?: boolean }) {
  const asked: any[] = [];
  const server = createServer((req, res) => {
    let input = "";
    req.on("data", (c) => (input += c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "grok-4" }] }));
      asked.push(JSON.parse(input));
      const said = answer();
      if (said.status) {
        res.statusCode = said.status;
        return res.end(JSON.stringify({ error: { message: "Insufficient credits. Add more using https://example.test/credits" } }));
      }
      const usage = { prompt_tokens: 1_000, completion_tokens: 20, ...(said.cost === undefined ? {} : { cost: said.cost }) };
      if (said.stream) {
        res.setHeader("content-type", "text/event-stream");
        return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "Done" } }], usage })}\n\ndata: [DONE]\n\n`);
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Done" } }], usage }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, asked };
}

async function oneTurn(t: TestContext, spec: (typeof PROVIDER_SPECS)[number], url: string) {
  const instance = await openAiCompatDriver(spec).create({
    instanceId: "fixture", displayName: "Fixture", enabled: true,
    config: { url, apiKeyEnv: "FIXTURE_KEY" }, environment: { FIXTURE_KEY: "local-fixture" },
  });
  t.after(() => instance.dispose());
  const events: RuntimeEvent[] = [];
  instance.adapter.onEvent((e) => events.push(e));
  await instance.adapter.sendTurn({ threadId: "fixture-lane", text: "Hello", model: "grok-4" });
  const done = await waitFor(() => events.find((e) => e.type === "turn.completed"));
  assert.ok(done, "the fixture turn never completed");
  return done as Extract<RuntimeEvent, { type: "turn.completed" }>;
}

test("an API engine passes on the price its provider put in the answer, and only that", async (t) => {
  const grok = PROVIDER_SPECS.find((s) => s.kind === "grok")!;
  const priced = await provider(t, () => ({ cost: 0.0125 }));
  assert.equal((await oneTurn(t, grok, priced.url)).cost, 0.0125, "a tools turn");
  const streamed = await provider(t, () => ({ cost: 0.5, stream: true }));
  assert.equal((await oneTurn(t, { ...grok, tools: undefined }, streamed.url)).cost, 0.5, "a streamed turn");
  const unpriced = await provider(t, () => ({}));
  assert.equal((await oneTurn(t, grok, unpriced.url)).cost, null, "no price is no price, not zero");
  // Bloks AI's service is never read for a price, whatever it sends
  const bloks = await provider(t, () => ({ cost: 3 }));
  assert.equal((await oneTurn(t, { ...CREDITS_SPEC, url: bloks.url }, bloks.url)).cost, null);
});

test("an engine past its limit starts no new turn until the limit is raised, and says so", async (t) => {
  // each answer costs $0.75 against a $1 limit: the second one crosses it
  const fixture = await provider(t, () => ({ cost: 0.75 }));
  const h = await startHarness();
  t.after(() => h.stop());
  assert.ok((await h.fetch("/api/providers/grok/connect", { method: "POST", body: JSON.stringify({ key: "local-fixture", url: fixture.url }) })).ok);
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Penny" }) });
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "grok", model: "grok-4" } }) });

  // only engines on the person's own key are offered a limit
  const listed = await h.json("/api/spend-limits");
  assert.deepEqual(listed.limits.map((l: any) => l.instanceId), ["grok"]);
  assert.equal(listed.limits[0].limit, null, "off until somebody sets one");
  assert.equal((await h.fetch("/api/spend-limits/claude", { method: "PUT", body: JSON.stringify({ usd: 5 }) })).status, 404);
  assert.equal((await h.fetch("/api/spend-limits/grok", { method: "PUT", body: JSON.stringify({ usd: -1 }) })).status, 400);
  const set = await h.json("/api/spend-limits/grok", { method: "PUT", body: JSON.stringify({ usd: 1 }) });
  assert.equal(set.limits[0].limit, 1);

  const send = (text: string) => h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
  const idle = async () => (await h.json("/api/bots?messages=0")).bots.find((b: any) => b.id === bot.id && !b.busy);
  for (const [i, text] of ["One", "Two"].entries()) {
    assert.ok((await send(text)).ok);
    assert.ok(await waitFor(() => fixture.asked.length === i + 1), h.logs());
    assert.ok(await waitFor(idle), h.logs());
  }
  const row = (await h.json("/api/spend-limits")).limits[0];
  assert.deepEqual([row.spent, row.reached, row.usedPercent, row.reportsPrice], [1.5, true, 100, true]);

  const notices = (await h.json(`/api/usage-notices?thread=${bot.threadId}`)).notices;
  assert.deepEqual(notices.map((n: any) => [n.title, n.level, n.kind, n.usedPercent]), [["Spending limit reached", "stop", "spend", 100]]);

  const refused = await send("Three");
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /reached its \$1\.00 spending limit/);
  assert.equal(fixture.asked.length, 2, "a refused turn reached the provider");

  // the report has it, priced, under the engine
  const report = await h.json("/api/usage/report?range=7d");
  assert.equal(report.total.cost, 1.5);
  assert.equal(report.byEngine[0].id, "grok");
  assert.equal((await h.json(`/api/usage/report?range=7d&engine=nobody`)).total.turns, 0);

  // raised, it goes on
  await h.fetch("/api/spend-limits/grok", { method: "PUT", body: JSON.stringify({ usd: 10 }) });
  assert.ok((await send("Four")).ok);
  assert.ok(await waitFor(() => fixture.asked.length === 3), h.logs());
  assert.ok(await waitFor(idle), h.logs());
  // and taken off, it is gone from the file rather than kept as nothing
  const off = await h.json("/api/spend-limits/grok", { method: "PUT", body: JSON.stringify({ usd: null }) });
  assert.equal(off.limits[0].limit, null);
});

test("a provider refusing for money is said in the composer as a stop", async (t) => {
  const fixture = await provider(t, () => ({ status: 402 }));
  const h = await startHarness();
  t.after(() => h.stop());
  assert.ok((await h.fetch("/api/providers/grok/connect", { method: "POST", body: JSON.stringify({ key: "local-fixture", url: fixture.url }) })).ok);
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Penny" }) });
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "grok", model: "grok-4" } }) });
  assert.ok((await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Hello" }) })).ok);
  const notice = await waitFor(async () => (await h.json(`/api/usage-notices?thread=${bot.threadId}`)).notices[0], 20_000);
  assert.ok(notice, h.logs());
  assert.deepEqual([notice.title, notice.level, notice.resetsAt, notice.source], ["Spending limit reached", "stop", null, "grok"]);
  assert.match(notice.id, /^grok:credit:stop:\d+$/);
});
