// Moving a whole workspace to a hosted one, in one file: what a move
// clears and leaves out (server/workspace-move.ts), and the round trip
// through the real server, out of one workspace and into an empty one,
// with keys named and never carried.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  botsForMove,
  configForMove,
  emptyEnoughForMove,
  keepThisMachine,
  moveLeftOut,
  projectsForMove,
  roomsForMove,
} from "../server/workspace-move.ts";
import { startHarness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

test("what only means something on the computer a move leaves stays there", () => {
  for (const dir of ["checkpoints", "rehearsals", "vm-home", "identities"]) assert.ok(moveLeftOut(dir, true), dir);
  for (const file of ["turns-in-flight.json", "engine-sessions.json", "session-import.json", "pair-links.json", "live-activities.json"]) {
    assert.ok(moveLeftOut(file, false), file);
  }
  for (const kept of ["bots.json", "bloks.json", "routines.json", "watchers.json", "intents.json", "skills", "workspaces", "shared"]) {
    assert.equal(moveLeftOut(kept, kept.endsWith(".json") ? false : true), null, kept);
  }
  // only at the top: an agent's own folder may hold a file by that name
  assert.equal(moveLeftOut("workspaces/a/engine-sessions.json", false), null);
});

test("config for a move: the machine's sections go, and each key left behind is named once", () => {
  const original = {
    port: 4999,
    instances: { claude: { driver: "claudeAgent", config: { cli: "/Users/x/.local/bin/claude" } } },
    relay: { url: "https://relay.example", agentToken: "a", clientToken: "c", enabled: true },
    remote: { enabled: true, devices: [{ id: "d" }] },
    shortcuts: { quickAsk: "Alt+Space" },
    box: { token: "box-1", sleepAfter: 10 },
    agentDefaults: { cwd: "/Users/x/code", approvals: "auto" },
    providers: { openrouter: { key: "sk-or-1" } },
    custom: [{ id: "h1", name: "Together", url: "https://t.example/v1", keys: [{ id: "k1", key: "t-1" }] }],
    secrets: { WEATHER_TOKEN: "w", MAPS_KEY: "m" },
    credits: { licence: "blok_live_x", token: "cred", background: true },
    profile: { about: "Bakery" },
  };
  // what a backup's own stripping leaves and says it took
  const stripped = structuredClone(original) as Record<string, any>;
  delete stripped.providers.openrouter.key;
  delete stripped.custom[0].keys[0].key;
  delete stripped.secrets;
  delete stripped.box.token;
  delete stripped.relay.agentToken;
  delete stripped.relay.clientToken;
  delete stripped.remote.devices;
  delete stripped.credits.licence;
  delete stripped.credits.token;
  const leftOut = [
    "providers.openrouter.key",
    "box.token",
    "custom[h1].keys[k1].key",
    "secrets",
    "relay.agentToken",
    "relay.clientToken",
    "remote.devices",
    "credits.licence",
    "credits.token",
  ];
  const { config, toEnter } = configForMove(stripped, leftOut, original);
  for (const key of ["port", "instances", "relay", "remote", "shortcuts", "box"]) assert.equal(key in config, false, key);
  assert.deepEqual(config.agentDefaults, { approvals: "auto" }, "a folder on that disk is not a default here");
  assert.deepEqual((config.profile as any).about, "Bakery");
  assert.deepEqual((config.credits as any).background, true, "a setting, not a key, so it moves");
  assert.deepEqual(toEnter, [
    "OpenRouter key",
    "Cloud box key",
    "Key for Together",
    "Saved secret WEATHER_TOKEN",
    "Saved secret MAPS_KEY",
    "Bloks Cloud key, for Bloks AI",
  ]);
});

test("agents and lanes keep everything but that computer's folders and engine sessions", () => {
  const bots = [
    {
      id: "a",
      cwd: "/Users/x/code",
      computer: "cloud",
      resumeCursors: { claude: "s1" },
      tasks: [
        { id: "t1", cwd: "/Users/x/code", resumeCursors: { claude: "s1" }, lastInstanceId: "claude", busy: true, reading: { used: 1 }, title: "Lane", imported: { resumes: true } },
      ],
    },
    { id: "b", computer: "off", resumeCursors: {}, tasks: [] },
  ];
  const moved = JSON.parse(botsForMove(JSON.stringify(bots)));
  assert.equal(moved[0].cwd, undefined);
  assert.equal(moved[0].computer, undefined, "a box on that computer is not one here; the new machine decides");
  assert.equal(moved[1].computer, "off", "off stays off");
  assert.deepEqual(moved[0].resumeCursors, {});
  const lane = moved[0].tasks[0];
  assert.deepEqual(lane.resumeCursors, {});
  assert.equal(lane.lastInstanceId, "", "the next engine is told the conversation so far");
  assert.equal(lane.cwd, undefined);
  assert.equal(lane.busy, false);
  assert.equal(lane.reading, undefined);
  assert.equal(lane.imported.resumes, false);
  assert.equal(lane.title, "Lane");
});

test("a room's desk and a project's folders are folders on that disk", () => {
  const rooms = JSON.parse(roomsForMove(JSON.stringify([{ id: "r", name: "Room", cwd: "/x", pinnedCwd: "/x" }])));
  assert.deepEqual(rooms, [{ id: "r", name: "Room" }]);
  const projects = JSON.parse(projectsForMove(JSON.stringify([{ id: "p", name: "Shop", folders: ["/Users/x/shop"] }])));
  assert.deepEqual(projects, [{ id: "p", name: "Shop", folders: [] }]);
});

test("the machine a move lands on keeps its own sections, whole", () => {
  const restored: Record<string, unknown> = { profile: { about: "Bakery" }, port: 1 };
  keepThisMachine({ relay: { url: "https://here", agentToken: "here-a", enabled: true }, instances: { x: {} } }, restored);
  assert.deepEqual(restored.relay, { url: "https://here", agentToken: "here-a", enabled: true });
  assert.deepEqual(restored.instances, { x: {} });
  assert.equal("port" in restored, false, "this machine has no port of its own set, so none arrives");
});

test("only a workspace with nothing in it takes a move", () => {
  const none = { mine: 0, rooms: 0, routines: 0, watchers: 0, intents: 0 };
  assert.equal(emptyEnoughForMove(none), true);
  for (const key of Object.keys(none)) assert.equal(emptyEnoughForMove({ ...none, [key]: 1 }), false, key);
});

const PROVIDER_KEY = "sk-or-v1-movetestsecret0123456789";
const SAVED_SECRET = "weather-secret-value-0987654321";

function seeded(config: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "bloks-move-"));
  mkdirSync(join(home, ".bloks"), { recursive: true });
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify(config, null, 2));
  return home;
}

