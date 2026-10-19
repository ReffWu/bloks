// The incident desk's rules (server/incidents.ts): who leads, and the
// storm limits that keep a bad hour from becoming a worse one. The store
// writes a file, so it runs against a throwaway home and never the real
// one: HOME is set before the module is loaded.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const home = mkdtempSync(join(tmpdir(), "bloks-incidents-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
after(() => rmSync(home, { recursive: true, force: true }));

const {
  cardLine,
  cardText,
  chooseLead,
  DAY_MS,
  handText,
  HOUR_MS,
  IncidentStore,
  leadNote,
  MUTE_AFTER,
  retryRefusal,
  summaryText,
  whyOf,
} = await import("../server/incidents.ts");

const agent = (id: string, seniority = 1, able = true) => ({ id, name: id.toUpperCase(), seniority, able });
let files = 0;
const fresh = () => new IncidentStore(join(home, `incidents-${files++}.json`));
const input = (subject: string, thread = "lane-1") => ({
  kind: "turn" as const,
  subject,
  thread,
  title: "Sage's turn",
  why: "the engine said no",
  where: { botId: "sage", laneId: thread },
});
const lead = { kind: "agent" as const, id: "chief", name: "Chief" };

test("a room's lead takes it first, unless it is the one that failed", () => {
  const roomLead = agent("ada", 2);
  assert.deepEqual(chooseLead({ roomLead, failing: "sage", agents: [agent("chief", 5), roomLead] }), { kind: "agent", id: "ada", name: "ADA" });
  // asking the agent that failed to judge its own failure is no lead at all
  assert.deepEqual(chooseLead({ roomLead, failing: "ada", agents: [agent("chief", 5), roomLead] }), { kind: "agent", id: "chief", name: "CHIEF" });
});

test("outside a room, the one agent above all the others leads; a tie at the top is the person", () => {
  assert.deepEqual(chooseLead({ failing: "sage", agents: [agent("sage"), agent("chief", 4)] }), { kind: "agent", id: "chief", name: "CHIEF" });
  assert.deepEqual(chooseLead({ failing: "sage", agents: [agent("sage"), agent("a", 3), agent("b", 3)] }), { kind: "person" });
  // everybody at the default is nobody in particular
  assert.deepEqual(chooseLead({ failing: "sage", agents: [agent("sage"), agent("a")] }), { kind: "person" });
  // the chief itself failing goes to the person, not to whoever is next
  assert.deepEqual(chooseLead({ failing: "chief", agents: [agent("chief", 5), agent("a", 2)] }), { kind: "person" });
});

test("a lead that cannot act, or the person's own choice, decides who gets it", () => {
  // an engine without the command line cannot make any of the three choices
  assert.deepEqual(chooseLead({ failing: "sage", agents: [agent("sage"), agent("chief", 5, false)] }), { kind: "person" });
  assert.deepEqual(chooseLead({ setting: "person", failing: "sage", roomLead: agent("ada"), agents: [agent("chief", 5)] }), { kind: "person" });
  assert.deepEqual(chooseLead({ setting: "a", failing: "sage", agents: [agent("chief", 5), agent("a")] }), { kind: "agent", id: "a", name: "A" });
  // a named lead that is gone is the person, never a guess
  assert.deepEqual(chooseLead({ setting: "gone", failing: "sage", agents: [agent("chief", 5)] }), { kind: "person" });
});

test("the same thing failing while its incident is open is counted, never a second incident", () => {
  const store = fresh();
  const first = store.raise(input("lane:1"), lead, 1_000);
  assert.equal(first.outcome, "new");
  assert.equal(first.incident.state, "with-lead");
  const again = store.raise({ ...input("lane:1"), why: "and again" }, lead, 2_000);
  assert.equal(again.outcome, "counted");
  assert.equal(again.incident.id, first.incident.id);
  assert.equal(again.incident.count, 2);
  assert.equal(again.incident.why, "and again");
  assert.equal(store.incidents.length, 1);
  // over, the next failure is news again
  store.resolve(first.incident.id, "Resolved by you.", 3_000);
  assert.equal(store.raise(input("lane:1"), lead, 4_000).outcome, "new");
});

test("a retry that fails goes to the person, and starts nothing new", () => {
  const store = fresh();
  const { incident } = store.raise(input("routine:r"), lead, 1_000);
  store.update(incident.id, (i) => {
    i.state = "retrying";
    i.retriedAt = 1_500;
  });
  const failed = store.raise(input("routine:r"), lead, 2_000);
  assert.equal(failed.outcome, "retry-failed");
  assert.equal(failed.incident.state, "needs-you");
  assert.equal(store.incidents.length, 1);
});

test("no lead means the person straight away", () => {
  const store = fresh();
  assert.equal(store.raise(input("lane:9"), { kind: "person" }, 1_000).incident.state, "needs-you");
});

