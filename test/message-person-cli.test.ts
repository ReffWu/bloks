// message_person for the engines with a shell (server/access.ts has the
// rule itself). Claude Code reaches it as a tool on its bridge, published
// only by name for a turn the owner or an admin started in a team
// conversation or a room; the other engines with a shell run
// `bloks message-person`, and an admin's turn gets a credential that does
// that one thing and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAskBroker, type PendingAsk } from "../server/harness/ask-broker.ts";
import { AgentTokens, allows, messageHint } from "../server/agent-cli.ts";
import { startHarness } from "./helpers/server.ts";

const PROXY = fileURLToPath(new URL("../server/permission-proxy.ts", import.meta.url));

async function bridge(t: import("node:test").TestContext, publish: string | null, asks: PendingAsk[]) {
  const dir = mkdtempSync(join(tmpdir(), "bloks-message-person-"));
  const broker = createAskBroker({
    socketPath: join(dir, "b.sock"),
    onAsk: (ask) => {
      asks.push(ask);
      broker.answer(ask.id, "answer", "Sent to Sam, marked as from you on Hamed's behalf.");
    },
    onResolve: () => {},
  });
  const env = { ...process.env };
  if (publish) env.BLOKS_PUBLISH = publish;
  else delete env.BLOKS_PUBLISH;
  const proxy = spawn(process.execPath, [PROXY, join(dir, "b.sock")], { env, stdio: ["pipe", "pipe", "inherit"] });
  t.after(() => {
    proxy.kill();
    broker.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const replies = new Map<number, any>();
  let pending = "";
  proxy.stdout.on("data", (chunk) => {
    pending += chunk;
    for (let cut = pending.indexOf("\n"); cut !== -1; cut = pending.indexOf("\n")) {
      const frame = JSON.parse(pending.slice(0, cut));
      pending = pending.slice(cut + 1);
      replies.set(frame.id, frame);
    }
  });
  return async (id: number, method: string, params: object = {}) => {
    proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    for (let i = 0; i < 200 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 25));
    return replies.get(id);
  };
}

test("Claude Code's bridge carries message_person only when the turn is told to publish it", async (t) => {
  const asks: PendingAsk[] = [];
  const plain = await bridge(t, null, asks);
  const listed = await plain(1, "tools/list");
  assert.ok(!listed.result.tools.some((tool: any) => tool.name === "message_person"), "never on an ordinary turn");
  const refused = await plain(2, "tools/call", { name: "message_person", arguments: { person: "Sam", text: "hi" } });
  assert.equal(refused.result.isError, true);
  assert.equal(asks.length, 0);

  const call = await bridge(t, "approve,request_connection,request_secret,ask_user,message_person", asks);
  const tools = (await call(1, "tools/list")).result.tools.map((tool: any) => tool.name);
  assert.ok(tools.includes("message_person"));
  assert.ok(tools.includes("approve"), "the turn keeps everything else it had");
  const sent = await call(2, "tools/call", { name: "message_person", arguments: { person: "Sam", text: "The draft is ready" } });
  assert.match(sent.result.content[0].text, /^Sent to Sam/);
  // it reaches the workspace as an ask the server answers, never a card
  assert.equal(asks.length, 1);
  assert.equal(asks[0].tool, "message_person");
  assert.deepEqual(asks[0].input, { person: "Sam", text: "The draft is ready" });
});

test("a messenger credential is its own kind, and the command line's route is on the list", () => {
  const tokens = new AgentTokens();
  const messenger = tokens.mintMessenger("b1", "t1", Date.now());
  assert.match(messenger.token, /^blm_/);
  assert.equal(messenger.messenger, true);
  assert.equal(tokens.identify(messenger.token, Date.now())?.messenger, true);
  const full = tokens.mint("b1", "t1", Date.now());
  assert.equal(full.messenger, undefined);
  assert.ok(allows("b1", "POST", "/api/agent/message-person").ok);
  assert.equal(messageHint(null, "bloks"), null);
  assert.match(messageHint("tool", "bloks")!, /message_person tool/);
  assert.match(messageHint("cli", "bloks")!, /bloks message-person/);
});

test("a messenger credential that is not one is refused, and an agent's own credential is needed for the route", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  const forged = await h.fetch("/api/agent/message-person", {
    method: "POST",
    headers: { authorization: `Bearer blm_${"x".repeat(32)}` },
    body: JSON.stringify({ person: "Sam", text: "hi" }),
  });
  assert.equal(forged.status, 403);
  // and the person at the keyboard is not an agent
  const bare = await h.fetch("/api/agent/message-person", { method: "POST", body: JSON.stringify({ person: "Sam", text: "hi" }) });
  assert.equal(bare.status, 401);
});
