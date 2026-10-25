// The workspace's mute and notification level, kept by its server
// (GitHub 391, server/attention.ts): a route the owner reaches from any
// device of theirs and nobody else does, a copy in the data folder that a
// restart finds, a change put to the app beside the server first, and the
// app saying it to a server on another machine only when it changed
// (electron/attention-said.mjs). What the server does with it is in
// test/answer-ready.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attentionBody, attentionRoute, readAttention, type AttentionRouteDeps } from "../server/attention.ts";
import type { Attention } from "../server/answer-ready.ts";
import { JoinClient } from "../server/join-client.ts";
import { attentionWord, createAttentionSayer } from "../electron/attention-said.mjs";
import { startHarness } from "./helpers/server.ts";
import { controlledChain } from "./helpers/agent-chain.ts";
import { teamPlan } from "./helpers/team-plan.ts";

const PATH = "/api/workspace/attention";
const body = (b: unknown) => async () => b as Record<string, unknown>;

test("the route reads a mute and a level strictly", () => {
  assert.deepEqual(attentionBody({ mute: null, notify: "all" }), { mute: null, notify: "all" });
  assert.deepEqual(attentionBody({ notify: "needs-me" }), { mute: null, notify: "needs-me" });
  assert.deepEqual(attentionBody({ mute: "forever", notify: "nothing" }), { mute: "forever", notify: "nothing" });
  assert.deepEqual(attentionBody({ mute: 1_900_000_000_000, notify: "all" }), { mute: 1_900_000_000_000, notify: "all" });
  for (const b of [{}, null, { notify: "loud" }, { mute: "soon", notify: "all" }, { mute: -5, notify: "all" }, { mute: 1.5, notify: "all" }, { mute: Infinity, notify: "all" }]) {
    assert.ok("error" in attentionBody(b), JSON.stringify(b));
  }
});

test("a change is put to the app beside the server first, and one it refuses is not kept", async () => {
  let kept: Attention | null = null;
  const asked: Attention[] = [];
  let answer: Record<string, unknown> = { ok: true, mute: "forever", notify: "all" };
  const deps: AttentionRouteDeps = {
    current: () => kept,
    save: (a) => void (kept = a),
    askApp: async (a) => (asked.push(a), answer),
  };
  assert.deepEqual(await attentionRoute("GET", PATH, body({}), deps), { status: 200, body: { attention: null } });
  // the app's word is the one kept: the list is where the mute lives
  const ok = await attentionRoute("PUT", PATH, body({ mute: "forever", notify: "all" }), deps);
  assert.deepEqual(ok, { status: 200, body: { attention: { mute: "forever", notify: "all" } } });
  assert.deepEqual(asked, [{ mute: "forever", notify: "all" }]);
  answer = { error: "There is no such workspace here.", status: 404 };
  const refused = await attentionRoute("PUT", PATH, body({ mute: null, notify: "nothing" }), deps);
  assert.deepEqual(refused, { status: 404, body: { error: "There is no such workspace here." } });
  assert.deepEqual(kept, { mute: "forever", notify: "all" }, "refused is not kept");
  // with no app, the server decides alone
  const alone = await attentionRoute("PUT", PATH, body({ mute: null, notify: "needs-me" }), { ...deps, askApp: () => null });
  assert.equal(alone?.status, 200);
  assert.deepEqual(kept, { mute: null, notify: "needs-me" });
  assert.equal((await attentionRoute("PUT", PATH, body({ notify: "loud" }), deps))?.status, 400);
  assert.equal((await attentionRoute("POST", PATH, body({}), deps))?.status, 405);
  assert.equal(await attentionRoute("GET", "/api/workspace/other", body({}), deps), null);
});

