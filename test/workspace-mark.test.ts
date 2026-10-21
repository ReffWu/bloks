// Choosing a workspace's mark, from the Mac or from the owner's phone
// (electron/workspace-marks.mjs, server/workspace-mark.ts): the same
// colours and shapes on both sides, a route the phone can call that only
// the owner reaches, and a line to the app (server/desktop-line.ts) that
// asks before keeping, since only the app knows what the other
// workspaces on this computer wear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BUSINESS_MARK,
  CHOICE_COLORS,
  CHOICE_PATTERNS,
  CUSTOM_PATTERNS,
  MARK_PALETTE,
  PERSONAL_MARK,
  isChoosableMark,
} from "../electron/workspace-marks.mjs";
import * as server from "../server/workspace-mark.ts";
import { DesktopLine } from "../server/desktop-line.ts";
import { startHarness } from "./helpers/server.ts";
import { controlledChain } from "./helpers/agent-chain.ts";

test("the server offers exactly the picker's colours and shapes, and allows exactly what the app allows", () => {
  assert.deepEqual([...server.CHOICE_COLORS], [...CHOICE_COLORS]);
  assert.deepEqual([...server.CHOICE_PATTERNS], [...CHOICE_PATTERNS]);
  assert.deepEqual({ ...server.PERSONAL_DEFAULT }, { ...PERSONAL_MARK });
  assert.deepEqual({ ...server.BUSINESS_DEFAULT }, { ...BUSINESS_MARK });
  assert.equal(CHOICE_COLORS.length, 12);
  assert.equal(new Set(CHOICE_PATTERNS).size, CHOICE_PATTERNS.length, "no shape offered twice");
  const samples = [
    ...CHOICE_COLORS.flatMap((color) => CHOICE_PATTERNS.map((pattern) => ({ color, pattern }))),
    ...MARK_PALETTE.map((color, i) => ({ color, pattern: CUSTOM_PATTERNS[i * 31]! })),
    { color: "#e9a83a", pattern: "101010101" },
    { color: "#000000", pattern: "010111101" },
    { color: "#149E8E", pattern: "111111111" },
    { color: "#149E8E", pattern: "000000111" },
    { color: "#149E8E", pattern: "01011101x" },
    { color: 12, pattern: "010111101" },
    null,
  ];
  for (const mark of samples) {
    assert.equal(Boolean(server.choosableMark(mark)), isChoosableMark(mark), JSON.stringify(mark));
  }
  // a colour is kept in the picker's own spelling
  assert.deepEqual(server.choosableMark({ color: "#e9a83a", pattern: "101010101" }), { color: "#E9A83A", pattern: "101010101" });
  assert.deepEqual(server.defaultForKind("business"), { ...BUSINESS_MARK });
  assert.deepEqual(server.defaultForKind(undefined), { ...PERSONAL_MARK }, "a server on its own is Personal");
  assert.equal(server.defaultForKind("custom"), null);
});

