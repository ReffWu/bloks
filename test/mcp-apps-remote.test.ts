// An MCP server's apps from the owner's own paired devices (GitHub 356).
// A workspace on a server elsewhere has no window of its own, and the Apps
// card in the app connected to it offered a Check that only ever said
// "not from here". Now the owner's device runs the inventory, opens an app
// and lets it call the tools its server published, on the network and
// through Bloks Cloud, framed under the same terms as on the computer
// itself. A member's device, a member's credential presented on that
// computer, an agent's turn and a device nobody paired reach none of it,
// and the card never shows the bare refusal an older Bloks gives.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { startRemoteProxy } from "../electron/remote.mjs";
import { allows } from "../server/agent-cli.ts";
import { APPS_ELSEWHERE, appsTrouble } from "../src/lib/mcpApps.ts";
import { sealedRelay } from "./helpers/sealed-relay.ts";
import { startHarness } from "./helpers/server.ts";

const OWNER_TOKEN = "fixture-owner-device-token";
const MEMBER_TOKEN = "fixture-member-device-token";
const FAKE = fileURLToPath(new URL("./helpers/fake-mcp.mjs", import.meta.url));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const device = (id: string, token: string, personId?: string) => ({
  id,
  name: "Fixture device",
  hash: sha(token),
  pairedAt: 1,
  ...(personId ? { personId } : {}),
});

