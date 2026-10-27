// What a turn did, laid out in time.
//
// The transcript says what an agent did, one row per call, in order. It
// does not say where the time went: that the turn spent forty seconds on
// one command and four seconds thinking, or sat for a minute on a card
// nobody had answered. A trace is the same turn as a waterfall, a span
// per step against one clock, so the shape of the work reads at a glance.
//
// Everything here is read off the runtime events the bus already carries
// (server/harness/bus.ts). Nothing new is asked of a driver, which is the
// point: every engine gets a trace on the day it gets events, and no
// engine can make one up.
//
// Three decisions.
//
//   Model work is what is left. No engine says "the model is thinking
//   now"; between a tool's end and the next tool's start, though, there
//   is nothing else it can be doing. So the stretches of a turn that no
//   tool and no wait covers are the model's, named by what streamed in
//   them, and a stretch too short to see is not drawn at all.
//
//   Engines count tokens two ways. Claude Code reports each message's
//   usage on its own, so a turn's tokens are their sum and each report is
//   one model call. Codex, the API engines and the ACP ones restate the
//   turn's running total, so a turn's tokens are the highest it reached,
//   and its model calls are the stretches drawn. Summing a running total
//   would count the first request of a turn once per request after it.
//
//   A trace has a ceiling. A turn that ran ten thousand commands is real,
//   and the app asking for it must not get a ten megabyte answer, so the
//   oldest finished spans are folded away past it. The totals still count
//   them: the numbers stay true when the picture is cut.
import { createReadStream, statSync } from "node:fs";

import type { RuntimeEvent } from "./contracts.ts";
import { lineSplitter } from "./ndjson.ts";

export type SpanKind = "turn" | "model" | "tool" | "agent" | "wait" | "error" | "compact";
export type SpanStatus = "running" | "ok" | "failed" | "stopped";

export interface TraceSpan {
  id: string;
  /** The turn span is the root; everything else hangs off it. */
  parentId: string | null;
  kind: SpanKind;
  status: SpanStatus;
  /** "Bash", "Read", "Thinking", "Writing", "Waiting for you". */
  name: string;
  /** One line: the command, the path, the question's summary. */
  detail?: string;
  /** Milliseconds from the trace's startedAt. */
  start: number;
  /** Null while it runs. */
  end: number | null;
  tokens?: number;
  cost?: number | null;
  /** The same call (same signature) again after it failed. */
  retry?: boolean;
}

export interface Trace {
  turnId: string | null;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds, null while it runs. */
  endedAt: number | null;
  running: boolean;
  /** The driver kind, e.g. "claudeAgent". */
  engine?: string;
  model?: string;
  spans: TraceSpan[];
  totals: {
    durationMs: number;
    /** Null when the engine does not price turns. */
    cost: number | null;
    tokens: number | null;
    modelCalls: number;
    toolCalls: number;
    errors: number;
    waits: number;
  };
}

/** GET /api/trace/live: every lane at work or waiting on the person. */
export interface LiveTraces {
  /** The server's clock, so a client can line its own up with it. */
  now: number;
  agents: Array<{
    botId: string;
    name: string;
    /** The agent's BlokColor. */
    color: string;
    /** Its pixel face's shape, and when its own picture was uploaded if
     * it has one, so the notch draws the face the rest of the app does. */
    shape?: string;
    avatarAt?: number | null;
    taskId: string;
    taskTitle: string;
    state: "working" | "needs-you";
    trace: Trace;
  }>;
}

/** Past this, the oldest finished spans are folded away. */
export const MAX_SPANS = 2_000;
/** A model stretch shorter than this is the gap between one event and the
 * next, not work anybody could see on a timeline. */
export const MIN_MODEL_MS = 150;
/** Events kept for one turn. A slimmed event is a few hundred bytes, so a
 * lane's worst is a couple of megabytes. */
export const MAX_TURN_EVENTS = 8_000;
/** How much of the end of an events file a lookup reads. Turns anybody
 * asks for are recent, and the file of a long-lived lane is not small. */
export const SCAN_BYTES = 16 * 1024 * 1024;

const DETAIL_CHARS = 200;
/** Engines whose token reports are per message rather than a running
 * total for the turn (see the top of this file). */
const PER_MESSAGE_USAGE = new Set(["claudeAgent"]);
/** Claude Code's names for handing work to a sub-agent. */
const AGENT_TOOLS = new Set(["Task", "Agent"]);

