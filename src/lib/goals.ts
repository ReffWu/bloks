// How a conversation's goal reads on the chip over the composer
// (src/components/Goal.tsx). Kept apart from the component so the words
// can be tested without a DOM.
import type { LaneGoal } from "@/state/reducer";
import { t } from "./i18n.ts";

/** The server's default and cap (GOAL_DEFAULT_BUDGET, MAX_GOAL_TURNS). */
export const DEFAULT_GOAL_TURNS = 20;
export const MAX_GOAL_TURNS = 100;
/** How many turns "More turns" gives a goal that ran out. */
export const MORE_GOAL_TURNS = 10;

/** Where a goal stands, in the words the chip shows after its text. */
export function goalState(goal: LaneGoal): string {
  switch (goal.status) {
    case "active":
      return goal.judging ? t("goals.checkingStep", steps(goal)) : t("goals.step", steps(goal));
    case "paused":
      return t("goals.pausedAt", steps(goal));
    case "done":
      return t("goals.doneIn", { count: goal.turns });
    case "blocked":
      // the reason is the agent's own words, as it gave them
      return goal.lastReason ? t("goals.blockedBecause", { reason: goal.lastReason }) : t("goals.blocked");
    case "out":
      return t("goals.outOfStepsAt", steps(goal));
  }
}

function steps(goal: LaneGoal): { step: number; budget: number } {
  return { step: goal.turns, budget: goal.budget };
}

/** The same, short enough for a phone's width beside the goal itself;
 * the reason a goal stopped is in its notice and the chip's title. */
export function goalStateShort(goal: LaneGoal): string {
  switch (goal.status) {
    case "active":
      return t("goals.short.stepOf", steps(goal));
    case "paused":
      return t("goals.short.paused", steps(goal));
    case "done":
      return t("goals.short.done");
    case "blocked":
      return t("goals.short.needsYou");
    case "out":
      return t("goals.short.out");
  }
}

/** The one press the chip offers besides Clear, if any: pause one that
 * is going, resume one that stopped short, or give one that ran out
 * more turns, up to the cap. A goal that is done has nothing to resume;
 * a new one is set instead. */
export function goalAction(goal: LaneGoal): { label: string; body: { status: "paused" | "active"; budget?: number } } | null {
  if (goal.status === "active") return { label: t("goals.pause"), body: { status: "paused" } };
  if (goal.status === "paused" || goal.status === "blocked") return { label: t("goals.resume"), body: { status: "active" } };
  if (goal.status === "out" && goal.budget < MAX_GOAL_TURNS) {
    return { label: t("goals.moreSteps"), body: { status: "active", budget: Math.min(MAX_GOAL_TURNS, goal.budget + MORE_GOAL_TURNS) } };
  }
  return null;
}
