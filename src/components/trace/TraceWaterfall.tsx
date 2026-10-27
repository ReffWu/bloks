// What an agent did in a turn, as a waterfall: each step a bar on one
// timeline, nested under the agent that took it, with the running one
// riding the playhead as it goes.
//
// The same drawing serves the panel beside a conversation (one agent)
// and the notch (every agent working, on one clock). It reads, top to
// bottom: what the turn has added up to, the steps against the ruler,
// and what the colours mean.
//
// Motion is the point and it is kept cheap. The data arrives once a
// second or so; between arrivals one clock (./clock.ts) moves everything
// by setting two numbers on the timeline, pixels per millisecond and
// how far now has gone, and every bar, tick and link is placed from
// those in CSS (styles.css). A running step's counter writes itself into
// its own element. React renders when the data changes, a row folds, or
// the ruler takes a new step; never because a frame went by.
//
// A step's bar is in its agent's colour: model time the bright tint, a
// tool the same colour deeper, waiting on a person hatched, a failure
// red with a cross, a call tried again after one wearing a circular
// arrow, and a sub-agent the agent mark. An agent's own row is all of
// that in one line, piece by piece.
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight, TriangleAlert } from "@/components/icons";
import { BlokAvatar } from "@/components/Avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BLOK_COLORS, shapeForBot, type BlokColor } from "@/lib/mascot";
import {
  alignGroups,
  barKind,
  barNote,
  childrenOf,
  flattenRows,
  formatCost,
  formatDuration,
  formatTokens,
  groupsElapsed,
  markersOf,
  ROOT,
  rulerTicks,
  segmentsOf,
  slowestLeaf,
  spanDuration,
  sumTotals,
  tickStep,
  ticksForWidth,
  timelineDomain,
  traceElapsed,
  type RulerTick,
  type TraceGroup,
  type TraceRow,
} from "@/lib/traceView";
import { cn } from "@/lib/cn";
import { useLiveString, useLiveText, useTraceClock, type TraceClock } from "./clock";
import { RollingNumber } from "./RollingNumber";
import { BarGlyph, colorHex, kindWord, Legend, SpanDetail, Spinner, StepIcon } from "./parts";

export type { TraceGroup } from "@/lib/traceView";

export interface TraceWaterfallProps {
  /** One per agent; each a parent row in its own colour. */
  groups: TraceGroup[];
  /** When `groups` were true, epoch ms on the server's clock. The
   * waterfall runs on from here by itself while anything is running. */
  now: number;
  /** "panel" beside a conversation; "island" in the notch, smaller, on
   * black, with every agent folded to its one line until opened. */
  variant?: "panel" | "island";
  className?: string;
}

const SIZES = {
  panel: { row: 30, bar: 14, icon: 14, avatar: 18, indent: 16, text: "text-small", tree: "clamp(170px, 38%, 264px)", glyph: 10 },
  island: { row: 24, bar: 10, icon: 12, avatar: 15, indent: 13, text: "text-caption", tree: "clamp(128px, 32%, 188px)", glyph: 8 },
} as const;
type Size = (typeof SIZES)[keyof typeof SIZES];

const RULER_H = 26;

/** Ticks as drawn: the ones the step has now, and for a moment the ones
 * it just dropped, fading. */
type ShownTick = RulerTick & { leaving?: boolean };