test("the line to the app: an answer comes back to its question, a silent app is a timeout, no app is said at once", async () => {
  const sent: any[] = [];
  const line = new DesktopLine({ postMessage: (m) => sent.push(m) }, 50);
  assert.equal(new DesktopLine(undefined).ask("mark", {}), null);
  const asking = line.ask("mark", { mark: { color: "#149E8E", pattern: "010111010" } })!;
  assert.equal(sent[0].kind, "desktop.ask");
  assert.equal(sent[0].what, "mark");
  assert.equal(line.heard({ kind: "answer", ask: sent[0].ask, ok: true, mark: { color: "#149E8E", pattern: "010111010" } }), true);
  assert.deepEqual(await asking, { ok: true, mark: { color: "#149E8E", pattern: "010111010" } });
  // a question nobody answers is answered here
  assert.deepEqual(await line.ask("mark", {}, 10), { error: "The Bloks app on this computer did not answer in time.", status: 504 });
  // and the app's own questions are answered on the same line
  line.answer("pair", (asked) => ({ ok: true, echoed: asked.for }));
  assert.equal(line.heard({ kind: "ask", ask: "x1", what: "pair", for: "phone" }), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(sent.at(-1), { ok: true, echoed: "phone", kind: "desktop.answer", ask: "x1" });
  line.heard({ kind: "ask", ask: "x2", what: "nothing" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.at(-1).status, 404);
  // everything else on the line is not this line's
  assert.equal(line.heard({ kind: "licence", key: "k" }), false);
  assert.equal(line.heard(null), false);
});

test("the owner reads and changes the mark, on this computer or from their phone, and the choice is kept", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  const first = await h.json("/api/workspace/mark");
  assert.deepEqual(first.mark, { ...PERSONAL_MARK });
  assert.deepEqual(first.default, { ...PERSONAL_MARK });
  assert.equal(first.chosen, false);
  assert.deepEqual(first.choices.colors, [...CHOICE_COLORS]);
  assert.deepEqual(first.choices.patterns, [...CHOICE_PATTERNS]);

  const chosen = { color: "#8E4FC9", pattern: "010101010" };
  const set = await h.fetch("/api/workspace/mark", { method: "PUT", body: JSON.stringify({ mark: chosen }) });
  assert.equal(set.status, 200);
  assert.deepEqual((await set.json()).mark, chosen);
  const kept = await h.json("/api/workspace/mark");
  assert.deepEqual(kept.mark, chosen);
  assert.equal(kept.chosen, true);
  // beside the name, where the invites and a member's app read it
  assert.deepEqual(JSON.parse(readFileSync(join(h.home, ".bloks", "workspace.json"), "utf8")).mark, chosen);

  // nothing outside the picker's rules
  for (const mark of [{ color: "#000000", pattern: "010101010" }, { color: "#8E4FC9", pattern: "111111111" }, "red"]) {
    const res = await h.fetch("/api/workspace/mark", { method: "PUT", body: JSON.stringify({ mark }) });
    assert.equal(res.status, 400, JSON.stringify(mark));
  }
  assert.equal((await h.fetch("/api/workspace/mark", { method: "PUT", body: "{}" })).status, 400);

  // the owner's phone: paired, and on the same footing as the window here
  await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const started = await h.json("/api/pair/start", { method: "POST" });
  const paired = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Test iPhone" }) });
  const token = paired.body?.token;
  assert.ok(token, "the fixture phone did not pair");
  const fromPhone = await h.fetchRemote("/api/workspace/mark", { method: "PUT", token, body: JSON.stringify({ mark: { color: "#3F9A5B", pattern: "111000111" } }) });
  assert.equal(fromPhone.status, 200);
  assert.deepEqual(fromPhone.body.mark, { color: "#3F9A5B", pattern: "111000111" });
  // and back to the default, from the phone too
  const back = await h.fetchRemote("/api/workspace/mark", { method: "PUT", token, body: JSON.stringify({ mark: null }) });
  assert.equal(back.status, 200);
  assert.deepEqual(back.body.mark, { ...PERSONAL_MARK });
  assert.equal(back.body.chosen, false);
  // nobody else: a website, or the network without a pairing
  assert.equal((await h.fetchAs("https://evil.example", "/api/workspace/mark", { method: "PUT", body: JSON.stringify({ mark: chosen }) })).status, 403);
  const stranger = await h.fetchRemote("/api/workspace/mark", { method: "PUT", body: JSON.stringify({ mark: chosen }) });
  assert.ok(stranger.status === 401 || stranger.status === 403, `a stranger was answered ${stranger.status}`);
});

test("an agent never changes the workspace's mark", async (t) => {
  const f = await controlledChain(t);
  const bot = await f.hire("Penny");
  const turn = await f.begin(bot);
  const res = await f.agent(turn, "/api/workspace/mark", { mark: { color: "#8E4FC9", pattern: "010101010" } }, "PUT");
  assert.equal(res.status, 403);
  assert.equal((await f.agent(turn, "/api/workspace/mark", undefined, "GET")).status, 403);
  assert.deepEqual((await f.h.json("/api/workspace/mark")).mark, { ...PERSONAL_MARK });
  await f.finish(turn, bot);
});

test("a change from the phone is put to the app, and a mark the app refuses is not kept", async () => {
  const saved: unknown[] = [];
  const frames: unknown[] = [];
  let mark = { ...PERSONAL_MARK };
  const deps: server.MarkRouteDeps = {
    identity: () => ({ id: "personal", name: "Personal", kind: "Personal", mark }),
    markDefault: () => ({ ...PERSONAL_MARK }),
    save: (m) => {
      saved.push(m);
      mark = m;
    },
    askApp: async (m) => (m && m.color === "#3E5BD9" && m.pattern === "111101111" ? { error: "Another workspace has that mark.", status: 409 } : { ok: true, mark: m ?? PERSONAL_MARK, markDefault: PERSONAL_MARK }),
    broadcast: (f) => frames.push(f),
  };
  const body = (b: unknown) => async () => b as Record<string, unknown>;
  const refused = await server.markRoute("PUT", "/api/workspace/mark", body({ mark: { ...BUSINESS_MARK } }), deps);
  assert.deepEqual(refused, { status: 409, body: { error: "Another workspace has that mark." } });
  assert.deepEqual(saved, [], "refused is not kept");
  const ok = await server.markRoute("PUT", "/api/workspace/mark", body({ mark: { color: "#D64C7F", pattern: "101000101" } }), deps);
  assert.equal(ok?.status, 200);
  assert.deepEqual(saved, [{ color: "#D64C7F", pattern: "101000101" }]);
  assert.deepEqual(frames.at(-1), { kind: "workspace.mark", mark: { color: "#D64C7F", pattern: "101000101" }, default: { ...PERSONAL_MARK }, chosen: true });
  assert.equal(await server.markRoute("GET", "/api/workspace/other", body({}), deps), null);
});

test("the app answers a server's question about its own workspace only, and hands the mark back", () => {
  const main = readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  assert.match(main, /if \(said\?\.kind === "desktop\.ask" && typeof said\.ask === "string"\) return void answerServer\(id, child, said\);/);
  assert.match(main, /if \(said\.what === "mark"\) reply = markFromServer\(id, said\.mark\);/);
  assert.match(main, /run\.child\.postMessage\(\{ kind: "mark", mark: ws\.mark, markDefault: markDefault\(ws\) \}\)/);
  // a joined workspace's mark never goes to its owner's server
  const hand = main.slice(main.indexOf("function handMark("), main.indexOf("function markFromServer("));
  assert.match(hand, /isRemoteKind\(ws\.kind\)/);
});
