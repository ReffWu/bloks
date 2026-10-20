// Claude Code on Bloks AI: the CLI is started pointed at the service with
// the token as its bearer, an empty API key, the alias for every model and
// the turn's tags as custom headers; the token is never written to a log,
// what the CLI says it ran on and what it cost never get past it, a
// used-up allowance is said plainly, and a token the service refused is
// renewed before the turn is asked again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { turnEnvironment } from "../server/drivers/claude.ts";
import { startHarness, type Harness } from "./helpers/server.ts";
import { messagesOf, waitFor } from "./helpers/turns.ts";
import { startFakeCredits } from "./helpers/fake-credits.ts";

const LICENCE = `blok_live_${"e".repeat(32)}`;

test("on credits the CLI gets the service's base, the token and an empty key", () => {
  const env = turnEnvironment(
    { PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-person", CLAUDECODE: "1" },
    { credits: { baseUrl: "https://credits.example/api/ai", token: "cred_123" } },
  );
  assert.equal(env.ANTHROPIC_BASE_URL, "https://credits.example/api/ai");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "cred_123");
  assert.equal(env.ANTHROPIC_API_KEY, "", "empty, so a key in the server's environment can never be what it spends");
  assert.equal(env.ANTHROPIC_MODEL, "bloks-ai");
  assert.equal(env.CLAUDECODE, undefined);
});

test("off credits nothing changes: the key is dropped and no base is set", () => {
  const env = turnEnvironment({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-person" }, { env: { BLOKS_TOKEN: "t" } });
  assert.equal("ANTHROPIC_API_KEY" in env, false);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.BLOKS_TOKEN, "t");
});

/** A Claude Code that writes down how it was started, asks the credits
 * service whether its token is good the way the real one would find out,
 * and answers, or fails the way the CLI fails on a 401 or a 402. */
const FAKE = `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (args[0] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
const out = (frame) => console.log(JSON.stringify(frame));
let line = "";
let started = false;
process.stdin.on("data", (c) => {
  line += c;
  let at;
  while ((at = line.indexOf(String.fromCharCode(10))) !== -1) {
    const next = line.slice(0, at);
    line = line.slice(at + 1);
    if (!started && next.trim() && JSON.parse(next).type === "user") {
      started = true;
      void answer();
    }
  }
});
async function answer() {
  const env = process.env;
  appendFileSync("__HOME__/env.jsonl", JSON.stringify({
    base: env.ANTHROPIC_BASE_URL ?? null,
    token: env.ANTHROPIC_AUTH_TOKEN ?? null,
    key: "ANTHROPIC_API_KEY" in env ? env.ANTHROPIC_API_KEY : null,
  }) + String.fromCharCode(10));
  appendFileSync("__HOME__/more.jsonl", JSON.stringify({
    model: args[args.indexOf("--model") + 1] ?? null,
    envModel: env.ANTHROPIC_MODEL ?? null,
    small: env.ANTHROPIC_SMALL_FAST_MODEL ?? null,
    headers: env.ANTHROPIC_CUSTOM_HEADERS ?? null,
  }) + String.fromCharCode(10));
  // what a real upstream would say it ran on, and what it cost
  out({ type: "system", subtype: "init", session_id: "sess-credits", model: "upstream-sekrit-9" });
  const res = await fetch(env.ANTHROPIC_BASE_URL + "/balance", { headers: { authorization: "Bearer " + env.ANTHROPIC_AUTH_TOKEN } });
  const body = await res.json();
  const fail = (text) => {
    out({ type: "assistant", error: "api_error", message: { model: "<synthetic>", content: [{ type: "text", text }] } });
    out({ type: "result", subtype: "success", is_error: true, num_turns: 1, session_id: "sess-credits", result: text });
  };
  if (res.status === 401) return fail("API Error: 401 " + JSON.stringify(body));
  if (body.leftPercent <= 0) return fail('API Error: 402 {"type":"error","error":{"type":"billing_error","message":"Bloks AI is used up for this month. Top up to carry on."}}');
  out({ type: "assistant", message: { model: "upstream-sekrit-9", content: [{ type: "text", text: "Answered on credits." }] } });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 10, total_cost_usd: 0.4321, modelUsage: { "upstream-sekrit-9": { inputTokens: 5, costUSD: 0.4321, contextWindow: 200000 } }, session_id: "sess-credits", result: "Answered on credits." });
}
`;

function workspace(config: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "bloks-credits-claude-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({ instances: { claude: { driver: "claudeAgent", config: { cli: join(home, "fake-claude.mjs") } } }, ...config }),
  );
  writeFileSync(join(home, "fake-claude.mjs"), FAKE.replaceAll("__HOME__", home), { mode: 0o755 });
  return home;
}

const starts = (home: string) => {
  try {
    return readFileSync(join(home, "env.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

/** Every file under a folder, as text, for looking for a leak. */
function everything(dir: string): string {
  let all = "";
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) all += everything(path);
    else if (st.size < 5_000_000) all += readFileSync(path, "utf8");
  }
  return all;
}

async function claudeOnCredits(h: Harness) {
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Clio" }) });
  await h.fetch(`/api/bots/${bot.id}`, {
    method: "PATCH",
    body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, engineAccess: "credits" }),
  });
  return bot as { id: string; threadId: string };
}

