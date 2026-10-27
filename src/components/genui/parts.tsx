// The answer's words, numbers, lists, choices and buttons, drawn.
//
// An interface answer sits in the transcript where prose would, so it
// reads as part of the reply rather than as a dashboard that landed in
// it: no card around the whole, the chat's own type sizes and borders,
// and a frame only on the things that are a thing (a table, a metric, a
// form). The accent follows the palette rule in styles.css: words and
// marks drawn in it use brand-ink, a fill that carries words is
// brand-ink with brand-foreground, and plain brand is for pure colour.
//
// What a renderer gets is whatever the agent wrote, possibly half
// written, so every one reads its props through ./read.ts and draws what
// it has rather than nothing.
import { useContext, useRef, useState, type ReactNode } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  useFormName,
  useFormValidation,
  useIsStreaming,
  useTriggerAction,
  type ActionPlan,
  type ComponentRenderer,
} from "@openuidev/react-lang";
import { AlertTriangle } from "@/components/icons";
import { ArrowDown } from "@/components/icons";
import { ArrowRight } from "@/components/icons";
import { ArrowUp } from "@/components/icons";
import { ArrowUpRight } from "@/components/icons";
import { Ban } from "@/components/icons";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { ChevronRight } from "@/components/icons";
import { CircleDot } from "@/components/icons";
import { CornerDownRight } from "@/components/icons";
import { FileImage } from "@/components/icons";
import { Info } from "@/components/icons";
import { X } from "@/components/icons";
import { Button as UiButton } from "@/components/ui/button";
import { CodeView, InlineMarkdown, Markdownish } from "@/components/Markdown";
import { TableScroll } from "@/components/TableScroll";
import { cn } from "@/lib/cn";
import { safeHttpUrl } from "@/lib/genui/actions";
import { FormSent } from "./forms";
import { elements, figure, isElement, list, localImage, text, type Element } from "./read";
import { t } from "@/lib/i18n";

type Part = ComponentRenderer<Record<string, unknown>>;

/** Drawn only inside its parent, which reads its props. */
export const Inner: Part = () => null;

// ── the answer ─────────────────────────────────────────────────────────

/**
 * The root: everything, top to bottom, at the reply's own rhythm.
 *
 * Metrics written one after another sit side by side, because that is
 * what a row of numbers is for, and the language has no row of its own
 * in the chat library. While the answer streams, each new part fades in
 * where it lands; settled, it is simply there.
 */
export const Card: Part = ({ props, renderNode }) => {
  const streaming = useIsStreaming();
  const runs: Array<{ metrics: Element[] } | { one: unknown }> = [];
  for (const child of list(props.children)) {
    const last = runs[runs.length - 1];
    if (isElement(child) && child.typeName === "MetricIndicator") {
      if (last && "metrics" in last) last.metrics.push(child);
      else runs.push({ metrics: [child] });
    } else runs.push({ one: child });
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {runs.map((run, i) => (
        <div key={i} className={cn("min-w-0", streaming && "animate-fade-in")}>
          {"metrics" in run ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">{run.metrics.map((m, j) => <div key={j} className="min-w-0">{renderNode(m)}</div>)}</div>
          ) : (
            renderNode(run.one)
          )}
        </div>
      ))}
    </div>
  );
};

/** Several parts in a row of their own, inside a tab or a section. */
function Stack({ children, renderNode }: { children: unknown; renderNode: (value: unknown) => ReactNode }) {
  return <Card props={{ children }} renderNode={renderNode} />;
}

export const CardHeader: Part = ({ props }) => {
  const title = text(props.title);
  const subtitle = text(props.subtitle);
  if (!title && !subtitle) return null;
  return (
    <div>
      {title && <h3 className="text-title font-semibold text-balance text-foreground">{title}</h3>}
      {subtitle && <p className="mt-0.5 text-body text-muted-foreground">{subtitle}</p>}
    </div>
  );
};

