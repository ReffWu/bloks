// Pairing a phone from the owner's own devices (GitHub 403). A workspace
// on a server with no screen is reached only from paired devices, so the
// Phone access card in the app connected to it said "not from here" and
// offered no way to pair anything. Now the owner's device sees the status,
// turns phone access on, makes a code or a link and closes it again, on the
// network and through Bloks Cloud, and what it is shown sends a phone to the
// server, never to the device asking. Turning access off and removing every
// device stay at the server, since from a device they cut that device off
// too. A member's device, a member's credential presented on the server,
// an agent's turn and a device nobody paired reach none of it, and the
// person at the server is answered as before.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { claimPairLink, parsePairLink, startRemoteProxy } from "../electron/remote.mjs";
import { allows } from "../server/agent-cli.ts";
import { PAIRING_ELSEWHERE, cloudOnly, pairingAway, pairingTrouble } from "../src/lib/pairing.ts";
import { sealedRelay } from "./helpers/sealed-relay.ts";
import { startHarness } from "./helpers/server.ts";

const OLD_PHONE = "fixture-old-phone-token";
const MEMBER_TOKEN = "fixture-member-device-token";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const device = (id: string, token: string, personId?: string) => ({
  id,
  name: "Fixture device",
  hash: sha(token),
  pairedAt: 1,
  ...(personId ? { personId } : {}),
});

/** Every pairing route, as the card calls it. */
const ROUTES: Array<[string, string, string | undefined]> = [
  ["GET", "/api/pair", undefined],
  ["PUT", "/api/pair", JSON.stringify({ enabled: true })],
  ["POST", "/api/pair/start", "{}"],
  ["POST", "/api/pair/cancel", "{}"],
  ["POST", "/api/pair/link", "{}"],
  ["DELETE", "/api/pair/devices/old-phone", undefined],
  ["DELETE", "/api/pair/devices", undefined],
];

