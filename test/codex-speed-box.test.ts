// Codex speed on a Box or Boat engine.
//
// The box's Codex cannot be asked for a tier yet. Standard runs there as
// it always has; Fast is refused before anything reaches the box, and a
// backup that can run Fast may take the message instead.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test, type TestContext } from "node:test";
import { codexCommands, waitFor } from "./helpers/codex-commands.ts";
import { CodexSpeedUnavailable, resolveCodexSpeed } from "../server/codex-speed.ts";

const isolatedHome = mkdtempSync(join(tmpdir(), "bloks-box-speed-unit-"));
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
after(() => rmSync(isolatedHome, { recursive: true, force: true }));

const loopback = `--import=${new URL("./helpers/boat-fetch.mjs", import.meta.url).href}`;

/** A Boat on loopback that answers every prompt at once. */
async function fakeBoat(t: TestContext) {
  const requests: Array<{ method: string; path: string; body: any }> = [];
  const boxes: any[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ method: req.method!, path: req.url!, body: JSON.parse(raw || "{}") });
      const path = new URL(req.url!, "http://localhost").pathname;
      let data: unknown = {};
      if (path.endsWith("/sandboxes")) data = { sandboxes: boxes };
      else if (path.endsWith("/prompt")) data = { promptId: "synthetic-prompt" };
      else if (path.endsWith("/events")) data = { events: [] };
      else if (path.includes("/prompts/")) data = { promptRun: { status: "finished" }, result: "BOX ANSWER" };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(data));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  // the name Bloks gives an agent's box, so it is found rather than made
  const addBoxFor = (botId: string) =>
    boxes.push({
      id: "box-" + botId,
      name: `bloks-${botId.slice(0, 8)}-${createHash("sha256").update(botId).digest("hex").slice(0, 6)}`,
      state: "ready",
    });
  const prompts = () => requests.filter((r) => r.method === "POST" && r.path.endsWith("/prompt"));
  return { url, addBoxFor, prompts };
}

async function boxDriver(t: TestContext) {
  const boat = await fakeBoat(t);
  const original = fetch;
  t.mock.method(globalThis, "fetch", (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "boat.dev");
    return original(new URL(url.pathname + url.search, boat.url), init);
  });
  const { BoxAgentDriver } = await import("../server/drivers/boxagent.ts");
  const instance = await BoxAgentDriver.create({
    instanceId: "computer",
    displayName: "Box",
    enabled: true,
    environment: { BOX_TOKEN: "DUMMY" },
    config: { pollMs: 1 },
  });
  t.after(() => instance.dispose());
  const events: any[] = [];
  instance.adapter.onEvent((event) => events.push(event));
  const send = (model: string, speed: "standard" | "fast") =>
    instance.adapter.sendTurn({
      threadId: "fixture",
      text: "LOCAL",
      model,
      codexSpeed: resolveCodexSpeed({ codex: { speed } }),
      integrations: { computer: { boxId: "synthetic", token: "DUMMY" } },
    });
  return { boat, events, send };
}

test("Standard Codex on a box is prompted as it always was", async (t) => {
  const { boat, events, send } = await boxDriver(t);
  await send("gpt-6", "standard");
  await waitFor(() => events.some((e) => e.type === "turn.completed"));
  assert.equal(boat.prompts().length, 1);
});

test("Fast Codex on a box is refused before any prompt; Claude on the same box is not", async (t) => {
  const { boat, events, send } = await boxDriver(t);
  await assert.rejects(send("gpt-6", "fast"), CodexSpeedUnavailable);
  assert.equal(boat.prompts().length, 0);

  await send("sonnet", "fast");
  await waitFor(() => events.some((e) => e.type === "turn.completed"));
  assert.equal(boat.prompts().length, 1);
  assert.equal(boat.prompts()[0].body.provider, "claude-code");
});

async function boxAgent(t: TestContext, extraEnv: Record<string, string> = {}) {
  const boat = await fakeBoat(t);
  const s = await codexCommands(t, { NODE_OPTIONS: loopback, BLOKS_TEST_BOAT_URL: boat.url, ...extraEnv });
  await s.h.json("/api/config", { method: "PATCH", body: JSON.stringify({ box: { token: "DUMMY" } }) });
  boat.addBoxFor(s.bot.id);
  return { boat, s };
}

const patchBot = (s: Awaited<ReturnType<typeof codexCommands>>, body: unknown) =>
  s.h.json(`/api/bots/${s.bot.id}`, { method: "PATCH", body: JSON.stringify(body) });

test("a Standard agent on Box Codex reaches the box", async (t) => {
  const { boat, s } = await boxAgent(t);
  await patchBot(s, { modelSelection: { instanceId: "computer", model: "gpt-6" }, computer: "cloud" });
  await s.say("Standard on the box");
  await waitFor(() => boat.prompts().length === 1, "the box was never prompted");
  await s.settled();
  assert.doesNotMatch((await s.messages()).map((m) => m.text ?? "").join("\n"), /not sent/);
});

