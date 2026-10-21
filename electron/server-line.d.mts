// Hand-written twin of server-line.mjs, so the tests typecheck against
// the same shapes the main process uses.
import type { Registry } from "./workspaces.mjs";

type Answer = { ok?: boolean; status?: number; error?: string; [key: string]: unknown };

export class ServerAsks {
  ask(child: { postMessage(message: unknown): void } | null | undefined, what: string, payload?: Record<string, unknown>, timeoutMs?: number): Promise<Answer>;
  heard(said: unknown): boolean;
}
export const OWN_LOCAL_KINDS: readonly string[];
export function othersFor(
  registry: Registry,
  askedFrom: string,
  checks?: Record<string, { pairable?: unknown; why?: unknown } | undefined>,
): Array<{
  id: string;
  name: string;
  kind: string;
  mark: { color: string; pattern: string } | null;
  team: boolean;
  here: boolean;
  pairable: boolean | null;
  why: string | null;
}>;
export function pairRefusal(registry: Registry, askedFrom: string, target: string): { status: number; error: string } | null;
