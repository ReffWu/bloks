// The line at the end of a transcript while an agent works: when it is
// owed, what it calls the step, and how it counts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { clock, REPLY_HOLD_MS, turnStartedAt, workingLineOwed } from "../src/lib/transcript.ts";
import { runningCall, stepWords } from "../src/lib/tool-summary.ts";
import type { Message } from "../src/state/reducer.ts";

const msg = (m: Partial<Message>): Message => ({ id: Math.random().toString(36), role: "bot", kind: "text", at: 0, ...m }) as Message;

describe("the working line", () => {
  test("shows while working, even with a call still running at the tail", () => {
    const running = msg({ kind: "activity", tool: { name: "Bash", command: "npm test" } });
    assert.equal(workingLineOwed(true, undefined, running, 0), true);
    assert.equal(workingLineOwed(false, undefined, running, 0), false);
    assert.equal(workingLineOwed(true, "Half a sentence", running, 0), true);
    assert.equal(workingLineOwed(true, undefined, undefined, 0), true);
  });

  test("a reply at the tail holds it off, then lets it back if the work goes on", () => {
    const reply = msg({ kind: "text", text: "Done." });
    assert.equal(workingLineOwed(true, undefined, reply, 0), false);
    assert.equal(workingLineOwed(true, undefined, reply, REPLY_HOLD_MS), true);
  });

  test("the turn began at the newest message that started one", () => {
    const messages = [
      msg({ role: "user", text: "first", at: 100 }),
      msg({ kind: "activity", at: 150, tool: { name: "Read", ok: true } }),
      msg({ role: "user", text: "second", at: 200 }),
      msg({ role: "user", text: "into the running turn", at: 250, midTurn: true }),
    ];
    assert.equal(turnStartedAt(messages), 200);
    assert.equal(turnStartedAt([msg({ text: "hello" })]), null);
  });

  test("counts in a fixed width", () => {
    assert.equal(clock(0), "0s");
    assert.equal(clock(42_400), "42s");
    assert.equal(clock(65_000), "1m 05s");
    assert.equal(clock(3_725_000), "1h 02m");
  });
});

describe("the step, in plain words", () => {
  test("names a command by what it is for, when that is plain", () => {
    assert.equal(stepWords({ name: "Bash", command: "pnpm test" }), "Running tests");
    assert.equal(stepWords({ name: "shell", command: "npx vitest run src" }), "Running tests");
    assert.equal(stepWords({ name: "Bash", command: "npm install left-pad" }), "Installing packages");
    assert.equal(stepWords({ name: "Bash", command: "npm run build" }), "Building");
    assert.equal(stepWords({ name: "Bash", command: "ls -la" }), "Running a command");
    assert.equal(stepWords({ name: "npm test" }), "Running tests", "old rows name the command itself");
  });

  test("names the rest by kind, and leaves a guess unsaid", () => {
    assert.equal(stepWords({ name: "Read" }), "Reading a file");
    assert.equal(stepWords({ name: "Grep" }), "Searching the files");
    assert.equal(stepWords({ name: "WebSearch" }), "Searching the web");
    assert.equal(stepWords({ name: "WebFetch" }), "Reading a web page");
    assert.equal(stepWords({ name: "Edit" }), "Editing a file");
    assert.equal(stepWords({ name: "Write" }), "Writing a file");
    assert.equal(stepWords({ name: "memory_read: deadlines" }), "Checking its memory");
    assert.equal(stepWords({ name: "messaged Ada" }), "Messaging Ada");
    assert.equal(stepWords({ name: "mcp__github__create_issue" }), "Using github");
    assert.equal(stepWords({ name: "Skill" }), null);
  });

  test("the call going now is the newest one not settled", () => {
    const rows = [
      { tool: { name: "Read", ok: true } },
      { tool: { name: "Bash" } },
      { tool: { name: "Grep" } },
      { tool: { name: "Edit", stopped: true } },
    ];
    assert.equal(runningCall(rows)?.tool.name, "Grep");
    assert.equal(runningCall([{ tool: { name: "Read", ok: false } }]), null);
  });
});
