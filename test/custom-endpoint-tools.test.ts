// A custom OpenAI-compatible host is chat only until its owner says the
// model behind it can use tools (GitHub 359). Switched on, it runs the
// same tool loop as a catalog engine; a host that will not take the
// tools ends the turn saying so, never quietly answering without them.
// Every model here is a loopback fixture, and every key a made-up one.
// before anything loads server/config.ts, so nothing lands in ~/.bloks
import "./helpers/own-data.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { openAiCompatDriver, refusedTools } from "../server/drivers/openai-compat.ts";
import { CUSTOM_SPEC, PROVIDER_SPECS } from "../server/providers.ts";
import type { RuntimeEvent } from "../server/contracts.ts";
import { startHarness, type Harness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

type Reply = { status?: number; json?: unknown; sse?: string };

/** A model server on loopback that keeps every completion it is asked
 * for and answers each the way the test says. */
async function fixture(t: TestContext, answer: (body: any, round: number) => Reply) {
  const bodies: any[] = [];
  const server = createServer((req, res) => {
    let input = "";
    req.on("data", (c) => (input += c));
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      }
      const body = JSON.parse(input || "{}");
      bodies.push(body);
      const reply = answer(body, bodies.length - 1);
      res.statusCode = reply.status ?? 200;
      res.setHeader("content-type", reply.sse ? "text/event-stream" : "application/json");
      res.end(reply.sse ?? JSON.stringify(reply.json ?? {}));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${(server.address() as any).port}/v1`, bodies };
}

const said = (text: string): Reply => ({ json: { choices: [{ message: { role: "assistant", content: text } }] } });
const streamed = (text: string): Reply => ({
  sse: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
});
const callsMemory = (id: string): Reply => ({
  json: {
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id, type: "function", function: { name: "memory_read", arguments: JSON.stringify({ file: "MEMORY.md" }) } }],
      },
    }],
  },
});

/** A custom host's instance, made the way the registry makes one: the
 * saved config read through the driver's own decode. */
async function host(t: TestContext, url: string, saved: Record<string, unknown> = {}) {
  const driver = openAiCompatDriver(CUSTOM_SPEC);
  const instance = await driver.create({
    instanceId: "custom_fixture",
    displayName: "Fixture Host",
    enabled: true,
    config: driver.decodeConfig({ url, ...saved }),
    environment: { CUSTOM_API_KEY: "local-fixture" },
  });
  t.after(() => instance.dispose());
  const events: RuntimeEvent[] = [];
  instance.adapter.onEvent((event) => events.push(event));
  return { instance, events };
}

const ended = (events: RuntimeEvent[]) => waitFor(() => events.find((e) => e.type === "turn.completed"));

test("a custom host is chat only until its owner switches tools on", async (t) => {
  const f = await fixture(t, () => streamed("Hello"));
  // nothing said, said no, and two ways of half saying yes
  const unsaid = [{}, { tools: false }, { tools: "yes" }, { tools: 1 }];
  for (const saved of unsaid) {
    const { instance, events } = await host(t, f.url, saved);
    assert.equal(instance.adapter.capabilities.toolLoop, false, JSON.stringify(saved));
    assert.equal(instance.adapter.capabilities.replyToSender, false, JSON.stringify(saved));
    await instance.adapter.sendTurn({ threadId: "lane", text: "Hi", model: "fixture-model" });
    assert.equal((await ended(events))?.ok, true, JSON.stringify(saved));
  }
  assert.equal(f.bodies.length, unsaid.length);
  for (const body of f.bodies) {
    assert.equal(body.stream, true);
    assert.equal(body.tools, undefined, "a chat-only host was sent tool schemas");
  }
});

test("the switch is read only where the spec leaves tools to the owner", () => {
  assert.equal(openAiCompatDriver(CUSTOM_SPEC).decodeConfig({ url: "http://127.0.0.1:9/v1", tools: true }).tools, true);
  // Ollama's tools depend on the model too, but it has no switch: a stray
  // flag in a hand-edited config does not turn its loop on
  const ollama = PROVIDER_SPECS.find((spec) => spec.kind === "ollama")!;
  assert.equal(openAiCompatDriver(ollama).decodeConfig({ tools: true }).tools, undefined);
});

test("switched on, the host is sent the tool schemas and a tool call goes round", async (t) => {
  const f = await fixture(t, (_body, round) => (round === 0 ? callsMemory("call-1") : said("Your favourite colour is blue.")));
  const { instance, events } = await host(t, f.url, { tools: true });
  assert.equal(instance.adapter.capabilities.toolLoop, true);
  assert.equal(instance.adapter.capabilities.replyToSender, true);

  await instance.adapter.sendTurn({ threadId: "lane", text: "What is my favourite colour?", model: "fixture-model" });
  // memory_read is answered by the workspace, which here is the test
  const asked = await waitFor(() => events.find((e) => e.type === "request.opened" && e.tool === "memory_read"));
  assert.ok(asked?.requestId, "the tool call never reached the workspace");
  await instance.adapter.respondToRequest("lane", asked.requestId, { behavior: "answer", message: "Favourite colour: blue" });

  const done = await ended(events);
  assert.equal(done?.ok, true, JSON.stringify(events.find((e) => e.type === "runtime.error")));
  assert.equal(f.bodies.length, 2);
  for (const body of f.bodies) {
    assert.equal(body.stream, false, "the tool loop does not stream");
    const names = (body.tools ?? []).map((tool: any) => tool.function?.name);
    for (const name of ["ask_user", "memory_read", "memory_write", "request_secret"]) assert.ok(names.includes(name), name);
  }
  const second = f.bodies[1].messages;
  assert.equal(second.find((m: any) => m.role === "assistant" && m.tool_calls)?.tool_calls[0].id, "call-1");
  const result = second.find((m: any) => m.role === "tool");
  assert.deepEqual([result?.tool_call_id, result?.content], ["call-1", "Favourite colour: blue"]);
  assert.equal(events.find((e) => e.type === "item.completed" && e.itemType === "tool")?.ok, true);
  const text = events.find((e) => e.type === "item.completed" && e.itemType === "assistant_text");
  assert.equal(text && "text" in text ? text.text : null, "Your favourite colour is blue.");
});

test("a host that refuses the tools ends the turn and says how to switch them off", async (t) => {
  const refusals: Reply[] = [
    // vLLM started without a tool parser
    {
      status: 400,
      json: { object: "error", message: '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', type: "BadRequestError" },
    },
    // Ollama with a model that has no tool template
    { status: 400, json: { error: "registry.ollama.ai/library/gemma:2b does not support tools" } },
    // a strict proxy that does not know the field
    { status: 422, json: { detail: [{ loc: ["body", "tools"], msg: "extra fields not permitted" }] } },
    // a gateway that refuses with a 200 and an error where the choices go
    { json: { error: { message: "function calling is not enabled for this model" } } },
  ];
  for (const refusal of refusals) {
    const f = await fixture(t, () => refusal);
    const { instance, events } = await host(t, f.url, { tools: true });
    await instance.adapter.sendTurn({ threadId: "lane", text: "Look something up", model: "fixture-model" });
    const done = await ended(events);
    const shown = JSON.stringify(refusal);
    assert.equal(done?.ok, false, shown);
    assert.equal(done && "stopReason" in done ? done.stopReason : null, "error", shown);
    const error = events.find((e) => e.type === "runtime.error");
    const message = error && "message" in error ? String(error.message) : "";
    assert.match(message, /^Fixture Host refused the tools Bloks sent/, shown);
    assert.match(message, /turn off "This model can use tools"/, shown);
    assert.equal(f.bodies.length, 1, `the turn was asked again without its tools: ${shown}`);
    assert.ok(Array.isArray(f.bodies[0].tools), shown);
    assert.ok(!events.some((e) => e.type === "item.completed" && e.itemType === "assistant_text"), shown);
  }
});

test("only a refusal that names the tools is read as one", () => {
  assert.equal(refusedTools(400, "llama3 does not support tools"), true);
  assert.equal(refusedTools(422, '{"detail":[{"loc":["body","tool_choice"]}]}'), true);
  assert.equal(refusedTools(400, "Function calling is not enabled"), true);
  // a key, a balance, a rate limit and a fault each keep their own words
  for (const status of [401, 402, 403, 408, 429, 500, 503]) assert.equal(refusedTools(status, "tools"), false, String(status));
  assert.equal(refusedTools(400, "model fixture-model not found"), false);
  assert.equal(refusedTools(200, "tools"), false);
});

test("a catalog engine's refusal keeps its plain words", async (t) => {
  const f = await fixture(t, () => ({ status: 400, json: { error: "tools are not supported" } }));
  const grok = PROVIDER_SPECS.find((spec) => spec.kind === "grok")!;
  const driver = openAiCompatDriver(grok);
  const instance = await driver.create({
    instanceId: "grok",
    displayName: "Grok",
    enabled: true,
    config: driver.decodeConfig({ url: f.url, apiKeyEnv: "FIXTURE_KEY" }),
    environment: { FIXTURE_KEY: "local-fixture" },
  });
  t.after(() => instance.dispose());
  const events: RuntimeEvent[] = [];
  instance.adapter.onEvent((event) => events.push(event));
  await instance.adapter.sendTurn({ threadId: "lane", text: "Hi", model: "grok-4" });
  await ended(events);
  const error = events.find((e) => e.type === "runtime.error");
  // there is no switch to point at for an engine that always has tools
  assert.match(error && "message" in error ? String(error.message) : "", /^Grok HTTP 400/);
});

// ── through the real harness ──────────────────────────────────────────

/** Sends one message to the agent and waits for it to finish. `reached`
 * says the turn got to the model, so an idle read from before the turn
 * started is not taken for its end. */
async function say(h: Harness, botId: string, text: string, reached: () => boolean) {
  const sent = await h.fetch(`/api/bots/${botId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
  assert.ok(sent.ok, await sent.text());
  assert.ok(await waitFor(reached, 30_000), `the turn never reached the model: ${h.logs()}`);
  assert.ok(await waitFor(async () => (await h.json("/api/bots")).bots.find((b: any) => b.id === botId && !b.busy), 30_000), h.logs());
}

test("the switch round-trips through the endpoint API and disk, and decides what a turn is sent", async (t) => {
  // An agent's turn carries the system prompt; a title or a summary does not.
  const isTurn = (body: any) => body.messages?.[0]?.role === "system";
  const f = await fixture(t, (body) => {
    if (body.stream) return streamed("Chatting along.");
    if (!body.tools) return said("A title");
    const round = body.messages.filter((m: any) => m.role === "tool").length;
    return round === 0 ? callsMemory("call-h") : said("Looked it up.");
  });
  const home = mkdtempSync(join(tmpdir(), "bloks-custom-tools-"));
  const config = () => JSON.parse(readFileSync(join(home, ".bloks", "config.json"), "utf8"));
  let h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });

  const refused = await h.fetch("/api/custom-endpoints", {
    method: "POST",
    body: JSON.stringify({ name: "Nope", url: f.url, key: "sk-fixture-nope", tools: "yes" }),
  });
  assert.equal(refused.status, 400, "a half-said yes is not a setting");

  const { endpoints } = await h.json("/api/custom-endpoints", {
    method: "POST",
    body: JSON.stringify({ name: "Fixture Host", url: f.url, key: "sk-fixture-tools" }),
  });
  const endpoint = endpoints.find((e: any) => e.name === "Fixture Host");
  assert.equal(endpoint.tools, false, "a new host starts chat only");
  assert.ok(!("tools" in config().custom[0]), "chat only is the field left out, not a stored false");

  assert.equal((await h.fetch(`/api/custom-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ tools: "on" }) })).status, 400);
  assert.equal((await h.fetch(`/api/custom-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({}) })).status, 400);
  assert.equal((await h.fetch("/api/custom-endpoints/nosuchhost", { method: "PATCH", body: JSON.stringify({ tools: true }) })).status, 404);

  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Toolsy" }) });
  const picked = await h.fetch(`/api/bots/${bot.id}`, {
    method: "PATCH",
    body: JSON.stringify({ modelSelection: { instanceId: endpoint.instanceId, model: "fixture-model" } }),
  });
  assert.equal(picked.status, 200);

  // off: the turn streams, with no tools, and memory lives in files
  await say(h, bot.id, "First, chat only", () => f.bodies.some(isTurn));
  const chat = f.bodies.filter(isTurn);
  assert.equal(chat.length, 1, h.logs());
  assert.equal(chat[0].stream, true);
  assert.equal(chat[0].tools, undefined);
  assert.doesNotMatch(chat[0].messages[0].content, /memory_read and memory_write tools/);

  const on = await h.json(`/api/custom-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ tools: true }) });
  assert.equal(on.endpoints.find((e: any) => e.id === endpoint.id).tools, true);
  assert.equal(config().custom[0].tools, true);
  assert.ok(!JSON.stringify(on).includes("sk-fixture-tools"), "the key came back out");

  // on: the same agent's next turn is sent the tools and runs a round
  f.bodies.length = 0;
  await say(h, bot.id, "Now look in your memory", () => f.bodies.filter(isTurn).length >= 2);
  const rounds = f.bodies.filter(isTurn);
  assert.equal(rounds.length, 2, h.logs());
  for (const body of rounds) {
    assert.equal(body.stream, false);
    assert.ok(body.tools.some((tool: any) => tool.function.name === "memory_read"));
  }
  assert.match(rounds[0].messages[0].content, /memory_read and memory_write tools/, "the prompt should name the memory tools");
  const answered = rounds[1].messages.find((m: any) => m.role === "tool");
  assert.equal(answered?.tool_call_id, "call-h");
  assert.ok(typeof answered?.content === "string" && answered.content.length > 0, "the workspace never answered memory_read");

  // a restart reads it back from disk
  await h.stop();
  h = await startHarness({ HOME: home });
  const reread = await h.json("/api/custom-endpoints");
  assert.equal(reread.endpoints.find((e: any) => e.id === endpoint.id).tools, true);

  const off = await h.json(`/api/custom-endpoints/${endpoint.id}`, { method: "PATCH", body: JSON.stringify({ tools: false }) });
  assert.equal(off.endpoints.find((e: any) => e.id === endpoint.id).tools, false);
  assert.ok(!("tools" in config().custom[0]), "switched back off reads the same as never switched");
  assert.equal((await h.json("/api/custom-endpoints")).endpoints.find((e: any) => e.id === endpoint.id).tools, false);
});
