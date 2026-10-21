// A hosted workspace that has gone to sleep, and waiting for it to wake.
//
// A hosted workspace on a plan that sleeps when nobody is using it is
// woken by Bloks Cloud: the first ask to arrive starts the machine, and
// Bloks Cloud holds that ask for about twelve seconds. A machine back by
// then answers as if it had never slept. One that takes longer (a cold
// start can take two minutes) gets the answer "waking" instead, and that
// answer promises the ask never reached it. So asking again is always
// safe, a sent message included, and that is all this does: ask again, a
// little less often as the wait goes on, until the machine answers or two
// minutes have gone. Any other failure is not this file's business and
// goes straight back, untried.
//
// One window asks many things at once (the agent list, the rooms, the
// settings), so they share one wait: it begins when the first of them
// finds the machine asleep, it is what the window shows, and its two
// minutes are everyone's. The moment any ask gets through, the machine is
// up, the wait is over, and whatever was sitting out a pause asks again
// at once instead of finishing it.
//
// Nothing here knows about the network or the screen, and the clock is
// handed in, so the tests can check the whole schedule without waiting
// two minutes for it. Plain Node, as remote.mjs is.

/** The pauses before asking a waking machine again: after its first
 * "waking", its second, and so on, the last repeating. Short at first,
 * because Bloks Cloud has already held the ask twelve seconds before
 * saying so; never long, because asking more often would not hurry a
 * machine that is rebuilding, and every ask waits at Bloks Cloud anyway. */
export const WAKE_PAUSES_MS = Object.freeze([1_000, 2_000, 4_000, 8_000, 15_000]);

/** How long a wait goes on, from when the first ask that found the
 * machine asleep set out. About as long as the slowest wake takes. */
export const WAKE_BUDGET_MS = 2 * 60_000;

/** What an ask that never got through says once the wait is over. The
 * window shows these words (src/lib/waking.ts keeps the same). */
export const WAKE_GAVE_UP = "Your hosted workspace did not wake up in time.";

/** The pause after `answers` waking answers in a row (one or more). */
export function wakePause(answers) {
  if (!(answers >= 1)) return 0;
  return WAKE_PAUSES_MS[Math.min(Math.floor(answers), WAKE_PAUSES_MS.length) - 1];
}

/** The pause before asking again, or null when asking again would start
 * past the budget. `elapsed` is how long the wait has gone on so far. */
export function nextWakePause(answers, elapsed, budget = WAKE_BUDGET_MS) {
  const pause = wakePause(answers);
  return elapsed + pause <= budget ? pause : null;
}

/** Whether Bloks Cloud's answer to an ask is "waking": a 503 that says so.
 * A 503 that does not (not connected) and every other failure is a
 * different thing, which asking again on a timer would only hide. */
export function isWakingAnswer(status, body) {
  return status === 503 && body !== null && typeof body === "object" && body.waking === true;
}

const restFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

/**
 * The one wait a window's asks share. `run(ask)` asks, and asks again for
 * as long as the answer is waking; `ask` makes a fresh request each time
 * and resolves `{ waking, heard, ... }`: `waking` for Bloks Cloud saying
 * so, `heard` for an answer that came from the machine itself. Whatever
 * the last ask resolved is what `run` resolves; what it throws, `run`
 * throws, untried.
 *
 * `onChange` hears the wait as the window shows it: `{ waking: true,
 * since, until }` while one goes on, and `{ waking: false, outcome }`
 * once it is over, "awake" when the machine answered and "gaveUp" when
 * the two minutes ran out (no outcome when the last ask waiting simply
 * went: another failure, or the window that asked closed).
 */
export function createWakeWatch({ now = Date.now, sleep = restFor, budget = WAKE_BUDGET_MS, onChange = () => {} } = {}) {
  /** Bloks Cloud said the machine is not connected, on a workspace that
   * sleeps: the next ask will wake it, so the window may say so from the
   * start rather than after the twelve seconds of the first hold. */
  let asleep = false;
  /** The wait going on: when it began, who is in it, how it ended. */
  let current = null;
  let told = { waking: false };
  let stopped = false;
  /** Every ask out now, with the wait it is part of, if any. */
  const out = new Set();
  const everyKick = new Set();

  const tell = (state) => {
    told = state;
    try {
      onChange(state);
    } catch {
      /* a listener's trouble is not the ask's */
    }
  };

  const join = (me, at) => {
    if (me.wait && me.wait === current) return;
    leave(me);
    if (!current) {
      current = { since: at, members: 0, over: null, kicks: new Set() };
      tell({ waking: true, since: at, until: at + budget });
    }
    current.members++;
    me.wait = current;
  };

  const end = (wait, outcome) => {
    if (wait.over) return;
    wait.over = outcome;
    if (current === wait) current = null;
    tell({ waking: false, outcome });
    for (const kick of [...wait.kicks]) kick();
  };

  const leave = (me) => {
    const wait = me.wait;
    me.wait = null;
    if (!wait) return;
    wait.members--;
    if (wait.over || wait.members > 0 || current !== wait) return;
    // the last ask in it went without the machine answering or the time
    // running out, so there is nothing left to wait for and nothing to say
    wait.over = "left";
    current = null;
    tell({ waking: false });
  };

  /** The machine answered: whatever waits, waits no longer. */
  const heard = () => {
    asleep = false;
    if (current) end(current, "awake");
    else if (told.outcome === "gaveUp") tell({ waking: false, outcome: "awake" });
  };

  /** A pause, cut short when the wait ends either way or this stops. */
  const rest = (wait, ms) =>
    new Promise((resolve) => {
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        wait.kicks.delete(go);
        everyKick.delete(go);
        resolve();
      };
      wait.kicks.add(go);
      everyKick.add(go);
      Promise.resolve(sleep(ms)).then(go, go);
    });

  async function run(ask, { gone = () => false } = {}) {
    const me = { wait: null };
    out.add(me);
    let answers = 0;
    try {
      for (;;) {
        const setOut = now();
        if (asleep && !me.wait) join(me, setOut);
        const answer = await ask();
        if (!answer?.waking) {
          if (answer?.heard) heard();
          return answer;
        }
        // the wait this ask set out in ran out while it was out: it ends
        // with the rest, which the window has already been told
        if (me.wait?.over === "gaveUp" || stopped || gone()) return answer;
        if (me.wait?.over === "awake") {
          // it woke while this ask was out: what came back is stale, and
          // the next ask finds the machine up, or starts a wait of its own
          leave(me);
          answers = 0;
          continue;
        }
        answers++;
        asleep = true;
        join(me, setOut);
        const wait = me.wait;
        const pause = nextWakePause(answers, now() - wait.since, budget);
        if (pause === null) {
          end(wait, "gaveUp");
          return answer;
        }
        await rest(wait, pause);
        if (wait.over === "gaveUp" || stopped || gone()) return answer;
        if (wait.over === "awake") {
          leave(me);
          answers = 0;
        }
      }
    } finally {
      out.delete(me);
      leave(me);
    }
  }

  return {
    run,
    /** What Bloks Cloud's own line says of the machine, for a workspace
     * that sleeps: not connected means asleep, and any ask out now is
     * waiting on a wake. */
    presume(online) {
      if (online) return heard();
      asleep = true;
      const at = now();
      for (const me of out) if (!me.wait) join(me, at);
    },
    /** The wait as the window should show it right now. */
    state: () => told,
    /** Lets every pause go, so nothing is left asking after a stop. */
    stop() {
      stopped = true;
      for (const kick of [...everyKick]) kick();
    },
  };
}
