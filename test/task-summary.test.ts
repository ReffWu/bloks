// A conversation's summary can be read and dropped (GitHub 405), and one
// that runs past the limit is cut where a line ends and says so, rather
// than losing its end without a word.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { allows } from "../server/agent-cli.ts";
import { keptSummary, SUMMARY_CUT_MARK, SUMMARY_MAX_CHARS } from "../server/context.ts";
import { startHarness } from "./helpers/server.ts";

test("a summary within the limit is kept word for word", () => {
  const text = "You agreed the launch moves to Friday.\nThey want the invoice by Monday.";
  assert.deepEqual(keptSummary(text), { summary: text, cut: false });
  const exact = "x".repeat(SUMMARY_MAX_CHARS);
  assert.deepEqual(keptSummary(exact), { summary: exact, cut: false });
});

test("a summary past the limit is cut where a line ends, and marked", () => {
  const lines = Array.from({ length: 400 }, (_, i) => `- fact number ${i} about the launch`);
  const kept = keptSummary(lines.join("\n"));
  assert.equal(kept.cut, true);
  assert.ok(kept.summary.length <= SUMMARY_MAX_CHARS, `${kept.summary.length} is past the limit`);
  assert.ok(kept.summary.endsWith(SUMMARY_CUT_MARK), "the cut is not said");
  const body = kept.summary.slice(0, -SUMMARY_CUT_MARK.length).trimEnd().split("\n");
  for (const line of body) assert.ok(lines.includes(line), `a line was cut mid-way: ${line}`);

  // one long line has nowhere to break but a space
  const words = keptSummary(Array.from({ length: 3_000 }, (_, i) => `word${i}`).join(" "));
  assert.equal(words.cut, true);
  assert.ok(words.summary.length <= SUMMARY_MAX_CHARS);
  assert.match(words.summary, /word\d+\n\n\[This summary/, "the cut landed mid-word");
});

test("an agent may read and drop the summary of its own conversation", () => {
  const me = "bot-1";
  for (const method of ["GET", "DELETE"]) {
    assert.equal(allows(me, method, `/api/bots/${me}/tasks/lane-1/summary`).ok, true, method);
    assert.equal(allows(me, method, `/api/bots/bot-2/tasks/lane-1/summary`).ok, false, `${method} on another agent`);
  }
  assert.equal(allows(me, "PUT", `/api/bots/${me}/tasks/lane-1/summary`).ok, false, "nobody writes a summary by hand");
});

test("the person reads a conversation's summary and drops it; the transcript stays", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "bloks-task-summary-"));
  const data = join(home, ".bloks");
  mkdirSync(data);
  const id = randomUUID(), threadId = randomUUID();
  const context = { summary: "You promised the report by Tuesday. That moved to Friday since.", through: 2, at: Date.UTC(2026, 9, 23) };
  writeFileSync(
    join(data, "bots.json"),
    JSON.stringify([{ id, threadId, activeTaskId: threadId, name: "Keeper", title: "", description: "", color: "blue", shape: "circle",
      createdAt: 1, unread: false, notifications: false, resumeCursors: {}, modelSelection: { instanceId: "none", model: "" },
      tasks: [{ id: threadId, title: "General", createdAt: 1, context }] }]),
  );
  const messages = [0, 1, 2].map((i) => ({ id: randomUUID(), at: i + 1, role: i % 2 ? "bot" : "user", kind: "text", text: `message ${i}` }));
  writeFileSync(join(data, `messages-${threadId}.json`), JSON.stringify(messages));
  const h = await startHarness({ HOME: home });
  t.after(async () => {
    await h.stop();
    rmSync(home, { recursive: true, force: true });
  });

  const route = `/api/bots/${id}/tasks/${threadId}/summary`;
  const read = await h.json(route);
  assert.deepEqual(read.summary, { text: context.summary, covers: 2, at: "2026-10-23T00:00:00.000Z" });

  const dropped = await h.json(route, { method: "DELETE" });
  assert.deepEqual(dropped, { ok: true, dropped: true });
  assert.equal((await h.json(route)).summary, null);
  assert.deepEqual(await h.json(route, { method: "DELETE" }), { ok: true, dropped: false }, "dropping nothing is not an error");

  const { messages: kept } = await h.json(`/api/bots/${id}/messages?thread=${threadId}&limit=100`);
  assert.deepEqual(kept.filter((m: any) => m.kind === "text").map((m: any) => m.text), ["message 0", "message 1", "message 2"]);
  assert.equal((await h.fetch(`/api/bots/${id}/tasks/nope/summary`)).status, 404);
});
