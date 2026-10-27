// The Usage page's chart: one value a day, drawn to scale, with a thin
// line per engine over it when more than one is in view.
//
// Drawn here in SVG, the way the agents' own charts are (genui/charts.tsx),
// rather than with a charting library whose idea of type and colour would
// be a second design system on one page. The total is the filled shape in
// the brand colour; each engine's line takes a series colour after the
// first, which is the brand's own blue, so no engine is mistaken for the
// total.
//
// Pointing at the chart, or focusing it and using the arrow keys, reads
// out one day: its date, the total and each engine's part. A screen
// reader hears the same as the day moves, and has the whole series as a
// table besides.
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { axisFigure, figureOf, longDay, niceTicks, shortDay, valueOf, type UsageDay, type UsageMetric } from "@/lib/usagePage";
import { t } from "@/lib/i18n";

export interface ChartLine {
  id: string;
  name: string;
  colour: string;
}

const PAD = { top: 12, right: 10, bottom: 26, left: 46 };

/** How wide the chart's box is, measured once it is on screen. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    watch.observe(el);
    return () => watch.disconnect();
  }, [el]);
  return [setEl, width];
}

export function UsageChart({
  days,
  metric,
  lines,
  label,
}: {
  days: UsageDay[];
  metric: UsageMetric;
  /** The engines drawn as lines over the total, or none. */
  lines: ChartLine[];
  /** What the chart shows, for a screen reader: "Daily cost, last 30 days". */
  label: string;
}) {
  const [box, width] = useWidth();
  const [at, setAt] = useState<number | null>(null);
  const height = width > 0 && width < 480 ? 180 : 224;
  const totals = useMemo(() => days.map((d) => valueOf(d, metric)), [days, metric]);
  const engineValues = useMemo(
    () => lines.map((line) => days.map((d) => (d.byEngine[line.id] ? valueOf(d.byEngine[line.id], metric) : 0))),
    [days, lines, metric],
  );
  const marks = niceTicks(Math.max(0, ...totals));
  const top = marks[marks.length - 1] || 1;

  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length <= 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - v / top) * plotH;
  const base = y(0);
  const path = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = days.length > 1 ? `${path(totals)}L${x(days.length - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z` : "";
  // a few dates along the bottom, never crowded, the last always shown
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 72))));

  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    const i = days.length <= 1 ? 0 : Math.round((px / plotW) * (days.length - 1));
    setAt(Math.min(days.length - 1, Math.max(0, i)));
  };
  const keys = (e: React.KeyboardEvent) => {
    const last = days.length - 1;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 };
    if (e.key in step) setAt((was) => Math.min(last, Math.max(0, (was ?? last) + step[e.key])));
    else if (e.key === "Home") setAt(0);
    else if (e.key === "End") setAt(last);
    else if (e.key === "Escape") setAt(null);
    else return;
    e.preventDefault();
  };

  const day = at !== null ? days[at] : null;
  const reading = day ? `${longDay(day.date)}: ${figureOf(day, metric)}` : "";

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={box}
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}. Use the arrow keys to read each day.`}
        onKeyDown={keys}
        onFocus={() => setAt((was) => was ?? days.length - 1)}
        onBlur={() => setAt(null)}
        className="relative rounded-lg"
        style={{ height }}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block touch-none select-none" aria-hidden onPointerMove={point} onPointerLeave={() => setAt(null)}>
            {marks.map((mark) => (
              <g key={mark}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(mark)} y2={y(mark)} stroke="var(--border)" strokeDasharray={mark === 0 ? undefined : "2 4"} />
                <text x={PAD.left - 10} y={y(mark)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-caption tabular-nums">
                  {axisFigure(mark, metric)}
                </text>
              </g>
            ))}
            {days.map((d, i) =>
              i % every === 0 || i === days.length - 1 ? (
                // the last label is drawn alone when the one before it would crowd it
                i !== days.length - 1 && days.length - 1 - i < every * 0.6 ? null : (
                  <text
                    key={d.date}
                    x={x(i)}
                    y={height - 6}
                    textAnchor={days.length === 1 ? "middle" : i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}
                    className="fill-muted-foreground text-caption tabular-nums"
                  >
                    {shortDay(d.date)}
                  </text>
                )
              ) : null,
            )}
            {area && <path d={area} fill="var(--brand)" fillOpacity={0.1} />}
            {days.length > 1 && (
              <path d={path(totals)} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {engineValues.map((values, i) =>
              days.length > 1 ? (
                <path
                  key={lines[i].id}
                  d={path(values)}
                  fill="none"
                  stroke={lines[i].colour}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeOpacity={0.9}
                />
              ) : null,
            )}
            {at !== null && (
              <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={base} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
            )}
            {(at !== null || days.length === 1) &&
              [
                ...engineValues.map((values, i) => ({ v: values[at ?? 0], colour: lines[i].colour, key: lines[i].id })),
                { v: totals[at ?? 0], colour: "var(--brand)", key: "total" },
              ].map((dot) => (
                <circle key={dot.key} cx={x(at ?? 0)} cy={y(dot.v)} r={dot.key === "total" ? 4 : 3} fill={dot.colour} stroke="var(--background)" strokeWidth={2} />
              ))}
          </svg>
        )}
        {day && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border bg-popover px-2.5 py-2 text-small shadow-md shadow-(color:--shadow-color)"
            style={x(at!) > width / 2 ? { right: width - x(at!) + 12 } : { left: x(at!) + 12 }}
          >
            <div className="text-muted-foreground tabular-nums">{longDay(day.date)}</div>
            <div className="mt-0.5 text-ui font-semibold tabular-nums text-foreground">{figureOf(day, metric)}</div>
            {lines.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-0.5 border-t pt-1.5">
                {lines.map((line) => (
                  <div key={line.id} className="flex items-center gap-1.5 text-muted-foreground">
                    <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: line.colour }} />
                    <span className="min-w-0 flex-1 truncate">{line.name}</span>
                    <span className="tabular-nums text-foreground">{figureOf(day.byEngine[line.id], metric)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {reading}
        </span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{t("usageChart.day")}</th>
            <th scope="col">{t("usageChart.total")}</th>
            {lines.map((line) => (
              <th key={line.id} scope="col">
                {line.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{longDay(d.date)}</th>
              <td>{figureOf(d, metric)}</td>
              {lines.map((line) => (
                <td key={line.id}>{figureOf(d.byEngine[line.id], metric)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Which engine is which line, and a way to look at one alone. */
export function ChartLegend({ lines, onPick, className }: { lines: ChartLine[]; onPick: (id: string) => void; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1 gap-y-1", className)}>
      <span className="mr-2 flex items-center gap-1.5 text-small text-muted-foreground">
        <span aria-hidden className="h-0.5 w-3 rounded-full bg-brand" />
        Total
      </span>
      {lines.map((line) => (
        <button
          key={line.id}
          type="button"
          onClick={() => onPick(line.id)}
          title={`Show only ${line.name}`}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-small text-muted-foreground transition-[background-color,color] duration-150 hover:bg-accent hover:text-foreground"
        >
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: line.colour }} />
          {line.name}
        </button>
      ))}
    </div>
  );
}
