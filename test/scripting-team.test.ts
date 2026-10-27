// `bloks-server team apply`: a team file brought into a workspace as
// often as you like, changing only what differs (server/team-apply.ts),
// against the real server, and the plan itself as a plain function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { cli, scriptingWorkspace } from "./helpers/scripting.ts";
import { parseTeamFile } from "../server/team-file.ts";
import { drawNames, NAME_POOL, planLines, planTeam, statedLooks, TeamPlanError, type TeamWorld } from "../server/team-apply.ts";
import { NAME_POOL as DIALOG_POOL } from "../src/lib/teamLibrary.ts";

const FILE = `---
name: Launch crew
blurb: Ships a product launch, end to end.
---

## Launch lead
seniority: 5
look: blue star

Runs the launch and makes the call.

## Writer
name: Quill
skills:
- Short sentences

Writes the announcement.
`;

const roomsNamed = async (h: { json: (p: string) => Promise<any> }, name: string) =>
  ((await h.json("/api/bloks?messages=0")).bloks as any[]).filter((b) => b.name === name);

test("apply makes the room and its agents; a dry run first changes nothing", async (t) => {
  const { h, home } = await scriptingWorkspace(t);
  const file = join(home, "team.md");
  writeFileSync(file, FILE);
  const dry = await cli(h, ["team", "apply", file, "--dry-run"]);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /\+ room Launch crew/);
  assert.match(dry.out, /\+ hire a new agent as Launch lead/);
  assert.match(dry.out, /\+ hire Quill as Writer/);
  assert.match(dry.out, /Dry run: nothing was changed/);
  assert.equal((await roomsNamed(h, "Launch crew")).length, 0, "a dry run made the room");

  const applied = await cli(h, ["team", "apply", file]);
  assert.equal(applied.code, 0, applied.err);
  const [room] = await roomsNamed(h, "Launch crew");
  assert.ok(room, applied.out);
  const { bots } = await h.json("/api/bots?messages=0");
  const members = room.memberIds.map((id: string) => bots.find((b: any) => b.id === id));
  assert.equal(members.length, 2);
  const lead = members.find((b: any) => b.title === "Launch lead");
  const quill = members.find((b: any) => b.name === "Quill");
  assert.ok(lead && quill);
  // an unnamed member gets a name the way the hire dialog would give one
  assert.ok((NAME_POOL as readonly string[]).includes(lead.name));
  assert.equal(lead.color, "blue");
  assert.equal(quill.description, "Writes the announcement.");
  assert.deepEqual(quill.skills, ["Short sentences"]);
  assert.equal(room.leadId, lead.id);
  const said = (await h.json(`/api/bloks/${room.id}/messages`)).messages as any[];
  assert.ok(said.some((m) => m.text === "The brief for this team: Ships a product launch, end to end."));
});

test("applying the same file again changes nothing; an edit changes only that", async (t) => {
  const { h, home } = await scriptingWorkspace(t);
  const file = join(home, "team.md");
  writeFileSync(file, FILE);
  assert.equal((await cli(h, ["team", "apply", file])).code, 0);
  const before = (await h.json("/api/bots?messages=0")).bots.length;

  const again = await cli(h, ["team", "apply", file]);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /Launch crew already matches the file\. Nothing to change\./);
  assert.equal((await h.json("/api/bots?messages=0")).bots.length, before, "a second apply hired again");
  assert.equal((await roomsNamed(h, "Launch crew")).length, 1);

  writeFileSync(file, FILE.replace("Writes the announcement.", "Writes the announcement and the FAQ."));
  const dry = await cli(h, ["team", "apply", file, "--dry-run", "--json"]);
  const plan = JSON.parse(dry.out);
  assert.equal(plan.applied, false);
  assert.deepEqual(plan.changes.map((c: any) => c.kind), ["update"]);
  assert.deepEqual(plan.changes[0].fields.map((f: any) => f.field), ["description"]);
  const edited = await cli(h, ["team", "apply", file]);
  assert.equal(edited.code, 0, edited.err);
  assert.match(edited.out, /~ Quill/);
  assert.match(edited.out, /Applied 1 change\./);
  const quill = (await h.json("/api/bots?messages=0")).bots.find((b: any) => b.name === "Quill");
  assert.equal(quill.description, "Writes the announcement and the FAQ.");
});

