// Every version of every skill, and how often each one is used.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_REVISIONS, SkillHistory, oneLine, sameText } from "../server/skill-history.ts";
import { SkillUsage, skillsNamed } from "../server/skill-usage.ts";

const fresh = () => new SkillHistory(mkdtempSync(join(tmpdir(), "bloks-skill-history-")));
const text = (body: string, name = "Release notes", description = "Writing a release note") => ({ name, description, body });
const you = { by: { kind: "person" as const, name: "you" }, why: "Edited" };

describe("a skill written before versions existed", () => {
  test("comes in as version 1, word for word", () => {
    const history = fresh();
    const before = text("Lead with what broke.\n\nPut the version at the top.");
    const first = history.sync("release-notes", before, 1_000);
    assert.equal(first.n, 1);
    assert.equal(first.by.kind, "migration");
    assert.ok(sameText(first, before), "the text changed on the way in");
    assert.equal(first.at, 1_000);
  });

  test("and reading it again does not make another", () => {
    const history = fresh();
    history.sync("release-notes", text("One."));
    history.sync("release-notes", text("One."));
    assert.equal(history.revisions("release-notes").length, 1);
  });
});

describe("changes", () => {
  test("each one is the next number, with who and why", () => {
    const history = fresh();
    history.sync("notes", text("One."));
    const second = history.record("notes", text("Two."), { by: { kind: "agent", name: "Scout", botId: "b1" }, why: "Put the version first" });
    assert.equal(second.n, 2);
    assert.equal(second.by.name, "Scout");
    assert.equal(second.why, "Put the version first");
    assert.equal(history.latest("notes")?.body, "Two.");
    assert.equal(history.get("notes", 1)?.body, "One.", "the old text is kept whole");
  });

  test("saving the same text again is not a change", () => {
    const history = fresh();
    history.sync("notes", text("One."));
    const same = history.record("notes", text("One.  "), you);
    assert.equal(same.n, 1);
    assert.equal(history.revisions("notes").length, 1);
  });

  test("a hand edit to the file is kept as its own version before anything is written over it", () => {
    const history = fresh();
    history.sync("notes", text("One."));
    const drifted = history.sync("notes", text("One, edited in a text editor."));
    assert.equal(drifted.n, 2);
    assert.equal(drifted.by.kind, "file");
    assert.match(drifted.why, /outside Bloks/);
  });

  test("a restore is a new version that says what it put back", () => {
    const history = fresh();
    history.sync("notes", text("One."));
    history.record("notes", text("Two."), you);
    const back = history.record("notes", text("One."), { ...you, why: "Restored version 1", restoredFrom: 1 });
    assert.equal(back.n, 3);
    assert.equal(back.restoredFrom, 1);
    assert.equal(history.revisions("notes").length, 3, "nothing was removed to restore");
  });

  test("the reason is one line, and has a default", () => {
    assert.equal(oneLine("  put the\nversion   first ", "x"), "put the version first");
    assert.equal(oneLine("", "Edited"), "Edited");
    assert.equal(oneLine(undefined, "Edited"), "Edited");
    assert.equal([...oneLine("y".repeat(500), "x")].length, 200);
  });
});

describe("what is kept", () => {
  test("past the limit the oldest go, except the first, and numbers never move", () => {
    const history = fresh();
    history.sync("notes", text("v1"));
    for (let i = 2; i <= MAX_REVISIONS + 10; i++) history.record("notes", text(`v${i}`), you);
    const kept = history.revisions("notes");
    assert.equal(kept.length, MAX_REVISIONS);
    assert.equal(kept[0].n, 1, "the first version is the one most worth comparing against");
    assert.equal(kept[kept.length - 1].n, MAX_REVISIONS + 10);
    assert.equal(history.get("notes", MAX_REVISIONS + 10)?.body, `v${MAX_REVISIONS + 10}`);
    assert.equal(history.get("notes", 2), null);
    assert.equal(history.pruned("notes"), true);
  });

  test("a removed skill keeps its versions, and one added again carries on from them", () => {
    const history = fresh();
    history.sync("notes", text("One."));
    history.record("notes", text("Two."), you);
    history.removed("notes");
    assert.equal(history.revisions("notes").length, 2);
    const again = history.record("notes", text("Three."), you);
    assert.equal(again.n, 3);
  });

  test("a record cannot be written outside its folder", () => {
    const history = fresh();
    assert.throws(() => history.sync("../escape", text("x")), /not a skill id/);
    assert.throws(() => history.record("a/b", text("x"), you), /not a skill id/);
  });

  test("a damaged record is set aside rather than trusted, and starts again from the skill", () => {
    const history = fresh();
    writeFileSync(join(history.dir, "notes.json"), "{ not json");
    const first = history.sync("notes", text("One."));
    assert.equal(first.n, 1);
    assert.equal(first.by.kind, "migration");
  });

  test("survives being opened again", () => {
    const history = fresh();
    history.sync("notes", text("One."));
    history.record("notes", text("Two."), you);
    const reopened = new SkillHistory(history.dir);
    assert.deepEqual(reopened.revisions("notes").map((r) => r.body), ["One.", "Two."]);
    assert.deepEqual(reopened.ids(), ["notes"]);
    // whole texts, so a restore is a copy and nothing has to be replayed
    const saved = JSON.parse(readFileSync(join(history.dir, "notes.json"), "utf8"));
    assert.equal(saved.revisions[0].body, "One.");
  });
});

describe("how often a skill is used", () => {
  const usage = () => new SkillUsage(join(mkdtempSync(join(tmpdir(), "bloks-skill-usage-")), "skill-usage.json"));

  test("by skill and by version, with when it was last used", () => {
    const counts = usage();
    counts.used("notes", 1, 1_000);
    counts.used("notes", 1, 2_000);
    counts.used("notes", 2, 3_000);
    const seen = counts.of("notes");
    assert.deepEqual(seen.total, { uses: 3, corrected: 0, lastUsed: 3_000 });
    assert.equal(seen.revisions[1].uses, 2);
    assert.equal(seen.revisions[2].uses, 1);
  });

  test("a correction is counted against the version it was about, never past its uses", () => {
    const counts = usage();
    counts.used("notes", 1);
    counts.corrected("notes", 1);
    counts.corrected("notes", 1);
    counts.corrected("notes", 2);
    assert.equal(counts.of("notes").revisions[1].corrected, 1);
    assert.equal(counts.of("notes").total.corrected, 1);
  });

  test("an unused skill says so rather than throwing", () => {
    assert.deepEqual(usage().of("nothing").total, { uses: 0, corrected: 0, lastUsed: null });
  });

  test("the counts survive a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "bloks-skill-usage-")), "skill-usage.json");
    new SkillUsage(file).used("notes", 3, 5);
    assert.equal(new SkillUsage(file).of("notes").revisions[3].uses, 1);
  });

  test("a skill named with a slash, among the ones the agent has", () => {
    assert.deepEqual(skillsNamed(["/release-notes for 0.2, please"], ["release-notes", "inbox-triage"]), ["release-notes"]);
    assert.deepEqual(skillsNamed(["use (/inbox-triage) now"], ["inbox-triage"]), ["inbox-triage"]);
    // a path is not a skill being named, and nor is one the agent lacks
    assert.deepEqual(skillsNamed(["look in src/release-notes"], ["release-notes"]), []);
    assert.deepEqual(skillsNamed(["/weekly-review"], ["release-notes"]), []);
    assert.deepEqual(skillsNamed(["/release-notes", "again /release-notes"], ["release-notes"]), ["release-notes"]);
  });
});