test("a Fast agent on Box Codex hands over once to a Codex backup that can run Fast", async (t) => {
  const { boat, s } = await boxAgent(t);
  s.spec({ tier: "echo" });
  await patchBot(s, {
    modelSelection: { instanceId: "computer", model: "gpt-6" },
    backupSelection: { instanceId: "codex", model: "gpt-6.1-sol" },
    codexSpeed: "fast",
  });

  await s.say("Fast, refused by the box");
  await s.called("turn/start", 1);
  await s.settled();

  assert.equal(boat.prompts().length, 0);
  assert.equal(s.count("turn/start"), 1);
  assert.equal(s.calls().find((c) => c.method === "thread/start").params.serviceTier, "priority");
  const said = (await s.messages()).map((m) => m.text ?? "").join("\n");
  assert.match(said, /picking this up/);
  assert.doesNotMatch(said, /Trying again in a minute/);
  assert.equal(s.stored().modelSelection.instanceId, "computer", "the agent's own engine stays its own");
});

test("a Fast agent on Box Codex with no backup ends unsent, once, in a room too", async (t) => {
  const { boat, s } = await boxAgent(t);
  await patchBot(s, { modelSelection: { instanceId: "computer", model: "gpt-6" }, backupSelection: null, codexSpeed: "fast" });

  await s.say("no backup");
  await waitFor(async () => (await s.messages()).some((m) => /not sent/.test(m.text ?? "")), "the refusal was never said");
  await s.settled();

  const peer = await s.hire("Peer");
  const { blok } = await s.post("/api/bloks", { name: "Fixture room", memberIds: [s.bot.id, peer.id] });
  await s.post(`/api/bloks/${blok.id}/messages`, { text: "@Rex check" });
  const refusals = async () => {
    const { messages } = await s.h.json(`/api/bloks/${blok.id}/messages?limit=100`);
    return messages.filter((m: any) => m.from === s.bot.id && /not sent/.test(m.text ?? ""));
  };
  await waitFor(async () => (await refusals()).length > 0, "the room never heard the refusal");

  assert.equal((await refusals()).length, 1);
  assert.equal(boat.prompts().length, 0);
  assert.equal(s.count("turn/start"), 0);
});

test("a routine on a Fast Box Codex agent with no backup fails with the reason", async (t) => {
  const { boat, s } = await boxAgent(t);
  await patchBot(s, { modelSelection: { instanceId: "computer", model: "gpt-6" }, backupSelection: null, codexSpeed: "fast" });

  const { routine } = await s.post("/api/routines", { targetId: s.bot.id, targetKind: "agent", prompt: "a routine", time: "23:59", days: [] });
  await s.post(`/api/routines/${routine.id}/run`);
  await waitFor(async () => {
    const current = (await s.h.json("/api/routines")).routines.find((r: any) => r.id === routine.id);
    return current?.runs?.some((run: any) => run.state === "failed" && /not sent/.test(run.error ?? ""));
  }, "the routine's run did not keep the reason");
  assert.equal(boat.prompts().length, 0);
});

test("a Telegram message to a Fast Box Codex agent with no backup is answered with the reason", async (t) => {
  const updates: any[] = [];
  const sent: any[] = [];
  const telegram = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      const reply = (result: unknown) => res.end(JSON.stringify({ ok: true, result }));
      if (req.url?.endsWith("getMe")) return reply({ id: 12345, is_bot: true, username: "FixtureBot" });
      if (req.url?.endsWith("getUpdates")) return void setTimeout(() => reply(updates.filter((u) => u.update_id >= body.offset)), 30);
      if (req.url?.endsWith("sendMessage")) {
        sent.push(body);
        return reply({ message_id: sent.length });
      }
      reply(true);
    });
  });
  await new Promise<void>((resolve) => telegram.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    telegram.closeAllConnections();
    telegram.close();
  });
  const { boat, s } = await boxAgent(t, { BLOKS_TEST_TELEGRAM_URL: `http://127.0.0.1:${(telegram.address() as any).port}` });
  await patchBot(s, { modelSelection: { instanceId: "computer", model: "gpt-6" }, backupSelection: null, codexSpeed: "fast" });

  let next = 1;
  const fromOwner = (text: string) =>
    updates.push({
      update_id: next++,
      message: { message_id: next, chat: { id: 10101, type: "private" }, from: { id: 10101, is_bot: false, first_name: "Synthetic owner" }, text },
    });
  const pairing = await s.post("/api/telegram", { token: "12345:TEST_ONLY", enabled: true, botId: s.bot.id, pair: true });
  fromOwner(pairing.pairing);
  await waitFor(() => sent.some((m) => m.text.startsWith("Paired.")), "Telegram never paired");

  fromOwner("Fast, please");
  await waitFor(() => sent.some((m) => /not sent/.test(m.text)), "Telegram never heard the reason");
  await s.settled();
  assert.equal(sent.filter((m) => /not sent/.test(m.text)).length, 1);
  assert.equal(boat.prompts().length, 0);
});
