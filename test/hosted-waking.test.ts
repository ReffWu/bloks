// A hosted workspace that has gone to sleep, from the desktop app's side.
//
// Bloks Cloud holds the first ask for a sleeping machine about twelve
// seconds and then answers "waking", which promises the ask never reached
// it. The app's stand-in for the workspace's server (electron/remote.mjs)
// asks again at 1, 2, 4, 8, then every 15 seconds, for up to two minutes,
// and the window shows one calm wait for all of it (src/lib/waking.ts).
//
// What this holds shut: a waking machine showing the window an error; a
// retry that is the same sealed request again, which the machine would
// refuse as a replay; any other failure being asked again on a timer and
// hidden; asking for longer than two minutes; and a message sent
// meanwhile vanishing, being sent twice, or being lost when the machine
// never wakes.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deviceKeys, startRemoteProxy } from "../electron/remote.mjs";
import {
  WAKE_BUDGET_MS,
  WAKE_GAVE_UP,
  WAKE_PAUSES_MS,
  createWakeWatch,
  isWakingAnswer,
  nextWakePause,
  wakePause,
  type WakeState,
} from "../electron/waking.mjs";
import { open, peek, seal } from "../server/relay-crypto.ts";
import {
  WAKE_GAVE_UP as WINDOW_GAVE_UP,
  SLOW_SEND_MS,
  currentWake,
  heldSends,
  heldToShow,
  readWake,
  sendHeld,
  takeWake,
  unsentReason,
  wakeFetch,
  wakeGaveUp,
  wakeProgress,
} from "../src/lib/waking.ts";

// ── the schedule ───────────────────────────────────────────────────────

test("a waking machine is asked again after 1, 2, 4 and 8 seconds, then every 15", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(wakePause), [1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000]);
  assert.deepEqual([...WAKE_PAUSES_MS], [1_000, 2_000, 4_000, 8_000, 15_000]);
  assert.equal(WAKE_BUDGET_MS, 120_000);
});

test("no ask is started past two minutes", () => {
  assert.equal(nextWakePause(1, 0), 1_000);
  // a pause that ends exactly at the two minutes is still allowed
  assert.equal(nextWakePause(6, 105_000), 15_000);
  assert.equal(nextWakePause(6, 105_001), null);
  assert.equal(nextWakePause(1, 119_500), null);
});

// "Not connected" is also a 503. Asking it again on a timer would turn a
// workspace that is down into one that looks like it is waking forever.
test("only Bloks Cloud's own waking answer counts as waking", () => {
  assert.equal(isWakingAnswer(503, { error: "Your Bloks is waking up.", waking: true }), true);
  assert.equal(isWakingAnswer(503, { error: "not connected" }), false);
  assert.equal(isWakingAnswer(503, { waking: "yes" }), false);
  assert.equal(isWakingAnswer(504, { waking: true }), false);
  assert.equal(isWakingAnswer(200, { waking: true }), false);
  assert.equal(isWakingAnswer(503, null), false);
});

/** A pretend clock: an ask takes `hold` (Bloks Cloud holding it), and a
 * pause takes exactly its length, at once. */
function clock(hold = 12_000) {
  let t = 0;
  const pauses: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      pauses.push(ms);
      t += ms;
    },
    hold: () => (t += hold),
    pauses,
    get t() {
      return t;
    },
  };
}

