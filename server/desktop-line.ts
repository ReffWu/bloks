// This server's line to the desktop app that started it, for questions
// with answers.
//
// The app and its servers already talk over the port Electron gives only
// to its own children (the licence, the name, banners): no network, no
// credential, nothing another program can listen to. Those are things
// said. Some things a phone asks of a workspace are the app's to decide,
// because they are about this computer rather than this workspace: which
// other workspaces are here, or whether another one already wears a mark.
// So the server asks, and waits a little for the answer, and a server
// with no app behind it (bloks-server, a hosted machine) is told so at
// once rather than left waiting.
//
// The app asks its servers things the same way (a pairing for a phone,
// electron/server-line.mjs), and this answers those.

type Port = { postMessage(message: unknown): void };

/** What either end answers: done, or why not, with the HTTP status a
 * route would use for it. Anything else rides along. */
export interface LineAnswer {
  ok?: boolean;
  error?: string;
  status?: number;
  [key: string]: unknown;
}

type Handler = (asked: Record<string, unknown>) => LineAnswer | Promise<LineAnswer>;

const ASK_ID = /^[\w.-]{1,40}$/;

export class DesktopLine {
  private seq = 0;
  private readonly waiting = new Map<string, { resolve(answer: LineAnswer): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly handlers = new Map<string, Handler>();
  private readonly port: Port | null;
  private readonly timeoutMs: number;

  constructor(port: Port | null | undefined, timeoutMs = 10_000) {
    this.port = port ?? null;
    this.timeoutMs = timeoutMs;
  }

  /** Whether there is an app to ask at all. */
  get available(): boolean {
    return Boolean(this.port);
  }

  /** Asks the app; null when there is no app. A question it never
   * answers is answered here, after a while, rather than hanging. */
  ask(what: string, payload: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<LineAnswer> | null {
    const port = this.port;
    if (!port) return null;
    const ask = `a${++this.seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(ask);
        resolve({ error: "The Bloks app on this computer did not answer in time.", status: 504 });
      }, timeoutMs);
      this.waiting.set(ask, { resolve, timer });
      try {
        port.postMessage({ ...payload, kind: "desktop.ask", ask, what });
      } catch {
        clearTimeout(timer);
        this.waiting.delete(ask);
        resolve({ error: "The Bloks app on this computer could not be asked.", status: 502 });
      }
    });
  }

  /** What this server answers when the app asks `what`. */
  answer(what: string, handler: Handler) {
    this.handlers.set(what, handler);
  }

  /** A message from the app: true when it belonged to this line (an
   * answer to one of ours, or a question for us), false for the rest. */
  heard(data: unknown): boolean {
    const said = data as { kind?: unknown; ask?: unknown; what?: unknown } | null;
    if (!said || typeof said.ask !== "string" || !ASK_ID.test(said.ask)) return false;
    if (said.kind === "answer") {
      const waiting = this.waiting.get(said.ask);
      if (waiting) {
        clearTimeout(waiting.timer);
        this.waiting.delete(said.ask);
        const { kind: _kind, ask: _ask, ...answer } = said as Record<string, unknown>;
        waiting.resolve(answer as LineAnswer);
      }
      return true;
    }
    if (said.kind === "ask" && typeof said.what === "string") {
      const handler = this.handlers.get(said.what);
      const ask = said.ask;
      void Promise.resolve()
        .then(() => (handler ? handler(said as Record<string, unknown>) : { error: "This server does not answer that.", status: 404 }))
        .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error), status: 500 }))
        .then((answer) => {
          try {
            this.port?.postMessage({ ...answer, kind: "desktop.answer", ask });
          } catch {
            /* the app is going; its question goes with it */
          }
        });
      return true;
    }
    return false;
  }
}
