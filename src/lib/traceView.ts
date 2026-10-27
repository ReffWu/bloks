// How a trace is drawn, worked out apart from the drawing.
//
// The waterfall (src/components/trace/TraceWaterfall.tsx) runs a clock
// sixty times a second and must not think while it does: everything
// here is plain arithmetic over the spans, done when the data changes,
// and tested on its own (test/trace-view.test.ts). What the numbers say,
// where the ruler puts its ticks, which rows show, what a parent's bar is
// made of, which step was slowest, and how several agents' turns share
// one clock.
//
// The demo traces at the end are the same shape the server sends, made
// up over time, so the notch and the panel can be looked at without an
// engine running.
import type { Message } from "../state/reducer.ts";
import type { LiveAgent, LiveTraces, SpanKind, Trace, TraceSpan, TraceTotals } from "./trace.ts";

// ── how the numbers read ──

/** "0.8s", "12s", "2m 10s", "1h 5m". Tenths only under ten seconds,
 * where they still say something; counted down, never up, so a running
 * step never shows a second it has not reached. */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (safe < 10_000) return `${(Math.floor(safe / 100) / 10).toFixed(1)}s`;
  const seconds = Math.floor(safe / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** "$0.005", "$0.42", "$12.50". Null when there is nothing to say: an
 * engine that does not price its turns is not a turn that cost nothing. */
export function formatCost(usd: number | null | undefined): string | null {
  if (usd === null || usd === undefined || !Number.isFinite(usd) || usd < 0) return null;
  if (usd === 0) return "$0";
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** "950", "12.4k", "124k", "1.2M". */
export function formatTokens(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return null;
  const whole = Math.round(n);
  if (whole < 1000) return String(whole);
  const short = (value: number, unit: string) => {
    const tenths = Math.floor(value * 10) / 10;
    return value < 100 ? `${tenths.toFixed(1)}${unit}` : `${Math.floor(value)}${unit}`;
  };
  if (whole < 1_000_000) return short(whole / 1000, "k");
  return short(whole / 1_000_000, "M");
}

/** "3.6s · $0.12": what follows a bar, the cost only when there is one. */
export function barNote(ms: number, cost?: number | null): string {
  const priced = cost ? formatCost(cost) : null;
  return priced ? `${formatDuration(ms)} · ${priced}` : formatDuration(ms);
}

// ── the ruler ──

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** The steps a ruler may take, in order. Round numbers a person counts
 * in: never a 7s or a 40s step. */
export const TICK_STEPS: readonly number[] = [
  ...[1, 2, 5, 10, 15, 20, 30].map((s) => s * SECOND),
  ...[1, 2, 5, 10, 15, 20, 30].map((m) => m * MINUTE),
  ...[1, 2, 3, 6, 12, 24].map((h) => h * HOUR),
];

/** The smallest step that keeps the ruler to `maxTicks` marks, zero
 * included, across `domainMs`. */
export function tickStep(domainMs: number, maxTicks: number): number {
  const most = Math.max(2, Math.floor(maxTicks));
  for (const step of TICK_STEPS) {
    if (Math.floor(domainMs / step) + 1 <= most) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/** "0s", "45s", "1m 30s", "2m", "1h 15m". */
export function tickLabel(ms: number): string {
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`;
  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    const seconds = Math.round((ms % MINUTE) / SECOND);
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.round((ms % HOUR) / MINUTE);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export interface RulerTick {
  /** Where it sits, in milliseconds from the start; also its key, so a
   * tick that stays across a change of step is the same tick and only
   * moves, while the ones the new step drops fade out. */
  at: number;
  label: string;
}

export function rulerTicks(domainMs: number, maxTicks: number): { step: number; ticks: RulerTick[] } {
  const step = tickStep(domainMs, maxTicks);
  const ticks: RulerTick[] = [];
  for (let at = 0; at <= domainMs + 0.5; at += step) ticks.push({ at, label: tickLabel(at) });
  return { step, ticks };
}

/** While a turn runs, now rides two thirds of the way across, so the
 * running bar always has room ahead of it and its note after it. */
export const LIVE_LEAD = 0.66;
/** A finished turn fills most of the width, its last note still in view. */
export const DONE_FIT = 0.8;
/** Never less than this across, so the first seconds are not a blur of
 * rescaling. */
export const MIN_DOMAIN_MS = 8 * SECOND;

/** How much time the width shows, given how long the trace has run. */
export function timelineDomain(elapsedMs: number, running: boolean, minMs = MIN_DOMAIN_MS): number {
  return Math.max(minMs, Math.max(0, elapsedMs) / (running ? LIVE_LEAD : DONE_FIT));
}

/** How many ticks fit a track this wide, one per 64px or so. */
export function ticksForWidth(px: number): number {
  return Math.max(3, Math.min(9, Math.floor(px / 64) + 1));
}

// ── the clock ──

/** How long a trace has run at `now` (epoch ms): to now while it runs,
 * to its end once it has ended. */
export function traceElapsed(trace: Trace, now: number): number {
  if (trace.running) return Math.max(0, now - trace.startedAt, trace.totals?.durationMs ?? 0);
  if (trace.endedAt !== null) return Math.max(0, trace.endedAt - trace.startedAt);
  return Math.max(0, trace.totals?.durationMs ?? 0);
}

/** Where a span ends, a running one reaching `elapsed` (ms from its
 * trace's start). Never before it began. */
export function spanEnd(span: TraceSpan, elapsed: number): number {
  return span.end ?? Math.max(span.start, elapsed);
}

export function spanDuration(span: TraceSpan, elapsed: number): number {
  return Math.max(0, spanEnd(span, elapsed) - span.start);
}

/** How far the server's clock is ahead of this page's, from a reading
 * that carries the server's own now (the live route does). */
export function clockOffset(serverNow: number, receivedAt: number): number {
  return Number.isFinite(serverNow) ? serverNow - receivedAt : 0;
}

/** The same for the per-conversation route, which says no now of its own:
 * a running trace's duration was measured up to the server's now, so its
 * start plus its duration is that now, near enough. */
export function traceClockOffset(trace: Trace | null, receivedAt: number): number {
  if (!trace?.running) return 0;
  return clockOffset(trace.startedAt + (trace.totals?.durationMs ?? 0), receivedAt);
}

// ── which turn ──

/** Which turn to show. A fold knows when its work happened, and the
 * turn's id when the engine wrote it on a message. */
export interface TraceAsk {
  turnId?: string | null;
  /** When the fold's work began and ended, epoch ms. */
  window?: { from: number; to: number };
}

/** What a fold can say about its turn: when its work happened, and the
 * turn's id where the engine wrote one on a message (Codex does). */
export function askForFold(messages: readonly Pick<Message, "at" | "codexText" | "joinedTurnId">[]): TraceAsk {
  const times = messages.map((m) => m.at).filter((at): at is number => typeof at === "number" && at > 0);
  const turnId = messages.map((m) => m.codexText?.turnId ?? m.joinedTurnId).find(Boolean) ?? null;
  return { turnId, ...(times.length ? { window: { from: Math.min(...times), to: Math.max(...times) } } : {}) };
}

/** Whether the trace the route gave is the turn a fold is about. The
 * route answers the running turn, else the last one, unless a turn is
 * named; a fold further up the conversation is neither. */
export function traceCovers(trace: Trace, window: TraceAsk["window"]): boolean {
  if (!window) return true;
  const end = trace.endedAt ?? Number.POSITIVE_INFINITY;
  return trace.startedAt <= window.to && end >= window.from;
}

// ── several agents on one clock ──

export interface TraceGroup {
  id: string;
  /** The agent, when the group is one of its conversations: its face is
   * drawn from it, so it looks the same here as everywhere else. */
  botId?: string;
  name: string;
  subtitle?: string;
  /** A BlokColor name, or a hex colour. */
  color: string;
  trace: Trace;
}

/** The earliest start among them, and how far after it each one began:
 * what lines several agents' turns up on one timeline. */
export function alignGroups(groups: readonly Pick<TraceGroup, "id" | "trace">[]): { origin: number; offsets: Record<string, number> } {
  if (!groups.length) return { origin: 0, offsets: {} };
  const origin = Math.min(...groups.map((g) => g.trace.startedAt));
  const offsets: Record<string, number> = {};
  for (const g of groups) offsets[g.id] = g.trace.startedAt - origin;
  return { origin, offsets };
}

/** From the earliest start to `now`, or to the last end once every one
 * of them has ended. */
export function groupsElapsed(groups: readonly Pick<TraceGroup, "id" | "trace">[], now: number): number {
  const { origin, offsets } = alignGroups(groups);
  let most = 0;
  for (const g of groups) most = Math.max(most, offsets[g.id] + traceElapsed(g.trace, now));
  return groups.some((g) => g.trace.running) ? Math.max(most, now - origin) : most;
}

/** What a set of spans adds up to, `elapsed` into their turn. */
export function totalsOf(spans: readonly TraceSpan[], elapsed: number): TraceTotals {
  let tokens: number | null = null;
  let cost: number | null = null;
  let modelCalls = 0;
  let toolCalls = 0;
  let errors = 0;
  let waits = 0;
  for (const span of spans) {
    if (span.kind === "model") modelCalls++;
    if (span.kind === "tool" || span.kind === "agent") toolCalls++;
    if (span.kind === "wait") waits++;
    if (span.kind === "error" || span.status === "failed") errors++;
    if (span.kind === "turn") continue;
    if (typeof span.tokens === "number") tokens = (tokens ?? 0) + span.tokens;
    if (typeof span.cost === "number") cost = (cost ?? 0) + span.cost;
  }
  return { durationMs: Math.max(0, elapsed), cost, tokens, modelCalls, toolCalls, errors, waits };
}

/** The metrics strip over several agents: each one's own totals, summed;
 * the duration is the shared timeline's. A cost or a count no engine
 * gave stays unknown rather than becoming zero. */
export function sumTotals(groups: readonly Pick<TraceGroup, "id" | "trace">[], now: number): TraceTotals {
  const sum = (pick: (t: TraceTotals) => number | null) => {
    let total: number | null = null;
    for (const g of groups) {
      const value = pick(g.trace.totals);
      if (typeof value === "number") total = (total ?? 0) + value;
    }
    return total;
  };
  return {
    durationMs: groupsElapsed(groups, now),
    cost: sum((t) => t.cost),
    tokens: sum((t) => t.tokens),
    modelCalls: sum((t) => t.modelCalls) ?? 0,
    toolCalls: sum((t) => t.toolCalls) ?? 0,
    errors: sum((t) => t.errors) ?? 0,
    waits: sum((t) => t.waits) ?? 0,
  };
}

// ── the tree ──

/** The turn itself: the span named as the root, else none. */
export function rootOf(spans: readonly TraceSpan[]): TraceSpan | null {
  return spans.find((s) => s.kind === "turn") ?? spans.find((s) => s.parentId === null) ?? null;
}

const byStart = (a: TraceSpan, b: TraceSpan) => a.start - b.start || (a.end ?? Infinity) - (b.end ?? Infinity) || a.id.localeCompare(b.id);

/** Each span's children, in the order they began. Under `ROOT` are the
 * turn's own, along with any span whose parent is not in the trace, so a
 * gap in what the server sent loses nothing from view. */
export const ROOT = "";
export function childrenOf(spans: readonly TraceSpan[]): Map<string, TraceSpan[]> {
  const root = rootOf(spans);
  const ids = new Set(spans.map((s) => s.id));
  const map = new Map<string, TraceSpan[]>();
  for (const span of spans) {
    if (root && span.id === root.id) continue;
    const parent = span.parentId && ids.has(span.parentId) && span.parentId !== root?.id ? span.parentId : ROOT;
    const list = map.get(parent);
    if (list) list.push(span);
    else map.set(parent, [span]);
  }
  for (const list of map.values()) list.sort(byStart);
  return map;
}

export interface TraceRow {
  /** The group's id for its own row; `${group}:${span}` under it. */
  key: string;
  groupId: string;
  /** Null on the group's own row, which stands for its whole turn. */
  span: TraceSpan | null;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  parentKey: string | null;
}

export const rowKey = (groupId: string, spanId: string) => `${groupId}:${spanId}`;

/** The rows on screen: one per agent, and under it the steps of its turn,
 * nested as deep as they go, except under a row folded shut. */
export function flattenRows(groups: readonly Pick<TraceGroup, "id" | "trace">[], collapsed: ReadonlySet<string>): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const group of groups) {
    const kids = childrenOf(group.trace.spans);
    const top = kids.get(ROOT) ?? [];
    const shut = collapsed.has(group.id);
    rows.push({ key: group.id, groupId: group.id, span: null, depth: 0, hasChildren: top.length > 0, collapsed: shut, parentKey: null });
    if (shut) continue;
    const walk = (list: TraceSpan[], depth: number, parentKey: string) => {
      for (const span of list) {
        const key = rowKey(group.id, span.id);
        const under = kids.get(span.id) ?? [];
        const closed = collapsed.has(key);
        rows.push({ key, groupId: group.id, span, depth, hasChildren: under.length > 0, collapsed: closed, parentKey });
        if (under.length && !closed) walk(under, depth + 1, key);
      }
    };
    walk(top, 1, group.id);
  }
  return rows;
}

// ── the bars ──

export type BarKind = "model" | "tool" | "agent" | "wait" | "failed" | "retry" | "stopped";

/** How a span's bar is drawn. A failure is red whatever it was; a retry
 * wears its circular arrow; a step stopped short is drawn faded. */
export function barKind(span: Pick<TraceSpan, "kind" | "status" | "retry">): BarKind {
  if (span.status === "failed") return "failed";
  if (span.retry) return "retry";
  if (span.status === "stopped") return "stopped";
  if (span.kind === "wait") return "wait";
  if (span.kind === "agent") return "agent";
  if (span.kind === "tool") return "tool";
  return "model";
}

/** A span with no length: a moment, drawn as a mark rather than a bar. */
export const isMarker = (kind: SpanKind) => kind === "error" || kind === "compact";

export interface Segment {
  id: string;
  start: number;
  /** Null while it runs: the bar reaches now. */
  end: number | null;
  kind: BarKind;
}

/** A parent's bar as the pieces its children made, so the shape of its
 * work reads in one line: model, tool and waiting in turn, and a red
 * piece where something failed. A turn with nothing in it yet is one
 * piece of model time, since that is what the start of a turn is. */
export function segmentsOf(children: readonly TraceSpan[], fallback?: { start: number; end: number | null }): Segment[] {
  const pieces = children
    .filter((c) => !isMarker(c.kind) && c.kind !== "turn")
    .map((c) => ({ id: c.id, start: c.start, end: c.end, kind: barKind(c) }));
  if (!pieces.length && fallback) return [{ id: "turn", start: fallback.start, end: fallback.end, kind: "model" }];
  return pieces;
}

export interface Marker {
  id: string;
  at: number;
  kind: "error" | "compact";
}

export function markersOf(children: readonly TraceSpan[]): Marker[] {
  return children.filter((c) => isMarker(c.kind)).map((c) => ({ id: c.id, at: c.start, kind: c.kind as Marker["kind"] }));
}

/** The longest single step so far across every agent, by row key, for
 * the "Slowest" pill. Steps only: a turn is not a step, waiting on a
 * person is not the agent being slow, and a moment has no length. Ties
 * go to the earlier, so the pill does not flicker between equals. */
export function slowestLeaf(
  groups: readonly Pick<TraceGroup, "id" | "trace">[],
  now: number,
): { key: string; ms: number } | null {
  let best: { key: string; ms: number; start: number } | null = null;
  for (const group of groups) {
    const elapsed = traceElapsed(group.trace, now);
    const kids = childrenOf(group.trace.spans);
    const parents = new Set([...kids.keys()]);
    for (const span of group.trace.spans) {
      if (span.kind === "turn" || span.kind === "wait" || isMarker(span.kind) || parents.has(span.id)) continue;
      const ms = spanDuration(span, elapsed);
      const start = group.trace.startedAt + span.start;
      if (ms <= 0) continue;
      if (!best || ms > best.ms || (ms === best.ms && start < best.start)) best = { key: rowKey(group.id, span.id), ms, start };
    }
  }
  return best && { key: best.key, ms: best.ms };
}

/** What an agent is doing right now, in a few words: its newest running
 * step, else the newest step. */
export function currentStep(trace: Trace): TraceSpan | null {
  const steps = trace.spans.filter((s) => s.kind !== "turn" && !isMarker(s.kind));
  const running = steps.filter((s) => s.end === null || s.status === "running");
  const pick = (list: TraceSpan[]) => list.reduce<TraceSpan | null>((last, s) => (!last || s.start >= last.start ? s : last), null);
  return pick(running) ?? pick(steps);
}

// ── made-up traces, for the demo and the tests ──

/** A small seeded generator, so a demo trace is the same every time. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One step a demo agent takes, from the start of its turn. */
interface ScriptStep {
  kind: Exclude<SpanKind, "turn">;
  name: string;
  detail?: string;
  start: number;
  length: number;
  status: "ok" | "failed";
  retry?: boolean;
  tokens?: number;
  cost?: number;
}

export interface FixtureScript {
  seed: number;
  steps: ScriptStep[];
  total: number;
}

const TOOLS: Array<{ name: string; details: string[]; short: [number, number] }> = [
  { name: "Read", details: ["src/pricing/plans.ts", "docs/launch.md", "package.json", "src/checkout/cart.tsx"], short: [300, 1400] },
  { name: "Grep", details: ["\"annualDiscount\"", "TODO launch", "stripe.prices"], short: [400, 1800] },
  { name: "Bash", details: ["pnpm test checkout", "git status", "pnpm typecheck", "ls -la build"], short: [1200, 7000] },
  { name: "Edit", details: ["src/pricing/plans.ts", "src/checkout/summary.tsx", "README.md"], short: [500, 2200] },
  { name: "WebSearch", details: ["team plan pricing 2026", "per seat billing examples"], short: [1800, 5200] },
  { name: "WebFetch", details: ["stripe.com/docs/billing", "news.ycombinator.com"], short: [1400, 4200] },
];

/** A turn's worth of steps: thinking, a few calls, now and then a call
 * that fails and is tried again, a question for the person, a sub-agent,
 * and the reply written at the end. */
export function fixtureScript(seed: number, { length = 60_000 }: { length?: number } = {}): FixtureScript {
  const rand = seeded(seed);
  const between = (lo: number, hi: number) => Math.round(lo + (hi - lo) * rand());
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const steps: ScriptStep[] = [];
  let at = 0;
  const model = (name: string, lo: number, hi: number) => {
    const len = between(lo, hi);
    const tokens = between(600, 5200);
    steps.push({ kind: "model", name, start: at, length: len, status: "ok", tokens, cost: tokens * 0.000012 });
    at += len;
  };
  let asked = false;
  let handed = false;
  let failed = false;
  let compacted = false;
  model("Thinking", 900, 2600);
  while (at < length * 0.82) {
    const roll = rand();
    if (!asked && roll < 0.08 && at > length * 0.3) {
      asked = true;
      const len = between(4000, 9000);
      steps.push({ kind: "wait", name: "Waiting for you", detail: "Ship the annual plan today?", start: at, length: len, status: "ok" });
      at += len;
    } else if (!handed && roll < 0.16 && at > length * 0.2) {
      handed = true;
      const len = between(6000, 13000);
      const tokens = between(4000, 16000);
      const brief = pick(["Check competitors' pricing pages", "Find every caller of applyDiscount", "Summarise the launch thread"]);
      steps.push({ kind: "agent", name: "Task", detail: brief, start: at, length: len, status: "ok", tokens, cost: tokens * 0.000004 });
      at += len;
    } else if (!compacted && roll > 0.97 && at > length * 0.5) {
      compacted = true;
      steps.push({ kind: "compact", name: "Compacted", detail: "Older turns summarised to make room", start: at, length: 0, status: "ok" });
    } else {
      const tool = pick(TOOLS);
      const detail = pick(tool.details);
      const len = between(tool.short[0], tool.short[1]);
      const fails = !failed && rand() < 0.14;
      steps.push({ kind: "tool", name: tool.name, detail, start: at, length: len, status: fails ? "failed" : "ok" });
      at += len;
      if (fails) {
        failed = true;
        model("Thinking", 500, 1400);
        const again = between(tool.short[0], tool.short[1]);
        steps.push({ kind: "tool", name: tool.name, detail, start: at, length: again, status: "ok", retry: true });
        at += again;
      }
    }
    at += between(0, 160);
    if (rand() < 0.55) model(rand() < 0.75 ? "Thinking" : "Model", 400, 2400);
  }
  model("Writing", 1800, 5200);
  return { seed, steps, total: at };
}

/** The script as the server would describe it `elapsed` into the turn:
 * the steps begun so far, the ones still going open at the end. */
export function fixtureTrace(script: FixtureScript, startedAt: number, elapsed: number, model = "Opus 4.7"): Trace {
  const shown = Math.max(0, Math.min(elapsed, script.total));
  const running = elapsed < script.total;
  const turnId = `turn-${script.seed}-${startedAt}`;
  const spans: TraceSpan[] = [
    { id: "turn", parentId: null, kind: "turn", status: running ? "running" : "ok", name: "Turn", start: 0, end: running ? null : script.total },
  ];
  script.steps.forEach((step, i) => {
    if (step.start > shown) return;
    const done = step.start + step.length <= shown;
    spans.push({
      id: `s${i}`,
      parentId: "turn",
      kind: step.kind,
      status: done ? step.status : "running",
      name: step.name,
      ...(step.detail ? { detail: step.detail } : {}),
      start: step.start,
      end: done ? step.start + step.length : null,
      ...(step.tokens !== undefined && done ? { tokens: step.tokens } : {}),
      ...(step.cost !== undefined && done ? { cost: step.cost } : {}),
      ...(step.retry ? { retry: true } : {}),
    });
  });
  return {
    turnId,
    startedAt,
    endedAt: running ? null : startedAt + script.total,
    running,
    engine: "claudeAgent",
    model,
    spans,
    totals: totalsOf(spans, shown),
  };
}

const DEMO_AGENTS: Array<Pick<LiveAgent, "botId" | "name" | "color" | "taskId" | "taskTitle"> & { seed: number; delay: number; length: number; rest: number; model: string }> = [
  { botId: "demo-scout", name: "Scout", color: "blue", taskId: "t-pricing", taskTitle: "Pricing research", seed: 7, delay: 0, length: 70_000, rest: 9000, model: "Sonnet 4.6" },
  { botId: "demo-quill", name: "Quill", color: "purple", taskId: "t-launch", taskTitle: "Launch post", seed: 21, delay: 6500, length: 55_000, rest: 12_000, model: "Opus 4.7" },
  { botId: "demo-forge", name: "Forge", color: "orange", taskId: "t-checkout", taskTitle: "Checkout tests", seed: 42, delay: 15_000, length: 85_000, rest: 7000, model: "GPT-5.5" },
];

/** What /api/trace/live would say `now`, for agents that began their
 * loop at `epoch`: each works through its turn, rests, and goes again,
 * so the demo has agents arriving, asking and leaving. */
export function fixtureLive(now: number, epoch: number): LiveTraces {
  const agents: LiveAgent[] = [];
  for (const demo of DEMO_AGENTS) {
    let since = now - epoch - demo.delay;
    if (since < 0) continue;
    // each round is a new turn, made from its own seed; walk to the one
    // `now` falls in
    let round = 0;
    let script = fixtureScript(demo.seed, { length: demo.length });
    let startedAt = epoch + demo.delay;
    while (since >= script.total + demo.rest) {
      since -= script.total + demo.rest;
      startedAt += script.total + demo.rest;
      round++;
      script = fixtureScript(demo.seed + round, { length: demo.length });
    }
    if (since >= script.total) continue;
    const trace = fixtureTrace(script, startedAt, since, demo.model);
    const asking = trace.spans.some((s) => s.kind === "wait" && s.end === null);
    agents.push({
      botId: demo.botId,
      name: demo.name,
      color: demo.color,
      taskId: demo.taskId,
      taskTitle: demo.taskTitle,
      state: asking ? "needs-you" : "working",
      trace,
    });
  }
  return { now, agents };
}
