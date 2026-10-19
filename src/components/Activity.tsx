// What is running, and what it is costing.
//
// The rest of the app shows work from whichever surface owns it: a routine
// from the calendar, a job from the board, a workflow from its own card. A
// person opening a workspace with ten agents in it wants the other view,
// the one nothing else gives: everything at once, what set each thing off,
// and what today has cost.
//
// The ordering is the design. What wants you comes first and stays first,
// because a turn that is working needs nothing from anybody and a card
// that has been open since yesterday does. Inside each group the oldest is
// at the top, since that is the one most likely to have been forgotten or
// to be stuck.
//
// Answering happens here rather than sending you somewhere. A gate is two
// buttons; going to find it in a background lane to press the same two
// buttons is the trip this panel exists to save.
import { useCallback, useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { Hourglass } from "@/components/icons";
import { Square } from "@/components/icons";
import { api, useStore, type Bot } from "@/state/store";
import { usePageVisible } from "@/lib/pageVisible";
import { AgentAvatar } from "./Avatar";
import { TeamMapView } from "./TeamMap";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { activityContext, type Fill } from "@/lib/contextCard";

export interface Spend {
  turns: number;
  input: number;
  output: number;
  cost: number;
  /** Turns whose engine reported no tokens. */
  unmeasured?: number;
}

interface Running {
  threadId: string;
  botId: string;
  botName: string;
  laneTitle: string;
  kind: "you" | "routine" | "job" | "workflow";
  because: string;
  since?: number;
  context?: Fill;
}

interface Waiting {
  threadId: string;
  botId: string;
  botName: string;
  laneTitle: string;
  messageId: string;
  asks: string;
  since: number;
  kind: "approval" | "workflow";
  until?: number;
  runId?: string;
}

interface Paused {
  botId: string;
  botName: string;
  since: number;
  why: string;
  turnedAway?: number;
}

export interface Activity {
  waiting: Waiting[];
  running: Running[];
  paused: Paused[];
  agents: Array<{ botId: string; botName: string; running: number; waiting: number; today: Spend }>;
  today: Spend;
  costKnown: boolean;
  at: number;
}

/** "4 minutes", for how long something has been going. */
function elapsed(since: number | undefined, now: number): string {
  if (!since) return "";
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** "in 3 hours", for a deadline somebody has to act inside. */
function until(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) return "any moment";
  if (minutes < 90) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/** 12,400 rather than 12400, and 1.2k once it stops being readable. */
function tokens(n: number): string {
  if (n < 10_000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * The tokens a day's spend shows. An engine that reports none (Pi, for
 * one) would read as "0 tokens", which says nothing was used; this says
 * the engine did not tell us, and how many turns that covers.
 */
function spentTokens(spend: Spend): string {
  const used = spend.input + spend.output;
  const unmeasured = spend.unmeasured ?? 0;
  if (!unmeasured) return `${tokens(used)} tokens`;
  const replies = `${unmeasured} ${unmeasured === 1 ? "reply" : "replies"}`;
  return used > 0 ? `${tokens(used)} tokens, ${replies} not counted` : "Tokens not reported";
}

function money(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}

export function ActivityPanel() {
  const { state, dispatch } = useStore();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** The same question at two zoom levels: rows, or the map. */
  const [view, setView] = useState<"list" | "map">("list");

  const load = useCallback(() => {
    api("/api/activity")
      .then((a: Activity) => {
        setActivity(a);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    load();
    const timer = setInterval(load, 3_000);
    return () => clearInterval(timer);
  }, [load, visible, state.config]);

  // Elapsed times tick on their own, or a row would sit at "2m" for as
  // long as the panel is open and read as frozen. A hidden panel has no
  // reader, so the tick pauses with the page.
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [visible]);

  const botOf = (id: string) => state.bots.find((b) => b.id === id);

  const goTo = (row: { botId: string; threadId: string }) => {
    dispatch({ type: "select", id: row.botId, lane: row.threadId });
  };

  const answer = (row: Waiting, approve: boolean) => {
    if (!row.runId) return;
    setBusy(row.runId);
    api(`/api/workflows/runs/${row.runId}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer: approve ? "Approve" : "Decline" }),
    })
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const stop = (row: Running) => {
    setBusy(row.threadId);
    api(`/api/bots/${row.botId}/interrupt`, {
      method: "POST",
      body: JSON.stringify({ taskId: row.threadId }),
    })
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const quiet =
    activity && !activity.waiting.length && !activity.running.length && !activity.paused?.length;

  return (
    <div
      className="flex min-w-0 flex-col rounded-2xl border bg-card p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lead font-semibold text-foreground">Activity</div>
          <div className="mt-0.5 text-body leading-relaxed text-muted-foreground">
            {view === "map"
              ? "Your whole team. Click anyone to open them."
              : "What's running, and today's cost."}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-lg bg-muted p-0.5">
            {(["list", "map"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setView(option)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-small capitalize transition-colors",
                  view === option
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "map" && (
        <TeamMapView
          onNavigate={(id) => {
            dispatch({ type: "select", id });
          }}
        />
      )}

      {view === "list" && activity && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-muted/50 px-3 py-2 text-body text-muted-foreground">
          <span>
            <span className="text-foreground">{activity.today.turns}</span> replies today
          </span>
          {activity.today.unmeasured ? (
            <span>{spentTokens(activity.today)}</span>
          ) : (
            <span>
              <span className="text-foreground">{tokens(activity.today.input + activity.today.output)}</span> tokens
            </span>
          )}
          {/* A zero here would read as "this was free" rather than as
              "nobody told us", which is the difference between a number
              and a guess. */}
          {activity.costKnown ? (
            <span>
              <span className="text-foreground">{money(activity.today.cost)}</span> spent where known
            </span>
          ) : (
            <span>Cost unavailable</span>
          )}
        </div>
      )}

      {view === "list" && error && (
        <div className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-body text-destructive">
          {error}
        </div>
      )}

      <div className={cn("mt-3 min-h-0 flex-1 overflow-y-auto", view === "map" && "hidden")}>
        {quiet && (
          <div className="rounded-2xl border border-dashed px-4 py-10 text-center">
            <div className="text-ui text-foreground">Nothing running right now.</div>
          </div>
        )}

        {activity?.waiting.length ? (
          <Section title="Waiting for you">
            {activity.waiting.map((row) => (
              <Row
                key={row.messageId}
                bot={botOf(row.botId)}
                name={row.botName}
                main={
                  <div className="min-w-0 flex-1">
                    <div className="text-body text-foreground">{row.asks}</div>
                    <div className="mt-0.5 text-small text-warning">
                      {row.botName}
                      {row.laneTitle ? ` · ${row.laneTitle}` : ""} · asked {elapsed(row.since, now)} ago
                      {row.until ? ` · stops ${until(row.until, now)}` : ""}
                    </div>
                  </div>
                }
                actions={
                  row.runId ? (
                    <>
                      <Button size="sm" disabled={busy === row.runId} onClick={() => answer(row, true)}>
                        <Check size={13} /> Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === row.runId}
                        onClick={() => answer(row, false)}
                      >
                        Decline
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => goTo(row)}>
                      Answer it
                    </Button>
                  )
                }
              />
            ))}
          </Section>
        ) : null}

        {activity?.paused?.length ? (
          <Section title="You have the wheel">
            {activity.paused.map((row) => (
              <Row
                key={row.botId}
                bot={botOf(row.botId)}
                name={row.botName}
                main={
                  <div className="min-w-0 flex-1">
                    <div className="text-body text-foreground">{row.botName} is waiting for you</div>
                    <div className="mt-0.5 text-small text-warning">
                      You took over {elapsed(row.since, now)} ago. Paused until you hand it back.
                      {row.turnedAway ? ` ${row.turnedAway} turned away since.` : ""}
                    </div>
                  </div>
                }
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy === row.botId}
                    onClick={() => {
                      setBusy(row.botId);
                      api(`/api/bots/${row.botId}/wheel`, { method: "DELETE" })
                        .then(load)
                        .catch((e: Error) => setError(e.message))
                        .finally(() => setBusy(null));
                    }}
                  >
                    Hand it back
                  </Button>
                }
              />
            ))}
          </Section>
        ) : null}

        {activity?.running.length ? (
          <Section title="Running">
            {activity.running.map((row) => (
              <Row
                key={row.threadId}
                bot={botOf(row.botId)}
                name={row.botName}
                main={
                  <div className="min-w-0 flex-1">
                    <div className="text-body text-foreground">
                      {row.botName}
                      <span className="text-muted-foreground"> · {row.laneTitle}</span>
                    </div>
                    <div className="mt-0.5 text-small text-muted-foreground">
                      {row.because}
                      {row.since ? ` · ${elapsed(row.since, now)}` : ""}
                      {activityContext(row.context) ? ` · ${activityContext(row.context)}` : ""}
                    </div>
                  </div>
                }
                actions={
                  <>
                    <Button variant="secondary" size="sm" onClick={() => goTo(row)}>
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Stop"
                      disabled={busy === row.threadId}
                      onClick={() => stop(row)}
                    >
                      <Square size={12} />
                    </Button>
                  </>
                }
              />
            ))}
          </Section>
        ) : null}

        {activity?.agents.length ? (
          <Section title="Today, by agent">
            {activity.agents.map((row) => (
              <Row
                key={row.botId}
                bot={botOf(row.botId)}
                name={row.botName}
                main={
                  <div className="min-w-0 flex-1">
                    <div className="text-body text-foreground">{row.botName}</div>
                    <div className="mt-0.5 text-small text-muted-foreground">
                      {row.today.turns} {row.today.turns === 1 ? "reply" : "replies"} ·{" "}
                      {spentTokens(row.today)}
                      {activity.costKnown && row.today.cost > 0 ? ` · ${money(row.today.cost)}` : ""}
                    </div>
                  </div>
                }
                actions={
                  row.waiting > 0 || row.running > 0 ? (
                    <span className="flex items-center gap-1.5 text-small">
                      {row.waiting > 0 && (
                        <span className="flex items-center gap-1 text-warning">
                          <Hourglass size={11} />
                          {row.waiting}
                        </span>
                      )}
                      {row.running > 0 && (
                        <span className="text-muted-foreground">{row.running} running</span>
                      )}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </Section>
        ) : null}
      </div>
    </div>

  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1.5 text-small font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

/**
 * One row: a face, what it says, and what you can do about it.
 *
 * The actions sit beside the words when there is room and underneath when
 * there is not. Two buttons taking half of a phone's width leave a
 * question wrapping to four lines beside them, which is the wrong half to
 * protect.
 */
function Row({
  bot,
  name,
  main,
  actions,
}: {
  bot?: Bot;
  name: string;
  main: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5">
      <span className="mt-0.5 shrink-0">
        {bot ? (
          <AgentAvatar bot={bot} size={24} />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-lg bg-muted text-micro text-muted-foreground">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        {main}
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </div>
  );
}
