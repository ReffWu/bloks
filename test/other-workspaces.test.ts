// A phone paired with one workspace on this computer learns the person's
// other workspaces here and pairs with one in a tap (server/other-workspaces.ts,
// electron/server-line.mjs). What matters most is who may ask: the
// owner's own paired devices, and nobody else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseRegistry } from "../electron/workspaces.mjs";
import { ServerAsks, othersFor, pairRefusal } from "../electron/server-line.mjs";
import { MintLimiter, mintPairing, othersRoute, pairCheck, type OthersDeps } from "../server/other-workspaces.ts";
import { startHarness } from "./helpers/server.ts";
import { controlledChain } from "./helpers/agent-chain.ts";

const registry = parseRegistry(
  JSON.stringify({
    workspaces: [
      { id: "personal", kind: "personal", name: "Personal", dataDir: "/home/a/.bloks", order: 0 },
      { id: "ws_music", kind: "custom", name: "Music Studio", dataDir: "/apps/ws/ws_music", order: 1, mark: { color: "#8E4FC9", pattern: "100110111" } },
      { id: "ws_join", kind: "joined", name: "Sam's Studio", order: 2, host: { name: "Sam", relayUrl: "https://relay.test" } },
      { id: "ws_hosted", kind: "hosted", name: "Hosted", order: 3, host: { name: "", relayUrl: "https://relay.test" } },
      { id: "ws_biz", kind: "business", name: "Okafor Studio", dataDir: "/apps/ws/ws_biz", order: 4, team: true },
    ],
  }),
);

test("the phone hears of the person's own workspaces here, in the list's order, and never one they joined or a hosted one", () => {
  const list = othersFor(registry, "personal", { ws_music: { pairable: true, why: null }, ws_biz: { pairable: false, why: "Phone access is off." } });
  assert.deepEqual(list.map((w) => w.id), ["personal", "ws_music", "ws_biz"]);
  assert.deepEqual(list.map((w) => w.here), [true, false, false]);
  assert.deepEqual(list.map((w) => w.pairable), [false, true, false]);
  assert.equal(list[2]!.why, "Phone access is off.");
  assert.equal(list[2]!.team, true);
  assert.deepEqual(list[1]!.mark, { color: "#8E4FC9", pattern: "100110111" });
  // a server that did not say is not said for
  assert.equal(othersFor(registry, "personal")[1]!.pairable, null);
});

test("a pairing is only for another of the person's own workspaces, asked from one of them", () => {
  assert.equal(pairRefusal(registry, "personal", "ws_music"), null);
  assert.equal(pairRefusal(registry, "personal", "personal")?.status, 409);
  assert.equal(pairRefusal(registry, "personal", "ws_join")?.status, 404, "never somebody else's");
  assert.equal(pairRefusal(registry, "personal", "ws_hosted")?.status, 404);
  assert.equal(pairRefusal(registry, "personal", "nope")?.status, 404);
  assert.equal(pairRefusal(registry, "ws_join", "personal")?.status, 403, "a joined workspace speaks for nobody here");
});

test("the app's questions to a server: answered by id, and a silent server is a timeout", async () => {
  const sent: any[] = [];
  const asks = new ServerAsks();
  const child = { postMessage: (m: unknown) => sent.push(m) };
  const asking = asks.ask(child, "pair.mint", {}, 1000);
  assert.equal(sent[0].kind, "ask");
  assert.equal(sent[0].what, "pair.mint");
  assert.equal(asks.heard({ kind: "desktop.answer", ask: "nobody" }), false);
  assert.equal(asks.heard({ kind: "desktop.answer", ask: sent[0].ask, ok: true, via: "relay", link: "https://bloks.dev/pair#x" }), true);
  assert.deepEqual(await asking, { ok: true, via: "relay", link: "https://bloks.dev/pair#x" });
  assert.equal((await asks.ask(child, "pair.check", {}, 5)).status, 504);
  assert.equal((await asks.ask(null, "pair.check")).status, 503);
});

test("a pairing goes through Bloks Cloud when it can, on the network when it cannot, and not at all with phone access off", () => {
  const relay = { link: "https://bloks.dev/pair#abc", webLink: "https://bloks.dev/web/#abc", expiresAt: 5, host: "Mac" };
  const ttls: number[] = [];
  const viaRelay = mintPairing({ relayLink: (ttl) => (ttls.push(ttl), relay), lan: () => null, lanToken: () => ({ token: "t", expiresAt: 1 }) });
  assert.deepEqual(viaRelay, { ok: true, via: "relay", link: relay.link, expiresAt: 5, host: "Mac" });
  assert.ok(ttls[0]! <= 5 * 60_000, "short lived");
  const viaLan = mintPairing({ relayLink: () => null, lan: () => ({ addresses: ["192.168.1.20"], port: 8812, name: "Mac" }), lanToken: () => ({ token: "bloks_pair_x", expiresAt: 9 }) });
  assert.deepEqual(viaLan, { ok: true, via: "lan", lan: { addresses: ["192.168.1.20"], port: 8812, token: "bloks_pair_x" }, expiresAt: 9, host: "Mac" });
  const none = mintPairing({ relayLink: () => null, lan: () => null, lanToken: () => ({ token: "t", expiresAt: 1 }) });
  assert.equal(none.ok, false);
  assert.equal(none.status, 409);
  assert.equal(pairCheck(false, false).pairable, false);
  assert.equal(pairCheck(true, false).pairable, true);
});

