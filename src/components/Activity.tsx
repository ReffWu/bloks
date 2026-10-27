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
import { Activity as ActivityIcon } from "@/components/icons";
import { Check } from "@/components/icons";
import { Hourglass } from "@/components/icons";
import { Square } from "@/components/icons";
import { api, useStore, type Bot } from "@/state/store";
import { usePageVisible } from "@/lib/pageVisible";
import { AgentAvatar } from "./Avatar";
import { TeamMapView } from "./TeamMap";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, PanelHeader, SkeletonRows, SubHead } from "./OverviewParts";
import { activityContext, type Fill } from "@/lib/contextCard";
import { t } from "@/lib/i18n";

export interface Spend {
  turns: number;
  input: number;
  output: number;
  cost: number;
  /** Of `cost`, the dollars estimated from tokens. */
  estimated?: number;
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

/** Something that failed and is still open (server/incidents.ts). */
interface Incident {
  id: string;
  kind: "turn" | "stall" | "routine" | "watcher" | "workflow";
  title: string;
  why: string;
  state: "with-lead" | "retrying" | "needs-you" | "muted" | "resolved";
  at: number;
  lastAt: number;
  count: number;
  lead: { kind: "agent"; id: string; name: string } | { kind: "person" };
  needs?: string;
  card?: { threadId: string; messageId: string };
  where: { botId?: string; botName?: string; laneId?: string; roomId?: string };
}

/** A routine or a watcher that stopped running on its own for failing. */
interface Failing {
  kind: "routine" | "watcher";
  id: string;
  name: string;
  error: string;
  since: number;
  failures: number;
  botId?: string;
  targetId?: string;
}

export interface Activity {
  /** Absent from a server older than the incident desk. */
  incidents?: Incident[];
  failing?: Failing[];
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

/** Dollars, "~$" when any of it is an estimate from tokens, as the Usage
 * page writes them. */
function money(n: number, estimated = false): string {
  const mark = estimated ? "~" : "";
  return n >= 1 ? `${mark}$${n.toFixed(2)}` : `${mark}$${n.toFixed(3)}`;
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

  const resolve = (row: Incident) => {
    setBusy(row.id);
    api(`/api/incidents/${row.id}/resolve`, { method: "POST" })
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  /** Where an incident's card is, or where it happened. */
  const openIncident = (row: Incident) => {
    const room = row.where.roomId;
    if (room) return dispatch({ type: "select", id: room });
    const lane = row.card?.threadId ?? row.where.laneId;
    if (row.where.botId) dispatch({ type: "select", id: row.where.botId, ...(lane ? { lane } : {}) });
  };

  const pauseFailing = (row: Failing) => {
    setBusy(row.id);
    api(row.kind === "routine" ? `/api/routines/${row.id}` : `/api/watchers/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    })
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const quiet =
    activity &&
    !activity.waiting.length &&
    !activity.running.length &&
    !activity.paused?.length &&
    !activity.incidents?.length &&
    !activity.failing?.length;

  // Somewhere to go when nothing is happening: the agent you were last
  // with, or making a first one.
  const last = state.bots.find((b) => b.id === state.selectedId && !b.hidden) ?? state.bots.find((b) => !b.hidden);

  return (
    <section aria-label={t("activity.activity")} className="flex min-w-0 flex-col">
      <PanelHeader
        icon={<ActivityIcon size={17} />}
        title={t("activity.activity")}
        hint={view === "map" ? t("activity.yourWholeTeamClickAnyone") : t("activity.whatsRunningAndTodaysCost")}
        actions={
          <Segmented
            size="sm"
            aria-label={t("activity.showAs")}
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: "List" },
              { value: "map", label: "Map" },
            ]}
          />
        }
      />

      {view === "map" && (
        <div className="mt-5">
          <TeamMapView
            onNavigate={(id) => {
              dispatch({ type: "select", id });
            }}
          />
        </div>
      )}

      {view === "list" && activity && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-body tabular-nums text-muted-foreground">
          <span>
            <span className="text-foreground">{activity.today.turns}</span> {activity.today.turns === 1 ? "reply" : "replies"} today
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
              <span className="text-foreground">{money(activity.today.cost, (activity.today.estimated ?? 0) > 0)}</span> spent where known
            </span>
          ) : (
            <span>{t("activity.costUnavailable")}</span>
          )}
        </div>
      )}

      {view === "list" && error && (
        <div className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-body text-destructive">
          {error}
        </div>
      )}

      <div className={cn("mt-5 min-h-0 flex-1", view === "map" && "hidden")}>
        {!activity && !error && <SkeletonRows rows={3} label={t("activity.loadingActivity")} />}

        {quiet && (
          <div className="mb-5">
            <EmptyState
              action={
                last ? (
                  <Button variant="secondary" size="sm" onClick={() => dispatch({ type: "select", id: last.id })}>
                    Message {last.name}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => dispatch({ type: "toggleNewAgent", open: true })}>
                    {t("activity.makeAnAgent")}
                  </Button>
                )
              }
            >
              {t("activity.nothingRunningOrWaitingAsk")}
            </EmptyState>
          </div>
        )}

        {activity?.waiting.length ? (
          <Section title={t("activity.waitingForYou")}>
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
                        <Check size={13} /> {t("common.approve")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === row.runId}
                        onClick={() => answer(row, false)}
                      >
                        {t("common.decline")}
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => goTo(row)}>
                      {t("activity.answerIt")}
                    </Button>
                  )
                }
              />
            ))}
          </Section>
        ) : null}

        {activity?.incidents?.length ? (
          <Section title={t("activity.somethingFailed")}>
            {activity.incidents.map((row) => (
              <Row
                key={row.id}
                bot={row.where.botId ? botOf(row.where.botId) : undefined}
                name={row.where.botName ?? row.title}
                main={
                  <div className="min-w-0 flex-1">
                    <div className="text-body text-foreground">
                      {row.title}
                      {row.count > 1 ? <span className="text-muted-foreground"> · {row.count} times</span> : null}
                    </div>
                    <div className="mt-0.5 text-small">
                      <span className={cn(row.state === "needs-you" ? "text-warning" : "text-muted-foreground")}>{incidentState(row)}</span>
                      <span className="text-muted-foreground"> · {elapsed(row.lastAt, now)} ago</span>
                    </div>
                    {/* the failure's own words can be long; two lines are
                        enough to recognise it, and the card has the rest */}
                    <div className="mt-0.5 line-clamp-2 break-words text-small text-muted-foreground">{row.why}</div>
                  </div>
                }
                actions={
                  <>
                    {(row.where.botId || row.where.roomId) && (
                      <Button variant="secondary" size="sm" onClick={() => openIncident(row)}>
                        {t("common.open")}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => resolve(row)}>
                      {t("activity.markResolved")}
                    </Button>
                  </>
                }
              />
            ))}
          </Section>
        ) : null}

        {activity?.failing?.length ? (
          <Section title={t("activity.stoppedForFailing")}>
            {activity.failing.map((row) => {
              const who = row.botId ?? row.targetId;
              return (
                <Row
                  key={row.id}
                  bot={who ? botOf(who) : undefined}
                  name={row.name}
                  main={
                    <div className="min-w-0 flex-1">
                      <div className="text-body text-foreground">
                        The {row.kind} {row.name}
                      </div>
                      <div className="mt-0.5 text-small text-warning">
                        Failed {row.failures} times in a row, stopped {elapsed(row.since, now)} ago
                      </div>
                      <div className="mt-0.5 line-clamp-2 break-words text-small text-muted-foreground">{row.error}</div>
                    </div>
                  }
                  actions={
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          dispatch({ type: "toggleRoutines", open: true, tab: row.kind === "routine" ? "schedules" : "watchers", focus: { kind: row.kind, id: row.id } })
                        }
                      >
                        {t("activity.fixIt")}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => pauseFailing(row)}>
                        {t("common.pause")}
                      </Button>
                    </>
                  }
                />
              );
            })}
          </Section>
        ) : null}

        {activity?.paused?.length ? (
          <Section title={t("activity.youHaveTheWheel")}>
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
                    {t("activity.handItBack")}
                  </Button>
                }
              />
            ))}
          </Section>
        ) : null}

        {activity?.running.length ? (
          <Section title={t("activity.running")}>
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
                      {t("common.open")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("common.stop")}
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
          <Section title={t("activity.todayByAgent")}>
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
    </section>
  );
}

/** Where an incident is, in a few words. */
function incidentState(row: Incident): string {
  switch (row.state) {
    case "with-lead":
      return row.lead.kind === "agent" ? `With ${row.lead.name}` : "With you";
    case "retrying":
      return "Trying again";
    case "needs-you":
      return row.needs ? `Needs you: ${row.needs}` : "Needs you";
    case "muted":
      return "Listed while many things failed";
    default:
      return "Resolved";
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <SubHead>{title}</SubHead>
      <div className="-mx-3 flex flex-col">{children}</div>
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
    <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-accent/40">
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
