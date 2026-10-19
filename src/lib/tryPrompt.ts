// "Try now", and the example prompts on an app's page: put a ready prompt
// in an agent's message box and go there, so pressing Enter is the only
// step left. Nothing is sent on its own; the person reads it first.
//
// It goes to the agent you were last talking to when that agent can use
// connected apps, otherwise to the first one that can. The prompt is
// written into that conversation's draft before its box appears (the box
// reads its draft as it mounts, src/lib/drafts.ts); anything already
// half-written there is kept, above it.
import type { Action, AppState, Bot } from "@/state/store";
import { keepDraft, readDraft } from "./drafts";

/** The agent a tried prompt goes to, or null when none can use apps. */
export function agentForApps(state: AppState): Bot | null {
  const usable = (b: Bot) => !b.hidden && b.composio !== false;
  const current = state.bots.find((b) => b.id === state.selectedId);
  return current && usable(current) ? current : (state.bots.find(usable) ?? null);
}

export function tryPrompt(state: AppState, dispatch: React.Dispatch<Action>, prompt: string): Bot | null {
  const bot = agentForApps(state);
  if (!bot) return null;
  const key = `${bot.id}:${bot.activeTaskId ?? bot.threadId}`;
  const draft = readDraft(key);
  keepDraft(key, { ...draft, text: draft.text.trim() ? `${draft.text.trimEnd()}\n\n${prompt}` : prompt });
  dispatch({ type: "select", id: bot.id });
  return bot;
}
