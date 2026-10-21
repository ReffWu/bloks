// What happens to work an agent starts in the background once its reply
// is done (server/background-work.ts), in the words both Settings pages
// use for it.
export type BackgroundWork = "finish" | "stop";

export const BACKGROUND_WORK: Array<{ value: BackgroundWork; label: string; says: string }> = [
  {
    value: "finish",
    label: "Let it finish",
    says: "The agent keeps working until its background subagents and tasks are done, then says what came of them.",
  },
  {
    value: "stop",
    label: "Stop when the reply is done",
    says: "The reply ends the turn, and anything the agent left running in the background is stopped.",
  },
];

export const backgroundWords = (value: BackgroundWork | null | undefined) =>
  BACKGROUND_WORK.find((choice) => choice.value === value) ?? BACKGROUND_WORK[0];