test("each try is a fresh ask, made on the schedule, until the machine answers", async () => {
  const time = clock();
  const told: WakeState[] = [];
  const watch = createWakeWatch({ now: time.now, sleep: time.sleep, onChange: (s) => told.push(s) });
  let asks = 0;
  const answer = await watch.run(async () => {
    asks++;
    time.hold();
    return asks < 7 ? { waking: true } : { heard: true, status: 200 };
  });
  assert.equal(asks, 7);
  assert.deepEqual(answer, { heard: true, status: 200 });
  assert.deepEqual(time.pauses, [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
  // one wait, from when the first ask set out, then awake
  assert.deepEqual(told, [{ waking: true, since: 0, until: 120_000 }, { waking: false, outcome: "awake" }]);
});

test("a machine that never wakes is given up on after two minutes, with no ask set out past them", async () => {
  const time = clock();
  const told: WakeState[] = [];
  const watch = createWakeWatch({ now: time.now, sleep: time.sleep, onChange: (s) => told.push(s) });
  const setOut: number[] = [];
  const answer = await watch.run(async () => {
    setOut.push(time.t);
    time.hold();
    return { waking: true, status: 503 };
  });
  assert.equal(answer.waking, true);
  assert.deepEqual(setOut, [0, 13_000, 27_000, 43_000, 63_000, 90_000, 117_000]);
  assert.ok(setOut.every((at) => at <= 120_000));
  // the last ask was held, answered "waking" again, and that was the end
  assert.equal(time.t, 129_000);
  assert.deepEqual(told.at(-1), { waking: false, outcome: "gaveUp" });
});

test("any other failure goes straight back, untried", async () => {
  for (const other of [{ status: 503 }, { status: 504 }, { status: 502 }, { status: 401 }, { status: 404, heard: true }]) {
    const time = clock();
    const told: WakeState[] = [];
    const watch = createWakeWatch({ now: time.now, sleep: time.sleep, onChange: (s) => told.push(s) });
    let asks = 0;
    const answer = await watch.run(async () => (asks++, other));
    assert.equal(asks, 1, JSON.stringify(other));
    assert.deepEqual(answer, other);
    assert.deepEqual(time.pauses, []);
    assert.deepEqual(told, []);
  }
  // and one that could not reach Bloks Cloud at all throws, once
  const watch = createWakeWatch(clock());
  let asks = 0;
  await assert.rejects(
    watch.run(async () => {
      asks++;
      throw new Error("Bloks Cloud could not be reached");
    }),
    /could not be reached/,
  );
  assert.equal(asks, 1);
});

test("a failure that is not waking ends the wait it was in, without a word of waking or giving up", async () => {
  const time = clock();
  const told: WakeState[] = [];
  const watch = createWakeWatch({ now: time.now, sleep: time.sleep, onChange: (s) => told.push(s) });
  let asks = 0;
  await watch.run(async () => (++asks === 1 ? { waking: true } : { status: 504 }));
  assert.equal(asks, 2);
  assert.deepEqual(told, [{ waking: true, since: 0, until: 120_000 }, { waking: false }]);
});

// The window asks many things at once. They are one wait: the first ask
// to get through ends it for all of them, and whatever was sitting out a
// pause asks again then rather than when its pause would have ended.
test("the window's asks share one wait, and the first to get through brings the rest", async () => {
  let t = 0;
  const pauses: Array<() => void> = [];
  const told: WakeState[] = [];
  const watch = createWakeWatch({
    now: () => t,
    // a pause that only ends when it is cut short
    sleep: () => new Promise<void>((resolve) => pauses.push(resolve)) as Promise<unknown>,
    onChange: (s) => told.push(s),
  });
  let awake = false;
  const asked: string[] = [];
  const ask = (name: string) => async () => {
    asked.push(name);
    return awake ? { heard: true, name } : { waking: true };
  };
  const list = watch.run(ask("list"));
  const rooms = watch.run(ask("rooms"));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, ["list", "rooms"]);
  assert.equal(told.length, 1, "one wait, said once");
  t = 30_000;
  awake = true;
  const third = await watch.run(ask("config"));
  assert.deepEqual(third, { heard: true, name: "config" });
  // the two that were pausing asked again straight away, and got through
  assert.deepEqual(await list, { heard: true, name: "list" });
  assert.deepEqual(await rooms, { heard: true, name: "rooms" });
  assert.deepEqual(told, [{ waking: true, since: 0, until: 120_000 }, { waking: false, outcome: "awake" }]);
});

test("Bloks Cloud saying the machine is not connected starts the wait as the first ask sets out", async () => {
  const time = clock();
  const told: WakeState[] = [];
  const watch = createWakeWatch({ now: time.now, sleep: time.sleep, onChange: (s) => told.push(s) });
  watch.presume(false);
  assert.deepEqual(told, [], "nothing is asked yet, so nothing waits");
  let sawWaiting = false;
  await watch.run(async () => {
    // said before the twelve seconds of the first hold, not after
    sawWaiting = watch.state().waking;
    time.hold();
    return { heard: true };
  });
  assert.equal(sawWaiting, true);
  assert.deepEqual(told, [{ waking: true, since: 0, until: 120_000 }, { waking: false, outcome: "awake" }]);
});

// ── through the stand-in, end to end ───────────────────────────────────

const ui = mkdtempSync(join(tmpdir(), "bloks-waking-ui-"));
writeFileSync(join(ui, "index.html"), "<!doctype html><title>Bloks</title>");
after(() => rmSync(ui, { recursive: true, force: true }));

const DEVICE = { deviceId: "dev_owner", deviceToken: "owner-device-token", relayToken: "client-token" };
const keys = deviceKeys(DEVICE.deviceToken);

/**
 * Bloks Cloud in front of a machine that is asleep for its first
 * `sleeps` asks: those are answered "waking" (and move the clock on by
 * the hold), and the rest reach the machine, which opens each, notes it,
 * and answers sealed.
 */
async function sleepyRelay({ sleeps, hold = () => {}, other }: { sleeps: number; hold?: () => void; other?: { status: number; body: unknown } }) {
  const payloads: string[] = [];
  const reached: Array<{ method: string; path: string; body?: unknown; nonce?: string }> = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/space/client/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ kind: "hello", online: false })}\n\n`);
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const { payload } = JSON.parse(raw || "{}");
      payloads.push(payload);
      if (other) return send(other.status, other.body);
      if (payloads.length <= sleeps) {
        hold();
        return send(503, { error: "Your Bloks is waking up. Try again in a moment.", waking: true });
      }
      const asked = open(keys.seal, peek(payload)!) as { method: string; path: string; bodyB64?: string; nonce?: string };
      const body = asked.bodyB64 ? JSON.parse(Buffer.from(asked.bodyB64, "base64").toString("utf8")) : undefined;
      reached.push({ method: asked.method, path: asked.path, body, nonce: asked.nonce });
      send(200, { status: 200, payload: seal(keys.open, DEVICE.deviceId, { status: 200, body: { ok: true, path: asked.path } }) });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    profile: { ...DEVICE, relayUrl: url },
    payloads,
    reached,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/** What the stand-in tells the window about the wait, as it says it. */
function followWait(port: number) {
  const said: WakeState[] = [];
  const abort = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/remote/wake`, { signal: abort.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 2);
          if (line.startsWith("data:")) said.push(JSON.parse(line.slice(5)));
        }
      }
    } catch {
      /* stopped */
    }
  })();
  return { said, stop: () => abort.abort() };
}

