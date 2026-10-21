// Hand-written twin of renderer-watch.mjs, so the tests typecheck against
// the same shapes the main process uses.
export const DEATH_LIMIT: number;
export const DEATH_WINDOW_MS: number;
export const RELOAD_URL: string;

export function isReloadAsk(url: string): boolean;

export function deathGuard(options?: { limit?: number; windowMs?: number }): {
  note(now?: number): "reload" | "stop";
  reset(): void;
};

export function stoppedPage(options?: { backdrop?: string; dark?: boolean }): string;

interface Emitter {
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export function watchRenderer(
  win: Emitter & { webContents: Emitter; isDestroyed(): boolean; loadURL(url: string): unknown },
  options: {
    log(text: string): void;
    reopen(): void;
    stopped(): string;
    quitting?: () => boolean;
    now?: () => number;
  },
): void;
