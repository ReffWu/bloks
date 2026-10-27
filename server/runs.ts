// A job given to an agent from a script, and the moment it is done.
//
// `bloks-server run` hands an agent a task and waits for the answer, which
// sounds like waiting for one turn and is not. The agent may hand part of
// the work to a teammate with `bloks say`, the teammate reports back, and
// that report starts the agent's next turn; a failed turn is asked again
// after a wait; the turn's changes card is made after the turn has ended.
// A script that stopped at the first turn's end would print "I've asked
// Ivy" and exit 0 while the work was still going.
//
// So a run is a set of conversations, not a turn. It starts with the one
// the task went to, and every conversation an agent in the run hands work
// to joins it (link). It is done when every one of them has been quiet,
// in the server's own sense (laneQuiet in server/index.ts: not busy, not
// claimed, nothing waiting in its queue, no card being made, no goal on
// its way), for a moment on end. The moment matters: a handoff is
// admitted inside the sender's turn, but between one turn ending and the
// next starting there is a gap a single look could fall into.
//
// A card asking the person (an approval, a question) stops a run where it
// is, as needs-you, until it is answered. Nothing here answers one: what
// the workspace would ask about, a script is asked about too.
//
// Everything a run reports is read off what the server already says
// (message frames, turn ends, the turn log), so a run says nothing the
// person would not read in the app. Kept in memory and bounded; a restart
// ends every run, as it ends every stream.
import { newId } from "./contracts.ts";

export type RunStatus = "working" | "needs-you" | "done" | "failed" | "stopped";

/** One line of what happened, for a terminal to print as it goes. */
export interface RunStep {
  n: number;
  at: number;
  kind: "started" | "tool" | "said" | "handoff" | "ask" | "file" | "notice" | "ended";
  agent: string;
  text: string;
}

/** A card in one of the run's conversations, waiting on the person. */
export interface RunAsk {
  requestId: string;
  botId: string;
  agent: string;
  laneId: string;
  messageId: string;
  title: string;
  subtitle: string;
  options: string[];
  /** A yes or no on something the agent wants to do, rather than a
   * question (isApproval in src/lib/cardAnswer.ts). */
  approval: boolean;
}

/** Something the run left behind: a deliverable an agent saved, or a file
 * a turn changed in its folder, as its changes card lists it. */
export type RunFile =
  | { kind: "artifact"; botId: string; agent: string; name: string; size: number; mime: string }
  | { kind: "change"; botId: string; agent: string; path: string; status: "added" | "modified" | "deleted"; checkpointId: string };

export interface RunView {
  id: string;
  agent: { id: string; name: string };
  conversation: { id: string; title: string };
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  /** Milliseconds, to now while it is working. */
  duration: number;
  /** The agent's last words in the conversation the task went to. */
  reply: string | null;
  error: string | null;
  turns: number;
  tokens: { input: number; output: number };
  /** US dollars, or null when no engine in the run said what it cost. */
  cost: number | null;
  /** Every agent that took a turn in the run. */
  agents: Array<{ id: string; name: string }>;
  files: RunFile[];
  asks: RunAsk[];
  /** Steps after the `after` asked for, and the number to ask after next. */
  steps: RunStep[];
  next: number;
}

/** The shape of a message frame this reads; the store's Message, loosely. */
export interface SeenMessage {
  id: string;
  role: string;
  kind: string;
  text?: string;
  queued?: boolean;
  from?: string;
  tool?: { name: string; command?: string; ok?: boolean };
  card?: { title?: string; subtitle?: string; options?: string[]; requestId?: string; tool?: string; answered?: string };
  artifact?: { name: string; mime: string; size: number };
  changes?: { checkpointId: string; files: Array<{ path: string; status: "added" | "modified" | "deleted"; shared?: boolean }> };
  agent?: { dir: "in" | "out"; peerName?: string };
}