type Completed = Extract<RuntimeEvent, { type: "turn.completed" }>;

export interface TraceOptions {
  now: number;
  /** What a settled turn cost when its engine put no price on it: the
   * harness's estimate from its tokens (turnPrice in server/index.ts).
   * Absent, such a turn has no cost. */
  price?: (completed: Completed) => number | null;
}

const firstLine = (text: string | undefined): string | undefined => {
  const line = text?.split("\n").find((l) => l.trim())?.trim();
  return line ? line.slice(0, DETAIL_CHARS) : undefined;
};

/** A Codex web search opens an item and never closes it, so it is taken
 * as done as soon as the turn says anything else. Left open, every search
 * would read as stopped at the turn's end. */
const neverCloses = (event: Extract<RuntimeEvent, { type: "item.started" }>) =>
  event.provider === "codex" && event.title === "web_search";

interface Stretch {
  ordinal: number;
  start: number;
  text: boolean;
  reasoning: boolean;
  tokens: number;
  span: TraceSpan | null;
}

/**
 * One turn's events, as a trace.
 *
 * `events` are the turn's in the order the bus published them, starting
 * with its `turn.started` where there is one; anything after its
 * `turn.completed` is not this turn's. Pure: the same events and the same
 * `now` make the same trace.
 */
export function buildTrace(events: readonly RuntimeEvent[], { now, price }: TraceOptions): Trace {
  // One clock that never runs backwards. Events are stamped as they are
  // made, by more than one process for some engines, and a span that ends
  // before it starts helps nobody.
  const times: number[] = [];
  let latest = Number.NaN;
  for (const event of events) {
    let t = Date.parse(event.createdAt);
    if (!Number.isFinite(t)) t = Number.isFinite(latest) ? latest : now;
    if (Number.isFinite(latest) && t < latest) t = latest;
    times.push(t);
    latest = t;
  }
  const opened = events.findIndex((e) => e.type === "turn.started");
  const startedAt = opened >= 0 ? times[opened] : (times[0] ?? now);
  const rel = (t: number) => Math.max(0, t - startedAt);
  const turnId = (opened >= 0 ? events[opened].turnId : undefined) ?? events.find((e) => e.turnId)?.turnId ?? null;
  const engine = events[0]?.provider;
  const perMessage = engine !== undefined && PER_MESSAGE_USAGE.has(engine);

  const spans: TraceSpan[] = [];
  const tools = new Map<string, { span: TraceSpan; signature?: string }>();
  const waits = new Map<string, TraceSpan>();
  const openTools = new Set<string>();
  const openWaits = new Set<string>();
  const lingering = new Set<string>();
  const failed = new Set<string>();
  let ordinal = 0;
  // Cast rather than annotated: both are set from the helpers below, which
  // the compiler cannot see from the loop.
  let stretch = null as Stretch | null;
  // The stretch an item.started just closed: Claude Code reports a
  // message's usage after the calls the message made, so it belongs to the
  // stretch that wrote them, not to whatever comes next.
  let justClosed = null as Stretch | null;
  let errors = 0;
  let compactions = 0;
  let anonymous = 0;
  let usageReports = 0;
  let tokenSum = 0;
  let tokenHigh = 0;
  let model: string | undefined;
  let completed: Completed | null = null;
  let endedAt: number | null = null;

  const covered = () => openTools.size + openWaits.size > 0;
  const closeStretch = (t: number) => {
    if (!stretch) return;
    if (t - stretch.start >= MIN_MODEL_MS) {
      stretch.span = modelSpan(stretch, "ok", rel(t));
      spans.push(stretch.span);
    }
    justClosed = stretch;
    stretch = null;
  };
  const cover = (t: number) => {
    if (!covered()) closeStretch(t);
  };
  const uncover = (t: number) => {
    if (!covered()) stretch = { ordinal: ordinal++, start: t, text: false, reasoning: false, tokens: 0, span: null };
  };
  const modelSpan = (s: Stretch, status: SpanStatus, end: number | null): TraceSpan => ({
    id: `model:${s.ordinal}`,
    parentId: "turn",
    kind: "model",
    status,
    name: s.text ? "Writing" : s.reasoning ? "Thinking" : "Model",
    start: rel(s.start),
    end,
    ...(s.tokens ? { tokens: s.tokens } : {}),
  });
  const closeTool = (itemId: string, status: SpanStatus, t: number) => {
    const tool = tools.get(itemId);
    if (!tool || !openTools.has(itemId)) return;
    tool.span.status = status;
    tool.span.end = rel(t);
    openTools.delete(itemId);
    lingering.delete(itemId);
    if (status === "failed" && tool.signature) failed.add(tool.signature);
    uncover(t);
  };

  // The turn starts with the model reading what it was sent.
  uncover(startedAt);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const t = times[i];
    for (const itemId of [...lingering]) {
      if (itemId !== event.itemId) closeTool(itemId, "ok", t);
    }
    switch (event.type) {
      case "session.started":
        if (typeof event.model === "string" && event.model) model = event.model;
        break;
      case "item.started": {
        if (event.itemType === "reasoning") {
          if (stretch) stretch.reasoning = true;
          break;
        }
        const itemId = event.itemId ?? `anonymous-${anonymous++}`;
        if (tools.has(itemId)) break;
        cover(t);
        const name = event.title?.trim() || "Tool";
        const detail = firstLine(event.command) ?? firstLine(event.paths?.[0]);
        const span: TraceSpan = {
          id: `tool:${itemId}`,
          parentId: "turn",
          kind: event.provider === "claudeAgent" && AGENT_TOOLS.has(name) ? "agent" : "tool",
          status: "running",
          name,
          ...(detail ? { detail } : {}),
          start: rel(t),
          end: null,
          ...(event.signature && failed.has(event.signature) ? { retry: true } : {}),
        };
        spans.push(span);
        tools.set(itemId, { span, ...(event.signature ? { signature: event.signature } : {}) });
        openTools.add(itemId);
        if (neverCloses(event)) lingering.add(itemId);
        break;
      }
      case "item.updated":
        if (event.itemType === "reasoning" && stretch) stretch.reasoning = true;
        break;
      case "item.completed":
        if (event.itemType === "tool") {
          if (event.itemId) closeTool(event.itemId, event.ok ? "ok" : "failed", t);
        } else if (stretch) stretch.text = true;
        break;
      case "content.delta":
        if (stretch) {
          if (event.streamKind === "assistant_text") stretch.text = true;
          else stretch.reasoning = true;
        }
        break;
      case "request.opened": {
        // An async question waits on nobody: the engine carried on.
        if (event.async) break;
        const requestId = event.requestId ?? `anonymous-${anonymous++}`;
        if (waits.has(requestId)) break;
        cover(t);
        const detail = firstLine(event.summary);
        const span: TraceSpan = {
          id: `wait:${requestId}`,
          parentId: "turn",
          kind: "wait",
          status: "running",
          name: "Waiting for you",
          ...(detail ? { detail } : {}),
          start: rel(t),
          end: null,
        };
        spans.push(span);
        waits.set(requestId, span);
        openWaits.add(requestId);
        break;
      }
      case "request.resolved": {
        const span = event.requestId ? waits.get(event.requestId) : undefined;
        if (!span || !openWaits.has(event.requestId!)) break;
        span.status = "ok";
        span.end = rel(t);
        openWaits.delete(event.requestId!);
        uncover(t);
        break;
      }
      case "thread.token-usage.updated": {
        const spent = (Number(event.input) || 0) + (Number(event.output) || 0);
        usageReports++;
        tokenSum += spent;
        tokenHigh = Math.max(tokenHigh, spent);
        if (perMessage) {
          const owner = stretch ?? justClosed;
          if (owner) {
            owner.tokens += spent;
            if (owner.span) owner.span.tokens = owner.tokens;
          }
        }
        break;
      }
      case "runtime.error": {
        const detail = firstLine(event.message);
        spans.push({
          id: `error:${errors++}`,
          parentId: "turn",
          kind: "error",
          status: "failed",
          name: "Error",
          ...(detail ? { detail } : {}),
          start: rel(t),
          end: rel(t),
        });
        break;
      }
      case "context.compacted":
        spans.push({
          id: `compact:${compactions++}`,
          parentId: "turn",
          kind: "compact",
          status: "ok",
          name: "Compacted",
          ...(event.trigger ? { detail: event.trigger } : {}),
          start: rel(t),
          end: rel(t),
        });
        break;
      case "turn.completed":
        completed = event;
        endedAt = t;
        break;
    }
    // Only the calls a message made stand between it and its usage, and a
    // message reports once.
    if (!(event.type === "item.started" && event.itemType === "tool")) justClosed = null;
    if (completed) break;
  }

  if (completed && endedAt !== null) {
    const end = endedAt;
    for (const itemId of [...lingering]) closeTool(itemId, "ok", end);
    for (const itemId of openTools) {
      const span = tools.get(itemId)!.span;
      span.status = "stopped";
      span.end = rel(end);
    }
    for (const requestId of openWaits) {
      const span = waits.get(requestId)!;
      span.status = "stopped";
      span.end = rel(end);
    }
    openTools.clear();
    openWaits.clear();
    closeStretch(end);
  } else if (stretch) {
    const live: Stretch = stretch;
    if (Math.max(now, latest) - live.start >= MIN_MODEL_MS) spans.push(modelSpan(live, "running", null));
  }

  const running = !completed;
  const finish = endedAt ?? Math.max(now, Number.isFinite(latest) ? latest : now);
  const cost = completed ? (typeof completed.cost === "number" ? completed.cost : (price?.(completed) ?? null)) : null;
  const tokens = usageReports ? (perMessage ? tokenSum : tokenHigh) : null;
  const status: SpanStatus = !completed ? "running" : completed.ok ? "ok" : completed.stopReason === "interrupted" ? "stopped" : "failed";
  model ??= completed?.unpriced?.model;

  const toolSpans = spans.filter((s) => s.kind === "tool" || s.kind === "agent");
  const modelSpans = spans.filter((s) => s.kind === "model").length;
  const totals: Trace["totals"] = {
    durationMs: Math.max(0, finish - startedAt),
    cost,
    tokens,
    modelCalls: perMessage ? usageReports : modelSpans,
    toolCalls: toolSpans.length,
    errors: errors + toolSpans.filter((s) => s.status === "failed").length,
    waits: waits.size,
  };

  const root: TraceSpan = {
    id: "turn",
    parentId: null,
    kind: "turn",
    status,
    name: "Turn",
    start: 0,
    end: completed ? rel(finish) : null,
    ...(tokens !== null ? { tokens } : {}),
    cost,
  };
  return {
    turnId,
    startedAt,
    endedAt: completed ? finish : null,
    running,
    ...(engine ? { engine } : {}),
    ...(model ? { model } : {}),
    spans: [root, ...fold(spans.sort(byStart))],
    totals,
  };
}