export function TraceWaterfall({ groups, now, variant = "panel", className }: TraceWaterfallProps) {
  const size = SIZES[variant];
  const reduce = Boolean(useReducedMotion());
  const uid = useId();
  const running = groups.some((g) => g.trace.running);
  const clock = useTraceClock(now, running);
  const { origin, offsets } = useMemo(() => alignGroups(groups), [groups]);
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // what has been folded or opened by hand; in the notch every agent
  // starts as its one line, in the panel everything starts open
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const collapsed = useMemo(() => {
    const shut = new Set(toggled);
    if (variant !== "island") return shut;
    for (const g of groups) {
      if (shut.has(g.id)) shut.delete(g.id);
      else shut.add(g.id);
    }
    return shut;
  }, [toggled, groups, variant]);
  const rows = useMemo(() => flattenRows(groups, collapsed), [groups, collapsed]);
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);
  const slowest = useMemo(() => slowestLeaf(groups, now), [groups, now]);
  const toggle = (key: string) =>
    setToggled((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A row new since the last drawing fades up, a step just begun or a
  // fold just opened; the first drawing is simply there.
  const seen = useRef<Set<string> | null>(null);
  const fresh = (key: string) => seen.current !== null && !seen.current.has(key);
  useEffect(() => {
    seen.current = new Set(rows.map((r) => r.key));
  }, [rows]);

  // ── the timeline, moved every frame ──
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const width = useRef(0);
  const domain = useRef(0);
  const [ticks, setTicks] = useState<ShownTick[]>([]);
  const tickKey = useRef("");
  const latest = useRef({ groups, origin, running, reduce });
  latest.current = { groups, origin, running, reduce };
  // a different turn, or a different set of agents: no easing from the
  // old scale to the new one
  useLayoutEffect(() => {
    domain.current = 0;
    clock.kick();
  }, [origin, clock]);

  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const measure = () => {
      width.current = el.clientWidth;
      clock.kick();
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [clock]);

  useEffect(() => {
    let dropping: ReturnType<typeof setTimeout> | null = null;
    const stop = clock.subscribe((t, dt) => {
      const { groups, origin, running, reduce } = latest.current;
      const px = width.current;
      if (!px || !groups.length) return false;
      const target = timelineDomain(groupsElapsed(groups, t), running);
      // the scale eases to a new reading rather than jumping to it
      let shown = domain.current;
      shown = !shown || reduce ? target : shown + (target - shown) * (1 - Math.exp(-dt / 170));
      if (Math.abs(target - shown) <= target * 0.0004) shown = target;
      domain.current = shown;
      const ms = String(px / shown);
      const elapsed = String(Math.max(0, t - origin));
      for (const el of [rulerRef.current, tracksRef.current]) {
        if (!el) continue;
        el.style.setProperty("--ms", ms);
        el.style.setProperty("--now", elapsed);
      }
      // the ruler renders again only when its step or its count changes
      const most = ticksForWidth(px);
      const step = tickStep(shown, most);
      const key = `${step}:${Math.floor(shown / step)}`;
      if (key !== tickKey.current) {
        tickKey.current = key;
        const next = rulerTicks(shown, most).ticks;
        const keep = new Set(next.map((tick) => tick.at));
        setTicks((was) => [...next, ...(reduce ? [] : was.filter((tick) => !keep.has(tick.at)).map((tick) => ({ ...tick, leaving: true })))]);
        if (dropping) clearTimeout(dropping);
        dropping = setTimeout(() => setTicks((was) => was.filter((tick) => !tick.leaving)), 260);
      }
      return shown !== target;
    });
    return () => {
      stop();
      if (dropping) clearTimeout(dropping);
    };
  }, [clock]);

  // ── one highlight across both columns, moved by hand ──
  const bodyRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const onBodyMove = (e: React.PointerEvent) => {
    const body = bodyRef.current;
    const mark = hoverRef.current;
    if (!body || !mark) return;
    const at = Math.floor((e.clientY - body.getBoundingClientRect().top) / size.row);
    if (at < 0 || at >= rows.length) return void (mark.style.opacity = "0");
    mark.style.transform = `translateY(${at * size.row}px)`;
    mark.style.opacity = "1";
  };
  const onBodyLeave = () => {
    if (hoverRef.current) hoverRef.current.style.opacity = "0";
  };

  // hand-offs: a sub-agent's row hangs from its parent's bar
  const links = rows.flatMap((row, i) => {
    if (row.span?.kind !== "agent" || !row.parentKey) return [];
    const from = indexOf.get(row.parentKey);
    if (from === undefined) return [];
    return [{ key: row.key, from, to: i, start: (offsets[row.groupId] ?? 0) + row.span.start, color: colorHex(byId.get(row.groupId)?.color ?? "blue") }];
  });

  const island = variant === "island";
  const lead = groups[0] ? colorHex(groups[0].color) : colorHex("blue");
  return (
    <TooltipProvider delayDuration={180} disableHoverableContent>
      <div
        className={cn("@container flex min-h-0 min-w-0 flex-col", size.text, className)}
        style={{ "--trace-ground": island ? "#000" : "var(--background)", "--trace-shine": "var(--foreground)" } as CSSProperties}
      >
        <Metrics groups={groups} clock={clock} island={island} />
        <div
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
          style={{ scrollbarGutter: "stable" }}
        >
          {/* the ruler, held at the top while the rows scroll under it */}
          <div className={cn("sticky top-0 z-10 flex border-b", island ? "bg-black" : "bg-background")} style={{ height: RULER_H }}>
            <div className="flex shrink-0 items-center px-3 text-caption text-muted-foreground" style={{ width: size.tree }}>
              Steps
            </div>
            <div ref={rulerRef} className="trace-timeline relative min-w-0 flex-1 border-l text-caption tabular-nums text-muted-foreground">
              {ticks.map((tick) => (
                <span
                  key={tick.at}
                  className={cn("trace-tick animate-fade-in", tick.leaving && "opacity-0")}
                  style={{ "--at": tick.at, top: (RULER_H - 16) / 2 - 1 } as CSSProperties}
                >
                  {tick.label}
                </span>
              ))}
              {ticks.map((tick) => (
                <span key={`g${tick.at}`} className={cn("trace-grid", tick.leaving && "opacity-0")} style={{ "--at": tick.at } as CSSProperties} />
              ))}
              {running && (
                // the dot rests on the ruler's bottom line, clear of the
                // labels above it (the timeline clips at its own edge)
                <span className="trace-playhead" style={{ top: RULER_H - 7 }}>
                  <span className="absolute -left-[3px] top-0 size-[7px] rounded-full bg-foreground shadow-[0_0_0_2px_var(--trace-ground)]" />
                </span>
              )}
            </div>
          </div>

          <div
            ref={bodyRef}
            className="relative flex"
            // the island's last row clears its rounded corners
            style={{ height: rows.length * size.row + (island ? 10 : 0) }}
            onPointerMove={onBodyMove}
            onPointerLeave={onBodyLeave}
          >
            <div
              ref={hoverRef}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 bg-foreground/[0.035] opacity-0 transition-opacity duration-100 dark:bg-foreground/[0.05]"
              style={{ height: size.row }}
            />
            <div className="relative shrink-0" style={{ width: size.tree }}>
              {rows.map((row, i) => {
                const group = byId.get(row.groupId)!;
                return (
                  <TreeRow
                    key={row.key}
                    row={row}
                    index={i}
                    group={group}
                    size={size}
                    fresh={fresh(row.key)}
                    onToggle={toggle}
                  />
                );
              })}
            </div>
            <div ref={tracksRef} className="trace-timeline relative min-w-0 flex-1 border-l" style={{ "--bar-h": `${size.bar}px` } as CSSProperties}>
              {ticks.map((tick) => (
                <span key={tick.at} className={cn("trace-grid", tick.leaving && "opacity-0")} style={{ "--at": tick.at } as CSSProperties} />
              ))}
              {links.map((link) => (
                <span
                  key={link.key}
                  className="trace-link"
                  style={
                    {
                      "--start": link.start,
                      "--c": link.color,
                      top: link.from * size.row + size.row / 2 + size.bar / 2,
                      height: (link.to - link.from) * size.row - size.bar / 2,
                    } as CSSProperties
                  }
                />
              ))}
              {rows.map((row, i) => {
                const group = byId.get(row.groupId)!;
                return (
                  <TrackRow
                    key={row.key}
                    row={row}
                    index={i}
                    group={group}
                    offset={offsets[row.groupId] ?? 0}
                    size={size}
                    clock={clock}
                    fresh={fresh(row.key)}
                    slowest={slowest?.key === row.key}
                    pill={`${uid}slowest`}
                    reduce={reduce}
                    island={island}
                  />
                );
              })}
              {running && <span className="trace-playhead z-[1]" />}
            </div>
          </div>
          {!rows.length && <div className="px-3 py-6 text-center text-small text-muted-foreground">Nothing has happened yet.</div>}
        </div>
        {!island && <Legend color={lead} className="border-t px-3 py-2" />}
      </div>
    </TooltipProvider>
  );
}

// ── the numbers along the top ──

function Metrics({ groups, clock, island }: { groups: TraceGroup[]; clock: TraceClock; island: boolean }) {
  const totals = sumTotals(groups, clock.read());
  const duration = useLiveString(clock, (t) => formatDuration(groupsElapsed(groups, t)));
  // A cost is said when a turn ends, so a running one has none yet; an
  // engine that never prices its turns has none at all. Neither is $0.
  const running = groups.some((g) => g.trace.running);
  const cells: Array<{ label: string; value: string | null; quiet?: string; why?: string; warn?: boolean }> = [
    { label: "Duration", value: duration },
    {
      label: "Cost",
      value: formatCost(totals.cost),
      quiet: running ? "Not yet" : "n/a",
      why: running ? "Said when the turn ends" : "This engine does not price its turns",
    },
    {
      label: "Tokens",
      value: formatTokens(totals.tokens),
      quiet: running ? "Not yet" : "n/a",
      why: running ? "Counted as the model answers" : "This engine did not count them",
    },
    { label: "Model calls", value: String(totals.modelCalls) },
    { label: "Tool calls", value: String(totals.toolCalls) },
    { label: "Errors", value: String(totals.errors), warn: totals.errors > 0 },
  ];
  // hairlines between the cells however they wrap: the gaps show the
  // border colour behind them
  return (
    <div className={cn("grid shrink-0 gap-px border-b bg-border", island ? "grid-cols-6" : "grid-cols-3 @[31rem]:grid-cols-6")}>
      {cells.map((cell) => (
        <div key={cell.label} className={cn("min-w-0", island ? "bg-black px-2.5 py-1.5" : "bg-background px-3 py-2")}>
          <div className="truncate text-caption text-muted-foreground">{cell.label}</div>
          {cell.value === null ? (
            <div className={cn("truncate text-muted-foreground", island ? "text-small" : "text-ui")} title={cell.why}>
              {cell.quiet}
            </div>
          ) : (
            <RollingNumber
              value={cell.value}
              className={cn("font-medium", island ? "text-small" : "text-ui", cell.warn ? "text-destructive" : "text-foreground")}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── a row of the tree ──

const TreeRow = memo(function TreeRow({
  row,
  index,
  group,
  size,
  fresh,
  onToggle,
}: {
  row: TraceRow;
  index: number;
  group: TraceGroup;
  size: Size;
  fresh: boolean;
  onToggle: (key: string) => void;
}) {
  const span = row.span;
  const live = span ? span.end === null && group.trace.running : false;
  const failed = span?.status === "failed" || span?.kind === "error";
  const pad = 8 + row.depth * size.indent;
  return (
    <div
      className="trace-row flex items-center gap-1.5 pr-2"
      data-new={fresh || undefined}
      style={{ height: size.row, transform: `translateY(${index * size.row}px)`, paddingLeft: pad, "--c": colorHex(group.color) } as CSSProperties}
    >
      {/* a hairline down from each level above, so nesting reads */}
      {Array.from({ length: row.depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: 8 + level * size.indent + size.icon / 2 + 1 }}
        />
      ))}
      {row.hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(row.key)}
          aria-expanded={!row.collapsed}
          aria-label={row.collapsed ? `Show ${span?.name ?? group.name}'s steps` : `Hide ${span?.name ?? group.name}'s steps`}
          className="-ml-1 flex shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          style={{ width: size.icon + 2, height: size.icon + 2 }}
        >
          <ChevronRight size={size.icon - 2} className={cn("transition-transform duration-200", !row.collapsed && "rotate-90")} />
        </button>
      ) : row.depth === 0 ? (
        <span className="-ml-1 shrink-0" style={{ width: size.icon + 2 }} />
      ) : null}
      {span ? (
        live ? (
          <Spinner size={size.icon} className="text-muted-foreground" />
        ) : (
          <StepIcon span={span} size={size.icon} className={span.kind === "error" ? "text-destructive" : "text-muted-foreground"} />
        )
      ) : (
        <BlokAvatar
          color={(group.color in BLOK_COLORS ? group.color : "blue") as BlokColor}
          shape={shapeForBot({ id: group.botId ?? group.id, name: group.name })}
          expression={group.trace.running ? "focused" : "deadpan"}
          size={size.avatar}
        />
      )}
      <span className="flex min-w-0 items-baseline gap-1.5">
        {/* a call that failed keeps its own icon and says so beside it;
            an error is its own warning already */}
        {span?.status === "failed" && span.kind !== "error" && (
          <TriangleAlert size={size.icon - 3} className="shrink-0 self-center text-destructive" />
        )}
        <span
          className={cn(
            "shrink-0 truncate",
            !span
              ? "font-semibold text-foreground"
              : failed
                ? "text-destructive"
                : live
                  ? "trace-shimmer text-muted-foreground"
                  : // thinking and waiting sit a step back from what was done
                    span.kind === "model" || span.kind === "wait"
                    ? "text-foreground/75"
                    : "text-foreground",
          )}
          style={{ maxWidth: "100%" }}
        >
          {span ? span.name : group.name}
        </span>
        {(span ? span.detail : group.subtitle) && (
          <span className="min-w-0 truncate text-muted-foreground">{span ? span.detail : group.subtitle}</span>
        )}
      </span>
    </div>
  );
});

// ── a row of the timeline ──

const TrackRow = memo(function TrackRow({
  row,
  index,
  group,
  offset,
  size,
  clock,
  fresh,
  slowest,
  pill,
  reduce,
  island,
}: {
  row: TraceRow;
  index: number;
  group: TraceGroup;
  offset: number;
  size: Size;
  clock: TraceClock;
  fresh: boolean;
  slowest: boolean;
  pill: string;
  reduce: boolean;
  island: boolean;
}) {
  const trace = group.trace;
  const span = row.span;
  // a trace that has ended has nothing running, whatever a span says
  const done = trace.running ? null : traceElapsed(trace, trace.endedAt ?? trace.startedAt);
  const endOf = (end: number | null) => (end !== null ? offset + end : done !== null ? offset + done : null);
  const at = (value: number | null): Record<string, number> => (value === null ? {} : { "--end": value });

  const kids = useMemo(() => (span ? null : childrenOf(trace.spans).get(ROOT) ?? []), [span, trace.spans]);
  const pieces = span
    ? []
    : segmentsOf(kids ?? [], { start: 0, end: trace.running ? null : (done ?? 0) });
  const marks = span ? (span.kind === "error" || span.kind === "compact" ? [{ id: span.id, at: span.start, kind: span.kind }] : []) : markersOf(kids ?? []);

  const start = offset + (span ? span.start : 0);
  const end = endOf(span ? span.end : trace.running ? null : (done ?? 0));
  const isMark = span?.kind === "error" || span?.kind === "compact";
  const cost = span ? span.cost : trace.totals.cost;
  const live = trace.running && (span ? span.end === null : true);
  const took = (t: number) => (span ? spanDuration(span, traceElapsed(trace, t)) : traceElapsed(trace, t));

  const bar = (key: string, from: number, to: number | null, kind: ReturnType<typeof barKind>, piece: boolean) => (
    <span
      key={key}
      className="trace-bar"
      data-kind={kind}
      data-live={to === null && trace.running ? true : undefined}
      style={{ "--start": from, ...at(to), ...(piece ? { "--inset": "0.5px", "--bar-min": "2px" } : {}) } as CSSProperties}
    >
      <BarGlyph kind={kind} size={size.glyph} />
    </span>
  );

  return (
    <div
      className="trace-row"
      data-new={fresh || undefined}
      style={{ height: size.row, transform: `translateY(${index * size.row}px)`, "--c": colorHex(group.color) } as CSSProperties}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          {/* the bar's whole extent answers the pointer, a little taller
              than the bar, so a thin one is still easy to land on */}
          <span
            className="trace-bar !bg-transparent"
            data-kind="hit"
            style={{ "--start": start, ...at(isMark ? start : end), "--bar-h": `${size.row - 6}px`, "--bar-min": "8px", "--inset": isMark ? "-4px" : "0px" } as CSSProperties}
          />
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className={cn(
            "rounded-lg border px-3 py-2.5 font-normal shadow-lg",
            island ? "border-white/10 bg-[#1a1a1e] text-[#ededf0] [--popover-foreground:#ededf0] [--muted-foreground:#8f8f99]" : "bg-popover text-popover-foreground",
          )}
        >
          <SpanDetail
            title={span ? span.name : group.name}
            detail={span ? span.detail : group.subtitle}
            kindWord={kindWord(span)}
            status={span ? (span.end === null && trace.running ? "running" : span.status) : trace.running ? "running" : "ok"}
            started={span ? span.start : 0}
            took={<LiveText clock={clock} live={live} format={(t) => formatDuration(took(t))} />}
            tokens={span ? span.tokens : trace.totals.tokens}
            cost={cost}
          />
        </TooltipContent>
      </Tooltip>
      <div className="pointer-events-none absolute inset-0">
        {span
          ? !isMark && bar(span.id, start, end, barKind(span), false)
          : pieces.map((piece) => bar(piece.id, offset + piece.start, endOf(piece.end), piece.kind, true))}
        {marks.map((mark) => (
          <span key={mark.id} className="trace-mark" data-kind={mark.kind} style={{ "--start": offset + mark.at } as CSSProperties} />
        ))}
        {!isMark && (
          <span className="trace-note text-caption tabular-nums text-muted-foreground" style={at(end) as CSSProperties}>
            <LiveText clock={clock} live={live} format={(t) => barNote(took(t), cost)} />
            {slowest && (
              <motion.span
                layoutId={pill}
                layout="position"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34 }}
                className="rounded-full bg-warning/12 px-1.5 text-micro font-medium leading-[16px] text-warning ring-1 ring-warning/25 ring-inset"
              >
                Slowest
              </motion.span>
            )}
          </span>
        )}
      </div>
    </div>
  );
});

/** Words that follow the clock without rendering anything around them. */
function LiveText({ clock, format, live }: { clock: TraceClock; format: (now: number) => string; live: boolean }) {
  const ref = useLiveText<HTMLSpanElement>(clock, format, live);
  return <span ref={ref} />;
}
