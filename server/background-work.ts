// What happens to work an agent starts in the background, once its reply
// is written.
//
// Claude Code can run a subagent or a shell command in the background and
// answer before it is done. The process keeps going for it, and when it
// ends the agent hears and says what came of it. Left alone, that went on
// in a process no turn owned: a subagent's notes posted as the agent's
// reply, and the next turn resumed the session beside it (GitHub 330,
// 331). Since then a turn's process is stopped when the turn ends, so the
// one thing left to choose is when the turn ends:
//
//   finish  the turn stays open, the agent shown as working, until the
//           background work it started is done and it has said what came
//           of it. Words sent meanwhile go into that turn or wait, as
//           they do for any turn, and a background task that goes silent
//           for the stall limit stops it like any silent call.
//   stop    the turn ends with the reply, and what it left running in
//           the background is stopped with its process.
//
// Set for the workspace in Settings, Behaviour, and for one agent in its
// own settings. Only the person sets either: agents cannot.

export type BackgroundWork = "finish" | "stop";
export const BACKGROUND_WORK: readonly BackgroundWork[] = ["finish", "stop"];
export const DEFAULT_BACKGROUND_WORK: BackgroundWork = "finish";

export function backgroundWork(value: unknown): BackgroundWork | undefined {
  return BACKGROUND_WORK.includes(value as BackgroundWork) ? (value as BackgroundWork) : undefined;
}

/** What applies to a turn: the agent's own choice, then the workspace's,
 * then letting it finish. */
export function resolveBackgroundWork(agent: unknown, workspace: unknown): BackgroundWork {
  return backgroundWork(agent) ?? backgroundWork(workspace) ?? DEFAULT_BACKGROUND_WORK;
}
