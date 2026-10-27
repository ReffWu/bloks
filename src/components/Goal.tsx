// A conversation's goal, on screen: its line in the composer's tray until
// it is done, and the dialog that sets one (server/goals.ts has the rules).
//
// The line is the goal's whole state, because a goal works
// while nobody is watching and the first thing anyone wants on coming
// back is where it got to: which turn of how many, or why it is blocked
// or out of turns. Its buttons are the two decisions that are the
// person's alone, whether it goes on and whether it exists at all.
// A done goal cannot go on and costs nothing while it stays, and its
// notice in the chat says how it ended, so it has no line.
import { useEffect, useState } from "react";
import { Target } from "@/components/icons";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { DEFAULT_GOAL_TURNS, MAX_GOAL_TURNS, goalAction, goalState } from "@/lib/goals";
import { RANK, TrayButton, type Notice } from "@/components/composer/Tray";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider, numberStops } from "@/components/ui/slider";
import { t, tr } from "@/lib/i18n";

function goalPath(botId: string, taskId: string) {
  return `/api/bots/${botId}/tasks/${taskId}/goal`;
}

// made where it draws, so the stops speak the language chosen now
const goalSteps = () => numberStops(1, MAX_GOAL_TURNS, (n) => t("goal.steps", { count: n }));

/** The goal's line in the composer's tray, until the open conversation's
 * goal is done. A blocked or spent goal moves up the tray, since the next
 * step is the person's; a running one sits below anything pressing. */
export function useGoalNotice(bot: Bot): Notice | null {
  const laneId = bot.activeTaskId ?? bot.threadId;
  const goal = bot.tasks?.find((t) => t.id === laneId)?.goal;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // a different goal, or the same one moving on, clears what the last
  // press said
  useEffect(() => setError(null), [goal?.startedAt, goal?.status]);
  if (!goal || goal.status === "done") return null;

  const change = (init: RequestInit) => {
    setBusy(true);
    setError(null);
    api(goalPath(bot.id, laneId), init)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const stuck = goal.status === "blocked" || goal.status === "out";
  const action = goalAction(goal);
  return {
    id: "goal",
    tone: stuck ? "warn" : "info",
    rank: stuck ? RANK.goalStuck : RANK.goal,
    icon: (
      <Target
        size={14}
        className={cn(
          goal.status === "active" && "text-brand",
          goal.status === "active" && goal.judging && "animate-pulse motion-reduce:animate-none",
        )}
      />
    ),
    // the goal gives way to where it stands: a long goal is cut short at
    // two lines, and the whole of it is on hover
    title: (
      <span aria-live="polite">
        <span className="font-medium">{t("goal.goal")}</span> {goal.text}
      </span>
    ),
    detail: error ? <span className="text-destructive">{error}</span> : <span className="tabular-nums">{goalState(goal)}</span>,
    hint: [goal.text, goal.check && t("goal.doneWhen", { check: goal.check }), goal.lastReason].filter(Boolean).join("\n"),
    actions: action && (
      <TrayButton disabled={busy} onClick={() => change({ method: "PATCH", body: JSON.stringify(action.body) })}>
        {action.label}
      </TrayButton>
    ),
    onDismiss: busy ? undefined : () => change({ method: "DELETE" }),
    dismissLabel: t("goal.clear"),
  };
}

/**
 * "Set a goal": what done looks like, an optional check, and how many
 * turns it may take. Opened from a conversation's menu, or by sending
 * `/goal` with nothing after it. A goal already there is the starting
 * point, since the usual reason to open this again is to change it.
 */
export function GoalDialog() {
  const { state, dispatch } = useStore();
  const target = state.goalFor;
  const bot = target ? state.bots.find((b) => b.id === target.botId) : undefined;
  const lane = target ? bot?.tasks?.find((t) => t.id === target.taskId) : undefined;
  const current = lane?.goal;
  const [text, setText] = useState("");
  const [check, setCheck] = useState("");
  const [turns, setTurns] = useState(DEFAULT_GOAL_TURNS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!target) return;
    setText(current?.text ?? "");
    setCheck(current?.check ?? "");
    setTurns(Math.min(MAX_GOAL_TURNS, Math.max(1, current?.budget ?? DEFAULT_GOAL_TURNS)));
    setError(null);
    // only when it opens: a goal moving on underneath is not a reason to
    // throw away what is being typed
  }, [target?.botId, target?.taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target || !bot || !lane) return null;

  const close = () => dispatch({ type: "closeGoal" });
  const going = current && current.status !== "done";
  const submit = () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    api(goalPath(bot.id, lane.id), {
      method: "PUT",
      body: JSON.stringify({ text: text.trim(), check: check.trim() || undefined, budget: String(turns) }),
    })
      .then(close)
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-[460px]">
        <DialogTitle>{t("goal.setAGoal")}</DialogTitle>
        <DialogDescription>
          {t("goal.keepsGoing", { name: bot.name })}
          {going && ` ${t("goal.replacesCurrent")}`}
        </DialogDescription>
        <form
          className="mt-4 flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-foreground">{t("goal.whatDoesDoneLookLike")}</span>
            <Textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              maxLength={2_000}
              rows={3}
              placeholder={t("goal.theImporterHandlesEveryFile")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-foreground">
              {tr("goal.check", { optional: <span className="font-normal text-muted-foreground">{t("goal.optional")}</span> })}
            </span>
            <Input
              value={check}
              onChange={(e) => setCheck(e.target.value)}
              maxLength={500}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="pnpm test"
              className="font-mono text-body"
            />
            <span className="text-small leading-relaxed text-muted-foreground">
              {t("goal.runsAfterEachStepFor")}
            </span>
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-body font-medium text-foreground">{t("goal.stepLimit")}</span>
            <Slider aria-label={t("goal.stepLimit")} stops={goalSteps()} value={turns} onChange={setTurns} onCommit={setTurns} />
          </div>
          {error && <div className="text-body text-destructive">{error}</div>}
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!text.trim() || saving}>
              {t("goal.start")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