const byStart = (a: TraceSpan, b: TraceSpan) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Under the ceiling, with the root's place kept. The oldest finished
 * spans go first; a running one goes only when nothing else is left. */
function fold(sorted: TraceSpan[]): TraceSpan[] {
  const room = MAX_SPANS - 1;
  if (sorted.length <= room) return sorted;
  let excess = sorted.length - room;
  const dropped = new Set<TraceSpan>();
  for (const span of sorted) {
    if (!excess) break;
    if (span.status === "running") continue;
    dropped.add(span);
    excess--;
  }
  for (const span of sorted) {
    if (!excess) break;
    if (dropped.has(span)) continue;
    dropped.add(span);
    excess--;
  }
  return sorted.filter((span) => !dropped.has(span));
}

/** A trace with nothing in it yet: a lane whose turn the harness has
 * started and whose engine has not said a word, or one waiting on the
 * person with no turn of its own in memory. */
export function emptyTrace(startedAt: number, running: boolean, now: number): Trace {
  const durationMs = running ? Math.max(0, now - startedAt) : 0;
  return {
    turnId: null,
    startedAt,
    endedAt: running ? null : startedAt,
    running,
    spans: [{ id: "turn", parentId: null, kind: "turn", status: running ? "running" : "ok", name: "Turn", start: 0, end: running ? null : 0, cost: null }],
    totals: { durationMs, cost: null, tokens: null, modelCalls: 0, toolCalls: 0, errors: 0, waits: 0 },
  };
}

