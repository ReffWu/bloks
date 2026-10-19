// When the rules have nothing to say about words sent mid-turn, the
// agent's own engine is asked, if it has a small model (server/delivery.ts).
// Served by a loopback fixture: the agent's turns are held open, and the
// small model answers NOW or WAIT.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";

import { PROVIDER_SPECS } from "../server/providers.ts";
import { startHarness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

const SMALL = PROVIDER_SPECS.find((s) => s.kind === "grok")!.small!;

async function fixture(t: TestContext, verdict: () => string) {
  const asked: string[] = [];
  const held: Array<() => void> = [];
  let turns = 0;
  const server = createServer((req, res) => {
    let input = "";
    req.on("data", (c) => (input += c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "grok-4" }, { id: SMALL }] }));
      const body = JSON.parse(input);
      res.setHeader("content-type", "application/json");
      const answer = (text: string) => res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
      if (body.model === SMALL) {
        asked.push(String(body.messages?.at(-1)?.content ?? ""));
        return answer(verdict());
      }
      // a turn: held open, so the agent is mid-turn until the test lets go
      turns++;
      held.push(() => answer("Done"));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    held.forEach((f) => f());
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, asked, held, turns: () => turns };
}

async function boot(t: TestContext, verdict: () => string) {
  const f = await fixture(t, verdict);
  const h = await startHarness();
  t.after(() => h.stop());
  // off unless the person turns it on
  assert.equal((await h.json("/api/config")).delivery.askModel, false);
  assert.equal((await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ delivery: { askModel: "yes" } }) })).status, 400);
  assert.equal((await h.fetch("/api/config", { method: "PUT", body: JSON.stringify({ delivery: { askModel: true } }) })).status, 200);
  assert.ok((await h.fetch("/api/providers/grok/connect", { method: "POST", body: JSON.stringify({ key: "local-fixture", url: f.url }) })).ok);
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ivy" }) });
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "grok", model: "grok-4" } }) });
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "TASK" }) });
  assert.ok(await waitFor(() => f.turns() === 1), "the turn never reached the provider");
  return { f, h, bot: bot as { id: string } };
}

const send = (h: any, bot: { id: string }, text: string) =>
  h.json(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text }) });

test("words the rules cannot read are put to the agent's small model, and its NOW stops a turn that cannot take them", async (t) => {
  const { f, h, bot } = await boot(t, () => "NOW");

  // sure words never reach the model
  const later = await send(h, bot, "when you're done, draft a summary");
  assert.equal(later.delivery.why, "later");
  assert.equal(f.asked.length, 0, "the model was asked about words the rules had already read");

  const unsure = await send(h, bot, "the client prefers the blue palette");
  assert.equal(f.asked.length, 1);
  assert.match(f.asked[0], /the client prefers the blue palette/);
  // this engine cannot take words mid-turn, so going in now means
  // stopping the turn and starting the next one with them
  assert.equal(unsure.queued, true);
  assert.deepEqual(unsure.delivery, { route: "stopped", why: "model", line: "Stopped Ivy to take your message" });
  assert.ok(await waitFor(() => f.turns() === 2), "the stopped turn was never followed by the next one");
});

test("the small model's WAIT, or no answer at all, leaves the words waiting", async (t) => {
  const answers = ["WAIT", "I am not sure"];
  const { f, h, bot } = await boot(t, () => answers.shift() ?? "");
  const waits = await send(h, bot, "the client prefers the blue palette");
  assert.deepEqual(waits.delivery, { route: "queued", why: "model", line: "Queued until Ivy finishes" });
  const unread = await send(h, bot, "here is the brand guide link");
  assert.deepEqual([unread.queued, unread.delivery.why], [true, "other"]);
  assert.equal(f.asked.length, 2);
  assert.equal(f.turns(), 1, "a waiting message stopped the turn");
});