test("the owner's own device checks a server's apps, opens one and runs its tools; nobody else does", { timeout: 120_000 }, async (t) => {
  const relay = await sealedRelay();
  t.after(() => relay.stop());
  const home = mkdtempSync(join(tmpdir(), "bloks-test-mcp-remote-"));
  mkdirSync(join(home, ".bloks"));
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({
      remote: { devices: [device("owner-device", OWNER_TOKEN)], memberDevices: [device("member-device", MEMBER_TOKEN, "fixture-member")] },
      relay: { enabled: true, url: relay.url, agentToken: "fixture-relay-agent" },
    }),
  );
  // a server that answers only on loopback, as bloks-server does
  const h = await startHarness({ HOME: home, BLOKS_LOOPBACK_ONLY: "1" });
  t.after(() => h.stop());
  t.after(() => rmSync(home, { recursive: true, force: true }));
  await relay.connection;

  // one server that draws an app, and one that is only tools, as most are
  const add = async (name: string, args: string) =>
    (await h.json("/api/mcp-servers", { method: "POST", body: JSON.stringify({ name, transport: "stdio", command: process.execPath, args }) })).id as string;
  const sales = await add("Sales", JSON.stringify(FAKE));
  const tools = await add("Home", `${JSON.stringify(FAKE)} --no-apps`);
  const view = { method: "POST", body: JSON.stringify({ uri: "ui://sales/dashboard", theme: { scheme: "dark", background: "#101013" } }) };
  const act = (tool: string) => ({ method: "POST", body: JSON.stringify({ message: { type: "tool", payload: { toolName: tool, params: { since: "today" } } } }) });

  // ── on the network, with the device's own token ──
  const none = await h.fetchRemote(`/api/mcp-servers/${tools}/apps`, { token: OWNER_TOKEN });
  assert.equal(none.status, 200, JSON.stringify(none.body));
  assert.deepEqual(none.body.apps, [], "a server of tools alone is a server with no app, which the card says");
  assert.deepEqual(none.body.tools.map((tool: any) => tool.name), ["refresh", "export"]);
  const listed = await h.fetchRemote(`/api/mcp-servers/${sales}/apps`, { token: OWNER_TOKEN });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.apps.map((app: any) => app.uri), ["ui://sales/dashboard"]);
  const framed = await h.fetchRemote(`/api/mcp-servers/${sales}/apps/view`, { ...view, token: OWNER_TOKEN });
  assert.equal(framed.status, 200);
  const html = String(framed.body);
  assert.match(html, /Sales/);
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("Sales"), "the policy is not ahead of the server's own markup");
  assert.match(html, /connect-src 'none'/);
  const ran = await h.fetchRemote(`/api/mcp-servers/${sales}/apps/act`, { ...act("refresh"), token: OWNER_TOKEN });
  assert.equal(ran.status, 200);
  assert.match(ran.body.text, /refreshed since today/);
  const unpublished = await h.fetchRemote(`/api/mcp-servers/${sales}/apps/act`, { ...act("rm_rf"), token: OWNER_TOKEN });
  assert.equal(unpublished.status, 403, "a tool the server never published ran for a device elsewhere");
  assert.equal(unpublished.body.error, "that server does not publish that tool");

  // ── through Bloks Cloud, the way the Mac app reaches a server elsewhere ──
  const files = mkdtempSync(join(tmpdir(), "bloks-test-mcp-remote-ui-"));
  t.after(() => rmSync(files, { recursive: true, force: true }));
  writeFileSync(join(files, "index.html"), "<!doctype html><title>Fixture</title>");
  const app = await startRemoteProxy(
    { relayUrl: relay.url, relayToken: "fixture-relay-client", deviceId: "owner-device", deviceToken: OWNER_TOKEN },
    { staticDir: files, client: "macOS 3.0" },
  );
  const member = await startRemoteProxy(
    { relayUrl: relay.url, relayToken: "fixture-relay-member", deviceId: "member-device", deviceToken: MEMBER_TOKEN },
    { staticDir: files },
  );
  t.after(() => {
    app.stop();
    member.stop();
  });
  const at = (proxy: { port: number }, path: string, init?: { method?: string; body?: string }) =>
    fetch(`http://127.0.0.1:${proxy.port}${path}`, { ...init, headers: { "content-type": "application/json" } });
  const checked = await at(app, `/api/mcp-servers/${tools}/apps`);
  assert.equal(checked.status, 200);
  const inventory = await checked.json();
  assert.equal(inventory.apps.length, 0);
  assert.equal(inventory.tools.length, 2);
  const opened = await at(app, `/api/mcp-servers/${sales}/apps/view`, view);
  assert.equal(opened.status, 200);
  assert.match(opened.headers.get("content-type") ?? "", /text\/html/, "the frame arrived as something other than a document");
  const document = await opened.text();
  assert.ok(document.startsWith("<!doctype html>"), "the document was wrapped on the way");
  assert.ok(document.indexOf("default-src 'none'") < document.indexOf("Sales"));
  const relayed = await at(app, `/api/mcp-servers/${sales}/apps/act`, act("refresh"));
  assert.equal(relayed.status, 200);
  assert.match((await relayed.json()).text, /refreshed since today/);

  // ── nobody else ──
  const routes: Array<[string, string, { method?: string; body?: string }]> = [
    ["GET", `/api/mcp-servers/${sales}/apps`, {}],
    ["POST", `/api/mcp-servers/${sales}/apps/view`, view],
    ["POST", `/api/mcp-servers/${sales}/apps/act`, act("refresh")],
  ];
  for (const [method, path, init] of routes) {
    // a member's device, on the network and through Bloks Cloud
    const network = await h.fetchRemote(path, { ...init, token: MEMBER_TOKEN });
    assert.notEqual(network.status, 200, `${method} ${path} answered a member's device on the network`);
    assert.doesNotMatch(JSON.stringify(network.body), /refresh|Sales dashboard|<html/);
    const cloud = await at(member, path, init);
    assert.notEqual(cloud.status, 200, `${method} ${path} answered a member's device through Bloks Cloud`);
    assert.doesNotMatch(await cloud.text(), /refresh|Sales dashboard|<html/);
    // a member's credential presented on this computer is the member's
    const local = await h.fetch(path, { ...init, headers: { authorization: `Bearer ${MEMBER_TOKEN}` } });
    assert.equal(local.status, 403, `${method} ${path} answered a member's credential on this computer`);
    // a device nobody paired
    assert.equal((await h.fetchRemote(path, { ...init, token: "not-a-device" })).status, 401);
    assert.equal((await h.fetchRemote(path, init)).status, 401);
    // and never an agent's turn
    assert.equal(allows("ada", method, path).ok, false, `${method} ${path} is open to an agent`);
  }
  // the person at this computer, as ever
  assert.equal((await h.fetch(`/api/mcp-servers/${tools}/apps`)).status, 200);
});

describe("what the Apps card says when apps could not be had", () => {
  test("an older Bloks's refusal is said plainly, never as its bare words", () => {
    const said = appsTrouble(403, "not from here", "403 Forbidden");
    assert.equal(said, APPS_ELSEWHERE);
    assert.doesNotMatch(said, /not from here/);
    assert.match(said, /Update Bloks there/);
  });

  test("a server that would not answer, or a tool it never published, keeps the workspace's words", () => {
    assert.equal(appsTrouble(502, "that server would not answer", "502 Bad Gateway"), "that server would not answer");
    assert.equal(appsTrouble(403, "that server does not publish that tool", "403 Forbidden"), "that server does not publish that tool");
    assert.equal(appsTrouble(500, undefined, "Could not open this app"), "Could not open this app");
    assert.equal(appsTrouble(500, "  ", "Could not open this app"), "Could not open this app");
  });
});