interface Run {
  id: string;
  botId: string;
  agentName: string;
  laneId: string;
  laneTitle: string;
  lanes: Set<string>;
  /** Rooms an agent in the run said something into, for the turns there. */
  rooms: Set<string>;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  quietSince: number | null;
  reply: string | null;
  error: string | null;
  /** How the start conversation's last turn ended, once one has. */
  lastEnd: { ok: boolean; why: string | null } | null;
  turns: number;
  input: number;
  output: number;
  cost: number | null;
  agents: Map<string, string>;
  files: RunFile[];
  asks: Map<string, RunAsk>;
  steps: RunStep[];
  next: number;
  /** Bumped on every change, for the long poll. */
  version: number;
  stopped: boolean;
}

export interface RunsOptions {
  now?: () => number;
  /** How long every conversation in a run stays quiet before it is done. */
  quietMs?: number;
  /** How long a finished run is kept for the script to read. */
  keepMs?: number;
}

/** A run's conversations stay quiet this long before it is done: past the
 * gap between one turn ending and the turn its handoff starts. */
export const RUN_QUIET_MS = 1_500;
const KEEP_MS = 60 * 60_000;
const MAX_RUNS = 200;
const MAX_STEPS = 500;
const MAX_FILES = 500;
const STEP_CHARS = 300;
/** What an agent said is a step a terminal shows whole, as a chat would,
 * up to a long reply; a tool call or a notice is one line. */
const SAID_CHARS = 8_000;
/** The longest a long poll waits for something new. */
export const RUN_WAIT_MAX_MS = 25_000;

