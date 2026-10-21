// The sender's record of a message that waited behind another agent's
// turn: the "messaged B" row in its own conversation (server/index.ts,
// settleRecord; GitHub 337). It says the words wait while they wait, and
// follows them once they go: sent when the other agent's next turn takes
// them, not delivered when they are taken back or a restart drops them.
// Written once and never again, it said "waiting" for hours after B had
// answered, and the sender was asked to take back what B had already heard.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { controlledChain } from "./helpers/agent-chain.ts";
import type { Harness } from "./helpers/server.ts";
import { waitFor } from "./helpers/turns.ts";

const WORDS = "Please rerun the example checks.";

/** Reads the event stream for a moment, from a sequence number on. */
async function framesSince(h: Harness, seq: number, ms = 1_200): Promise<any[]> {
  const res = await h.fetch(`/api/events?since=${seq}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const race = await Promise.race([
      reader.read(),
      new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now())),
    ]);
    if (!race || race.done) break;
    seen += decoder.decode(race.value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return seen
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

async function currentSeq(h: Harness) {
  const [hello] = await framesSince(h, 0, 400);
  return Number(hello?._seq ?? 0);
}

/** Agent A, mid-turn, says something to Agent B, who is mid-turn too,
 * so the words wait; A's row for them says so. */
async function waitingSay(t: TestContext) {
  const f = await controlledChain(t);
  const a = await f.hire("Agent A"), b = await f.hire("Agent B");
  const turnA = await f.begin(a, "Begin as A");
  const turnB = await f.begin(b, "Begin as B");
  const seq = await currentSeq(f.h);
  const res = await f.agent(turnA, `/api/bots/${b.id}/messages`, { text: WORDS });
  assert.equal(res.status, 202);
  assert.equal((await res.json()).queued, true);
  const row = async () => (await f.messages(a)).find((m) => m.agent?.dir === "out" && m.text === WORDS);
  const said = await row();
  assert.equal(said?.agent.status, "queued", "the sender's row does not say the words wait");
  const copy = async () => (await f.messages(b)).find((m) => m.agent?.dir === "in" && m.text === WORDS);
  assert.equal((await copy())?.queued, true);
  /** What went out about A's row, in order. */
  const rowPatches = async () => (await framesSince(f.h, seq))
    .filter((frame) => frame.kind === "message.patch" && frame.threadId === a.threadId && frame.message?.id === said.id)
    .map((frame) => frame.message.agent?.status);
  return { f, a, b, turnA, turnB, row, rowId: said.id as string, copy, rowPatches };
}

test("a say that waited reads as sent on the sender's side once the other agent's turn takes it", async (t) => {
  const s = await waitingSay(t);
  const before = s.f.turns().length;
  // B's turn ends; its next one is the words that waited
  writeFileSync(join(s.f.home, `finish-${s.turnB.pid}`), "");
  const next = await s.f.turnAfter(before);
  assert.ok(next.text.includes(WORDS), "B's next turn was not the waiting words");
  const delivered = await s.copy();
  assert.equal(delivered.queued, false);
  assert.ok(delivered.deliveredAt);
  const settled = await waitFor(async () => {
    const row = await s.row();
    return row?.agent.status === "sent" ? row : null;
  }, 5_000);
  assert.ok(settled, "the sender's row still says the words wait after B heard them");
  assert.equal(settled.id, s.rowId, "the row was written again rather than changed");
  assert.equal(settled.tool.ok, true);
  assert.equal((await s.f.messages(s.a)).filter((m) => m.agent?.dir === "out").length, 1);
  assert.deepEqual(await s.rowPatches(), ["sent"], "no screen was told the row changed");
  // heard once, so the exchange lists it once, from the side it arrived on
  const { messages: exchange } = await s.f.h.json(`/api/bots/${s.a.id}/exchange/${s.b.id}`);
  assert.deepEqual(exchange.map((e: any) => [e.dir, e.status ?? null]), [["in", null]]);
});

test("a say taken back while it waited reads as not delivered on the sender's side", async (t) => {
  const s = await waitingSay(t);
  const res = await s.f.agent(s.turnA, `/api/bots/${s.b.id}/take-back`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).takenBack.length, 1);
  const row = await s.row();
  assert.equal(row.id, s.rowId);
  assert.equal(row.agent.status, "failed", "the sender's row still says taken-back words wait");
  assert.equal(row.tool.ok, false);
  assert.deepEqual(await s.rowPatches(), ["failed"], "no screen was told the row changed");
  // B's turn ending has nothing to deliver, and the row stays as it is
  const before = s.f.turns().length;
  await s.f.finish(s.turnB, s.b);
  assert.equal(s.f.turns().length, before, "B was handed words that were taken back");
  assert.equal((await s.row()).agent.status, "failed");
  assert.equal((await s.copy()), undefined, "the taken-back words are still in B's conversation");
});

test("a say a restart finds too old to send reads as not delivered on the sender's side", async (t) => {
  const s = await waitingSay(t);
  const file = join(s.f.home, ".bloks", `messages-${s.b.threadId}.json`);
  const waiting = JSON.parse(readFileSync(file, "utf8")).find((m: any) => m.agent?.dir === "in" && m.text === WORDS);
  // the tie to the sender's row is on disk, where a restart reads it
  assert.deepEqual(waiting.agent.record, { laneId: s.a.threadId, id: s.rowId });
  // Gone at once, as a crash goes: a stop would end both turns first,
  // and B's end would deliver the words before the restart could judge them.
  await s.f.h.crash();
  await s.f.restart(() => {
    const list = JSON.parse(readFileSync(file, "utf8"));
    list.find((m: any) => m.id === waiting.id).queuedAt = Date.now() - 2 * 24 * 60 * 60_000;
    writeFileSync(file, JSON.stringify(list, null, 2));
  });
  const unsent = await waitFor(async () => {
    const copy = (await s.f.messages(s.b)).find((m) => m.id === waiting.id);
    return copy?.unsent ? copy : null;
  });
  assert.ok(unsent, "the restart did not mark the old words not sent");
  const row = await waitFor(async () => {
    const row = await s.row();
    return row?.agent.status === "failed" ? row : null;
  }, 5_000);
  assert.ok(row, "the sender's row still says words the restart dropped are waiting");
  assert.equal(row.id, s.rowId);
  assert.equal(row.tool.ok, false);
  // listed once, from the sender's record, which says it was not delivered
  const { messages: exchange } = await s.f.h.json(`/api/bots/${s.a.id}/exchange/${s.b.id}`);
  assert.deepEqual(exchange.map((e: any) => [e.dir, e.status ?? null, e.id]), [["out", "failed", s.rowId]]);
});
