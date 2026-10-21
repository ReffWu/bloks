// The app's questions to its workspaces' servers, and the lists it
// answers theirs with. Plain Node, so it can be tested outside Electron
// (test/other-workspaces.test.ts).
//
// The app and each server talk over the port Electron gives only to its
// own children. A server's questions to the app are answered in main.mjs
// (answerServer); this is the other direction, where the app asks one
// workspace's server something on behalf of another (a pairing for the
// owner's phone), and waits a little for the answer.

/** Questions put to servers, each waiting for its answer by id. */
export class ServerAsks {
  #seq = 0;
  #waiting = new Map();

  /** Asks the server behind `child`; resolves with its answer, or with an
   * error after `timeoutMs` when it says nothing. */
  ask(child, what, payload = {}, timeoutMs = 10_000) {
    if (!child) return Promise.resolve({ ok: false, status: 503, error: "That workspace is not running." });
    const ask = `m${++this.#seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(ask);
        resolve({ ok: false, status: 504, error: "That workspace did not answer in time." });
      }, timeoutMs);
      this.#waiting.set(ask, { resolve, timer });
      try {
        child.postMessage({ ...payload, kind: "ask", ask, what });
      } catch {
        clearTimeout(timer);
        this.#waiting.delete(ask);
        resolve({ ok: false, status: 503, error: "That workspace is not running." });
      }
    });
  }

  /** A server's answer ("desktop.answer"): true when it was one we were
   * waiting for. */
  heard(said) {
    if (said?.kind !== "desktop.answer" || typeof said.ask !== "string") return false;
    const waiting = this.#waiting.get(said.ask);
    if (!waiting) return false;
    clearTimeout(waiting.timer);
    this.#waiting.delete(said.ask);
    const { kind: _kind, ask: _ask, ...answer } = said;
    waiting.resolve(answer);
    return true;
  }
}

/** The kinds a person owns and this computer runs: what a phone paired
 * with one of them may learn of and pair with. Never one they joined
 * (somebody else's) or a hosted one (paired from the Plan page). */
export const OWN_LOCAL_KINDS = Object.freeze(["personal", "business", "custom"]);

/**
 * The workspaces a phone paired with `askedFrom` is told about: the
 * person's own ones on this computer, in the list's order, with the one
 * it asked marked `here`. `checks` maps an id to what its server said
 * about pairing ({ pairable, why }), when it said anything.
 */
export function othersFor(registry, askedFrom, checks = {}) {
  return registry.workspaces
    .filter((w) => OWN_LOCAL_KINDS.includes(w.kind))
    .map((w) => {
      const here = w.id === askedFrom;
      const check = checks[w.id];
      return {
        id: w.id,
        name: w.name,
        kind: w.kind,
        mark: w.mark ?? null,
        team: w.team === true,
        here,
        // the one it asked is paired already
        pairable: here ? false : typeof check?.pairable === "boolean" ? check.pairable : null,
        why: here ? null : typeof check?.why === "string" ? check.why : null,
      };
    });
}

/** Why a phone paired with `askedFrom` may not have a pairing for
 * `target`, or null when it may. */
export function pairRefusal(registry, askedFrom, target) {
  const from = registry.workspaces.find((w) => w.id === askedFrom);
  if (!from || !OWN_LOCAL_KINDS.includes(from.kind)) return { status: 403, error: "Only a workspace of your own on this computer can ask for the others." };
  if (target === askedFrom) return { status: 409, error: "This phone is paired with that workspace already." };
  const ws = registry.workspaces.find((w) => w.id === target);
  if (!ws || !OWN_LOCAL_KINDS.includes(ws.kind)) return { status: 404, error: "There is no such workspace of yours on this computer." };
  return null;
}
