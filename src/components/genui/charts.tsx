// Charts an agent draws with numbers it already has.
//
// Bars lie on their side, as the gallery's chart always has: a label
// then its bar, which fits the width of a chat and never turns a word
// on its end. Lines are for a trend, a pie for shares of a whole. All
// three are drawn here in SVG and plain elements rather than with a
// charting library, because they are small, and a library's idea of
// type and colour would be a second design system in the transcript.
//
// The series colours are five fixed slots (--series-1 to 5 in
// styles.css), always assigned in order, checked as a set for colour
// blind separation in both themes. Three of them sit under 3:1 on
// white, so values are written beside their marks, and every chart
// carries a table for a screen reader. Text is never drawn in a series
// colour: a swatch beside it says which is which.
import { useEffect, useMemo, useState } from "react";
import type { ComponentRenderer } from "@openuidev/react-lang";
import { cn } from "@/lib/cn";
import { elements, figure, list, num, text } from "./read";

type Part = ComponentRenderer<Record<string, unknown>>;

const SLOTS = 5;
const series = (i: number) => `var(--series-${(i % SLOTS) + 1})`;

interface Line {
  name: string;
  values: Array<number | null>;
}

/** The labels and the series a bar or line chart was given, cut to what
 * can be told apart. A sixth series would need a sixth colour, and a
 * generated one is a colour nobody checked. */
function readSeries(props: Record<string, unknown>): { labels: string[]; lines: Line[]; dropped: number } {
  const labels = list(props.labels).map(text);
  const all = elements(props.series, "Series").map((s) => ({
    name: text(s.props.category),
    values: labels.map((_, i) => num(list(s.props.values)[i])),
  }));
  return { labels, lines: all.slice(0, SLOTS), dropped: Math.max(0, all.length - SLOTS) };
}

function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-small text-muted-foreground">
      {names.map((name, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-[3px]" style={{ background: series(i) }} />
          {name || `Series ${i + 1}`}
        </span>
      ))}
    </div>
  );
}

