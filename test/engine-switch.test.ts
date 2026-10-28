// The switch on an engine in Settings (GitHub 421).
//
// An engine kept in the config and switched off starts no turns (GitHub
// 324), and the refusal sends the person to Settings to switch it back
// on. Settings had nothing there to switch: the row read the CLI's
// health, said Connected in green, and offered no control. Now the
// engines list says which are switched on, the row says Off ahead of
// everything else, and the owner, and only the owner, can switch it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { instanceConfigs } from "../server/config.ts";
import { ProviderRegistry } from "../server/harness/registry.ts";
import type { AnyProviderDriver } from "../server/contracts.ts";
import { startHarness } from "./helpers/server.ts";

const OWNER_TOKEN = "fixture-owner-phone-token-0123456789";
const MEMBER_TOKEN = "fixture-member-phone-token-0123456789";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

test("the switch reaches every kind of engine and wins over the config underneath, without writing into it", () => {
  const instances = { claude: { driver: "claudeAgent" as const, enabled: false } };
  const map = instanceConfigs({
    instances,
    providers: { mistral: { key: "fixture-key" } },
    engineSwitches: { claude: true, mistral: false, codex: false, nothing: false },
  });
  assert.equal(map.claude.enabled, true, "the switch is the later word");
  assert.equal(map.mistral.enabled, false, "an engine a connected key makes has no entry of its own to write it in");
  assert.equal(map.codex.enabled, false);
  assert.equal(map.nothing, undefined, "a switch for an engine that is not there makes none");
  assert.equal(instances.claude.enabled, false, "the saved config's own entry was changed");
  assert.equal(instanceConfigs({ instances }).claude.enabled, false, "no switch is as configured");
});

test("the engines list says which are switched on, a placeholder included", async () => {
  const driver = {
    driverKind: "fixture",
    metadata: { displayName: "Fixture" },
    defaultConfig: () => ({}),
    decodeConfig: (raw: unknown) => raw,
    async create(input: { instanceId: string; enabled: boolean }) {
      return {
        instanceId: input.instanceId,
        driverKind: "fixture",
        displayName: "Fixture",
        enabled: input.enabled,
        models: { default: "", options: [] },
        adapter: { capabilities: {} },
        async snapshot() {
          return { state: "available", authenticated: true };
        },
        async dispose() {},
      };
    },
  } as unknown as AnyProviderDriver;
  const registry = new ProviderRegistry([driver]);
  await registry.load({
    on: { driver: "fixture" as never },
    off: { driver: "fixture" as never, enabled: false },
    future: { driver: "notYet" as never, enabled: false },
  });
  const rows = new Map((await registry.describe()).map((row) => [row.instanceId, row]));
  assert.equal(rows.get("on")?.enabled, true);
  assert.equal(rows.get("off")?.enabled, false);
  assert.equal(rows.get("off")?.snapshot.state, "available", "switched off is said apart from installed and signed in");
  assert.equal(rows.get("future")?.enabled, false, "a placeholder keeps what its config said");
});

