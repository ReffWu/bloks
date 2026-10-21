// The app's own log stays small, one line per entry, and never throws
// (electron/app-log.mjs).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { APP_LOG_MAX_LINE, createAppLog, lineBudget, logLine } from "../electron/app-log.mjs";

const dir = mkdtempSync(join(tmpdir(), "bloks-app-log-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("a line is stamped, flattened to one line, and cut to length", () => {
  const at = new Date("2026-10-21T08:00:00.000Z");
  assert.equal(logLine("window: gone\n  at stack line\r\n", at), "2026-10-21T08:00:00.000Z window: gone | at stack line | \n");
  assert.equal(logLine("x".repeat(APP_LOG_MAX_LINE * 2), at).length, at.toISOString().length + 1 + APP_LOG_MAX_LINE + 1);
});

test("the log moves aside once it would pass its size, keeping one older file", () => {
  const log = createAppLog(dir, { name: "small", maxBytes: 200 });
  for (let i = 0; i < 20; i++) log.write(`line ${i} ${"y".repeat(20)}`);
  assert.ok(statSync(log.file).size <= 200);
  assert.ok(statSync(join(dir, "small.1.log")).size <= 200);
  assert.match(readFileSync(log.file, "utf8"), /line 19/);
  assert.equal((statSync(log.file).mode & 0o777).toString(8), "600");
});

test("a log that cannot be written does not throw", () => {
  const blocked = join(dir, "a-file");
  writeFileSync(blocked, "not a folder");
  assert.doesNotThrow(() => createAppLog(join(blocked, "logs")).write("nowhere"));
});

test("a page may write twenty lines a minute, no more", () => {
  const may = lineBudget();
  let allowed = 0;
  for (let i = 0; i < 100; i++) if (may(1_000 + i)) allowed++;
  assert.equal(allowed, 20);
  assert.equal(may(61_000), true, "a minute later there is room again");
});