const until = async (check: () => boolean, ms = 3_000) => {
  for (const end = Date.now() + ms; Date.now() < end && !check(); ) await new Promise((r) => setTimeout(r, 10));
  return check();
};

test("a message sent while the hosted workspace wakes is held, then sent once, freshly sealed each try", async () => {
  let t = 0;
  const relay = await sleepyRelay({ sleeps: 3, hold: () => (t += 12_000) });
  const proxy = await startRemoteProxy(relay.profile, {
    staticDir: ui,
    hosted: true,
    waking: { now: () => t, sleep: async (ms) => void (t += ms) },
  });
  const wait = followWait(proxy.port);
  try {
    assert.ok(await until(() => wait.said.length >= 1));
    const res = await fetch(`http://127.0.0.1:${proxy.port}/api/bots/river/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Draft the launch note" }),
    });
    // the window never saw the machine asleep: only the answer, late
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, path: "/api/bots/river/messages" });
    // four asks in all, every one sealed afresh (a new nonce and time), so
    // the machine does not take the one that reached it for a replay
    assert.equal(relay.payloads.length, 4);
    assert.equal(new Set(relay.payloads).size, 4);
    // and the machine heard it exactly once, words intact
    assert.equal(relay.reached.length, 1);
    assert.deepEqual(relay.reached[0].body, { text: "Draft the launch note" });
    assert.ok(relay.reached[0].nonce);
    // the window was told it was waking, and then that it was awake
    assert.ok(await until(() => wait.said.some((s) => !s.waking && s.outcome === "awake")));
    assert.ok(wait.said.some((s) => s.waking));
  } finally {
    wait.stop();
    proxy.stop();
    relay.close();
  }
});

test("a workspace that never wakes answers the window after two minutes, in words, marked as such", async () => {
  let t = 0;
  const relay = await sleepyRelay({ sleeps: Infinity, hold: () => (t += 12_000) });
  const proxy = await startRemoteProxy(relay.profile, {
    staticDir: ui,
    hosted: true,
    waking: { now: () => t, sleep: async (ms) => void (t += ms) },
  });
  const wait = followWait(proxy.port);
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/api/bots/river/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Draft the launch note" }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.deepEqual(body, { error: WAKE_GAVE_UP, waking: true });
    // nothing like "Try again" reaches the window from Bloks Cloud's words
    assert.doesNotMatch(body.error, /try again/i);
    assert.equal(relay.payloads.length, 7);
    assert.equal(relay.reached.length, 0);
    assert.ok(await until(() => wait.said.some((s) => !s.waking && s.outcome === "gaveUp")));
  } finally {
    wait.stop();
    proxy.stop();
    relay.close();
  }
});

// A window has only a few connections to the stand-in, so the wait comes
// on the event stream it already holds open, not on one more of its own.
test("the window's event stream says how the wait stands as it opens, and as it changes", async () => {
  let t = 0;
  const relay = await sleepyRelay({ sleeps: 1, hold: () => (t += 12_000) });
  const proxy = await startRemoteProxy(relay.profile, { staticDir: ui, waking: { now: () => t, sleep: async (ms) => void (t += ms) } });
  const abort = new AbortController();
  const frames: Array<Record<string, unknown>> = [];
  try {
    const events = await fetch(`http://127.0.0.1:${proxy.port}/api/events`, { signal: abort.signal });
    void (async () => {
      const reader = events.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const line = buffer.slice(0, cut).trim();
            buffer = buffer.slice(cut + 2);
            if (line.startsWith("data:")) frames.push(JSON.parse(line.slice(5)));
          }
        }
      } catch {
        /* stopped */
      }
    })();
    assert.ok(await until(() => frames.some((f) => f.kind === "remote.wake")));
    assert.deepEqual(frames.find((f) => f.kind === "remote.wake"), { kind: "remote.wake", waking: false, _seq: 0 });
    assert.equal((await fetch(`http://127.0.0.1:${proxy.port}/api/bots`)).status, 200);
    assert.ok(await until(() => frames.some((f) => f.kind === "remote.wake" && f.outcome === "awake")));
    assert.ok(frames.some((f) => f.kind === "remote.wake" && f.waking === true));
    // each says where it falls, as every frame does, and none is news: the
    // watermark as it stood, never a new one
    const hello = frames.find((f) => f.kind === "hello");
    assert.ok(frames.filter((f) => f.kind === "remote.wake").every((f) => f._seq === hello?._seq));
  } finally {
    abort.abort();
    proxy.stop();
    relay.close();
  }
});