const clip = (text: string, kind: RunStep["kind"]) => {
  const said = kind === "said";
  const max = said ? SAID_CHARS : STEP_CHARS;
  const line = said ? text.trim() : text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 3).trimEnd()}...` : line;
};

export class Runs {
  private runs = new Map<string, Run>();
  private waiters = new Map<string, Set<() => void>>();
  private readonly now: () => number;
  private readonly quietMs: number;
  private readonly keepMs: number;

  constructor(options: RunsOptions = {}) {
    this.now = options.now ?? Date.now;
    this.quietMs = options.quietMs ?? RUN_QUIET_MS;
    this.keepMs = options.keepMs ?? KEEP_MS;
  }

  begin(start: { botId: string; agent: string; laneId: string; laneTitle: string }): RunView {
    this.sweep();
    const run: Run = {
      id: newId(),
      botId: start.botId,
      agentName: start.agent,
      laneId: start.laneId,
      laneTitle: start.laneTitle,
      lanes: new Set([start.laneId]),
      rooms: new Set(),
      status: "working",
      startedAt: this.now(),
      endedAt: null,
      quietSince: null,
      reply: null,
      error: null,
      lastEnd: null,
      turns: 0,
      input: 0,
      output: 0,
      cost: null,
      agents: new Map(),
      files: [],
      asks: new Map(),
      steps: [],
      next: 0,
      version: 0,
      stopped: false,
    };
    this.runs.set(run.id, run);
    return this.view(run.id)!;
  }

  /** A run that never got going (the send was refused) leaves no trace. */
  drop(id: string) {
    this.runs.delete(id);
  }

  /** Whether any run is still waiting on its conversations. */
  get active(): boolean {
    for (const run of this.runs.values()) if (!run.endedAt) return true;
    return false;
  }

  /** The conversations a run is made of, for stopping them. */
  lanesOf(id: string): string[] {
    return [...(this.runs.get(id)?.lanes ?? [])];
  }

  roomsOf(id: string): string[] {
    return [...(this.runs.get(id)?.rooms ?? [])];
  }

  private live(laneId: string, rooms = false): Run[] {
    return [...this.runs.values()].filter((run) => !run.endedAt && (run.lanes.has(laneId) || (rooms && run.rooms.has(laneId))));
  }

  private step(run: Run, kind: RunStep["kind"], agent: string, text: string) {
    run.steps.push({ n: ++run.next, at: this.now(), kind, agent, text: clip(text, kind) });
    if (run.steps.length > MAX_STEPS) run.steps.splice(0, run.steps.length - MAX_STEPS);
    this.changed(run);
  }

  private changed(run: Run) {
    run.version++;
    run.quietSince = null;
    const waiting = this.waiters.get(run.id);
    if (!waiting) return;
    this.waiters.delete(run.id);
    for (const wake of waiting) wake();
  }

  /** An agent whose turn runs in `fromLane` handed work to `toLane`. The
   * handoff joins every run the sender is in, whichever way it went:
   * started a turn, joined one, or waited behind one. */
  link(fromLane: string, toLane: string, sender: string, recipient: string) {
    for (const run of this.live(fromLane)) {
      if (run.lanes.has(toLane)) continue;
      run.lanes.add(toLane);
      this.step(run, "handoff", sender, `handed work to ${recipient}`);
    }
  }

  /** An agent in a run said something into a room: the turns it wakes
   * there are the run's too, until the room is quiet. */
  linkRoom(fromLane: string, roomId: string) {
    for (const run of this.live(fromLane)) run.rooms.add(roomId);
  }

  started(laneId: string, botId: string, agent: string) {
    for (const run of this.live(laneId)) {
      run.turns++;
      run.agents.set(botId, agent);
      this.step(run, "started", agent, `${agent} is working`);
    }
  }

  /** What one attempt at a turn spent, from the turn log. */
  spent(laneId: string, use: { input: number; output: number; cost: number | null }) {
    for (const run of this.live(laneId)) {
      run.input += use.input;
      run.output += use.output;
      if (typeof use.cost === "number") run.cost = (run.cost ?? 0) + use.cost;
      this.changed(run);
    }
  }

  /** A lane's turn is over for good: asked again and handed to a backup
   * already, and nothing more will pick it up (settleOwners). */
  ended(laneId: string, outcome: { ok: boolean; why: string | null }) {
    for (const run of this.live(laneId)) {
      if (laneId === run.laneId) run.lastEnd = outcome;
      this.changed(run);
    }
  }

  /** Every message the server writes in a conversation, as its frame. */
  message(threadId: string, message: SeenMessage, who: { botId: string; agent: string } | null) {
    if (message.role !== "bot" || message.queued || !who) return;
    for (const run of this.live(threadId, true)) {
      const agent = who.agent;
      switch (message.kind) {
        case "text":
          if (!message.text) break;
          if (threadId === run.laneId && (!message.from || message.from === run.botId)) run.reply = message.text;
          this.step(run, "said", agent, message.text);
          break;
        case "activity":
          if (message.agent?.dir === "out" || !message.tool?.name) break;
          this.step(run, "tool", agent, message.tool.command ? `${message.tool.name}: ${message.tool.command}` : message.tool.name);
          break;
        case "notice":
          if (!message.text) break;
          if (threadId === run.laneId) run.error = message.text;
          this.step(run, "notice", agent, message.text);
          break;
        case "options": {
          const card = message.card;
          if (!card?.requestId || card.answered) break;
          run.asks.set(card.requestId, {
            requestId: card.requestId,
            botId: who.botId,
            agent,
            laneId: threadId,
            messageId: message.id,
            title: card.title ?? "",
            subtitle: card.subtitle ?? "",
            options: card.options ?? [],
            approval: Boolean(card.tool) || card.title === "Approval needed",
          });
          this.step(run, "ask", agent, [card.title, card.subtitle].filter(Boolean).join(": "));
          break;
        }
        case "artifact":
          if (!message.artifact) break;
          this.file(run, { kind: "artifact", botId: who.botId, agent, ...message.artifact });
          this.step(run, "file", agent, `saved ${message.artifact.name}`);
          break;
        case "changes":
          for (const file of message.changes?.files ?? []) {
            if (file.shared) continue;
            this.file(run, { kind: "change", botId: who.botId, agent, path: file.path, status: file.status, checkpointId: message.changes!.checkpointId });
          }
          if (message.changes?.files.length) this.step(run, "file", agent, `changed ${message.changes.files.length === 1 ? message.changes.files[0].path : `${message.changes.files.length} files`}`);
          break;
      }
    }
  }

  private file(run: Run, file: RunFile) {
    // the latest word on a path wins: a file added and then edited by a
    // later turn in the run is one file, as it now is
    const same = (f: RunFile) =>
      f.kind === file.kind && f.botId === file.botId && (f.kind === "artifact" ? f.name === (file as typeof f).name : f.path === (file as typeof f).path);
    const at = run.files.findIndex(same);
    if (at >= 0) run.files.splice(at, 1);
    if (run.files.length < MAX_FILES) run.files.push(file);
  }

  /** Stopped from the script (Ctrl+C, a timeout) or the app. */
  stop(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || run.endedAt) return false;
    run.stopped = true;
    run.asks.clear();
    this.finish(run, "stopped");
    return true;
  }

  private finish(run: Run, status: RunStatus) {
    run.status = status;
    run.endedAt = this.now();
    if (status === "done") run.error = null;
    this.step(run, "ended", run.agentName, status === "done" ? "done" : status === "stopped" ? "stopped" : (run.error ?? "the turn did not finish"));
  }

  /**
   * Looks at every working run: a card waiting makes it needs-you; every
   * conversation quiet for long enough makes it done or failed, by how the
   * start conversation's last turn ended. `quiet` and `asking` are the
   * server's own reads, passed in so this stays a plain function of them.
   */
  tick(quiet: (laneId: string) => boolean, roomQuiet: (roomId: string) => boolean, asking: (requestId: string) => boolean) {
    const now = this.now();
    for (const run of this.runs.values()) {
      if (run.endedAt) continue;
      for (const [id] of run.asks) if (!asking(id)) run.asks.delete(id);
      const status: RunStatus = run.asks.size ? "needs-you" : "working";
      if (status !== run.status) {
        run.status = status;
        this.changed(run);
      }
      if (run.asks.size) continue;
      const still = [...run.lanes].every(quiet) && [...run.rooms].every(roomQuiet);
      if (!still) {
        run.quietSince = null;
        continue;
      }
      run.quietSince ??= now;
      if (now - run.quietSince < this.quietMs) continue;
      const ok = run.lastEnd ? run.lastEnd.ok : run.turns > 0 && run.reply !== null;
      if (!ok && run.lastEnd?.why === "interrupted") this.finish(run, "stopped");
      else if (!ok && !run.error) {
        run.error = run.lastEnd?.why ? `The turn ended: ${run.lastEnd.why}` : run.turns ? "The turn did not finish." : "Nothing ran.";
        this.finish(run, "failed");
      } else this.finish(run, ok ? "done" : "failed");
    }
  }

  view(id: string, after = 0): RunView | null {
    const run = this.runs.get(id);
    if (!run) return null;
    const end = run.endedAt ?? this.now();
    return {
      id: run.id,
      agent: { id: run.botId, name: run.agentName },
      conversation: { id: run.laneId, title: run.laneTitle },
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      duration: end - run.startedAt,
      reply: run.reply,
      error: run.status === "done" ? null : run.error,
      turns: run.turns,
      tokens: { input: run.input, output: run.output },
      cost: run.cost === null ? null : Math.round(run.cost * 1e6) / 1e6,
      agents: [...run.agents].map(([agentId, name]) => ({ id: agentId, name })),
      files: [...run.files],
      asks: [...run.asks.values()],
      steps: run.steps.filter((s) => s.n > after),
      next: run.next,
    };
  }

  /** Resolves once the run changes after `version`, or after `ms`. */
  async wait(id: string, ms: number): Promise<void> {
    const run = this.runs.get(id);
    if (!run || run.endedAt) return;
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(id) ?? new Set();
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        set.delete(wake);
        resolve();
      }, Math.max(0, Math.min(ms, RUN_WAIT_MAX_MS)));
      set.add(wake);
      this.waiters.set(id, set);
    });
  }

  /** Finished runs past their keep, and the oldest past the cap. */
  private sweep() {
    const now = this.now();
    for (const [id, run] of this.runs) if (run.endedAt && now - run.endedAt > this.keepMs) this.runs.delete(id);
    while (this.runs.size >= MAX_RUNS) {
      const oldest = [...this.runs.values()].sort((a, b) => (a.endedAt ? 0 : 1) - (b.endedAt ? 0 : 1) || a.startedAt - b.startedAt)[0];
      if (!oldest) break;
      this.runs.delete(oldest.id);
    }
  }
}