const TEXT_SIZE: Record<string, string> = {
  small: "text-body",
  "small-heavy": "text-body font-semibold",
  large: "text-title",
  "large-heavy": "text-title font-semibold",
};

export const TextContent: Part = ({ props }) => {
  const words = text(props.text);
  if (!words) return null;
  return (
    <div className={cn("min-w-0", TEXT_SIZE[text(props.size)])}>
      <Markdownish text={words} />
    </div>
  );
};

const CALLOUT = {
  info: { box: "border-brand/20 bg-brand-soft/50", mark: "text-brand-ink", Icon: Info },
  warning: { box: "border-warning/30 bg-warning/5", mark: "text-warning", Icon: AlertTriangle },
  error: { box: "border-destructive/30 bg-destructive/5", mark: "text-destructive", Icon: Ban },
  success: { box: "border-success/30 bg-success/5", mark: "text-success", Icon: Check },
  neutral: { box: "border-transparent bg-muted/70", mark: "text-muted-foreground", Icon: Info },
} as const;

export const Callout: Part = ({ props }) => {
  const look = CALLOUT[text(props.variant) as keyof typeof CALLOUT] ?? CALLOUT.neutral;
  const title = text(props.title);
  const description = text(props.description);
  if (!title && !description) return null;
  return (
    <div className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3", look.box)}>
      <look.Icon size={15} aria-hidden className={cn("mt-[3px] shrink-0", look.mark)} />
      <div className="min-w-0">
        {title && <div className="text-body font-semibold text-foreground">{title}</div>}
        {description && (
          <div className={cn("text-body text-pretty text-muted-foreground [overflow-wrap:anywhere]", title && "mt-0.5")}>
            <InlineMarkdown text={description} />
          </div>
        )}
      </div>
    </div>
  );
};

export const Separator: Part = () => <hr className="my-1 border-border" />;

/**
 * An image. One the app holds is drawn; one anywhere else is offered as a
 * link to open in the browser, never fetched from here, because fetching
 * an address an agent wrote is how what it read would leave the machine.
 */
export const Image: Part = ({ props }) => {
  const alt = text(props.alt);
  const local = localImage(props.src);
  if (local) {
    return <img src={local} alt={alt} className="max-h-[360px] max-w-full rounded-xl border object-contain" />;
  }
  const url = safeHttpUrl(props.src);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-body transition-colors duration-150 hover:bg-accent/60"
    >
      <FileImage size={16} aria-hidden className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-foreground">{alt || t("genuiParts.image")}</span>
      <span className="shrink-0 text-small text-muted-foreground">{new URL(url).host}</span>
      <ArrowUpRight size={13} aria-hidden className="shrink-0 text-muted-foreground" />
    </a>
  );
};

export const CodeBlock: Part = ({ props }) => {
  const code = text(props.codeString);
  if (!code) return null;
  return <CodeView lang={text(props.language)} code={code} />;
};

export const Quote: Part = ({ props }) => {
  const words = text(props.text);
  if (!words) return null;
  const said = [text(props.from), text(props.where)].filter(Boolean).join(" · ");
  return (
    <figure className="border-l-2 border-brand pl-4">
      <blockquote className="whitespace-pre-wrap text-pretty text-foreground">{words}</blockquote>
      {said && <figcaption className="mt-1.5 text-small text-muted-foreground">{said}</figcaption>}
    </figure>
  );
};

const TAG: Record<string, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  info: "bg-brand-soft text-brand-ink",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

function Pill({ label, variant }: { label: string; variant?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-small font-medium", TAG[variant ?? ""] ?? TAG.neutral)}>
      {label}
    </span>
  );
}

export const Tag: Part = ({ props }) => {
  const label = text(props.text);
  return label ? <Pill label={label} variant={text(props.variant)} /> : null;
};

export const TagBlock: Part = ({ props }) => {
  const tags = list(props.tags).map(text).filter(Boolean);
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag, i) => (
        <Pill key={`${tag}-${i}`} label={tag} />
      ))}
    </div>
  );
};

// ── numbers ────────────────────────────────────────────────────────────