test("a workspace that is not connected, rather than waking, says so at once and is not asked again", async () => {
  const relay = await sleepyRelay({ sleeps: 0, other: { status: 503, body: { error: "Your hosted workspace is not connected to Bloks Cloud right now." } } });
  const proxy = await startRemoteProxy(relay.profile, { staticDir: ui, hosted: true });
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/api/bots`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Your hosted workspace is not connected to Bloks Cloud right now." });
    assert.equal(relay.payloads.length, 1);
  } finally {
    proxy.stop();
    relay.close();
  }
});

// ── the window ─────────────────────────────────────────────────────────

/** A failure as the window's api() makes it from the stand-in's answer. */
const gaveUp = () => Object.assign(new Error(WAKE_GAVE_UP), { status: 503, waking: true });

test("the window and the stand-in say the same words when a wait runs out", () => {
  assert.equal(WINDOW_GAVE_UP, WAKE_GAVE_UP);
  assert.equal(wakeGaveUp(gaveUp()), WAKE_GAVE_UP);
  assert.equal(wakeGaveUp(Object.assign(new Error("not connected"), { status: 503 })), null);
  assert.equal(wakeGaveUp(new Error("boom")), null);
  assert.equal(wakeGaveUp(null), null);
});

test("a sent message stays with its conversation while it is out, and leaves once it has gone", async () => {
  const timers: Array<() => void> = [];
  let land!: (value: unknown) => void;
  const sending = sendHeld("river:main", "Draft the launch note", () => new Promise((resolve) => (land = resolve)), {
    after: "m-41",
    now: () => 1_000,
    later: (run, ms) => {
      assert.equal(ms, SLOW_SEND_MS);
      timers.push(run);
      return timers.length;
    },
  });
  assert.deepEqual(heldSends("river:main"), [{ id: heldSends("river:main")[0].id, text: "Draft the launch note", at: 1_000, after: "m-41", slow: false }]);
  timers[0]();
  assert.equal(heldSends("river:main")[0].slow, true);
  land({ ok: true });
  assert.deepEqual(await sending, { ok: true });
  assert.deepEqual(heldSends("river:main"), []);
  assert.equal(unsentReason("river:main"), null);
});

test("a message whose workspace never woke leaves the reason for the composer, and goes back", async () => {
  await assert.rejects(sendHeld("river:ideas", "Plan the week", () => Promise.reject(gaveUp())), (e: Error & { waking?: boolean }) => e.waking === true);
  assert.deepEqual(heldSends("river:ideas"), []);
  assert.equal(unsentReason("river:ideas"), WAKE_GAVE_UP);
  // the next send there clears it: it was about the last one
  await sendHeld("river:ideas", "Plan the week", async () => ({ ok: true }));
  assert.equal(unsentReason("river:ideas"), null);
  // and a failure of any other kind leaves no such reason
  await assert.rejects(sendHeld("river:ideas", "Plan the week", () => Promise.reject(new Error("refused"))));
  assert.equal(unsentReason("river:ideas"), null);
});

test("a held message is shown while the workspace wakes, faded, and not twice once its copy is in", () => {
  const send = { id: 1, text: "Draft the launch note", at: 1_000, after: "m-41", slow: false };
  const said = [
    { id: "m-40", role: "user", text: "Draft the launch note" },
    { id: "m-41", role: "bot", text: "Done." },
  ];
  // a send is over in a moment anywhere else, so nothing is drawn
  assert.deepEqual(heldToShow([send], { waking: false, hosted: false }, said), []);
  assert.deepEqual(heldToShow([send], { waking: false, hosted: true }, said), []);
  // a hosted workspace slow to take it: on its way
  assert.deepEqual(heldToShow([{ ...send, slow: true }], { waking: false, hosted: true }, said), [{ ...send, slow: true }]);
  // waking: shown, though the same words were said once before
  assert.deepEqual(heldToShow([send], { waking: true, hosted: true }, said), [send]);
  // its own copy arrived: drawn once, as itself
  const arrived = [...said, { id: "m-42", role: "user", text: "Draft the launch note" }];
  assert.deepEqual(heldToShow([send], { waking: true, hosted: true }, arrived), []);
  // or it is waiting its turn in the queue
  assert.deepEqual(heldToShow([send], { waking: true, hosted: true }, said, [{ id: "q-1", role: "user", text: "Draft the launch note" }]), []);
});

// The lists poll every few seconds. Held at the stand-in for the whole
// wait, each read held one of the window's few connections to it, and a
// message sent meanwhile queued behind them in the browser instead of
// waiting at the stand-in to go the moment the workspace answered.
test("while the workspace wakes, reads wait in the page, the same one asked once, and writes go straight on", async () => {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    takeWake({ waking: true, since: Date.now(), until: Date.now() + 120_000 });
    const first = wakeFetch("/api/activity");
    const again = wakeFetch("/api/activity");
    const other = wakeFetch("/api/bloks");
    const write = await wakeFetch("/api/bots/river/messages", { method: "POST", body: "{}" });
    assert.equal(write.status, 200);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(asked, ["POST /api/bots/river/messages"]);
    takeWake({ waking: false, outcome: "awake" });
    const [a, b, c] = await Promise.all([first, again, other]);
    assert.deepEqual(await a.json(), { ok: true });
    assert.deepEqual(await b.json(), { ok: true });
    assert.deepEqual(await c.json(), { ok: true });
    assert.deepEqual(asked.slice(1).sort(), ["GET /api/activity", "GET /api/bloks"]);
    // and with no wait, a read is only a read
    await wakeFetch("/api/activity");
    assert.equal(asked.length, 4);
  } finally {
    globalThis.fetch = real;
    takeWake({ waking: false });
  }
  assert.equal(currentWake().waking, false);
});

test("the window reads the wait it is told, and its bar moves without ever claiming to be done", () => {
  assert.deepEqual(readWake({ waking: true, since: 10, until: 120_010 }), { waking: true, since: 10, until: 120_010 });
  assert.deepEqual(readWake({ waking: false, outcome: "gaveUp" }), { waking: false, outcome: "gaveUp" });
  assert.deepEqual(readWake({ waking: true }), { waking: false });
  assert.deepEqual(readWake("nonsense"), { waking: false });
  assert.equal(wakeProgress(0, 120_000), 0);
  const early = wakeProgress(5_000, 120_000);
  const late = wakeProgress(110_000, 120_000);
  assert.ok(early > 0 && early < late, `${early} then ${late}`);
  assert.ok(wakeProgress(10 * 60_000, 120_000) <= 0.95);
});
