// Pausing an engine or a model for a while (server/engine-pauses.ts,
// based on GitHub 305): what a pause covers, who may make and end one and
// for how long, what survives a restart, and what a file that cannot be
// read does and does not hold up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  covers,
  EnginePauses,
  familyOf,
  MAX_PAUSES,
  MAX_SELF_PAUSES,
  PAUSE_MAX_MS,
  PauseRefusal,
  SELF_PAUSE_MAX_MS,
  type EnginePause,
} from "../server/engine-pauses.ts";

const HOUR = 60 * 60_000;
const OWNER = { kind: "owner" } as const;
const ADA = { kind: "agent", id: "bot_ada" } as const;
const claude = { instanceId: "claude", driver: "claudeAgent", model: "claude-opus-5.5" };
const codex = { instanceId: "codex", driver: "codex", model: "gpt-6-sol" };

function folder(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "bloks-pauses-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, "engine-pauses.json") };
}

const refused = (fn: () => unknown, status: number, words?: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof PauseRefusal && e.status === status && (!words || words.test(e.message)));

test("with nothing paused there is no file, nothing is held, and nothing is written", (t) => {
  const { file } = folder(t);
  const pauses = new EnginePauses(file);
  assert.equal(pauses.any(), false);
  assert.equal(pauses.holding("bot_ada", claude), null);
  assert.equal(pauses.nextEnd(), null);
  assert.equal(pauses.fault, null);
  assert.equal(existsSync(file), false, "looking wrote a file");
});

test("a family is told from the model's id first, then from the engine serving it", () => {
  assert.equal(familyOf("claudeAgent", "claude-opus-5.5"), "anthropic");
  assert.equal(familyOf("claudeAgent", "opus"), "anthropic");
  assert.equal(familyOf("openrouter", "anthropic/claude-sonnet-5"), "anthropic");
  assert.equal(familyOf("openrouter", "openai/gpt-6-luna"), "openai");
  assert.equal(familyOf("codex", "default"), "openai");
  assert.equal(familyOf("openrouter", "google/gemini-3.8-flash"), "google");
  assert.equal(familyOf("ollama", "qwen3:32b"), "qwen");
  assert.equal(familyOf("grok", "grok-4"), "xai");
  assert.equal(familyOf("custom", "my-house-model"), null, "a family nobody can tell is nobody's");
});

test("a pause covers what it names, for the agents it names", () => {
  const pause = (what: EnginePause["what"], agents: EnginePause["agents"] = "all"): EnginePause =>
    ({ id: "p", what, agents, until: Date.now() + HOUR, createdAt: Date.now(), by: "owner" });
  assert.equal(covers(pause({ family: "anthropic" }), "bot_ada", claude), true);
  assert.equal(covers(pause({ family: "anthropic" }), "bot_ada", codex), false);
  assert.equal(covers(pause({ driver: "codex" }), "bot_ada", codex), true);
  assert.equal(covers(pause({ instanceId: "claude" }), "bot_ada", claude), true);
  assert.equal(covers(pause({ instanceId: "claude", model: "claude-sonnet-5" }), "bot_ada", claude), false, "another model on the same engine still goes");
  assert.equal(covers(pause({ model: "claude-opus-5.5" }), "bot_ada", claude), true);
  assert.equal(covers(pause({ family: "anthropic" }, ["bot_ben"]), "bot_ada", claude), false);
  assert.equal(covers(pause({ family: "anthropic" }, ["bot_ada", "bot_ben"]), "bot_ada", claude), true);
});