/** The numbers again, as a table, for a screen reader. */
function DataTable({ caption, labels, lines }: { caption: string; labels: string[]; lines: Line[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Label</th>
          {lines.map((line, i) => (
            <th key={i} scope="col">
              {line.name || `Series ${i + 1}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {labels.map((label, r) => (
          <tr key={r}>
            <th scope="row">{label}</th>
            {lines.map((line, i) => (
              <td key={i}>{line.values[r] ?? ""}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Frame({ title, children, note }: { title?: string; children: React.ReactNode; note?: string }) {
  return (
    <figure className="min-w-0 rounded-xl border px-3.5 py-3">
      {title && <figcaption className="mb-2 text-small font-medium text-muted-foreground">{title}</figcaption>}
      {children}
      {note && <div className="mt-2 text-small text-muted-foreground">{note}</div>}
    </figure>
  );
}

const dropNote = (dropped: number) => (dropped ? `${dropped} more series not shown` : undefined);

/**
 * Bars on their side. Every bar the same, every bar zero, or some below
 * zero are all real answers; a span of nothing would divide by zero and
 * draw an empty chart, which reads as broken rather than flat.
 */
export const BarChart: Part = ({ props }) => {
  const { labels, lines, dropped } = readSeries(props);
  if (!labels.length || !lines.length) return null;
  const stacked = text(props.variant) === "stacked" && lines.length > 1;
  const totals = labels.map((_, r) =>
    stacked
      ? { hi: lines.reduce((sum, l) => sum + Math.max(0, l.values[r] ?? 0), 0), lo: lines.reduce((sum, l) => sum + Math.min(0, l.values[r] ?? 0), 0) }
      : { hi: Math.max(0, ...lines.map((l) => l.values[r] ?? 0)), lo: Math.min(0, ...lines.map((l) => l.values[r] ?? 0)) },
  );
  const top = Math.max(0, ...totals.map((t) => t.hi));
  const bottom = Math.min(0, ...totals.map((t) => t.lo));
  const span = top - bottom || 1;
  const zero = (-bottom / span) * 100;
  const share = (v: number) => (Math.abs(v) / span) * 100;
  const axis = [text(props.xLabel), text(props.yLabel)].filter(Boolean).join(" · ");

  return (
    <Frame title={axis || undefined} note={dropNote(dropped)}>
      <div className="flex flex-col gap-2">
        <Legend names={lines.map((l) => l.name)} />
        <div className="flex flex-col gap-1.5" aria-hidden>
          {labels.map((label, r) => (
            <div key={r} className="flex items-center gap-2.5">
              <span className="w-[32%] shrink-0 truncate text-body text-muted-foreground" title={label}>
                {label}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                {stacked ? (
                  <Stacked values={lines.map((l) => l.values[r] ?? 0)} share={share} />
                ) : (
                  lines.map((line, i) => {
                    const v = line.values[r];
                    return (
                      <div key={i} className="relative flex h-3 items-center">
                        {v !== null && (
                          <>
                            <span
                              className={cn("absolute h-full", v < 0 ? "rounded-l-[4px]" : "rounded-r-[4px]")}
                              style={{
                                background: series(i),
                                left: v < 0 ? `${zero - share(v)}%` : `${zero}%`,
                                width: `max(2px, ${share(v) * 0.82}%)`,
                              }}
                            />
                            <span
                              className="absolute text-small leading-none tabular-nums text-foreground"
                              style={{ left: `calc(${v < 0 ? zero : zero + share(v) * 0.82}% + 6px)` }}
                            >
                              {figure(v)}
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <DataTable caption={axis || "Bar chart"} labels={labels} lines={lines} />
    </Frame>
  );
};

/** One bar made of each series' part, a hairline of ground between them,
 * and the total at its end. */
function Stacked({ values, share }: { values: number[]; share: (v: number) => number }) {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  return (
    <div className="flex h-3.5 items-center gap-1.5">
      <div className="flex h-full overflow-hidden rounded-r-[4px]" style={{ width: `${share(total) * 0.82}%`, gap: 2 }}>
        {values.map((v, i) =>
          v > 0 ? <span key={i} className="h-full" style={{ background: series(i), flex: `${v} 0 0` }} /> : null,
        )}
      </div>
      <span className="text-small leading-none tabular-nums text-foreground">{figure(total)}</span>
    </div>
  );
}

/** Round numbers for an axis, three or four of them. */
function ticks(lo: number, hi: number): number[] {
  if (lo === hi) return [lo];
  const raw = (hi - lo) / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** How wide the chart's box is, measured once it is on screen, which
 * for a chart still streaming in may be a few frames after it mounts. */
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

const HEIGHT = 168;
const PAD = { top: 10, right: 12, bottom: 24, left: 40 };

/**
 * Lines over time. Pointing anywhere on the chart shows every series'
 * value at that label, so no point needs a number written on it.
 */
export const LineChart: Part = ({ props }) => {
  const { labels, lines, dropped } = readSeries(props);
  const [box, width] = useWidth();
  const [at, setAt] = useState<number | null>(null);
  const values = lines.flatMap((l) => l.values.filter((v): v is number => v !== null));
  const scale = useMemo(() => {
    if (!values.length) return null;
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    // a trend near zero keeps zero in view; one far from it does not
    // flatten itself against the floor
    if (lo > 0 && lo < hi * 0.35) lo = 0;
    if (lo === hi) {
      lo -= Math.abs(lo) * 0.1 || 1;
      hi += Math.abs(hi) * 0.1 || 1;
    }
    const marks = ticks(lo, hi);
    return { lo: Math.min(lo, marks[0]), hi: Math.max(hi, marks[marks.length - 1]), marks };
  }, [values.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!labels.length || !lines.length || !scale) return null;

  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - scale.lo) / (scale.hi - scale.lo)) * plotH;
  const step = text(props.variant) === "step";
  const path = (line: Line) => {
    let d = "";
    let pen = false;
    line.values.forEach((v, i) => {
      if (v === null) return void (pen = false);
      if (!pen) d += `M${x(i)},${y(v)}`;
      else if (step) d += `H${x(i)}V${y(v)}`;
      else d += `L${x(i)},${y(v)}`;
      pen = true;
    });
    return d;
  };
  // a few labels along the bottom, never crowded
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 64))));
  const axis = [text(props.yLabel), text(props.xLabel)].filter(Boolean).join(" · ");

  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    const i = labels.length === 1 ? 0 : Math.round((px / plotW) * (labels.length - 1));
    setAt(Math.min(labels.length - 1, Math.max(0, i)));
  };

  return (
    <Frame title={axis || undefined} note={dropNote(dropped)}>
      <div className="flex flex-col gap-2">
        <Legend names={lines.map((l) => l.name)} />
        <div ref={box} className="relative" aria-hidden>
          {width > 0 && (
            <svg width={width} height={HEIGHT} className="block touch-none" onPointerMove={point} onPointerLeave={() => setAt(null)}>
              {scale.marks.map((mark, i) => (
                <g key={i}>
                  <line x1={PAD.left} x2={PAD.left + plotW} y1={y(mark)} y2={y(mark)} stroke="var(--border)" />
                  <text x={PAD.left - 8} y={y(mark)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-caption tabular-nums">
                    {figure(mark)}
                  </text>
                </g>
              ))}
              {labels.map((label, i) =>
                i % every === 0 || i === labels.length - 1 ? (
                  <text
                    key={i}
                    x={x(i)}
                    y={HEIGHT - 6}
                    textAnchor={labels.length === 1 ? "middle" : i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
                    className="fill-muted-foreground text-caption"
                  >
                    {label}
                  </text>
                ) : null,
              )}
              {at !== null && <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.35} />}
              {lines.map((line, i) => (
                <path key={i} d={path(line)} fill="none" stroke={series(i)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {lines.map((line, i) =>
                line.values.map((v, j) =>
                  v !== null && (j === at || line.values.filter((n) => n !== null).length === 1) ? (
                    <circle key={`${i}-${j}`} cx={x(j)} cy={y(v)} r={4} fill={series(i)} stroke="var(--background)" strokeWidth={2} />
                  ) : null,
                ),
              )}
            </svg>
          )}
          {at !== null && (
            <div
              className="pointer-events-none absolute top-1 z-[1] min-w-28 rounded-lg border bg-popover px-2.5 py-1.5 text-small shadow-[0_4px_12px_var(--shadow-color)]"
              style={x(at) > width / 2 ? { right: width - x(at) + 10 } : { left: x(at) + 10 }}
            >
              <div className="font-medium text-foreground">{labels[at]}</div>
              {lines.map((line, i) => (
                <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 shrink-0 rounded-[3px]" style={{ background: series(i) }} />
                  <span className="min-w-0 flex-1 truncate">{line.name || `Series ${i + 1}`}</span>
                  <span className="tabular-nums text-foreground">{line.values[at] === null ? "" : figure(line.values[at]!)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <DataTable caption={axis || "Line chart"} labels={labels} lines={lines} />
    </Frame>
  );
};

/** More slices than this and the smallest fold into one called Other. */
const MAX_SLICES = 5;

/** Shares of a whole: a ring, and beside it what each part is, how much,
 * and what share of the whole. */
export const PieChart: Part = ({ props }) => {
  const [hover, setHover] = useState<number | null>(null);
  const raw: Array<{ label: string; value: number; other?: boolean }> = list(props.labels)
    .map((label, i) => ({ label: text(label), value: num(list(props.values)[i]) ?? 0 }))
    .filter((slice) => slice.value > 0);
  if (!raw.length) return null;
  const sorted = raw.length > MAX_SLICES ? [...raw].sort((a, b) => b.value - a.value) : raw;
  const slices = sorted.length > MAX_SLICES
    ? [...sorted.slice(0, MAX_SLICES - 1), { label: "Other", value: sorted.slice(MAX_SLICES - 1).reduce((s, x) => s + x.value, 0), other: true }]
    : sorted;
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const donut = text(props.variant) !== "pie";
  const size = 128;
  const r = size / 2;
  const inner = donut ? r * 0.62 : 0;
  const colour = (i: number, slice: { other?: boolean }) => (slice.other ? "var(--muted-foreground)" : series(i));
  let angle = -Math.PI / 2;
  const arcs = slices.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    return { start, end: angle, sweep };
  });
  const arc = ({ start, end, sweep }: { start: number; end: number; sweep: number }) => {
    if (sweep >= Math.PI * 2 - 1e-6) {
      // a whole circle is two halves; one arc from a point to itself draws nothing
      return donut
        ? `M${r},0A${r},${r},0,1,1,${r},${size}A${r},${r},0,1,1,${r},0ZM${r},${r - inner}A${inner},${inner},0,1,0,${r},${r + inner}A${inner},${inner},0,1,0,${r},${r - inner}Z`
        : `M${r},0A${r},${r},0,1,1,${r},${size}A${r},${r},0,1,1,${r},0Z`;
    }
    const large = sweep > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${r + rad * Math.cos(a)},${r + rad * Math.sin(a)}`;
    return donut
      ? `M${p(start, r)}A${r},${r},0,${large},1,${p(end, r)}L${p(end, inner)}A${inner},${inner},0,${large},0,${p(start, inner)}Z`
      : `M${r},${r}L${p(start, r)}A${r},${r},0,${large},1,${p(end, r)}Z`;
  };
  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
          {slices.map((slice, i) => (
            <path
              key={i}
              d={arc(arcs[i])}
              fill={colour(i, slice)}
              stroke="var(--background)"
              strokeWidth={2}
              strokeLinejoin="round"
              className="transition-opacity duration-150"
              opacity={hover === null || hover === i ? 1 : 0.35}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <ul className="flex min-w-[10rem] flex-1 flex-col gap-1">
          {slices.map((slice, i) => (
            <li
              key={i}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              className={cn("flex items-center gap-2 text-body transition-opacity duration-150", hover !== null && hover !== i && "opacity-50")}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colour(i, slice) }} />
              <span className="min-w-0 flex-1 truncate text-foreground">{slice.label || `Part ${i + 1}`}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{figure(slice.value)}</span>
              <span className="w-10 shrink-0 text-right tabular-nums text-foreground">{Math.round((slice.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
};
