// Codex speed, from the choice down to what the driver says to Codex.
//
// Standard is Codex as it always ran: nothing about the tier is sent, so
// a Codex that has never heard of one keeps working. Fast asks for the
// priority tier and goes ahead only when Codex confirms it; a Fast turn
// that cannot be had is refused before any words reach the model.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { after, test, type TestContext } from "node:test";
import {
  codexSpeedRoute,
  CodexSpeedUnavailable,
  fastRefusal,
  requireFastTier,
  resolveCodexSpeed,
} from "../server/codex-speed.ts";
import type { RuntimeEvent, SendTurnInput } from "../server/contracts.ts";

const home = fs.mkdtempSync(join(tmpdir(), "bloks-speed-unit-"));
process.env.HOME = home;
const { CodexDriver, catalogFromModelList } = await import("../server/drivers/codex.ts");
after(() => fs.rmSync(home, { recursive: true, force: true }));

const FAST = resolveCodexSpeed({ codex: { speed: "fast" } });
const STANDARD = resolveCodexSpeed({ codex: { speed: "standard" } });

// ── the choice ─────────────────────────────────────────────────────────

test("an agent's own speed wins over the workspace, and Standard is the default", () => {
  assert.deepEqual(resolveCodexSpeed({}), { default: "standard", override: null, resolved: "standard", source: "workspace" });
  assert.deepEqual(resolveCodexSpeed({ codex: { speed: "fast" } }, { codexSpeed: null }), {
    default: "fast",
    override: null,
    resolved: "fast",
    source: "workspace",
  });
  assert.deepEqual(resolveCodexSpeed({ codex: { speed: "fast" } }, { codexSpeed: "standard" }), {
    default: "fast",
    override: "standard",
    resolved: "standard",
    source: "agent",
  });
  assert.equal(resolveCodexSpeed({}, { codexSpeed: "fast" }).resolved, "fast");
});

test("a malformed stored speed reads as unset rather than as Fast", () => {
  assert.equal(resolveCodexSpeed({ codex: { speed: "priority" } }).resolved, "standard");
  assert.equal(resolveCodexSpeed({}, { codexSpeed: "turbo" }).source, "workspace");
});

test("Codex on this computer, Codex on a Box or Boat, and everything else are told apart", () => {
  assert.equal(codexSpeedRoute("codex", "any-model"), "native");
  assert.equal(codexSpeedRoute("boxAgent", "gpt-6"), "remote");
  assert.equal(codexSpeedRoute("boxAgent", "sonnet"), "not-codex");
  for (const kind of ["acp", "openai", "claudeAgent"]) assert.equal(codexSpeedRoute(kind, "gpt-6"), "not-codex");
});

test("only a priority service tier in the catalog says a model offers Fast", () => {
  const catalog = catalogFromModelList([
    {
      data: [
        { model: "yes", serviceTiers: [{ id: "priority" }] },
        { model: "no", serviceTiers: [], additionalSpeedTiers: ["fast"] },
        { model: "unknown", additionalSpeedTiers: ["fast"] },
      ],
    },
  ])!;
  assert.deepEqual(
    catalog.options.map((m) => m.codexFast),
    [true, false, undefined],
  );
});

test("Fast goes ahead only on an answer that names the priority tier", () => {
  assert.doesNotThrow(() => requireFastTier({ serviceTier: "priority" }));
  for (const answer of [{}, { serviceTier: null }, { serviceTier: "default" }, { serviceTier: "fast" }, null]) {
    assert.throws(() => requireFastTier(answer), CodexSpeedUnavailable);
  }
});

test("a Codex refusing the tier is a Fast refusal; the old resume field is not", () => {
  assert.ok(fastRefusal(new Error("unknown field `serviceTier`")));
  assert.ok(fastRefusal(new Error("unknown variant `priority`")));
  assert.match(fastRefusal(new Error("unknown field `serviceTier`"))!.message, /update Codex/);
  assert.equal(fastRefusal(new Error("unknown field `excludeTurns`")), null);
  assert.equal(fastRefusal(new Error("conversation missing")), null);
});

// ── the driver, against a fake Codex ───────────────────────────────────

interface FakeCodex {
  /** What thread/start and thread/resume answer for serviceTier: "echo"
   * repeats what was asked, a value is said as it is, and leaving it out
   * is a Codex that never mentions the field. */
  tier?: "echo" | string | null;
  /** thread/start's own answer, where it differs from thread/resume's. */
  freshTier?: "echo" | string | null;
  /** thread/resume fails with this message. */
  resumeError?: string;
  /** Any thread request carrying serviceTier fails, as a Codex that does
   * not know the field. */
  rejectTier?: boolean;
  /** The model catalog's service tiers: Fast offered, not offered, or
   * not said. */
  offersFast?: boolean;
  /** thread/resume waits until the test lets it answer. */
  holdResume?: boolean;
  /** The thread's compaction fails, so the turn moves to a fresh thread. */
  compactError?: boolean;
}

