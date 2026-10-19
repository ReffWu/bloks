// Hand-written twin of terminal-window.mjs, so the tests typecheck against
// the same shapes the main process uses.
export function terminalAgent(raw: unknown): string | null;
export function terminalQuery(raw: unknown): string | null;
