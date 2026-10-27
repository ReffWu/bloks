// A turn's timeline, beside the conversation.
//
// The working line opens the turn going now; a finished turn's fold line
// opens that turn. The tool rows in the transcript say what was done;
// this says when, for how long, and what the waiting was, as a waterfall
// (TraceWaterfall.tsx).
//
// While the turn runs and the panel is open it is read about once a
// second, and the waterfall runs its own clock in between, so the
// playhead moves on smoothly rather than a second at a time. A finished
// turn is read once. Nothing is read while the window cannot be seen.
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { api, type Bot } from "@/state/store";
import { taskTracePath, type TaskTrace, type Trace } from "@/lib/trace";
import { clockOffset, traceClockOffset, traceCovers, type TraceAsk } from "@/lib/traceView";
import { usePageVisible } from "@/lib/pageVisible";
import { useEscape } from "@/lib/useEscape";
import { TraceWaterfall } from "./TraceWaterfall";
import { t } from "@/lib/i18n";

export type { TraceAsk } from "@/lib/traceView";

const POLL_MS = 1000;

export function TracePanel({
  bot,
  taskId,
  ask,
  working,
  onClose,
}: {
  bot: Bot;
  taskId: string;
  ask: TraceAsk;
  /** The conversation is at work: a turn to follow, even before its
   * trace says it is running. */
  working: boolean;
  onClose: () => void;
}) {
  useEscape(onClose);
  const visible = usePageVisible();
  const [read, setRead] = useState<{ trace: Trace | null; now: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = Boolean(read?.trace?.running);
  // a fold names its turn, or its time; the working line follows the turn
  // going now, and the one after it when it starts
  const follow = !ask.turnId && !ask.window;
  const path = taskTracePath(bot.id, taskId, { turnId: ask.turnId, at: ask.window?.from });

  const pathRef = useRef(path);
  useEffect(() => {
    // another turn or conversation: nothing of the last one shows meanwhile
    if (pathRef.current !== path) setRead(null);
    pathRef.current = path;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const once = async () => {
      try {
        const body: TaskTrace = await api(path);
        if (!alive) return;
        const at = Date.now();
        // the server says its clock; an older one does not, and a running
        // trace's own length stands in for it
        const offset = typeof body.now === "number" ? clockOffset(body.now, at) : traceClockOffset(body.trace ?? null, at);
        setRead({ trace: body.trace ?? null, now: at + offset });
        setError(null);
        // again while there is a turn going to follow; a finished one
        // does not change
        if (visible && (body.trace?.running || (follow && working))) timer = setTimeout(once, POLL_MS);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        if (visible && working) timer = setTimeout(once, POLL_MS * 3);
      }
    };
    void once();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [path, visible, working, follow]);

  const conversation = bot.tasks?.find((t) => t.id === taskId)?.title ?? "";
  const trace = read?.trace ?? null;
  const ours = trace && ask.window ? traceCovers(trace, ask.window) : true;
  // the same groups until the trace changes: the chat beside it renders
  // with every streamed word, and the waterfall need not
  const groups = useMemo(
    () => (trace && ours ? [{ id: `${bot.id}:${taskId}`, botId: bot.id, name: bot.name, subtitle: trace.model, color: bot.color, trace }] : []),
    [trace, ours, bot.id, bot.name, bot.color, taskId],
  );

  return (
    <aside
      aria-label={t("tracePanel.timeline")}
      className="fixed inset-0 z-50 flex w-full animate-panel-in flex-col bg-background md:static md:z-auto md:h-full md:w-[520px] md:max-w-[50%] md:shrink-0 md:border-l"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b pl-4 pr-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-ui font-semibold text-foreground">{t("tracePanel.timeline")}</span>
          {/* live: the one dot that says it is still being written */}
          {running && <span aria-label={t("tracePanel.live")} className="size-1.5 shrink-0 rounded-full bg-success motion-safe:animate-pulse" />}
          <span className="truncate text-small text-muted-foreground">{conversation}</span>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={t("tracePanel.closeTheTimeline")} onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
      {groups.length ? (
        <TraceWaterfall groups={groups} now={read!.now} className="min-h-0 flex-1" />
      ) : (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-small text-muted-foreground">
          {error
            ? `The timeline did not load. ${error}`
            : !read
              ? ""
              : !trace
                ? t("tracePanel.noTurnToShowYet")
                : t("tracePanel.thisTurnsTimelineIsNot")}
        </div>
      )}
    </aside>
  );
}
