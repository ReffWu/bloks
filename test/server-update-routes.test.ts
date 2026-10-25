// Updating the server from the app, through the real server (GitHub 396):
// the owner sees which version the server runs, asks GitHub for a newer
// one and reads its notes, at this computer or from one of their own
// paired devices. Nobody unpaired, no member and no agent gets any of it,
// and a server that may not update itself (this harness was not started
// by bloks-server) says why and installs nothing.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { JoinClient } from "../server/join-client.ts";
import { startHarness } from "./helpers/server.ts";
import { teamPlan } from "./helpers/team-plan.ts";

test("the owner checks for a newer server from here or a paired device; nobody else reaches it", { timeout: 120_000 }, async (t) => {
  // GitHub's latest release, on loopback
  const release = {
    tag_name: "v99.0.0",
    draft: false,
    prerelease: false,
    body: "Notes for the fixture release.",
    html_url: "https://github.com/hamedgitty/bloks/releases/tag/v99.0.0",
    assets: [{ name: "bloks-server-99.0.0.tar.gz", size: 10 }, { name: "bloks-server-99.0.0.tar.gz.sha256", size: 90 }],
  };
  let asked = 0;
  const github = createServer((req, res) => {
    asked++;
    res.setHeader("content-type", "application/json");
    res.end(req.url === "/releases/latest" ? JSON.stringify(release) : "{}");
  });
  await new Promise<void>((r) => github.listen(0, "127.0.0.1", () => r()));
  t.after(() => {
    github.closeAllConnections();
    github.close();
  });
  const base = `http://127.0.0.1:${(github.address() as AddressInfo).port}`;

  const home = mkdtempSync(join(tmpdir(), "bloks-update-routes-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const licence = await teamPlan();
  t.after(() => licence.close());
  mkdirSync(join(home, ".bloks"));
  writeFileSync(join(home, ".bloks", "config.json"), JSON.stringify({ remote: { enabled: true }, profile: { name: "Owner" }, ...licence.config }));
  const h = await startHarness({
    HOME: home,
    ...licence.env,
    BLOKS_COMPUTER_NAME: "Fixture Server",
    BLOKS_RELEASES_URL: `${base}/releases/latest`,
    BLOKS_RELEASE_DOWNLOADS: `${base}/download`,
  });
  t.after(() => h.stop());

  // ── here: the version, the computer, and why it does not update itself ──
  const here = await h.json("/api/server-update");
  assert.equal(here.computer, "Fixture Server");
  assert.match(here.version, /^\d+\.\d+\.\d+$/);
  assert.equal(here.install.kind, "unknown", "a server not started by bloks-server");
  assert.equal(here.install.canInstall, false);
  assert.equal(here.check, null, "nothing is asked of GitHub until someone checks");
  assert.equal(asked, 0);

  // ── unpaired: nothing ──
  for (const [method, path] of [["GET", "/api/server-update"], ["POST", "/api/server-update/check"], ["POST", "/api/server-update/install"]]) {
    const res = await h.fetchRemote(path, { method, body: method === "POST" ? "{}" : undefined });
    assert.ok(res.status === 401 || res.status === 403, `${method} ${path} answered ${res.status}`);
  }

  // ── the owner's own device: the same, and a check ──
  await h.fetch("/api/pair", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  const started = await h.json("/api/pair/start", { method: "POST" });
  const paired = await h.fetchRemote("/api/pair/claim", { method: "POST", body: JSON.stringify({ code: started.code, device: "Owner's MacBook" }) });
  const owner = paired.body?.token as string;
  assert.ok(owner, "the fixture device did not pair");
  const checked = await h.fetchRemote("/api/server-update/check", { method: "POST", token: owner, body: "{}" });
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  assert.equal(checked.body.check.newer, true);
  assert.equal(checked.body.check.latest.version, "99.0.0");
  assert.equal(checked.body.check.latest.notes, "Notes for the fixture release.");
  assert.equal(checked.body.check.latest.checksum, true);
  assert.ok(checked.body.steps.some((line: string) => line.includes(`${base}/download/v99.0.0/bloks-server-99.0.0.tar.gz`)), "the steps by hand");
  // installing is refused, with the reason, and nothing starts
  const install = await h.fetchRemote("/api/server-update/install", { method: "POST", token: owner, body: JSON.stringify({ version: "99.0.0" }) });
  assert.equal(install.status, 409);
  assert.match(install.body.error, /not started with bloks-server/);
  assert.equal((await h.json("/api/server-update")).job, null);

  // ── a member: refused on their device and with their credential here ──
  const lan = new URL(h.url).host;
  const made = await h.json("/api/workspace/invites", { method: "POST", body: JSON.stringify({ role: "admin", name: "Sam" }) });
  const client = new JoinClient(() => "http://127.0.0.1:9");
  const found = (await client.lookup(`${made.invite.link}~${lan}`)) as any;
  assert.ok(found.ok, JSON.stringify(found));
  await client.claim(found.session, { name: "Sam" });
  assert.equal((await h.fetch(`/api/workspace/requests/${made.invite.id}/approve`, { method: "POST" })).status, 200);
  const sam = ((await client.status(found.session)) as any).credentials as { deviceToken: string };
  const before = asked;
  for (const [method, path] of [["GET", "/api/server-update"], ["POST", "/api/server-update/check"], ["POST", "/api/server-update/install"], ["DELETE", "/api/server-update/install"]]) {
    const body = method === "POST" ? JSON.stringify({ version: "99.0.0" }) : undefined;
    const there = await h.fetchRemote(path, { method, token: sam.deviceToken, body });
    assert.notEqual(there.status, 200, `a member's device reached ${method} ${path}`);
    assert.notEqual(there.status, 202, `a member's device reached ${method} ${path}`);
    const local = await h.fetch(path, { method, headers: { authorization: `Bearer ${sam.deviceToken}` }, body });
    assert.equal(local.status, 403, `a member's credential on this computer reached ${method} ${path}`);
  }
  assert.equal(asked, before, "a member made the server ask GitHub");
});
