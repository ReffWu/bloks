// The small pieces of the waterfall: what each step is drawn with, the
// detail a bar opens on hover, and the legend.
import type { CSSProperties, ReactNode } from "react";
import {
  Brain,
  FilePen,
  FileText,
  Globe,
  Hand,
  Minimize2,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  X,
  Zap,
} from "@/components/icons";
import { CreatureMark } from "@/components/Avatar";
import { BLOK_COLORS, type BlokColor } from "@/lib/mascot";
import { kindOf } from "@/lib/tool-summary";
import type { TraceSpan } from "@/lib/trace";
import { formatCost, formatDuration, formatTokens, type BarKind } from "@/lib/traceView";
import { cn } from "@/lib/cn";
import { t, type MessageKey } from "@/lib/i18n";

/** An agent's colour as a hex value: a BlokColor by name, or a hex
 * colour as it came. */
export function colorHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  return BLOK_COLORS[color as BlokColor] ?? BLOK_COLORS.blue;
}

/** A small ring turning: the step that is going now. */
export function Spinner({ size, className }: { size: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("trace-spin inline-block shrink-0 rounded-full border-[1.5px] border-current border-r-transparent opacity-80", className)}
      style={{ width: size - 2, height: size - 2, margin: 1 }}
    />
  );
}

/** The icon a step is drawn with: what kind of thing it did. */
export function StepIcon({ span, size, className }: { span: TraceSpan; size: number; className?: string }) {
  const props = { size, className: cn("shrink-0", className) };
  switch (span.kind) {
    case "model":
      return span.name === "Writing" ? <Pencil {...props} /> : span.name === "Thinking" ? <Brain {...props} /> : <Sparkles {...props} />;
    case "wait":
      return <Hand {...props} />;
    case "agent":
      return <CreatureMark size={size} fill="var(--c)" className={cn("shrink-0", className)} />;
    case "error":
      return <TriangleAlert {...props} />;
    case "compact":
      return <Minimize2 {...props} />;
    default: {
      const kind = kindOf(span.name);
      if (kind === "command") return <SquareTerminal {...props} />;
      if (kind === "read") return <FileText {...props} />;
      if (kind === "search") return /web/i.test(span.name) ? <Globe {...props} /> : <Search {...props} />;
      if (kind === "edit") return <FilePen {...props} />;
      return /web|fetch|browse|url|http/i.test(span.name) ? <Globe {...props} /> : <Zap {...props} />;
    }
  }
}

/** What sits inside a bar, where it has room: a cross on a failure, the
 * circular arrow on a retry, the agent mark on a sub-agent. */
export function BarGlyph({ kind, size }: { kind: BarKind; size: number }) {
  if (kind === "failed") return <X size={size} strokeWidth={2.4} />;
  if (kind === "retry") return <RefreshCw size={size} strokeWidth={2.2} />;
  if (kind === "agent") return <CreatureMark size={size} fill="#101013" />;
  return null;
}

const STATUS_WORDS: Record<TraceSpan["status"], MessageKey> = {
  running: "traceParts.status.running",
  ok: "traceParts.status.done",
  failed: "traceParts.status.failed",
  stopped: "traceParts.status.stopped",
};

/** The hover card for one step, or for an agent's whole turn. */
export function SpanDetail({
  title,
  detail,
  kindWord,
  status,
  started,
  took,
  tokens,
  cost,
}: {
  title: string;
  detail?: string;
  kindWord: string;
  status: TraceSpan["status"];
  /** Milliseconds into its turn. */
  started: number;
  /** Rendered by the caller, since a running one counts. */
  took: ReactNode;
  tokens?: number | null;
  cost?: number | null;
}) {
  const said = [
    [t("traceParts.started"), t("traceParts.startedIn", { time: formatDuration(started) })],
    [t("traceParts.took"), took],
    [t("traceParts.tokens"), formatTokens(tokens)],
    [t("traceParts.cost"), formatCost(cost)],
  ].filter(([, value]) => value !== null && value !== undefined) as Array<[string, ReactNode]>;
  return (
    <div className="flex w-[240px] max-w-[70vw] flex-col gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-small font-semibold text-popover-foreground">{title}</span>
        <span
          className={cn(
            "shrink-0 text-caption",
            status === "failed" ? "text-destructive" : status === "running" ? "text-popover-foreground" : "text-muted-foreground",
          )}
        >
          {status === "running" ? kindWord : `${kindWord} · ${t(STATUS_WORDS[status])}`}
        </span>
      </div>
      {detail && <div className="line-clamp-2 break-all font-mono text-caption leading-snug text-muted-foreground">{detail}</div>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-caption">
        {said.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right tabular-nums text-popover-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function kindWord(span: TraceSpan | null): string {
  if (!span) return t("traceParts.kind.turn");
  switch (span.kind) {
    case "model":
      return t("traceParts.kind.model");
    case "tool":
      return span.retry ? t("traceParts.kind.toolAgain") : t("traceParts.kind.tool");
    case "agent":
      return t("traceParts.kind.subAgent");
    case "wait":
      return t("traceParts.kind.waiting");
    case "error":
      return t("traceParts.kind.error");
    case "compact":
      return t("traceParts.kind.compaction");
    default:
      return t("traceParts.kind.turn");
  }
}

/** A legend swatch is a still, tiny bar of the same kind. */
const SWATCH: CSSProperties = { position: "relative", top: "auto", left: "auto", margin: 0, transform: "none", width: 12, height: 8, borderRadius: 2 };

export function Legend({ color, className }: { color: string; className?: string }) {
  const items: Array<{ kind: BarKind; label: string }> = [
    { kind: "model", label: t("traceParts.kind.model") },
    { kind: "tool", label: t("traceParts.kind.tool") },
    { kind: "agent", label: t("traceParts.kind.subAgent") },
    { kind: "wait", label: t("traceParts.kind.waiting") },
    { kind: "failed", label: t("traceParts.status.failed") },
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-1 text-caption text-muted-foreground", className)} style={{ "--c": color } as CSSProperties}>
      {items.map((item) => (
        <span key={item.kind} className="flex items-center gap-1.5">
          <span aria-hidden className="trace-bar" data-kind={item.kind} style={SWATCH} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