// ── keeping turns ──────────────────────────────────────────────────────

/**
 * An event cut to what a trace reads, or null for one it never reads.
 *
 * Kept in memory for every lane at work, so the text, the raw payloads and
 * the tool arguments stay behind: a delta keeps only which kind of text it
 * was, an ask only its summary.
 */
export function slim(event: RuntimeEvent): RuntimeEvent | null {
  const base = {
    eventId: event.eventId,
    provider: event.provider,
    threadId: event.threadId,
    createdAt: event.createdAt,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.itemId ? { itemId: event.itemId } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
  };
  switch (event.type) {
    case "turn.started":
      return { ...base, type: event.type };
    case "session.started":
      return { ...base, type: event.type, sessionId: null, ...(event.model ? { model: event.model } : {}) };
    case "turn.completed":
      return {
        ...base,
        type: event.type,
        ok: event.ok,
        ...(event.stopReason !== undefined ? { stopReason: event.stopReason } : {}),
        ...(event.cost !== undefined ? { cost: event.cost } : {}),
        ...(event.unpriced ? { unpriced: event.unpriced } : {}),
      };
    case "item.started":
      return {
        ...base,
        type: event.type,
        itemType: event.itemType,
        ...(event.title ? { title: event.title } : {}),
        ...(event.command ? { command: firstLine(event.command) } : {}),
        ...(event.paths?.length ? { paths: [event.paths[0]] } : {}),
        ...(event.signature ? { signature: event.signature } : {}),
      };
    case "item.updated":
      return event.itemType === "reasoning" ? { ...base, type: event.type, itemType: event.itemType } : null;
    case "item.completed":
      return event.itemType === "tool"
        ? { ...base, type: event.type, itemType: event.itemType, ok: event.ok }
        : { ...base, type: event.type, itemType: event.itemType, text: "" };
    case "content.delta":
      return { ...base, type: event.type, streamKind: event.streamKind, delta: "" };
    case "request.opened":
      return {
        ...base,
        type: event.type,
        requestType: event.requestType,
        tool: event.tool,
        summary: firstLine(event.summary) ?? "",
        ...(event.async ? { async: true as const } : {}),
      };
    case "request.resolved":
      return { ...base, type: event.type, behavior: event.behavior, source: event.source };
    case "thread.token-usage.updated":
      return { ...base, type: event.type, input: event.input, output: event.output };
    case "runtime.error":
      return { ...base, type: event.type, message: firstLine(event.message) ?? "" };
    case "context.compacted":
      return { ...base, type: event.type, trigger: event.trigger, before: event.before, after: event.after };
    default:
      return null;
  }
}