test("the owner sets it from this computer or a phone of theirs, and a restart keeps it", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-attention-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let h = await startHarness({ HOME: home });
  t.after(() => h.stop());
  assert.deepEqual(await h.json(PATH), { attention: null });
  assert.equal(existsSync(join(home, ".bloks", "attention.json")), false, "never told keeps no file");

  const set = await h.fetch(PATH, { method: "PUT", body: JSON.stringify({ mute: "forever", notify: "needs-me" }) });
  assert.equal(set.status, 200);
  assert.deepEqual(await set.json(), { attention: { mute: "forever", notify: "needs-me" } });
  assert.deepEqual(readAttention(join(home, ".bloks")), { mute: "forever", notify: "needs-me" });
  assert.equal((await h.fetch(PATH, { method: "PUT", body: JSON.stringify({ mute: "later", notify: "all" }) })).status, 400);

  // the owner's phone, paired
  await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const started = await h.json("/api/pair/start", { method: "POST" });
  const paired = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Test iPhone" }) });
  const token = paired.body?.token;
  assert.ok(token, "the fixture phone did not pair");
  const until = Date.now() + 3_600_000;
  const fromPhone = await h.fetchRemote(PATH, { method: "PUT", token, body: JSON.stringify({ mute: until, notify: "all" }) });
  assert.equal(fromPhone.status, 200);
  assert.deepEqual((await h.fetchRemote(PATH, { token })).body, { attention: { mute: until, notify: "all" } });

  // nobody else: a website, or the network without a pairing
  assert.equal((await h.fetchAs("https://evil.example", PATH, { method: "PUT", body: JSON.stringify({ mute: null, notify: "all" }) })).status, 403);
  const stranger = await h.fetchRemote(PATH, { method: "PUT", body: JSON.stringify({ mute: null, notify: "all" }) });
  assert.ok(stranger.status === 401 || stranger.status === 403, `a stranger was answered ${stranger.status}`);

  // stopped and started again on the same folder
  await h.stop();
  h = await startHarness({ HOME: home });
  assert.deepEqual(await h.json(PATH), { attention: { mute: until, notify: "all" } }, "a restart forgot the mute");
});

test("an agent never reads or changes the workspace's mute", async (t) => {
  const f = await controlledChain(t);
  const bot = await f.hire("Penny");
  const turn = await f.begin(bot);
  assert.equal((await f.agent(turn, PATH, { mute: "forever", notify: "nothing" }, "PUT")).status, 403);
  assert.equal((await f.agent(turn, PATH, undefined, "GET")).status, 403);
  assert.deepEqual(await f.h.json(PATH), { attention: null });
  await f.finish(turn, bot);
});

test("a member and an admin never read or change the owner's mute, from their device or on this computer", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-attention-members-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  // members are Bloks Team's (server/plan-limits.ts)
  const team = await teamPlan();
  t.after(() => team.close());
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ remote: { enabled: true }, profile: { name: "Hamed" }, ...team.config }));
  const h = await startHarness({ HOME: home, ...team.env });
  t.after(() => h.stop());
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const lan = new URL(h.url).host;

  async function joinAs(name: string, role: "member" | "admin") {
    const made = await h.json("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role, name }) });
    const client = new JoinClient(() => "http://127.0.0.1:9");
    // the link's own network address, if it has one, gives way to the harness's (GitHub 392)
    const found = (await client.lookup(`${made.invite.link.split("~", 1)[0]}~${lan}`)) as any;
    assert.ok(found.ok, JSON.stringify(found));
    await client.claim(found.session, { name });
    assert.equal((await h.fetch(`/api/workspace/requests/${made.invite.id}/approve`, { method: "POST" })).status, 200);
    return ((await client.status(found.session)) as any).credentials as { deviceToken: string };
  }
  const owners = { mute: "forever", notify: "needs-me" };
  assert.equal((await h.fetch(PATH, { method: "PUT", body: JSON.stringify(owners) })).status, 200);

  for (const [name, role] of [["Sam", "member"], ["Ana", "admin"]] as const) {
    const who = await joinAs(name, role);
    const put = await h.fetchRemote(PATH, { method: "PUT", token: who.deviceToken, body: JSON.stringify({ mute: null, notify: "all" }) });
    assert.equal(put.status, 403, `${role} changed it: ${JSON.stringify(put.body)}`);
    assert.equal((await h.fetchRemote(PATH, { token: who.deviceToken })).status, 403, `${role} read it`);
    // the same credential on this computer is taken at its word, not as the owner at the keyboard
    const here = await h.fetch(PATH, { method: "PUT", headers: { authorization: `Bearer ${who.deviceToken}` }, body: JSON.stringify({ mute: null, notify: "all" }) });
    assert.equal(here.status, 403, `${role} on this computer changed it`);
    assert.equal((await h.fetch(PATH, { headers: { authorization: `Bearer ${who.deviceToken}` } })).status, 403);
  }
  assert.deepEqual(await h.json(PATH), { attention: owners });
});

