// What happens to work an agent starts in the background once its reply
// is done (server/background-work.ts), in the words both Settings pages
// use for it. The words are keys, said where they draw.
import type { MessageKey } from "./i18n.ts";

export type BackgroundWork = "finish" | "stop";

export const BACKGROUND_WORK: Array<{ value: BackgroundWork; label: MessageKey; says: MessageKey }> = [
  {
    value: "finish",
    label: "backgroundWork.finish",
    says: "backgroundWork.finishSays",
  },
  {
    value: "stop",
    label: "backgroundWork.stop",
    says: "backgroundWork.stopSays",
  },
];

export const backgroundWords = (value: BackgroundWork | null | undefined) =>
  BACKGROUND_WORK.find((choice) => choice.value === value) ?? BACKGROUND_WORK[0];