async function fakeCodex(t: TestContext, fake: FakeCodex = {}) {
  const frames: any[] = [];
  const argvs: string[][] = [];
  const events: RuntimeEvent[] = [];
  let releaseResume: (() => void) | undefined;

  const tierFor = (setting: FakeCodex["tier"], asked: unknown) => {
    if (setting === undefined) return {};
    return { serviceTier: setting === "echo" ? (asked ?? null) : setting };
  };

  t.mock.method(childProcess, "spawn", (_cli: unknown, argv: string[]) => {
    argvs.push(argv);
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter();
    const send = (message: unknown) => stdout.write(JSON.stringify(message) + "\n");

    const answer = (frame: any) => {
      const fail = (message: string) => send({ id: frame.id, error: { code: -32602, message } });
      if (frame.method === "model/list") {
        const serviceTiers = fake.offersFast === undefined ? undefined : fake.offersFast ? [{ id: "priority" }] : [];
        return send({ id: frame.id, result: { data: [{ model: "fixture", serviceTiers }] } });
      }
      if (frame.method === "thread/compact/start" && fake.compactError) return fail("synthetic compaction failure");
      if (frame.method === "thread/start" || frame.method === "thread/resume") {
        if (fake.rejectTier && "serviceTier" in frame.params) return fail("unknown field `serviceTier`");
        if (frame.method === "thread/resume" && fake.resumeError) return fail(fake.resumeError);
        const setting = frame.method === "thread/start" && "freshTier" in fake ? fake.freshTier : fake.tier;
        const result = {
          thread: { id: frame.params.threadId ?? "fresh" },
          model: "fixture",
          ...tierFor(setting, frame.params.serviceTier),
        };
        const reply = () => send({ id: frame.id, result });
        if (frame.method === "thread/resume" && fake.holdResume) releaseResume = reply;
        else reply();
        return;
      }
      send({ id: frame.id, result: {} });
      if (frame.method === "turn/start") send({ method: "turn/completed", params: { turn: { status: "completed" } } });
    };

    const stdin = new Writable({
      write(chunk, _encoding, done) {
        const frame = JSON.parse(String(chunk));
        frames.push(frame);
        if (frame.method && frame.id !== undefined) queueMicrotask(() => answer(frame));
        done();
      },
    });
    return Object.assign(child, { stdout, stderr, stdin, kill() {} });
  });
  t.mock.method(fs, "appendFileSync", () => {});
  syncBuiltinESMExports();

  const instance = await CodexDriver.create({
    instanceId: "codex",
    displayName: "Codex",
    environment: {},
    enabled: true,
    config: { cli: "explicit-fake", fullAuto: false },
  });
  instance.adapter.onEvent((event) => events.push(event));
  await setImmediate();
  t.after(async () => {
    await instance.dispose();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  const start = (extra: Partial<SendTurnInput> = {}) =>
    instance.adapter.sendTurn({ threadId: "lane", text: "LOCAL FIXTURE", model: "fixture", resumeCursor: "kept-cursor", ...extra });

  const ended = async () => {
    for (let i = 0; i < 200 && !events.some((e) => e.type === "turn.completed"); i++) await setImmediate();
    const ends = events.filter((e) => e.type === "turn.completed");
    assert.equal(ends.length, 1, "the turn should end once");
    return ends[0] as Extract<RuntimeEvent, { type: "turn.completed" }>;
  };

  const sent = (method: string) => frames.filter((f) => f.method === method);

  const waitForFrame = async (method: string) => {
    for (let i = 0; i < 200 && !sent(method).length; i++) await setImmediate();
    assert.ok(sent(method).length, `${method} was never sent`);
  };

  return { instance, frames, argvs, events, start, ended, sent, waitForFrame, releaseResume: () => releaseResume?.() };
}

for (const resumed of [false, true]) {
  test(`Standard ${resumed ? "resumes" : "opens"} a thread on a Codex that never mentions the tier`, async (t) => {
    const codex = await fakeCodex(t);
    await codex.start({ resumeCursor: resumed ? "kept-cursor" : undefined, codexSpeed: STANDARD });

    const end = await codex.ended();
    assert.equal(end.ok, true);
    assert.equal(end.preInputRefusal, undefined);
    const opened = codex.sent(resumed ? "thread/resume" : "thread/start");
    assert.equal(opened.length, 1);
    assert.equal("serviceTier" in opened[0].params, false, "Standard says nothing about the tier");
    assert.equal(codex.sent("turn/start").length, 1);
    assert.equal(codex.argvs.at(-1)!.includes("features.fast_mode=true"), false);
  });
}

test("a turn with no speed at all runs as Standard always did", async (t) => {
  const codex = await fakeCodex(t);
  await codex.start();
  assert.equal((await codex.ended()).ok, true);
  assert.equal("serviceTier" in codex.sent("thread/resume")[0].params, false);
});

test("Standard on a Codex that rejects the field never sends it, so never meets the rejection", async (t) => {
  const codex = await fakeCodex(t, { rejectTier: true });
  await codex.start({ codexSpeed: STANDARD });
  assert.equal((await codex.ended()).ok, true);
  assert.equal(codex.sent("turn/start").length, 1);
});

for (const resumeError of ["unknown field `serviceTier`", "unknown variant `priority`", "conversation missing"]) {
  test(`Standard still opens a fresh thread when resume fails: ${resumeError}`, async (t) => {
    const codex = await fakeCodex(t, { resumeError });
    await codex.start({ codexSpeed: STANDARD });

    const end = await codex.ended();
    assert.equal(end.ok, true);
    assert.equal(end.preInputRefusal, undefined);
    assert.equal(codex.sent("thread/start").length, 1);
    assert.equal(codex.sent("turn/start").length, 1);
  });
}

for (const resumed of [false, true]) {
  test(`Fast ${resumed ? "resumes" : "opens a thread"} with the priority tier once Codex confirms it`, async (t) => {
    const codex = await fakeCodex(t, { tier: "echo", offersFast: true });
    await codex.start({ resumeCursor: resumed ? "kept-cursor" : undefined, codexSpeed: FAST });

    const end = await codex.ended();
    assert.equal(end.ok, true);
    const opened = codex.sent(resumed ? "thread/resume" : "thread/start");
    assert.equal(opened[0].params.serviceTier, "priority");
    const turns = codex.sent("turn/start");
    assert.equal(turns.length, 1);
    assert.equal("serviceTier" in turns[0].params, false, "the tier belongs to the thread, not the turn");
    assert.ok(codex.argvs.at(-1)!.includes("features.fast_mode=true"));
    const report = codex.events.find((e) => e.type === "codex.speed");
    assert.ok(report?.type === "codex.speed");
    assert.equal(report.configuredTier, "priority");
    assert.equal(report.actualTier, null);
    assert.equal(report.choice.resolved, "fast");
  });
}

for (const fake of [
  { tier: undefined },
  { tier: null },
  { tier: "default" },
  { rejectTier: true },
  { resumeError: "unknown variant `priority`" },
] satisfies FakeCodex[]) {
  test(`Fast is refused before any input when Codex does not confirm it: ${JSON.stringify(fake)}`, async (t) => {
    const codex = await fakeCodex(t, fake);
    await codex.start({ codexSpeed: FAST, compactFirst: true, effort: "high" });

    const end = await codex.ended();
    assert.equal(end.ok, false);
    assert.equal(end.preInputRefusal?.kind, "codex-speed");
    assert.match(end.preInputRefusal!.reason, /not sent/);
    assert.match(end.preInputRefusal!.reason, /update Codex/);
    assert.equal(codex.sent("thread/resume").length, 1);
    for (const method of ["thread/start", "thread/compact/start", "turn/start"]) {
      assert.equal(codex.sent(method).length, 0, `${method} went out after the refusal`);
    }
    assert.equal(codex.events.some((e) => e.type === "session.started"), false);
  });
}

for (const via of ["a forgotten thread", "a failed compaction"]) {
  test(`Fast checks the tier again on the fresh thread after ${via}`, async (t) => {
    const codex = await fakeCodex(t, {
      tier: "echo",
      freshTier: null,
      ...(via === "a forgotten thread" ? { resumeError: "conversation missing" } : { compactError: true }),
    });
    await codex.start({ codexSpeed: FAST, compactFirst: via === "a failed compaction" });

    const end = await codex.ended();
    assert.equal(end.preInputRefusal?.kind, "codex-speed");
    assert.equal(codex.sent("thread/start").length, 1);
    assert.equal(codex.sent("turn/start").length, 0);
  });
}

test("Fast on a model the catalog just said has no Fast is refused before a process starts", async (t) => {
  const codex = await fakeCodex(t, { offersFast: false });
  const spawned = codex.argvs.length;

  await assert.rejects(codex.start({ codexSpeed: FAST }), CodexSpeedUnavailable);
  assert.equal(codex.argvs.length, spawned);
  assert.equal(codex.sent("thread/resume").length, 0);
});

test("an old catalog answer about Fast is not trusted either way", async (t) => {
  const codex = await fakeCodex(t, { offersFast: false, tier: "echo" });
  codex.instance.models.checkedAt = Date.now() - 300_001;

  await codex.start({ codexSpeed: FAST });
  assert.equal((await codex.ended()).ok, true);
  assert.equal(codex.sent("turn/start").length, 1);
});

test("the speed a turn started with holds, whatever changes while it runs", async (t) => {
  const codex = await fakeCodex(t, { holdResume: true });
  const choice = resolveCodexSpeed({ codex: { speed: "standard" } });
  await codex.start({ codexSpeed: choice });
  await codex.waitForFrame("thread/resume");

  // the caller's object changes after dispatch, as a setting edit would
  choice.resolved = "fast";
  choice.source = "agent";
  choice.override = "fast";
  codex.releaseResume();
  await codex.ended();

  assert.equal("serviceTier" in codex.sent("thread/resume")[0].params, false);
  const report = codex.events.find((e) => e.type === "codex.speed");
  assert.ok(report?.type === "codex.speed");
  assert.equal(report.choice.resolved, "standard");
  assert.equal(report.choice.source, "workspace");
});