test("on the network, the owner's own device pairs a phone with the server; nobody else does", { timeout: 120_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-pair-remote-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, ".bloks"));
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({
      remote: { enabled: true, devices: [device("old-phone", OLD_PHONE)], memberDevices: [device("member-device", MEMBER_TOKEN, "fixture-member")] },
      profile: { name: "Owner" },
    }),
  );
  const h = await startHarness({ HOME: home, BLOKS_COMPUTER_NAME: "Fixture Server" });
  t.after(() => h.stop());
  const port = Number(new URL(h.url).port);

  // ── at the server, as before ──
  const here = await h.json("/api/pair");
  assert.equal(here.enabled, true);
  assert.equal(here.here, true);
  assert.equal(here.computer, "Fixture Server");
  assert.equal(here.thisDevice, undefined, "the window at the server is no paired device");
  const started = await h.json("/api/pair/start", { method: "POST" });
  const paired = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Owner's MacBook" }) });
  const owner = paired.body?.token as string;
  assert.ok(owner, "the fixture device did not pair");
  const ownerId = paired.body.device.id as string;

  // ── nobody unpaired, no member, no agent ──
  for (const [method, path, body] of ROUTES) {
    const unpaired = await h.fetchRemote(path, { method, body });
    assert.equal(unpaired.status, 401, `${method} ${path} answered a device nobody paired`);
    assert.equal((await h.fetchRemote(path, { method, body, token: "not-a-device" })).status, 401);
    const member = await h.fetchRemote(path, { method, body, token: MEMBER_TOKEN });
    assert.notEqual(member.status, 200, `${method} ${path} answered a member's device`);
    assert.doesNotMatch(JSON.stringify(member.body), /bloks_pair_|\/pair#|"devices"/);
    const local = await h.fetch(path, { method, body, headers: { authorization: `Bearer ${MEMBER_TOKEN}` } });
    assert.equal(local.status, 403, `${method} ${path} answered a member's credential on the server`);
    assert.equal(allows("ada", method, path).ok, false, `${method} ${path} is open to an agent`);
  }
  assert.equal((await h.json("/api/pair")).pending, false, "a refused request opened a pairing window");
  assert.deepEqual((await h.json("/api/pair")).devices.map((d: { id: string }) => d.id).sort(), [ownerId, "old-phone"].sort());

  // ── the owner's own device ──
  const status = await h.fetchRemote("/api/pair", { token: owner });
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.here, false);
  assert.equal(status.body.computer, "Fixture Server");
  assert.equal(status.body.thisDevice, ownerId);
  assert.deepEqual(status.body.addresses, here.addresses, "the device was told other addresses than the server's own");
  const on = await h.fetchRemote("/api/pair", { method: "PUT", token: owner, body: JSON.stringify({ enabled: true }) });
  assert.equal(on.status, 200);
  assert.equal(on.body.enabled, true);

  // a code whose QR sends the phone to the server, never to the device
  const code = await h.fetchRemote("/api/pair/start", { method: "POST", token: owner, body: "{}" });
  assert.equal(code.status, 200, JSON.stringify(code.body));
  assert.match(code.body.code, /^\d{6}$/);
  assert.match(code.body.token, /^bloks_pair_[A-Za-z0-9_-]{32}$/);
  assert.equal(code.body.port, port);
  assert.equal(code.body.name, "Fixture Server");
  assert.deepEqual(code.body.addresses, here.addresses);
  assert.ok(!code.body.addresses.includes("127.0.0.1"));
  assert.equal((await h.json("/api/pair")).pending, true);
  const cancelled = await h.fetchRemote("/api/pair/cancel", { method: "POST", token: owner, body: "{}" });
  assert.equal(cancelled.status, 200);
  assert.equal((await h.json("/api/pair")).pending, false);
  // and the code a phone trades in, opened from the device
  const again = await h.fetchRemote("/api/pair/start", { method: "POST", token: owner, body: "{}" });
  const phone = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ credential: again.body.token, device: "Owner's iPhone" }) });
  assert.equal(phone.status, 200, JSON.stringify(phone.body));
  assert.equal((await h.fetchRemote("/api/bots", { token: phone.body.token })).status, 200);

  // without Bloks Cloud there is no link, and it says why in words
  const link = await h.fetchRemote("/api/pair/link", { method: "POST", token: owner, body: "{}" });
  assert.equal(link.status, 409);
  assert.match(link.body.error, /Bloks Cloud/);

  // what would cut the device off stays with the server, in plain words
  const off = await h.fetchRemote("/api/pair", { method: "PUT", token: owner, body: JSON.stringify({ enabled: false }) });
  assert.equal(off.status, 403);
  assert.match(off.body.error, /only on Fixture Server itself/);
  const all = await h.fetchRemote("/api/pair/devices", { method: "DELETE", token: owner });
  assert.equal(all.status, 403);
  assert.match(all.body.error, /only on Fixture Server itself/);
  const self = await h.fetchRemote(`/api/pair/devices/${ownerId}`, { method: "DELETE", token: owner });
  assert.equal(self.status, 403);
  assert.match(self.body.error, /another of your devices/);
  const after = await h.json("/api/pair");
  assert.equal(after.enabled, true);
  assert.equal(after.devices.length, 3, "a refused removal removed something");
  // a lost phone is removed from the device, which still gets in
  const lost = await h.fetchRemote("/api/pair/devices/old-phone", { method: "DELETE", token: owner });
  assert.equal(lost.status, 200);
  assert.equal((await h.fetchRemote("/api/bots", { token: OLD_PHONE })).status, 401);
  assert.equal((await h.fetchRemote("/api/pair", { token: owner })).status, 200);

  // ── and the person at the server, as before: off and on, every device out ──
  assert.equal((await h.fetch("/api/pair/devices", { method: "DELETE" })).status, 200);
  const offHere = await h.json("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  assert.equal(offHere.enabled, false);
  assert.equal(offHere.here, true);
});

