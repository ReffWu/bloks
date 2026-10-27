// The welcome a workspace made in the app opens on, shaped by what was
// chosen in the New workspace dialog (src/components/NewWorkspaceDialog).
//
// A person's first Bloks gets the whole first run: engines, who they are,
// approvals, their setup from other tools, the Mac's permissions. None of
// that is news the second time, on the same computer, so a workspace made
// beside Personal asks only what is new about it:
//
//   Business    its name and logo first, as it will look to clients
//   any         who works there: the agents for the work done in it
//   Team        and then the people, by invitation
//   Just me     no people at all
//
// The engines are asked about only when none can reply here (a key added
// in Personal is Personal's alone). Every step can be skipped, and the
// one reached is remembered, so quitting halfway comes back to it.
import type { MessageKey } from "./i18n.ts";

export type WelcomeStep = "business" | "engines" | "agents" | "invite";

export interface WelcomeShape {
  kind: string;
  team: boolean;
  /** Whether an engine can reply in this workspace; null until known. */
  enginesReady: boolean | null;
}

// Catalogue keys, put into words where the stepper draws them.
const LABELS: Record<WelcomeStep, MessageKey> = {
  business: "libWorkspaceWelcome.step.business",
  engines: "libWorkspaceWelcome.step.engines",
  agents: "libWorkspaceWelcome.step.agents",
  invite: "libWorkspaceWelcome.step.invite",
};

/** Which welcome a workspace's window shows: the short one for a
 * workspace made beside Personal, the whole first run otherwise. */
export function welcomeKind(workspace: { kind?: string } | null | undefined): "workspace" | "first-run" {
  return workspace?.kind === "business" || workspace?.kind === "custom" ? "workspace" : "first-run";
}

/** The steps, in order, for what was chosen. */
export function welcomeSteps(shape: WelcomeShape): Array<{ id: WelcomeStep; label: MessageKey }> {
  const ids: WelcomeStep[] = [];
  if (shape.kind === "business") ids.push("business");
  if (shape.enginesReady === false) ids.push("engines");
  ids.push("agents");
  if (shape.team) ids.push("invite");
  return ids.map((id) => ({ id, label: LABELS[id] }));
}

const ORDER: readonly WelcomeStep[] = ["business", "engines", "agents", "invite"];

/** Where to start: the step reached last time; when that step is gone
 * (an engine came ready meanwhile), the one that came after it; with
 * nothing kept, the first. */
export function resumeAt(steps: ReadonlyArray<{ id: WelcomeStep }>, saved: string | null | undefined): WelcomeStep {
  const reached = ORDER.indexOf(saved as WelcomeStep);
  if (reached < 0) return steps[0]!.id;
  return steps.find((s) => ORDER.indexOf(s.id) >= reached)?.id ?? steps.at(-1)!.id;
}

/** Per workspace already: each one's page is an origin of its own. */
export const WELCOME_STEP_KEY = "bloks-workspace-welcome-step";

export function readWelcomeStep(): string | null {
  try {
    return localStorage.getItem(WELCOME_STEP_KEY);
  } catch {
    return null;
  }
}

export function keepWelcomeStep(step: WelcomeStep | null) {
  try {
    if (step) localStorage.setItem(WELCOME_STEP_KEY, step);
    else localStorage.removeItem(WELCOME_STEP_KEY);
  } catch {
    /* storage refused: it starts at the beginning next time, which is only longer */
  }
}