test("only the owner's paired device asks, a handful at a time", async () => {
  const app: OthersDeps["askApp"] = async (what, payload) =>
    what === "workspaces"
      ? { ok: true, workspaces: othersFor(registry, "personal", {}) }
      : { ok: true, via: "relay", link: `https://bloks.dev/pair#${String(payload.target)}`, expiresAt: 1, workspace: { id: payload.target } };
  const body = async () => ({ device: "Hamed's iPhone" });
  const base = { asAgent: false, askApp: app, limiter: new MintLimiter() };
  const phone = { id: "dev1", name: "iPhone" };
  // the window here, an agent, and a member's phone are all turned away
  assert.equal((await othersRoute("GET", "/api/workspaces/others", body, { ...base, caller: null }))?.status, 403);
  assert.equal((await othersRoute("GET", "/api/workspaces/others", body, { ...base, caller: phone, asAgent: true }))?.status, 403);
  assert.equal((await othersRoute("GET", "/api/workspaces/others", body, { ...base, caller: { ...phone, personId: "p1" } }))?.status, 403);
  const listed = await othersRoute("GET", "/api/workspaces/others", body, { ...base, caller: phone });
  assert.equal(listed?.status, 200);
  assert.deepEqual((listed!.body as any).workspaces.map((w: any) => w.name), ["Personal", "Music Studio", "Okafor Studio"]);
  for (let i = 0; i < 5; i++) {
    const made = await othersRoute("POST", "/api/workspaces/others/ws_music/pair", body, { ...base, caller: phone });
    assert.equal(made?.status, 200);
    assert.equal((made!.body as any).link, "https://bloks.dev/pair#ws_music");
  }
  const sixth = await othersRoute("POST", "/api/workspaces/others/ws_music/pair", body, { ...base, caller: phone });
  assert.equal(sixth?.status, 429, "a lost phone cannot mint them in a loop");
  assert.equal(await othersRoute("GET", "/api/workspace/members", body, { ...base, caller: phone }), null);
});

test("through the real server: a stranger, a website and this window are refused, and a phone hears there is no app", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  assert.equal((await h.fetch("/api/workspaces/others")).status, 403, "loopback carries no credential, so it is not the owner's phone");
  assert.equal((await h.fetchAs("https://evil.example", "/api/workspaces/others")).status, 403);
  await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const stranger = await h.fetchRemote("/api/workspaces/others");
  assert.ok(stranger.status === 401 || stranger.status === 403, `a stranger was answered ${stranger.status}`);
  const started = await h.json("/api/pair/start", { method: "POST" });
  const paired = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Test iPhone" }) });
  const token = paired.body?.token;
  assert.ok(token, "the fixture phone did not pair");
  const fromPhone = await h.fetchRemote("/api/workspaces/others", { token });
  assert.equal(fromPhone.status, 404, "a server with no app behind it has no others");
  const pair = await h.fetchRemote("/api/workspaces/others/ws_x/pair", { method: "POST", token, body: "{}" });
  assert.equal(pair.status, 404);
});

test("an agent never lists the other workspaces or asks for a pairing", async (t) => {
  const f = await controlledChain(t);
  const bot = await f.hire("Penny");
  const turn = await f.begin(bot);
  assert.equal((await f.agent(turn, "/api/workspaces/others", undefined, "GET")).status, 403);
  assert.equal((await f.agent(turn, "/api/workspaces/others/personal/pair", {})).status, 403);
  await f.finish(turn, bot);
});

test("the app makes the pairing on the other workspace's own server, and tells the Mac each time", () => {
  const main = readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  assert.match(main, /else if \(said\.what === "workspaces"\) reply = await othersForPhone\(id\);/);
  assert.match(main, /else if \(said\.what === "pair"\) reply = await pairForPhone\(id, said\.target, said\.device\);/);
  const pairing = main.slice(main.indexOf("async function pairForPhone("), main.indexOf("function tellPairingMade("));
  assert.match(pairing, /pairRefusal\(registry, id, String\(target\)\)/);
  assert.match(pairing, /serverAsks\.ask\(servers\.get\(ws\.id\)\?\.child, "pair\.mint"/);
  assert.match(pairing, /tellPairingMade\(/);
});