test("through Bloks Cloud, a server with no network of its own pairs a phone by link, and the link reaches it", { timeout: 120_000 }, async (t) => {
  const relay = await sealedRelay();
  t.after(() => relay.stop());
  const home = mkdtempSync(join(tmpdir(), "bloks-pair-cloud-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const OWNER = "fixture-owner-device-token";
  mkdirSync(join(home, ".bloks"));
  writeFileSync(
    join(home, ".bloks", "config.json"),
    JSON.stringify({
      remote: {
        devices: [device("owner-device", OWNER), device("old-phone", OLD_PHONE)],
        memberDevices: [device("member-device", MEMBER_TOKEN, "fixture-member")],
      },
      relay: { enabled: true, url: relay.url, agentToken: "fixture-relay-agent", clientToken: "fixture-relay-client" },
      profile: { name: "Owner" },
    }),
  );
  // a server that answers only on loopback, as bloks-server does
  const h = await startHarness({ HOME: home, BLOKS_LOOPBACK_ONLY: "1", BLOKS_COMPUTER_NAME: "Fixture Server" });
  t.after(() => h.stop());
  await relay.connection;

  // the Mac app, as the owner's device and as a member's
  const files = mkdtempSync(join(tmpdir(), "bloks-pair-cloud-ui-"));
  t.after(() => rmSync(files, { recursive: true, force: true }));
  writeFileSync(join(files, "index.html"), "<!doctype html><title>Fixture</title>");
  const app = await startRemoteProxy(
    { relayUrl: relay.url, relayToken: "fixture-relay-client", deviceId: "owner-device", deviceToken: OWNER },
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
  const at = async (proxy: { port: number }, path: string, init: { method?: string; body?: string } = {}) => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}${path}`, { ...init, headers: { "content-type": "application/json" } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // which computer, and that only Bloks Cloud reaches it: no restart to
  // wait for and no address a phone could dial
  const status = await at(app, "/api/pair");
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.here, false);
  assert.equal(status.body.computer, "Fixture Server");
  assert.equal(status.body.thisDevice, "owner-device");
  assert.equal(status.body.enabled, true);
  assert.equal(status.body.restartRequired, false);
  assert.equal(status.body.listening, "loopback");
  assert.deepEqual(status.body.addresses, []);
  assert.equal(cloudOnly(status.body), true);
  assert.equal(pairingAway(status.body), "Fixture Server");
  assert.equal((await at(app, "/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) })).status, 200);

  // a code is one no phone could trade in, so none is made
  const code = await at(app, "/api/pair/start", { method: "POST", body: "{}" });
  assert.equal(code.status, 409);
  assert.equal(code.body.code, "cloud-only");
  assert.match(code.body.error, /Pair with a link/);
  assert.equal((await h.json("/api/pair")).pending, false);
  assert.equal((await at(app, "/api/pair/cancel", { method: "POST", body: "{}" })).status, 200);

  // the link names the server's relay, not the app's own loopback
  const made = await at(app, "/api/pair/link", { method: "POST", body: "{}" });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const parsed = parsePairLink(made.body.link);
  assert.ok(parsed, "the link is not one a device can read");
  assert.equal(parsed.relayUrl, relay.url);
  assert.doesNotMatch(made.body.link, new RegExp(`127\\.0\\.0\\.1:${app.port}`));
  // and a phone that opens it is one of the owner's devices on the server
  const phone = await claimPairLink(made.body.link, "Owner's iPhone");
  assert.equal(phone.relayUrl, relay.url);
  const listed = (await h.json("/api/pair")).devices.map((d: { id: string; name: string }) => d.name);
  assert.ok(listed.includes("Owner's iPhone"), "the phone did not land on the server");

  // what would cut the device off stays with the server
  const off = await at(app, "/api/pair", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  assert.equal(off.status, 403);
  assert.match(off.body.error, /only on Fixture Server itself/);
  assert.equal((await at(app, "/api/pair/devices", { method: "DELETE" })).status, 403);
  assert.equal((await at(app, "/api/pair/devices/owner-device", { method: "DELETE" })).status, 403);
  assert.equal((await at(app, "/api/pair/devices/old-phone", { method: "DELETE" })).status, 200);
  assert.equal((await at(app, "/api/pair")).status, 200, "the device lost its own way in");

  // a member's Mac app through Bloks Cloud gets none of it
  for (const [method, path, body] of ROUTES) {
    const there = await at(member, path, { method, body });
    assert.notEqual(there.status, 200, `${method} ${path} answered a member's device through Bloks Cloud`);
    assert.doesNotMatch(JSON.stringify(there.body), /bloks_pair_|\/pair#/);
  }
});

describe("what the Phone access card says", () => {
  test("an older server's refusal is said plainly, never as its bare words", () => {
    const said = pairingTrouble(403, "not from here", "403 Forbidden");
    assert.equal(said, PAIRING_ELSEWHERE);
    assert.doesNotMatch(said, /not from here/);
    assert.match(said, /bloks-server pair/);
    // anything else the server says is already meant for the person
    assert.equal(pairingTrouble(409, "Turn on Bloks Cloud first", "409 Conflict"), "Turn on Bloks Cloud first");
    assert.equal(pairingTrouble(500, undefined, "500 Internal Server Error"), "500 Internal Server Error");
  });

  test("the computer is named only when it is not this one", () => {
    assert.equal(pairingAway({ enabled: true, here: false, computer: "Fixture Server" }), "Fixture Server");
    assert.equal(pairingAway({ enabled: true, here: true, computer: "Fixture Server" }), null);
    // an older server says nothing about it, and is taken as here
    assert.equal(pairingAway({ enabled: true }), null);
    assert.equal(pairingAway(null), null);
  });

  test("a link is the way only where nothing on the network answers", () => {
    assert.equal(cloudOnly({ enabled: true, restartRequired: false, listening: "loopback" }), true);
    assert.equal(cloudOnly({ enabled: true, restartRequired: false, listening: "network" }), false);
    // waiting on a restart is not a server that never listens
    assert.equal(cloudOnly({ enabled: true, restartRequired: true, listening: "loopback" }), false);
    assert.equal(cloudOnly({ enabled: false, restartRequired: false, listening: "loopback" }), false);
  });
});