test("an agent the file no longer lists is kept; --prune takes it out of the room only with --yes, and never deletes it", async (t) => {
  const { h, home } = await scriptingWorkspace(t);
  const file = join(home, "team.md");
  writeFileSync(file, `${FILE}\n## Designer\nname: Pixel\n\nDraws things.\n`);
  assert.equal((await cli(h, ["team", "apply", file])).code, 0);
  writeFileSync(file, FILE);
  const kept = await cli(h, ["team", "apply", file]);
  assert.equal(kept.code, 0, kept.err);
  assert.match(kept.out, /Pixel is in the room but not in the file; kept/);
  assert.equal((await roomsNamed(h, "Launch crew"))[0].memberIds.length, 3);

  const unsure = await cli(h, ["team", "apply", file, "--prune"]);
  assert.equal(unsure.code, 2);
  assert.match(unsure.err, /--yes/);
  const pruned = await cli(h, ["team", "apply", file, "--prune", "--yes"]);
  assert.equal(pruned.code, 0, pruned.err);
  assert.match(pruned.out, /- Pixel leaves the room \(the agent is kept\)/);
  assert.equal((await roomsNamed(h, "Launch crew"))[0].memberIds.length, 2);
  const pixel = (await h.json("/api/bots?messages=0")).bots.find((b: any) => b.name === "Pixel");
  assert.ok(pixel && !pixel.archivedAt, "pruning deleted or archived the agent");
});

test("a file that is not a team says which line, and changes nothing", async (t) => {
  const { h, home } = await scriptingWorkspace(t);
  const file = join(home, "team.md");
  writeFileSync(file, "---\nname: Two\n---\n\n## One\nseniority: 9\n\nDoes it.\n\n## Two\n\nAlso.\n");
  const bad = await cli(h, ["team", "apply", file]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /line 5/);
  const missing = await cli(h, ["team", "apply", join(home, "nothing.md")]);
  assert.equal(missing.code, 2);
});

// ── the plan, without a server ──

const world = (extra: Partial<TeamWorld> = {}): TeamWorld => ({ agents: [], rooms: [], ...extra });
const agent = (id: string, name: string, title: string, more: Record<string, unknown> = {}) => ({
  id, name, title, description: "", skills: [], seniority: 1, color: "green", shape: "star", archived: false, placeable: true, ...more,
});

test("a named member is matched by its name anywhere in the workspace, an unnamed one by its role in the room", () => {
  const team = parseTeamFile(FILE);
  const quill = agent("q", "quill", "Something else", { description: "Old." });
  const lead = agent("l", "Juno", "Launch lead", { seniority: 5, color: "blue", shape: "star", description: "Runs the launch and makes the call." });
  const plan = planTeam(team, world({
    agents: [quill, lead],
    rooms: [{ id: "r", name: "launch crew", memberIds: ["l"], leadId: "l", archived: false, brief: "Ships a product launch, end to end." }],
  }), { looks: statedLooks(FILE) });
  assert.deepEqual(plan.seats, ["l", "q"]);
  assert.deepEqual(plan.changes.map((c) => c.kind), ["join", "update"]);
  assert.deepEqual(plan.unchanged, ["Juno"]);
  const update = plan.changes.find((c) => c.kind === "update")!;
  // Quill's file section says no look, so its own colour stays its own
  assert.ok(update.kind === "update" && !update.fields.some((f) => f.field === "color" || f.field === "shape"));
  assert.ok(planLines(plan).some((l) => l.startsWith("~ quill")));
});

test("the plan refuses what a room cannot hold, and a name used twice", () => {
  const team = parseTeamFile(FILE);
  const crowd = Array.from({ length: 7 }, (_, i) => agent(`a${i}`, `A${i}`, `Role ${i}`));
  assert.throws(
    () => planTeam(team, world({ agents: crowd, rooms: [{ id: "r", name: "Launch crew", memberIds: crowd.map((a) => a.id), leadId: null, archived: false, brief: null }] })),
    TeamPlanError,
  );
  const twice = parseTeamFile(FILE.replace("## Launch lead\n", "## Launch lead\nname: Quill\n"));
  assert.throws(() => planTeam(twice, world()), /both called Quill/);
});

test("names are drawn from the hire dialog's pool, never one already taken", () => {
  assert.deepEqual([...NAME_POOL], [...DIALOG_POOL], "the server's pool drifted from the dialog's");
  const taken = NAME_POOL.slice(0, NAME_POOL.length - 1);
  const drawn = drawNames(3, taken, () => 0.5);
  assert.equal(drawn[0], NAME_POOL.at(-1));
  assert.equal(new Set(drawn.map((n) => n.toLowerCase())).size, 3);
  for (const name of drawn.slice(1)) assert.ok(!taken.map((n) => n.toLowerCase()).includes(name.toLowerCase()));
});