/** The names and contents of a plain move file's entries. */
function entries(file: Buffer): Map<string, string> {
  const tar = gunzipSync(file);
  const out = new Map<string, string>();
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = tar.subarray(at, at + 100).toString("utf8").replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(tar.subarray(at + 124, at + 136).toString("ascii").replace(/\0.*$/s, "").trim() || "0", 8);
    const type = String.fromCharCode(tar[at + 156]);
    if (type === "0" || type === "\0") out.set(name, tar.subarray(at + 512, at + 512 + size).toString("utf8"));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

test("a workspace moves out whole, without its keys, and into an empty hosted one", async (t) => {
  const homeA = seeded({
    providers: { openrouter: { key: PROVIDER_KEY } },
    secrets: { WEATHER_TOKEN: SAVED_SECRET },
    profile: { about: "I run a bakery." },
    relay: { url: "https://relay.example", agentToken: "mac-agent-token-1", clientToken: "mac-client-token-1", enabled: false },
    agentDefaults: { approvals: "auto" },
  });
  const homeB = seeded({
    relay: { url: "https://relay.example", agentToken: "hosted-agent-token-1", clientToken: "hosted-client-token-1", enabled: false },
  });
  t.after(() => {
    rmSync(homeA, { recursive: true, force: true });
    rmSync(homeB, { recursive: true, force: true });
  });

  // ── the workspace on the Mac ──
  const a = await startHarness({ HOME: homeA });
  t.after(() => a.stop());
  const { bot: alpha } = await a.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Alpha" }) });
  const { bot: beta } = await a.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Beta" }) });
  assert.equal((await a.fetch(`/api/bots/${alpha.id}`, { method: "PATCH", body: JSON.stringify({ cwd: homeA, computer: "cloud" }) })).status, 200);
  assert.equal((await a.fetch(`/api/bots/${alpha.id}/memory`, { method: "PUT", body: JSON.stringify({ text: "- Croissants sell out by nine.\n" }) })).status, 200);
  assert.equal((await a.fetch("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Kitchen", memberIds: [alpha.id, beta.id] }) })).status < 300, true);
  assert.equal((await a.fetch("/api/skills", { method: "POST", body: JSON.stringify({ name: "Proofing", description: "How long dough rests", body: "Rest it an hour." }) })).status < 300, true);
  assert.equal((await a.fetch("/api/routines", { method: "POST", body: JSON.stringify({ targetId: alpha.id, targetKind: "agent", prompt: "Count the flour.", time: "06:00", days: [] }) })).status < 300, true);
  assert.equal((await a.fetch("/api/intents", { method: "POST", body: JSON.stringify({ name: "Orders", phrases: "order*", action: { kind: "note", text: "Orders close at noon." } }) })).status, 201);

  // a workspace with work in it never takes a move in
  const refused = await a.fetch("/api/workspace/move/import", { method: "POST", body: "x" });
  assert.equal(refused.status, 409);

  const made = await a.json("/api/workspace/move", { method: "POST", body: "{}" });
  assert.equal(made.backup.kind, "move");
  assert.deepEqual(made.toEnter.sort(), ["OpenRouter key", "Saved secret WEATHER_TOKEN"]);
  const download = await a.fetch(`/api/workspace/move/${encodeURIComponent(made.backup.name)}`);
  assert.equal(download.status, 200);
  const bytes = Buffer.from(await download.arrayBuffer());
  // a phone, or anything not on this computer, does not write one out
  assert.equal((await a.fetchRemote("/api/workspace/move", { method: "POST", body: "{}" })).status === 200, false);
  await a.stop();

  const inside = entries(bytes);
  const all = [...inside.values()].join("\n");
  for (const secret of [PROVIDER_KEY, SAVED_SECRET, "mac-agent-token-1", "mac-client-token-1"]) {
    assert.ok(!all.includes(secret), `${secret} never travels`);
  }
  assert.ok(!inside.get("bloks/bots.json")?.includes(homeA), "no folder on that disk");
  assert.ok(inside.has("bloks/routines.json") && inside.has("bloks/intents.json") && inside.has("bloks/bloks.json"));

  // ── the hosted workspace, empty ──
  const b = await startHarness({ HOME: homeB, BLOKS_HOSTED: "1" });
  t.after(() => b.stop());
  assert.equal((await b.json("/api/workspace/move")).empty, true);
  const imported = await b.fetch("/api/workspace/move/import", { method: "POST", body: bytes, headers: { "content-type": "application/octet-stream" } });
  assert.equal(imported.status, 202);
  assert.deepEqual((await imported.json()).toEnter.sort(), ["OpenRouter key", "Saved secret WEATHER_TOKEN"]);
  // it stops so the next start puts the workspace in place
  const stopped = await waitFor(async () => {
    try {
      await fetch(`${b.url}/api/health`);
      return null;
    } catch {
      return true;
    }
  }, 60_000);
  assert.ok(stopped, "the hosted workspace restarts to take it in");
  await b.stop();

  const c = await startHarness({ HOME: homeB, BLOKS_HOSTED: "1" });
  t.after(() => c.stop());
  const { bots } = await c.json("/api/bots");
  const movedAlpha = bots.find((x: any) => x.name === "Alpha");
  assert.ok(movedAlpha && bots.some((x: any) => x.name === "Beta"));
  assert.equal(movedAlpha.cwd ?? null, null);
  assert.equal(movedAlpha.computer ?? null, null);
  assert.match((await c.json(`/api/bots/${movedAlpha.id}/memory`)).text, /Croissants sell out by nine/);
  assert.ok((await c.json("/api/bloks")).bloks.some((r: any) => r.name === "Kitchen"));
  assert.equal((await c.json("/api/routines")).routines.length, 1);
  assert.equal((await c.json("/api/intents")).intents.length, 1);
  assert.ok((await c.json("/api/skills")).skills.some((s: any) => s.name === "Proofing"));
  assert.equal((await c.json("/api/config")).profile.about, "I run a bakery.");
  const config = JSON.parse(readFileSync(join(homeB, ".bloks", "config.json"), "utf8"));
  assert.equal(config.relay.agentToken, "hosted-agent-token-1", "the hosted machine keeps its own relay space");
  assert.equal(config.providers?.openrouter?.key, undefined, "keys are entered again, not carried");
  assert.equal(config.agentDefaults.approvals, "auto");
});
