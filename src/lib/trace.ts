// What one turn did, as a tree of timed spans, the way the server reads
// it back out of the turn's runtime events.
//
// The server builds these and the page only draws them, so this is a
// mirror of the shape the two agree on, kept here because the page never
// imports from the server. The turn is the root span and everything else
// hangs off it. Times inside a trace are milliseconds from its own
// `startedAt`; the trace's own times are epoch milliseconds, so traces of
// several agents can be set on one clock (src/lib/traceView.ts).
//
// Model work has no events of its own, so a model span is the time in
// the turn that no tool call and no wait covers: "Writing" when the reply
// streamed in it, "Thinking" when only reasoning did, else "Model". An
// error is a span with no length, at its moment; so is a compaction.

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
  /** One line: the command, the path, what the question was about. */
  detail?: string;
  /** Milliseconds from the trace's startedAt. */
  start: number;
  /** Null while it runs. */
  end: number | null;
  tokens?: number;
  cost?: number | null;
  /** The same call again (same signature) after one that failed. */
  retry?: boolean;
}

export interface TraceTotals {
  durationMs: number;
  /** Null when the engine does not price its turns. */
  cost: number | null;
  tokens: number | null;
  modelCalls: number;
  toolCalls: number;
  errors: number;
  waits: number;
}

export interface Trace {
  turnId: string | null;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds, null while it runs. */
  endedAt: number | null;
  running: boolean;
  /** The engine's kind, such as "claudeAgent". */
  engine?: string;
  model?: string;
  spans: TraceSpan[];
  totals: TraceTotals;
}

/** One agent at work, as the notch lists it. */
export interface LiveAgent {
  botId: string;
  name: string;
  /** The agent's BlokColor. */
  color: string;
  taskId: string;
  taskTitle: string;
  state: "working" | "needs-you";
  trace: Trace;
}

/** GET /api/trace/live */
export interface LiveTraces {
  /** The server's clock, so the page can line its own up with it. */
  now: number;
  agents: LiveAgent[];
}

/** GET /api/bots/:id/tasks/:task/trace */
export interface TaskTrace {
  trace: Trace | null;
}

export const LIVE_TRACES_PATH = "/api/trace/live";

/** The running turn, else the last one; or the one named. */
export function taskTracePath(botId: string, taskId: string, turnId?: string | null): string {
  const base = `/api/bots/${encodeURIComponent(botId)}/tasks/${encodeURIComponent(taskId)}/trace`;
  return turnId ? `${base}?turn=${encodeURIComponent(turnId)}` : base;
}
