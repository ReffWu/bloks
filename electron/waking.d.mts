// Hand-written twin of waking.mjs, so the tests typecheck against the
// same shapes the main process uses.

export const WAKE_PAUSES_MS: readonly number[];
export const WAKE_BUDGET_MS: number;
export const WAKE_GAVE_UP: string;

export function wakePause(answers: number): number;
export function nextWakePause(answers: number, elapsed: number, budget?: number): number | null;
export function isWakingAnswer(status: number, body: unknown): boolean;

/** The wait as the window shows it. */
export type WakeState =
  | { waking: true; since: number; until: number }
  | { waking: false; outcome?: "awake" | "gaveUp" };

export interface WakeClock {
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  budget?: number;
}

export function createWakeWatch(
  options?: WakeClock & { onChange?: (state: WakeState) => void },
): {
  run<T extends { waking?: boolean; heard?: boolean }>(ask: () => Promise<T>, options?: { gone?: () => boolean }): Promise<T>;
  presume(online: boolean): void;
  state(): WakeState;
  stop(): void;
};