/** Onto a turn's list, within its bound. Text arriving in a run says no
 * more than its first piece did, so only that piece is kept; and past the
 * bound the oldest events after the turn's start go, a tenth at a time. */
function keep(events: RuntimeEvent[], event: RuntimeEvent, cap: number) {
  const prior = events.at(-1);
  if (event.type === "content.delta" && prior?.type === "content.delta" && prior.streamKind === event.streamKind) return;
  events.push(event);
  if (events.length > cap) events.splice(1, Math.max(1, Math.floor(cap / 10)));
}

interface KeptTurn {
  turnId: string | null;
  events: RuntimeEvent[];
}

/**
 * Each lane's running turn and the one before it, as they pass through the
 * bus, so a trace of what is happening now never touches the disk.
 *
 * Bounded twice: per turn by MAX_TURN_EVENTS, and in lanes, where the one
 * least recently started with nothing running is let go first. Older turns
 * are in the events file (readTurn).
 */
export class LaneTurns {
  private lanes = new Map<string, { current: KeptTurn | null; last: KeptTurn | null }>();

  private readonly limits: { events: number; lanes: number };

  constructor(limits: { events: number; lanes: number } = { events: MAX_TURN_EVENTS, lanes: 500 }) {
    this.limits = limits;
  }

  note(event: RuntimeEvent) {
    const kept = slim(event);
    if (!kept) return;
    let lane = this.lanes.get(event.threadId);
    if (event.type === "turn.started") {
      // a lane that starts a turn is the most recent, for letting go
      if (lane) this.lanes.delete(event.threadId);
      lane = { current: { turnId: event.turnId ?? null, events: [kept] }, last: lane?.current ?? lane?.last ?? null };
      this.lanes.set(event.threadId, lane);
      this.trim();
      return;
    }
    const turn = lane?.current;
    if (!lane || !turn) return;
    // a late word from a turn that is over is not this one's
    if (event.turnId && turn.turnId && event.turnId !== turn.turnId) return;
    keep(turn.events, kept, this.limits.events);
    if (event.type === "turn.completed") {
      lane.last = turn;
      lane.current = null;
    }
  }

  /** The turn running in this lane, as events. */
  current(threadId: string): RuntimeEvent[] | null {
    return this.lanes.get(threadId)?.current?.events ?? null;
  }

  /** The turn that finished last in this lane. */
  last(threadId: string): RuntimeEvent[] | null {
    return this.lanes.get(threadId)?.last?.events ?? null;
  }