test("the app says a mute to a server on another machine once per change, and never to one that is not the owner's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bloks-attention-said-"));
  const file = join(dir, "attention-said.json");
  try {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let status: (method: string) => number = () => 200;
    let gate: Promise<void> | null = null;
    const fetcher = async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, ...(typeof init.body === "string" ? { body: init.body } : {}) });
      if (gate) await gate;
      const s = status(method);
      return { ok: s >= 200 && s < 300, status: s };
    };
    const hosted = { kind: "hosted", base: "http://127.0.0.1:41001" };
    let sayer = createAttentionSayer({ file, fetcher });
    assert.deepEqual(attentionWord({}), { mute: null, notify: "all" });

    // your hosted workspace: said once, and the same word not again
    await sayer.say("ws_h", hosted, { mute: null, notify: "all" });
    await sayer.say("ws_h", hosted, { mute: null, notify: "all" });
    assert.deepEqual(calls, [{ url: "http://127.0.0.1:41001/api/workspace/attention", method: "PUT", body: JSON.stringify({ mute: null, notify: "all" }) }]);
    // not after the app starts again either: a hosted machine asleep is not woken for nothing
    sayer = createAttentionSayer({ file, fetcher });
    await sayer.say("ws_h", hosted, { mute: null, notify: "all" });
    assert.equal(calls.length, 1);

    // a change while one is on its way goes after it, and only the last
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const first = sayer.say("ws_h", hosted, { mute: "forever", notify: "all" });
    void sayer.say("ws_h", hosted, { mute: null, notify: "needs-me" });
    void sayer.say("ws_h", hosted, { mute: null, notify: "nothing" });
    gate = null;
    open();
    await first;
    assert.deepEqual(calls.slice(1).map((c) => c.body), [JSON.stringify({ mute: "forever", notify: "all" }), JSON.stringify({ mute: null, notify: "nothing" })]);

    // a new pairing is a new server, told afresh
    sayer.forget("ws_h");
    await sayer.say("ws_h", hosted, { mute: null, notify: "nothing" });
    assert.equal(calls.length, 4);

    // a workspace somebody else owns: asked first, refused, and never sent the mute
    calls.length = 0;
    status = () => 403;
    const joined = { kind: "joined", base: "http://127.0.0.1:41002" };
    await sayer.say("ws_j", joined, { mute: "forever", notify: "all" });
    assert.deepEqual(calls, [{ url: "http://127.0.0.1:41002/api/workspace/attention", method: "GET" }]);
    await createAttentionSayer({ file, fetcher }).say("ws_j", joined, { mute: null, notify: "needs-me" });
    assert.equal(calls.length, 1, "a refusal was asked again");

    // one joined as its owner: asked, then told
    calls.length = 0;
    status = () => 200;
    await sayer.say("ws_o", { kind: "joined", base: "http://127.0.0.1:41003" }, { mute: "forever", notify: "all" });
    assert.deepEqual(calls.map((c) => c.method), ["GET", "PUT"]);

    // a server from before the route is not asked again for the same word this run
    calls.length = 0;
    status = () => 404;
    await sayer.say("ws_old", hosted, { mute: "forever", notify: "all" });
    await sayer.say("ws_old", hosted, { mute: "forever", notify: "all" });
    assert.equal(calls.length, 1);

    // not reachable: nothing is remembered, so the next change of the list tries again
    calls.length = 0;
    const down = createAttentionSayer({ file, fetcher: async () => Promise.reject(new Error("offline")) });
    await down.say("ws_down", hosted, { mute: "forever", notify: "all" });
    assert.equal(JSON.parse(readFileSync(file, "utf8")).ws_down, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the app keeps a mute chosen on a phone in its list, and tells the other machines' servers too", () => {
  const main = readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  assert.match(main, /else if \(said\.what === "attention"\) reply = attentionFromServer\(id, said\);/);
  const hand = main.slice(main.indexOf("function handAttention("), main.indexOf("/** What each workspace on another machine"));
  assert.match(hand, /if \(isRemoteKind\(ws\.kind\)\) \{\s+if \(run\.status === "running" && run\.port\) void attentionThere\(\)\.say\(/);
  assert.match(hand, /run\.child\.postMessage\(\{ kind: "attention"/);
  const fromServer = main.slice(main.indexOf("function attentionFromServer("), main.indexOf("function keepName("));
  // only a workspace this app runs, and handed back as any change is
  assert.match(fromServer, /isRemoteKind\(ws\.kind\)\) throw/);
  assert.match(fromServer, /tellWorkspaces\(\);/);
});