test("a Claude Code agent on credits runs against the service, and its token is in no log", async (t) => {
  const fake = await startFakeCredits();
  const token = ((await (await fetch(`${fake.base}/token`, { method: "POST", headers: { authorization: `Bearer ${LICENCE}` } })).json()) as { token: string }).token;
  const home = workspace({});
  const h = await startHarness({ HOME: home, BLOKS_CREDITS_URL: fake.base, BLOKS_CREDITS_TOKEN: token });
  t.after(async () => {
    await h.stop();
    await fake.close();
    rmSync(home, { recursive: true, force: true });
  });
  const bot = await claudeOnCredits(h);
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
  const answered = await waitFor(async () => (await messagesOf(h, bot)).find((m) => m.role === "bot" && m.text === "Answered on credits."), 20_000);
  assert.ok(answered);
  assert.deepEqual(starts(home)[0], { base: fake.base, token, key: "" });
  const more = JSON.parse(readFileSync(join(home, "more.jsonl"), "utf8").trim().split("\n")[0]);
  assert.deepEqual(more, { model: "bloks-ai", envModel: "bloks-ai", small: "bloks-ai", headers: "x-bloks-work: coding" }, "the alias for every model, and the work it is");

  // what the CLI said it ran on, and what it cost, got no further than it
  await waitFor(async () => !(await h.json("/api/bots")).bots.find((b: any) => b.id === bot.id)?.busy);
  for (const view of [
    JSON.stringify(await h.json("/api/usage?days=7")),
    JSON.stringify(await h.json("/api/engines/report")),
    JSON.stringify(await h.json("/api/activity")),
    JSON.stringify(await messagesOf(h, bot)),
  ]) {
    assert.ok(!view.includes("upstream-sekrit-9"), "no model of the service's");
    assert.ok(!view.includes("0.4321"), "no cost");
  }
  assert.ok(!everything(join(home, ".bloks")).includes("upstream-sekrit-9"), "not in any log or record on disk");
  assert.ok(!everything(join(home, ".bloks")).includes("0.4321"));

  // where a leak would land: the server's output, every file it wrote,
  // and the diagnostics a person might paste into an issue
  const diagnostics = await (await h.fetch("/api/diagnostics")).text();
  assert.ok(!h.logs().includes(token), "not in the server's output");
  assert.ok(!everything(join(home, ".bloks")).includes(token), "not in anything under the data folder");
  assert.ok(!diagnostics.includes(token), "not in diagnostics");

  // an agent on its own sign-in is started as before
  await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ engineAccess: "own" }) });
  await waitFor(async () => !(await h.json("/api/bots")).bots.find((b: any) => b.id === bot.id)?.busy);
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "again" }) });
  const second = await waitFor(() => starts(home)[1], 20_000);
  // whatever this machine's own environment says, never the credits
  assert.notEqual(second?.base, fake.base);
  assert.notEqual(second?.token, token);
  assert.equal(second?.key, null, "the key is dropped, as it always was");
});

test("an empty balance on Claude Code is said plainly and stands for the composer", async (t) => {
  const fake = await startFakeCredits({ leftPercent: 0 });
  const token = ((await (await fetch(`${fake.base}/token`, { method: "POST", headers: { authorization: `Bearer ${LICENCE}` } })).json()) as { token: string }).token;
  const home = workspace({});
  const h = await startHarness({ HOME: home, BLOKS_CREDITS_URL: fake.base, BLOKS_CREDITS_TOKEN: token });
  t.after(async () => {
    await h.stop();
    await fake.close();
    rmSync(home, { recursive: true, force: true });
  });
  const bot = await claudeOnCredits(h);
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
  const notice = await waitFor(async () =>
    (await messagesOf(h, bot)).find((m) => m.kind === "notice" && (m.text ?? "").startsWith("Bloks AI is used up for this month. Top up to carry on.")),
    20_000,
  );
  assert.ok(notice, "the service's words, without the CLI's wrapping");
  assert.ok(!/API Error/.test(notice.text));
  const status = await h.json("/api/credits");
  assert.equal(status.refused?.message, "Bloks AI is used up for this month. Top up to carry on.");
});

test("a token the service refused is renewed, and the turn is asked again with the new one", async (t) => {
  const fake = await startFakeCredits();
  const home = workspace({
    relay: { url: "http://127.0.0.1:9", agentToken: "agent-x", clientToken: "client-x", enabled: true },
    credits: { licence: LICENCE },
  });
  const h = await startHarness({ HOME: home, BLOKS_CREDITS_URL: fake.base });
  t.after(async () => {
    await h.stop();
    await fake.close();
    rmSync(home, { recursive: true, force: true });
  });
  const bot = await claudeOnCredits(h);
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "first" }) });
  assert.ok(await waitFor(async () => (await messagesOf(h, bot)).find((m) => m.text === "Answered on credits."), 20_000));
  fake.revoke(fake.issued[0]);
  await waitFor(async () => !(await h.json("/api/bots")).bots.find((b: any) => b.id === bot.id)?.busy);
  await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "second" }) });
  const renewed = await waitFor(() => starts(home).find((s) => s.token === fake.issued[1]), 30_000);
  assert.ok(renewed, "asked again with the renewed token");
  assert.ok(await waitFor(async () => (await messagesOf(h, bot)).filter((m) => m.text === "Answered on credits.").length >= 2, 20_000));
  assert.deepEqual(fake.traded, [LICENCE, LICENCE]);
  assert.ok(!h.logs().includes(fake.issued[0]) && !h.logs().includes(fake.issued[1]));
});