test("one automatic retry per thing a day, and two per conversation", () => {
  const store = fresh();
  const now = 10 * DAY_MS;
  const a = store.raise(input("lane:a", "t"), lead, now).incident;
  assert.equal(retryRefusal(store.incidents, a, now), null);
  store.update(a.id, (i) => (i.retriedAt = now));
  assert.match(retryRefusal(store.incidents, a, now)!, /already been tried once more/);
  // the same thing failing again later the same day had its retry
  store.resolve(a.id, "done", now);
  const a2 = store.raise(input("lane:a", "t"), lead, now + HOUR_MS).incident;
  assert.match(retryRefusal(store.incidents, a2, now + HOUR_MS)!, /one retry today/);
  // a second thing in the same conversation still may, a third may not
  const b = store.raise(input("lane:b", "t"), lead, now).incident;
  assert.equal(retryRefusal(store.incidents, b, now), null);
  store.update(b.id, (i) => (i.retriedAt = now));
  const c = store.raise(input("lane:c", "t"), lead, now).incident;
  assert.match(retryRefusal(store.incidents, c, now)!, /2 retries today/);
  // a day on, both rules let go
  assert.equal(retryRefusal(store.incidents, c, now + DAY_MS + 1), null);
  assert.equal(retryRefusal(store.incidents, a2, now + DAY_MS + 1), null);
});

test("past five in an hour the desk goes quiet: one summary, kept counting", () => {
  const store = fresh();
  const at = 50 * DAY_MS;
  for (let i = 0; i < MUTE_AFTER; i++) assert.equal(store.raise(input(`lane:${i}`), lead, at + i).outcome, "new");
  const sixth = store.raise(input("lane:6"), lead, at + 10);
  assert.equal(sixth.outcome, "muted");
  assert.equal(sixth.incident.state, "muted");
  assert.deepEqual(sixth.incident.lead, { kind: "person" }, "a muted incident is handed to nobody");
  assert.ok(sixth.outcome === "muted" && sixth.first);
  store.setSummaryCard({ threadId: "lane-1", messageId: "card" });
  const seventh = store.raise(input("lane:7"), lead, at + 20);
  assert.ok(seventh.outcome === "muted" && !seventh.first, "a second card while quiet");
  assert.ok(seventh.outcome === "muted" && seventh.summary.count === 7);
  assert.deepEqual(store.summary?.card, { threadId: "lane-1", messageId: "card" });
  // an hour later the desk hands things to leads again
  assert.equal(store.raise(input("lane:8"), lead, at + HOUR_MS + 30).outcome, "new");
});

test("what is kept is read back, and a hand-edited entry that is not one is dropped", () => {
  const file = join(home, "kept.json");
  const store = new IncidentStore(file);
  const { incident } = store.raise(input("lane:k"), lead, 1_000);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...saved, incidents: [...saved.incidents, { id: "x", state: "nonsense" }] }));
  const again = new IncidentStore(file);
  assert.deepEqual(again.incidents.map((i) => i.id), [incident.id]);
  assert.equal(again.openFor("lane:k")?.id, incident.id);
});

test("the words: a lead's note offers the three ways out and asks for QUIET; nothing has a dash", () => {
  const store = fresh();
  const { incident } = store.raise(input("lane:w"), lead, 1_000);
  const note = leadNote(incident, "bloks");
  for (const said of [`bloks incident retry ${incident.id}`, `bloks incident hand ${incident.id}`, `bloks incident tell ${incident.id}`, "QUIET", "not from the person"]) {
    assert.ok(note.includes(said), said);
  }
  const words = [
    note,
    handText(incident, "Chief", "look at the key"),
    summaryText(6),
    ...(["direct", "lead", "retry-failed", "unsettled", "lead-failed"] as const).map((r) => cardText({ ...incident, needs: "a new key" }, r)),
  ];
  for (const said of words) assert.doesNotMatch(said, /[\u2013\u2014]/);
  assert.match(cardText({ ...incident, needs: "a new key" }, "lead"), /Chief looked at it and needs you: a new key/);
  // added to a failure's own notice, only what is new is said
  assert.equal(cardLine(incident, "direct"), null);
  assert.equal(cardLine({ ...incident, needs: "a new key" }, "lead"), "Chief looked at it and needs you: a new key");
  assert.match(cardLine(incident, "retry-failed")!, /failed again when it was tried once more/);
  for (const reason of ["lead", "retry-failed", "unsettled", "lead-failed"] as const) assert.doesNotMatch(cardLine(incident, reason)!, /[\u2013\u2014]/);
});

test("a failure's words are kept to one short line", () => {
  assert.equal(whyOf("  line one\n line two.  "), "line one line two");
  assert.equal(whyOf(""), "it did not finish");
  assert.ok(whyOf("x".repeat(1_000)).length <= 300);
});