test("the owner pauses anything for anyone, for a week at most, and the end that holds is the latest", (t) => {
  const { file } = folder(t);
  let now = 1_000_000;
  const pauses = new EnginePauses(file, () => now);
  refused(() => pauses.add(OWNER, { what: { instanceId: "claude" } }), 400, /needs an end/);
  refused(() => pauses.add(OWNER, { what: {}, minutes: 60 }), 400, /Say what to pause/);
  refused(() => pauses.add(OWNER, { what: { instanceId: "claude" }, until: now - 1 }), 400, /later than now/);
  refused(() => pauses.add(OWNER, { what: { instanceId: "claude" }, until: now + PAUSE_MAX_MS + 2 * 60_000 }), 400, /a week at most/);
  refused(() => pauses.add(OWNER, { what: { instanceId: "claude" }, minutes: 60, agents: ["bot_nobody"] }, (id) => id === "bot_ada"), 400, /No agent/);
  const short = pauses.add(OWNER, { what: { family: "anthropic" }, minutes: 60 });
  const long = pauses.add(OWNER, { what: { instanceId: "claude" }, agents: ["bot_ada"], until: now + PAUSE_MAX_MS, note: "plan nearly spent" });
  assert.equal(short.by, "owner");
  assert.equal(short.agents, "all");
  assert.equal(pauses.holding("bot_ada", claude)?.id, long.id, "the later end is when the engine is free");
  assert.equal(pauses.holding("bot_ben", claude)?.id, short.id);
  assert.equal(pauses.holding("bot_ben", codex), null);
  assert.equal(pauses.nextEnd(), short.until);
  now = short.until;
  assert.equal(pauses.holding("bot_ben", claude), null, "an ended pause holds nothing");
  assert.equal(pauses.nextEnd(), long.until);
  pauses.cancel(OWNER, long.id);
  assert.equal(pauses.holding("bot_ada", claude), null);
  assert.equal(pauses.any(), false);
});

test("an agent pauses only itself, for a day at most, sees only what covers it, and ends only its own", (t) => {
  const { file } = folder(t);
  const now = 5_000_000;
  const pauses = new EnginePauses(file, () => now);
  refused(() => pauses.add(ADA, { what: { instanceId: "claude" }, minutes: 60, agents: "all" }), 403, /only for itself/);
  refused(() => pauses.add(ADA, { what: { instanceId: "claude" }, minutes: 60, agents: ["bot_ben"] }), 403);
  refused(() => pauses.add(ADA, { what: { instanceId: "claude" }, minutes: 60, agents: ["bot_ada", "bot_ben"] }), 403);
  refused(() => pauses.add(ADA, { what: { instanceId: "claude" }, until: now + SELF_PAUSE_MAX_MS + 2 * 60_000 }), 400, /a day at most/);
  const own = pauses.add(ADA, { what: { instanceId: "claude" }, minutes: 24 * 60 });
  assert.deepEqual(own.agents, ["bot_ada"]);
  assert.equal(own.by, "bot_ada");
  assert.equal(pauses.holding("bot_ada", claude)?.id, own.id);
  assert.equal(pauses.holding("bot_ben", claude), null, "an agent's pause held up another agent");

  const forBen = pauses.add(OWNER, { what: { driver: "codex" }, minutes: 60, agents: ["bot_ben"] });
  const forBoth = pauses.add(OWNER, { what: { family: "google" }, minutes: 60, agents: ["bot_ada", "bot_ben"] });
  const forAll = pauses.add(OWNER, { what: { model: "grok-4" }, minutes: 60 });
  const seen = pauses.visibleTo(ADA);
  assert.deepEqual(seen.map((p) => p.id).sort(), [own.id, forBoth.id, forAll.id].sort(), "an agent saw a pause that is not about it");
  assert.deepEqual(seen.find((p) => p.id === forBoth.id)?.agents, ["bot_ada"], "an agent saw who else is paused");
  assert.equal(pauses.visibleTo(OWNER).length, 4);

  refused(() => pauses.cancel(ADA, forAll.id), 404);
  refused(() => pauses.cancel(ADA, forBen.id), 404);
  assert.equal(pauses.cancel(ADA, own.id).id, own.id);
  assert.equal(pauses.cancel(OWNER, forBen.id).id, forBen.id);
});