  /** A turn by its id, if it is one of the two kept. */
  find(threadId: string, turnId: string): RuntimeEvent[] | null {
    const lane = this.lanes.get(threadId);
    for (const turn of [lane?.current, lane?.last]) {
      if (turn && turn.turnId === turnId) return turn.events;
    }
    return null;
  }

  forget(threadId: string) {
    this.lanes.delete(threadId);
  }

  private trim() {
    if (this.lanes.size <= this.limits.lanes) return;
    for (const [threadId, lane] of this.lanes) {
      if (this.lanes.size <= this.limits.lanes) break;
      if (!lane.current) this.lanes.delete(threadId);
    }
  }
}

/**
 * One turn of a lane, read back from its events file: the named turn, or
 * with no name the last one there. Null when the file has none.
 *
 * Streamed, and only the end of the file: a lane that has been running
 * for months has a file in the hundreds of megabytes, and the turn anybody
 * asks about is near its end. A line naming another turn is passed over
 * before it is parsed.
 */
export async function readTurn(
  file: string,
  turnId: string | null,
  { bytes = SCAN_BYTES, events: cap = MAX_TURN_EVENTS }: { bytes?: number; events?: number } = {},
): Promise<RuntimeEvent[] | null> {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return null;
  }
  // One byte early, so a read that starts on a line's first byte drops
  // only the newline before it, not the line.
  const from = size > bytes ? size - bytes - 1 : 0;
  const named: RuntimeEvent[] = [];
  const latest = new LaneTurns({ events: cap, lanes: 1 });
  let threadId: string | null = null;
  let partial = from > 0;
  let done = false;

  await new Promise<void>((resolve) => {
    const stream = createReadStream(file, { start: from });
    const split = lineSplitter((line) => {
      // the first line of a read that starts mid-file is the tail of one
      if (partial) {
        partial = false;
        return;
      }
      if (done || !line.trim() || (turnId && !line.includes(turnId))) return;
      let event: RuntimeEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (!event || typeof event !== "object" || typeof event.type !== "string") return;
      if (turnId) {
        if (event.turnId !== turnId) return;
        const kept = slim(event);
        if (kept) keep(named, kept, cap);
        if (event.type === "turn.completed") {
          done = true;
          stream.destroy();
          resolve();
        }
        return;
      }
      threadId ??= event.threadId;
      latest.note(event);
    });
    stream.on("data", split);
    stream.on("error", () => resolve());
    stream.on("close", () => resolve());
    stream.on("end", () => resolve());
  });

  if (turnId) return named.length ? named : null;
  return threadId ? (latest.current(threadId) ?? latest.last(threadId)) : null;
}

/** True when a turn's events cover the moment `at`: from its first event
 * to its last, or on to now while it has not ended. */
export function turnCovers(events: readonly RuntimeEvent[] | null, at: number): boolean {
  if (!events?.length) return false;
  const first = Date.parse(events[0].createdAt);
  const ended = events.some((e) => e.type === "turn.completed");
  const last = ended ? Date.parse(events[events.length - 1].createdAt) : Infinity;
  return first <= at && at <= last;
}

/**
 * The id of the turn that was running at `at`, from a lane's events file,
 * or the last one to start before it. What a transcript can name: its
 * messages carry a time, not a turn.
 *
 * Only the start and end of each turn are parsed, and only from the same
 * tail of the file readTurn reads, so this costs one pass over lines it
 * mostly skips.
 */
export async function turnAt(file: string, at: number, { bytes = SCAN_BYTES }: { bytes?: number } = {}): Promise<string | null> {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return null;
  }
  const from = size > bytes ? size - bytes - 1 : 0;
  let partial = from > 0;
  let best: { turnId: string; start: number } | null = null;
  await new Promise<void>((resolve) => {
    const stream = createReadStream(file, { start: from });
    const split = lineSplitter((line) => {
      if (partial) {
        partial = false;
        return;
      }
      if (!line.includes('"turn.started"')) return;
      let event: RuntimeEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event?.type !== "turn.started" || !event.turnId) return;
      const start = Date.parse(event.createdAt);
      // the latest turn to start at or before the moment asked about
      if (start <= at && (!best || start >= best.start)) best = { turnId: event.turnId, start };
    });
    stream.on("data", split);
    stream.on("error", () => resolve());
    stream.on("close", () => resolve());
    stream.on("end", () => resolve());
  });
  return (best as { turnId: string } | null)?.turnId ?? null;
}
