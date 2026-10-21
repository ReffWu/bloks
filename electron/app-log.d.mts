// Hand-written twin of app-log.mjs, so the tests typecheck against the
// same shapes the main process uses.
export const APP_LOG_MAX_BYTES: number;
export const APP_LOG_MAX_LINE: number;

export function logLine(text: unknown, now?: Date): string;

export function createAppLog(
  dir: string,
  options?: { name?: string; maxBytes?: number; now?: () => Date },
): { file: string; write(text: unknown): void };

export function lineBudget(options?: { limit?: number; windowMs?: number }): (now?: number) => boolean;
