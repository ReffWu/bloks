// A workspace's mute and notification level, said to its server when that
// server is on another machine (GitHub 391).
//
// A server this app started hears them on the line Electron gives its
// children (handAttention in main.mjs). A workspace reached through the
// stand-in on loopback (electron/remote.mjs) has no such line: your own
// hosted one, and a joined one where this device is the owner's. Those
// are told on the owner's route, PUT /api/workspace/attention, through the
// same stand-in the window uses, and their server keeps it
// (server/attention.ts).
//
// Only a change is said. The app tells its servers again on every change
// to its list, and a hosted workspace that sleeps is woken by any request,
// so what each one last took is remembered here, across restarts, and the
// same word is not sent twice. A joined workspace is asked first whether
// the route is this device's at all: one somebody else owns refuses a
// member and an admin, and then hears nothing of their mute, ever.
//
// Plain Node (no Electron imports), so it can be driven in a test.
import fs from "node:fs";

/** The word one workspace's entry gives, as its server takes it. */
export function attentionWord(ws) {
  return { mute: ws?.mute ?? null, notify: ws?.notify ?? "all" };
}

const REFUSED = "refused";

/**
 * `file` is where what each server last took is kept. `fetcher` stands in
 * for fetch in a test.
 */
export function createAttentionSayer({ file, fetcher = (...args) => fetch(...args), timeoutMs = 20_000 } = {}) {
  let said = null;
  /** Per workspace, for this run of the app: the word wanted, whether a
   * send is under way, and a word its server would not take. */
  const runs = new Map();

  const saidNow = () => {
    if (said) return said;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      said = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      said = {};
    }
    return said;
  };

  const note = (id, value) => {
    const all = saidNow();
    if (value === undefined) delete all[id];
    else all[id] = value;
    try {
      fs.writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
    } catch {
      /* said again on the next change, which is no harm */
    }
  };

  const runOf = (id) => {
    let run = runs.get(id);
    if (!run) runs.set(id, (run = { want: null, busy: false, owner: false, notTaken: null }));
    return run;
  };

  /**
   * Says `word` to the workspace `id`, whose stand-in answers at `base`,
   * unless its server already took it. Resolves when there is nothing more
   * to say; never throws.
   */
  async function say(id, { kind, base }, word) {
    const run = runOf(id);
    run.want = JSON.stringify(attentionWord(word));
    if (run.busy) return;
    run.busy = true;
    try {
      // a change made while one was on its way is sent after it
      while (saidNow()[id] !== REFUSED && saidNow()[id] !== run.want && run.notTaken !== run.want) {
        const want = run.want;
        const url = `${base}/api/workspace/attention`;
        if (kind === "joined" && !run.owner) {
          const look = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
          if (look.status === 401 || look.status === 403) return note(id, REFUSED);
          // a server from before the route, or not answering properly:
          // asked again when this app next starts
          if (!look.ok) return void (run.notTaken = want);
          run.owner = true;
        }
        const res = await fetcher(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: want,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 401 || res.status === 403) return note(id, REFUSED);
        if (!res.ok) return void (run.notTaken = want);
        note(id, want);
      }
    } catch {
      /* not reachable now: tried again when the list next changes */
    } finally {
      run.busy = false;
    }
  }

  /** A workspace whose server is a different one now (a new pairing, a
   * workspace moved onto it), or that is gone: told afresh, if at all. */
  function forget(id) {
    runs.delete(id);
    if (saidNow()[id] !== undefined) note(id, undefined);
  }

  return { say, forget };
}