const TONE: Record<string, string> = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

/** One number, said large, with what it is and how it moved. Whether a
 * move is good is the agent's to say: an up in costs is not. */
export const MetricIndicator: Part = ({ props }) => {
  const label = text(props.label);
  const value = text(props.value);
  if (!label && !value) return null;
  const trend = text(props.trend);
  const tone = text(props.tone) || (trend === "up" ? "positive" : trend === "down" ? "negative" : "neutral");
  const change = text(props.change);
  const Arrow = trend === "up" ? ArrowUp : trend === "down" ? ArrowDown : null;
  return (
    <div className="h-full min-w-0 rounded-xl border bg-card px-3.5 py-3">
      <div className="truncate text-small text-muted-foreground" title={label}>
        {label}
      </div>
      <div className="mt-0.5 truncate text-heading font-semibold tabular-nums text-foreground" title={value}>
        {value}
      </div>
      {change && (
        <div className={cn("mt-0.5 flex items-center gap-1 text-small font-medium tabular-nums", TONE[tone] ?? TONE.neutral)}>
          {Arrow && <Arrow size={12} strokeWidth={2.2} aria-hidden className="shrink-0" />}
          <span className="truncate">{change}</span>
        </div>
      )}
    </div>
  );
};

/** Most rows a table draws. The rest are a line saying how many. */
const MAX_ROWS = 200;

function cell(value: unknown): ReactNode {
  if (typeof value === "number") return Number.isFinite(value) ? figure(value) : "";
  if (typeof value === "boolean") return value ? t("genuiParts.yes") : t("genuiParts.no");
  const words = text(value);
  return words ? <InlineMarkdown text={words} /> : null;
}

/**
 * Rows and columns, written column by column. Drawn like a markdown
 * table in a reply, so the two kinds of table never look like two
 * products, and scrolling sideways inside its own frame.
 */
