// The catalogue through the real server: browsing, the review, the
// install and what it creates, updates, a fingerprint that does not
// match, offline from the cache, links and files, and sharing back.
//
// The catalogue is served from this process, never the internet, and
// changed between requests the way a pull request would change it.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { describe, test } from "node:test";

import { buildIndex, serializeIndex, writeSkillFile } from "../server/catalog.ts";
import { parseTeamFile } from "../server/team-file.ts";
import { startHarness } from "./helpers/server.ts";

const TIDY = writeSkillFile({
  name: "tidy",
  title: "Tidy",
  description: "Tidy a draft before it goes",
  body: "Use this when a draft is messy.\n\n1. Tidy it.\n\nNot for: a clean draft.\nReturn: the draft.\nApproval: none needed.",
  version: "1",
  author: "Tests",
  tags: ["writing"],
});

const CREW = `---
name: Crew
blurb: A crew for tests.
tags: testing
author: Tests
version: 1
routine: weekdays 09:30 | Stand-up | One line each.
---

## Lead
seniority: 5
look: blue star
uses: tidy
routine: fri 16:00 | Status | Write the status.

Leads the crew.

## Writer
seniority: 2
look: coral drop
uses: tidy

Writes for the crew.
`;

/** A catalogue on this machine, whose files a test can change. */
async function catalogue(t: { after: (fn: () => void) => void }, files: Record<string, string>) {
  const state = { files: { ...files }, index: "" as string | null, up: true };
  const rebuild = () => {
    const built = buildIndex(Object.entries(state.files).map(([path, text]) => ({ path, bytes: new TextEncoder().encode(text) })));
    assert.deepEqual(built.problems, []);
    state.index = serializeIndex(built.index);
  };
  rebuild();
  const server: Server = createServer((req, res) => {
    if (!state.up) {
      req.socket.destroy();
      return;
    }
    const path = decodeURIComponent((req.url ?? "").replace(/^\/c\//, ""));
    const body = path === "index.json" ? state.index : state.files[path];
    if (body == null) {
      res.writeHead(404);
      return res.end("missing");
    }
    res.writeHead(200, { "content-type": path.endsWith(".json") ? "application/json" : "text/markdown" });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/c/index.json`;
  return { state, rebuild, url };
}

describe("the catalogue", () => {
  test("browse, review and install a team: agents, a room, its skills, routines paused, connections off", async (t) => {
    const cat = await catalogue(t, { "teams/crew.md": CREW, "skills/tidy/SKILL.md": TIDY });
    const h = await startHarness({ BLOKS_CATALOG_URL: cat.url });
    try {
      const list = await h.json("/api/catalog");
      assert.equal(list.offline, false);
      assert.deepEqual(list.items.map((i: any) => `${i.kind}:${i.id}:${i.standing.state}`), ["team:crew:available", "skill:tidy:available"]);

      const { review } = await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ kind: "team", id: "crew" }) });
      assert.equal(review.origin, "catalogue");
      assert.equal(review.update, null);
      assert.deepEqual(review.plan.agents.map((a: any) => a.title), ["Lead", "Writer"]);
      assert.equal(review.plan.room.name, "Crew");
      assert.deepEqual(review.plan.skills.map((s: any) => [s.id, s.state]), [["tidy", "install"]]);
      assert.match(review.plan.skills[0].body, /Use this when a draft is messy/, "the skill is there to read");
      assert.deepEqual(review.plan.routines.map((r: any) => r.summary), ["Weekdays at 09:30", "Every Friday at 16:00"]);

      // reviewing creates nothing
      assert.equal((await h.json("/api/bloks")).bloks.length, 0);
      assert.ok(!(await h.json("/api/skills")).skills.some((s: any) => s.id === "tidy"));

      const { result } = await h.json("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: review.token, names: ["Ada", "Bo"] }) });
      assert.equal(result.botIds.length, 2);
      assert.deepEqual(result.skillIds, ["tidy"]);
      assert.equal(result.routineIds.length, 2);

      const { bloks } = await h.json("/api/bloks");
      const room = bloks.find((b: any) => b.id === result.roomId);
      assert.equal(room.name, "Crew");
      assert.deepEqual(room.memberIds, result.botIds);
      const { bots } = await h.json("/api/bots");
      const hired = result.botIds.map((id: string) => bots.find((b: any) => b.id === id));
      assert.deepEqual(hired.map((b: any) => b.name), ["Ada", "Bo"]);
      for (const bot of hired) {
        assert.equal(bot.composio, false, "connected apps start off");
        assert.equal(bot.browser, false, "the browser starts off");
        assert.deepEqual(bot.mcpServers, [], "tool servers start off");
        assert.deepEqual(bot.skillIds, ["tidy"], "and the skill it uses is attached");
      }
      const { routines } = await h.json("/api/routines");
      assert.equal(routines.length, 2);
      assert.ok(routines.every((r: any) => r.enabled === false), "every routine starts paused");
      assert.deepEqual(routines.map((r: any) => r.targetKind).sort(), ["agent", "room"]);
      const skill = (await h.json("/api/skills")).skills.find((s: any) => s.id === "tidy");
      assert.equal(skill.name, "Tidy");
      assert.equal(skill.registry, "tidy", "a catalogue skill remembers where it came from");

      // and now the catalogue says so
      const after = await h.json("/api/catalog");
      assert.deepEqual(after.items.map((i: any) => i.standing.state), ["current", "current"]);
      // a review is used once
      const again = await h.fetch("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: review.token }) });
      assert.equal(again.status, 410);
    } finally {
      await h.stop();
    }
  });

  test("an updated team is offered as an update that says what changed, and keeps what you changed", async (t) => {
    const cat = await catalogue(t, { "teams/crew.md": CREW, "skills/tidy/SKILL.md": TIDY });
    const h = await startHarness({ BLOKS_CATALOG_URL: cat.url });
    try {
      const first = (await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ kind: "team", id: "crew" }) })).review;
      const { result } = await h.json("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: first.token, names: ["Ada", "Bo"] }) });
      const [leadId, writerId] = result.botIds;
      // the person rewrites the writer here
      await h.json(`/api/bots/${writerId}`, { method: "PATCH", body: JSON.stringify({ description: "Writes only haiku." }) });

      // version 2: the lead changes, the writer changes, a checker joins
      cat.state.files["teams/crew.md"] = CREW.replace("version: 1", "version: 2")
        .replace("Leads the crew.", "Leads the crew, and reviews.")
        .replace("Writes for the crew.", "Writes for the crew, briefly.")
        .concat("\n## Checker\nseniority: 2\n\nChecks the crew's work.\n");
      cat.rebuild();
      const list = await h.json("/api/catalog?refresh=1");
      const crew = list.items.find((i: any) => i.id === "crew");
      assert.equal(crew.standing.state, "outdated");
      assert.equal(crew.standing.action, "Update");
      assert.equal(list.updates, 1);

      const { review } = await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ kind: "team", id: "crew" }) });
      assert.ok(review.update, "it is an update");
      assert.equal(review.update.roomId, result.roomId);
      assert.equal(review.update.version, "1");
      assert.deepEqual(review.update.changes.map((c: any) => `${c.kind} ${c.title}`).sort(), ["added Checker", "changed Lead", "changed Writer"]);
      assert.ok(review.update.diff.some((l: any) => l.kind === "add" && l.text === "## Checker"));

      const done = (await h.json("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: review.token, mode: "update", names: ["Ada", "Bo", "Cy"] }) })).result;
      assert.equal(done.roomId, result.roomId, "onto the same room");
      assert.equal(done.botIds.length, 1, "one new agent, for the checker");
      assert.match(done.notes.join(" "), /keeps your version/);
      const { bots } = await h.json("/api/bots");
      assert.equal(bots.find((b: any) => b.id === leadId).description, "Leads the crew, and reviews.");
      assert.equal(bots.find((b: any) => b.id === writerId).description, "Writes only haiku.", "your edit stays");
      const room = (await h.json("/api/bloks")).bloks.find((b: any) => b.id === result.roomId);
      assert.equal(room.memberIds.length, 3);
      assert.equal((await h.json("/api/routines")).routines.length, 2, "no routine added twice");
      assert.equal((await h.json("/api/catalog")).items.find((i: any) => i.id === "crew").standing.state, "current");
    } finally {
      await h.stop();
    }
  });

  test("a file that does not match its fingerprint is refused, and nothing is installed", async (t) => {
    const cat = await catalogue(t, { "teams/crew.md": CREW, "skills/tidy/SKILL.md": TIDY });
    // the file changes after the index was made
    cat.state.files["skills/tidy/SKILL.md"] = TIDY.replace("Tidy it.", "Send the draft to someone first.");
    const h = await startHarness({ BLOKS_CATALOG_URL: cat.url });
    try {
      const res = await h.fetch("/api/catalog/review", { method: "POST", body: JSON.stringify({ kind: "skill", id: "tidy" }) });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /fingerprint/);
      // a team that uses it leaves it out, and says why
      const { review } = await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ kind: "team", id: "crew" }) });
      assert.deepEqual(review.plan.skills.map((s: any) => s.state), ["missing"]);
      assert.match(review.plan.skills[0].says, /fingerprint/);
      const { result } = await h.json("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: review.token }) });
      assert.deepEqual(result.skillIds, []);
      assert.ok(!(await h.json("/api/skills")).skills.some((s: any) => s.id === "tidy"));
    } finally {
      await h.stop();
    }
  });

  test("offline, the catalogue opens from its copy and what was kept still installs", async (t) => {
    const cat = await catalogue(t, { "teams/crew.md": CREW, "skills/tidy/SKILL.md": TIDY });
    const h = await startHarness({ BLOKS_CATALOG_URL: cat.url });
    try {
      await h.json("/api/catalog");
      // the items are fetched in the background; wait for them to be kept
      for (let i = 0; i < 100; i++) {
        const { items } = await h.json("/api/catalog");
        if (items.every((x: any) => x.offline)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      cat.state.up = false;
      const list = await h.json("/api/catalog?refresh=1");
      assert.equal(list.offline, true);
      assert.equal(list.items.length, 2);
      assert.ok(list.items.every((x: any) => x.offline), "both kept here");
      const { review } = await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ kind: "skill", id: "tidy" }) });
      const { result } = await h.json("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: review.token }) });
      assert.deepEqual(result.skillIds, ["tidy"]);
    } finally {
      await h.stop();
    }
  });

  test("a catalogue that never answered is a bad gateway with a reason", async () => {
    const h = await startHarness();
    try {
      const res = await h.fetch("/api/catalog");
      assert.equal(res.status, 502);
      assert.match((await res.json()).error, /could not be reached/);
    } finally {
      await h.stop();
    }
  });

  test("a link must be https, and a file goes through the same review", async () => {
    const h = await startHarness();
    try {
      const plain = await h.fetch("/api/catalog/review", { method: "POST", body: JSON.stringify({ url: "http://example.com/teams/crew.md" }) });
      assert.equal(plain.status, 400);
      assert.match((await plain.json()).error, /https/);

      // a SKILL.md from a file: reviewed, then installed as the person's own
      const skill = (await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ text: TIDY, filename: "SKILL.md" }) })).review;
      assert.equal(skill.kind, "skill");
      assert.equal(skill.origin, "file");
      assert.equal(skill.plan.standing.state, "available");
      await h.json("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: skill.token }) });
      const tidy = (await h.json("/api/skills")).skills.find((s: any) => s.id === "tidy");
      assert.ok(tidy && !tidy.registry, "a file is not the catalogue");
      // a plain file with no top block takes its name from the file
      const notes = (await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ text: "Use this when notes pile up.\n\n1. File them.", filename: "Desk Notes.md" }) })).review;
      assert.equal(notes.plan.skill.id, "desk-notes");
      await h.json("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: notes.token }) });
      assert.ok((await h.json("/api/skills")).skills.some((s: any) => s.id === "desk-notes"), "installed under the id the review showed");

      // a team file with a mistake says which line, the way the hire dialog does
      const bad = await h.fetch("/api/catalog/review", { method: "POST", body: JSON.stringify({ text: CREW.replace("seniority: 5", "seniority: 9"), filename: "crew.md" }) });
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error, /Seniority in the Lead section/);
      const big = await h.fetch("/api/catalog/review", { method: "POST", body: JSON.stringify({ text: "x".repeat(100 * 1024), filename: "a.md" }) });
      assert.equal(big.status, 413);

      // a team from a file uses the library's skill of that name
      const team = (await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ text: CREW, filename: "crew.md" }) })).review;
      assert.equal(team.kind, "team");
      assert.deepEqual(team.plan.skills.map((s: any) => s.state), ["installed"]);
    } finally {
      await h.stop();
    }
  });

  test("share as file writes the catalogue's format, without secrets or the hire's brief", async (t) => {
    const cat = await catalogue(t, { "teams/crew.md": CREW, "skills/tidy/SKILL.md": TIDY });
    const h = await startHarness({ BLOKS_CATALOG_URL: cat.url });
    try {
      const { review } = await h.json("/api/catalog/review", { method: "POST", body: JSON.stringify({ kind: "team", id: "crew" }) });
      const { result } = await h.json("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: review.token, names: ["Ada", "Bo"] }) });
      await h.json(`/api/bots/${result.botIds[0]}`, {
        method: "PATCH",
        body: JSON.stringify({ description: "Leads the crew. Reach me at ada@example.com.\n\nWhat this team is working on: our secret launch." }),
      });
      const res = await h.fetch(`/api/bloks/${result.roomId}/team.md`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.doesNotMatch(text, /ada@example\.com|secret launch/);
      const back = parseTeamFile(text);
      assert.equal(back.blurb, "A crew for tests.");
      assert.deepEqual(back.members.map((m) => m.uses), [["tidy"], ["tidy"]]);
      assert.equal(back.routines?.length, 1, "the room's routine");
      assert.equal(back.members[0].routines?.length, 1, "and the one the install filed for the lead");

      const skill = await h.fetch("/api/skills/tidy/skill.md");
      assert.equal(skill.status, 200);
      const skillText = await skill.text();
      assert.match(skillText, /^---\nname: tidy\ndescription: Tidy a draft before it goes\n/);
      assert.match(skillText, /\n {2}title: Tidy\n/);
      assert.equal((await h.fetch("/api/skills/nope/skill.md")).status, 404);
    } finally {
      await h.stop();
    }
  });

  test("the catalogue's address can be changed, to https only, and put back", async () => {
    const h = await startHarness({ BLOKS_CATALOG_URL: "" });
    try {
      const before = await h.json("/api/catalog/source");
      assert.equal(before.url, before.default);
      assert.match(before.default, /^https:\/\/raw\.githubusercontent\.com\/hamedgitty\/bloks\/main\/catalog\/index\.json$/);
      const refused = await h.fetch("/api/catalog/source", { method: "PUT", body: JSON.stringify({ url: "http://example.com/index.json" }) });
      assert.equal(refused.status, 400);
      const set = await h.json("/api/catalog/source", { method: "PUT", body: JSON.stringify({ url: "https://example.com/team/index.json" }) });
      assert.equal(set.url, "https://example.com/team/index.json");
      const reset = await h.json("/api/catalog/source", { method: "PUT", body: JSON.stringify({ url: "" }) });
      assert.equal(reset.url, before.default);
    } finally {
      await h.stop();
    }
  });
});