test("the owner switches an engine off and on, a turn on it is refused in between, and nobody else can switch it", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-engine-switch-"));
  const cli = join(home, "claude.mjs");
  writeFileSync(
    cli,
    `#!${process.execPath}
const [first] = process.argv.slice(2);
if (first === "--version") { console.log("2.1.299 (Claude Code)"); process.exit(0); }
if (first === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  if (!String(chunk).includes('"type":"user"')) return;
  const text = "Answered.";
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_api_ms: 1, result: text }));
});
`,
    { mode: 0o755 },
  );
  mkdirSync(join(home, ".bloks"), { recursive: true });
  const configFile = join(home, ".bloks", "config.json");
  writeFileSync(
    configFile,
    JSON.stringify({
      profile: { name: "Sam" },
      brief: { enabled: false },
      backups: { auto: false },
      instances: {
        claude: { driver: "claudeAgent", config: { cli } },
        "claude-spare": { driver: "claudeAgent", enabled: false, config: { cli } },
      },
      remote: {
        enabled: true,
        devices: [{ id: "sams-iphone", name: "Sam's iPhone", hash: digest(OWNER_TOKEN), pairedAt: 1 }],
        memberDevices: [{ id: "ayas-iphone", name: "Aya's iPhone", hash: digest(MEMBER_TOKEN), pairedAt: 1, personId: "p_aya" }],
      },
    }),
  );
  writeFileSync(
    join(home, ".bloks", "people.json"),
    JSON.stringify({ version: 3, people: [{ id: "p_aya", name: "Aya", createdAt: 1, role: "member", joinedAt: 1, invitedBy: "owner" }], memberships: [], invites: [], knocks: [] }),
  );
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });

  const enabled = async (id: string) => ((await h.json("/api/instances")).instances as any[]).find((i) => i.instanceId === id)?.enabled;
  const switches = () => JSON.parse(readFileSync(configFile, "utf8")).engineSwitches ?? {};
  const put = (id: string, body: unknown) => h.fetch(`/api/instances/${id}/enabled`, { method: "PUT", body: JSON.stringify(body) });

  assert.equal(await enabled("claude"), true);
  assert.equal(await enabled("claude-spare"), false, "what the config says reaches the engines list");

  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Ada" }) });
  const set = await h.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }) });
  assert.equal(set.status, 200, await set.text());

  // off from this machine: said in the list, and a turn is refused with
  // a pointer to the switch that now exists
  const off = await put("claude", { enabled: false });
  assert.equal(off.status, 200, await off.clone().text());
  assert.equal(((await off.json()).instances as any[]).find((i) => i.instanceId === "claude").enabled, false);
  assert.equal(await enabled("claude"), false);
  assert.deepEqual(switches(), { claude: false });
  const refused = await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Are you there?" }) });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /Claude is switched off in Settings, so it starts no turns\. Switch it back on in Settings, Engines and keys/);

  // nobody but the owner: not a member's phone, not a member's
  // credential on this machine, not a window that never paired
  const member = await h.fetchRemote("/api/instances/claude/enabled", { method: "PUT", token: MEMBER_TOKEN, body: JSON.stringify({ enabled: true }) });
  assert.ok(member.status >= 400, `a member's phone switched an engine: ${member.status}`);
  const memberHere = await h.fetch("/api/instances/claude/enabled", {
    method: "PUT",
    headers: { authorization: `Bearer ${MEMBER_TOKEN}` },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(memberHere.status, 403);
  const stranger = await h.fetchRemote("/api/instances/claude/enabled", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  assert.ok(stranger.status >= 400);
  assert.equal(await enabled("claude"), false, "something other than the owner switched it on");

  // on again from the owner's own phone, and the file is as it was
  const phone = await h.fetchRemote("/api/instances/claude/enabled", { method: "PUT", token: OWNER_TOKEN, body: JSON.stringify({ enabled: true }) });
  assert.equal(phone.status, 200, JSON.stringify(phone.body));
  assert.equal(await enabled("claude"), true);
  assert.deepEqual(switches(), {});
  const answered = await h.fetch(`/api/bots/${bot.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Are you there?" }) });
  assert.ok(answered.ok, `switched back on and still refused: ${await answered.clone().text()}`);

  // one the config switched off comes on, and goes back to as written
  assert.equal((await put("claude-spare", { enabled: true })).status, 200);
  assert.equal(await enabled("claude-spare"), true);
  assert.deepEqual(switches(), { "claude-spare": true });
  assert.equal((await put("claude-spare", { enabled: false })).status, 200);
  assert.equal(await enabled("claude-spare"), false);
  assert.deepEqual(switches(), {});

  assert.equal((await put("claude", { enabled: "yes" })).status, 400);
  assert.equal((await put("nothing-here", { enabled: true })).status, 404);
});