export const Table: Part = ({ props }) => {
  const columns = elements(props.columns, "Col").map((col) => {
    const data = list(col.props.data);
    return {
      label: text(col.props.label),
      data,
      numeric: text(col.props.type) === "number" || (data.length > 0 && data.every((v) => v === null || typeof v === "number")),
    };
  });
  if (!columns.length) return null;
  const rows = Math.max(0, ...columns.map((c) => c.data.length));
  const shown = Math.min(rows, MAX_ROWS);
  // An unnamed first column is the rows' own names, as in a comparison.
  const named = columns[0].label === "";
  return (
    <div className="min-w-0">
      <TableScroll className="rounded-xl border">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="border-b bg-foreground/[0.03]">
              {columns.map((col, i) => (
                <th
                  key={i}
                  scope="col"
                  className={cn("px-3 py-2 font-semibold whitespace-nowrap text-foreground", col.numeric ? "text-right" : "text-left")}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: shown }, (_, r) => (
              <tr key={r} className="border-b last:border-b-0">
                {columns.map((col, c) => {
                  const Tag = named && c === 0 ? "th" : "td";
                  return (
                    <Tag
                      key={c}
                      scope={Tag === "th" ? "row" : undefined}
                      className={cn(
                        "px-3 py-2 align-top [overflow-wrap:anywhere]",
                        col.numeric ? "text-right tabular-nums" : "text-left",
                        Tag === "th" ? "font-medium text-foreground" : "font-normal",
                      )}
                    >
                      {cell(col.data[r])}
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {rows > shown && <div className="mt-1.5 text-small text-muted-foreground">{t("genuiParts.moreRowsNotShown", { count: rows - shown })}</div>}
    </div>
  );
};

// ── steps and lists ────────────────────────────────────────────────────

function StepMark({ state, index }: { state: string; index: number }) {
  const base = "relative z-[1] flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-medium tabular-nums";
  switch (state) {
    case "done":
      return (
        <span className={cn(base, "bg-success/12 text-success")}>
          <Check size={11} strokeWidth={2.6} aria-hidden />
          <span className="sr-only">{t("genuiParts.step.done")}</span>
        </span>
      );
    case "doing":
      return (
        <span className={cn(base, "bg-brand-soft text-brand-ink")}>
          <CircleDot size={11} aria-hidden />
          <span className="sr-only">{t("genuiParts.step.inProgress")}</span>
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "bg-destructive/10 text-destructive")}>
          <X size={11} strokeWidth={2.6} aria-hidden />
          <span className="sr-only">{t("genuiParts.step.failed")}</span>
        </span>
      );
    case "todo":
      return <span className={cn(base, "border border-foreground/20 bg-background text-muted-foreground")}>{index + 1}</span>;
    default:
      return <span className={cn(base, "bg-secondary text-secondary-foreground")}>{index + 1}</span>;
  }
}

export const Steps: Part = ({ props }) => {
  const items = elements(props.items, "StepsItem");
  if (!items.length) return null;
  return (
    <ol className="flex flex-col">
      {items.map((item, i) => {
        const state = text(item.props.state);
        const details = text(item.props.details);
        return (
          <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
            {/* the thread that joins one step to the next */}
            {i < items.length - 1 && <span aria-hidden className="absolute top-6 bottom-1 left-[9.5px] w-px bg-border" />}
            <StepMark state={state} index={i} />
            <div className="min-w-0 flex-1 pt-px">
              <div className={cn("text-body font-medium", state === "todo" ? "text-muted-foreground" : "text-foreground")}>
                {text(item.props.title)}
              </div>
              {details && (
                <div className="mt-0.5 text-small text-pretty text-muted-foreground [overflow-wrap:anywhere]">
                  <InlineMarkdown text={details} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

/** The first step of an action, to say what kind of click it is. */
function firstStep(action: unknown): string | undefined {
  const steps = (action as ActionPlan | undefined)?.steps;
  return Array.isArray(steps) ? steps[0]?.type : undefined;
}

/** Whether a click on this would send words to the agent. */
function sends(action: unknown): boolean {
  const steps = (action as ActionPlan | undefined)?.steps;
  return !Array.isArray(steps) || steps.some((step) => step.type === "continue_conversation");
}

/**
 * A short hold after a click that sends, so a double click does not say
 * the same thing twice.
 */
function useOnce(): [boolean, (run: () => void) => void] {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return [
    busy,
    (run) => {
      if (busy) return;
      setBusy(true);
      run();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setBusy(false), 1200);
    },
  ];
}

export const ListBlock: Part = ({ props }) => {
  const trigger = useTriggerAction();
  const streaming = useIsStreaming();
  const [busy, once] = useOnce();
  const items = elements(props.items, "ListItem");
  if (!items.length) return null;
  const numbered = text(props.variant) === "number";
  return (
    <div className="divide-y overflow-hidden rounded-xl border">
      {items.map((item, i) => {
        const title = text(item.props.title);
        const subtitle = text(item.props.subtitle);
        const image = localImage((item.props.image as { src?: unknown } | undefined)?.src);
        const action = item.props.action;
        const step = action ? firstStep(action) : undefined;
        const body = (
          <>
            {numbered && <span className="w-5 shrink-0 text-small tabular-nums text-muted-foreground">{i + 1}</span>}
            {image && <img src={image} alt="" className="size-9 shrink-0 rounded-lg object-cover" />}
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-foreground [overflow-wrap:anywhere]">{title}</span>
              {subtitle && <span className="mt-px block text-small text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</span>}
            </span>
            {action ? (
              <span className="flex shrink-0 items-center gap-1 text-small font-medium text-brand-ink">
                {text(item.props.actionLabel)}
                {step === "open_url" ? <ArrowUpRight size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
              </span>
            ) : null}
          </>
        );
        return action ? (
          <button
            key={i}
            type="button"
            disabled={streaming || busy}
            onClick={() => once(() => void trigger(title, undefined, action as ActionPlan))}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors duration-150 outline-none hover:bg-accent/60 focus-visible:bg-accent/60 disabled:cursor-default"
          >
            {body}
          </button>
        ) : (
          <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
            {body}
          </div>
        );
      })}
    </div>
  );
};

/** A decision, put to the person. Their pick goes back as their answer,
 * and the card keeps showing what they chose. */
export const OptionCards: Part = ({ props }) => {
  const trigger = useTriggerAction();
  const streaming = useIsStreaming();
  const [chosen, setChosen] = useState<number | null>(null);
  const items = elements(props.items, "OptionCard");
  if (!items.length) return null;
  const title = text(props.title);
  const note = text(props.note);
  // one recommendation or none: two is the question again
  const recommended = items.findIndex((item) => item.props.recommended === true);
  return (
    <div role="group" aria-label={title || undefined}>
      {title && <div className="mb-2 text-ui font-medium text-foreground">{title}</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item, i) => {
          const picked = chosen === i;
          const label = text(item.props.title);
          return (
            <button
              key={i}
              type="button"
              disabled={streaming || chosen !== null}
              aria-pressed={picked}
              onClick={() => {
                setChosen(i);
                void trigger(label);
              }}
              className={cn(
                "flex min-w-0 flex-col items-start gap-1 rounded-xl border px-3.5 py-3 text-left outline-none transition-[border-color,background-color,opacity,transform] duration-150 ease-out",
                "enabled:hover:border-foreground/20 enabled:hover:bg-accent/40 enabled:active:scale-[0.98]",
                i === recommended && chosen === null && "border-brand/45",
                picked && "border-brand-ink bg-brand-soft/50",
                chosen !== null && !picked && "opacity-55",
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 text-body font-semibold text-foreground [overflow-wrap:anywhere]">{label}</span>
                {picked ? (
                  <Check size={14} strokeWidth={2.4} aria-hidden className="shrink-0 text-brand-ink" />
                ) : (
                  i === recommended && (
                    <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-px text-caption font-medium text-brand-ink">{t("genuiParts.recommended")}</span>
                  )
                )}
              </span>
              {text(item.props.subtitle) && (
                <span className="text-small text-pretty text-muted-foreground">{text(item.props.subtitle)}</span>
              )}
            </button>
          );
        })}
      </div>
      {note && <div className="mt-2 text-small text-pretty text-muted-foreground">{note}</div>}
    </div>
  );
};

export const Sources: Part = ({ props }) => {
  const items = list(props.items).filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null);
  if (!items.length) return null;
  return (
    <div className="border-t pt-2.5">
      <div className="text-small font-medium text-muted-foreground">{t("genuiParts.sources")}</div>
      <ol className="mt-1 flex flex-col">
        {items.map((source, i) => {
          const url = safeHttpUrl(source.url);
          const title = text(source.title) || (url ? new URL(url).host : t("genuiParts.source"));
          const from = text(source.sourceName) || (url ? new URL(url).host.replace(/^www\./, "") : "");
          const row = (
            <>
              <span className="w-4 shrink-0 text-small tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-body text-foreground group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-2">
                {title}
              </span>
              {from && <span className="max-w-[40%] shrink-0 truncate text-small text-muted-foreground">{from}</span>}
            </>
          );
          return (
            <li key={i}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" title={url} className="group -mx-1.5 flex items-baseline gap-2 rounded-md px-1.5 py-1">
                  {row}
                </a>
              ) : (
                <div className="flex items-baseline gap-2 py-1">{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

// ── layout ─────────────────────────────────────────────────────────────

/**
 * Tabs, with Radix doing the keyboard (arrows between tabs, Tab into the
 * panel). Each tab is known by its place rather than its id, because an
 * id that is still streaming in changes as it arrives.
 */
export const Tabs: Part = ({ props, renderNode }) => {
  const items = elements(props.items, "TabItem");
  const [open, setOpen] = useState("0");
  if (!items.length) return null;
  const value = Number(open) < items.length ? open : "0";
  return (
    <TabsPrimitive.Root value={value} onValueChange={setOpen} className="min-w-0">
      <TabsPrimitive.List className="flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-muted p-0.5">
        {items.map((item, i) => (
          <TabsPrimitive.Trigger
            key={i}
            value={String(i)}
            className="flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-body font-medium text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-150 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:not-focus-visible:shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:data-[state=active]:not-focus-visible:shadow-[0_0_0_0.5px_rgba(255,255,255,0.08)]"
          >
            {text(item.props.trigger) || t("genuiParts.tabNumbered", { number: i + 1 })}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item, i) => (
        <TabsPrimitive.Content key={i} value={String(i)} className="mt-3 min-w-0 outline-none">
          <Stack renderNode={renderNode}>{item.props.content}</Stack>
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
};

/** Sections that open on a click. The platform's own disclosure, which
 * already does the keyboard and the screen reader. */
export const Accordion: Part = ({ props, renderNode }) => {
  const items = elements(props.items, "AccordionItem");
  if (!items.length) return null;
  return (
    <div className="divide-y overflow-hidden rounded-xl border">
      {items.map((item, i) => (
        <details key={i} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-body font-medium text-foreground transition-colors duration-150 outline-none select-none hover:bg-accent/50 focus-visible:bg-accent/50 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">{text(item.props.trigger)}</span>
            <ChevronDown size={14} aria-hidden className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="px-3.5 pt-1 pb-3.5">
            <Stack renderNode={renderNode}>{item.props.content}</Stack>
          </div>
        </details>
      ))}
    </div>
  );
};

// ── buttons ────────────────────────────────────────────────────────────

const BUTTON_LOOK = { primary: "brand", secondary: "outline", tertiary: "ghost" } as const;

/**
 * A button. In a form, the one that sends checks the fields first and,
 * once the answers are away, the form is done: it keeps what was entered
 * and says it was sent.
 */
export const Button: Part = ({ props }) => {
  const trigger = useTriggerAction();
  const streaming = useIsStreaming();
  const formName = useFormName();
  const validation = useFormValidation();
  const form = useContext(FormSent);
  const [busy, once] = useOnce();
  const label = text(props.label);
  if (!label) return null;
  const action = props.action;
  const variant = text(props.variant) || (formName ? "primary" : "secondary");
  const look = BUTTON_LOOK[variant as keyof typeof BUTTON_LOOK] ?? "outline";
  const speaks = sends(action);
  return (
    <UiButton
      variant={look}
      disabled={streaming || busy || (Boolean(formName) && form.sent && speaks)}
      onClick={() => {
        if (formName && speaks && validation && !validation.validateForm()) return;
        once(() => {
          void trigger(label, formName, action as ActionPlan | undefined);
          if (formName && speaks) form.markSent();
        });
      }}
    >
      {label}
      {firstStep(action) === "open_url" && <ArrowUpRight size={13} aria-hidden />}
    </UiButton>
  );
};

export const Buttons: Part = ({ props, renderNode }) => {
  const buttons = elements(props.buttons, "Button");
  if (!buttons.length) return null;
  return (
    <div className={cn("flex gap-2", text(props.direction) === "column" ? "flex-col items-start" : "flex-wrap items-center")}>
      {buttons.map((button, i) => (
        <span key={i} className="contents">
          {renderNode(button)}
        </span>
      ))}
    </div>
  );
};

/** What the person might ask next, last, quiet until pointed at. */
export const FollowUpBlock: Part = ({ props }) => {
  const trigger = useTriggerAction();
  const streaming = useIsStreaming();
  const [busy, once] = useOnce();
  const items = elements(props.items, "FollowUpItem").map((item) => text(item.props.text)).filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="flex flex-col border-t pt-2">
      {items.map((question, i) => (
        <button
          key={i}
          type="button"
          disabled={streaming || busy}
          onClick={() => once(() => void trigger(question))}
          className="group -mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground disabled:cursor-default"
        >
          <CornerDownRight size={14} aria-hidden className="shrink-0 text-muted-foreground/70" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{question}</span>
          <ArrowRight size={13} aria-hidden className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      ))}
    </div>
  );
};
