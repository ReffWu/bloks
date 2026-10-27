// Hand-written twin of links.mjs, so the tests typecheck against the
// same shapes the main process uses.
export function teamLink(raw: unknown): { kind: "team"; slug: string } | null;
export function linkInArgv(argv: unknown): string | null;
export function joinLink(raw: unknown): { kind: "join"; fragment: string } | null;
export function planLink(raw: unknown): { kind: "plan" } | null;
export function installLink(raw: unknown): { kind: "install"; url: string } | null;