test("how many pauses there can be is bounded, for everyone and for one agent", (t) => {
  const { file } = folder(t);
  const pauses = new EnginePauses(file, () => 9_000_000);
  for (let i = 0; i < MAX_SELF_PAUSES; i++) pauses.add(ADA, { what: { model: `m-${i}` }, minutes: 30 });
  refused(() => pauses.add(ADA, { what: { model: "one-more" }, minutes: 30 }), 409, /at once/);
  for (let i = MAX_SELF_PAUSES; i < MAX_PAUSES; i++) pauses.add(OWNER, { what: { model: `m-${i}` }, minutes: 30 });
  refused(() => pauses.add(OWNER, { what: { model: "one-more" }, minutes: 30 }), 409, /Call one off first/);
});

test("pauses outlive a restart, and ones that ended or were called off do not", (t) => {
  const { file } = folder(t);
  let now = 20_000_000;
  const first = new EnginePauses(file, () => now);
  const kept = first.add(OWNER, { what: { family: "anthropic" }, agents: ["bot_ada"], minutes: 120, note: "until the reset" });
  const ending = first.add(OWNER, { what: { driver: "codex" }, minutes: 30 });
  const ended = first.add(OWNER, { what: { model: "grok-4" }, minutes: 60 });
  first.cancel(OWNER, ended.id);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).pauses.length, 2);

  now += 45 * 60_000;
  const second = new EnginePauses(file, () => now);
  assert.equal(second.fault, null);
  assert.deepEqual(second.visibleTo(OWNER).map((p) => p.id), [kept.id], `${ending.id} ended while Bloks was away`);
  assert.equal(second.holding("bot_ada", claude)?.note, "until the reset");

  // a deadline further off than anyone may set still holds, for a week
  const far = JSON.parse(readFileSync(file, "utf8"));
  far.pauses[0].until = now + 400 * 24 * HOUR;
  writeFileSync(file, JSON.stringify(far));
  assert.equal(new EnginePauses(file, () => now).holding("bot_ada", claude)?.until, now + PAUSE_MAX_MS);
});

test("a file that will not parse holds nothing, is kept aside, says so, and new pauses still save", (t) => {
  const { dir, file } = folder(t);
  writeFileSync(file, "{ not json");
  const now = 30_000_000;
  const pauses = new EnginePauses(file, () => now);
  assert.equal(pauses.any(), false);
  assert.equal(pauses.holding("bot_ada", claude), null, "an unreadable file stopped work");
  assert.match(pauses.fault ?? "", /could not be read, so none of them is in force/);
  assert.ok(readdirSync(dir).some((name) => name.startsWith("engine-pauses.json.corrupt-")), "the unreadable file was not kept");
  const added = pauses.add(OWNER, { what: { instanceId: "claude" }, minutes: 30 });
  assert.equal(new EnginePauses(file, () => now).holding("bot_ada", claude)?.id, added.id);
});

test("of a file with some pauses that cannot be read, the rest still hold", (t) => {
  const { dir, file } = folder(t);
  const now = 40_000_000;
  const good = { id: "p-good", what: { instanceId: "claude" }, agents: "all", until: now + HOUR, createdAt: now, by: "owner" };
  writeFileSync(file, JSON.stringify({ version: 1, pauses: [good, { id: "p-bad", what: "everything", until: "soon" }, 42] }));
  const pauses = new EnginePauses(file, () => now);
  assert.equal(pauses.holding("bot_ada", claude)?.id, "p-good", "a readable pause stopped holding");
  assert.equal(pauses.holding("bot_ada", codex), null);
  assert.match(pauses.fault ?? "", /2 saved engine pauses could not be read/);
  assert.ok(readdirSync(dir).some((name) => name.startsWith("engine-pauses.json.corrupt-")));
});

test("a file that cannot be opened holds nothing, and is never written over", (t) => {
  const { file } = folder(t);
  // a folder where the file should be: there, and unreadable as a file
  mkdirSync(file);
  const pauses = new EnginePauses(file, () => 50_000_000);
  assert.equal(pauses.any(), false);
  assert.equal(pauses.holding("bot_ada", claude), null);
  assert.match(pauses.fault ?? "", /could not be read \(EISDIR\)/);
  refused(() => pauses.add(OWNER, { what: { instanceId: "claude" }, minutes: 30 }), 503);
  assert.equal(pauses.any(), false, "a pause that could not be saved is in force");
});
