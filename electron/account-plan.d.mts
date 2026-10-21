// Hand-written twin of account-plan.mjs, so the tests typecheck against
// the same shapes the main process uses.
export type AccountPlan = "team" | "cloud" | null;
export function cleanPlan(plan: unknown): AccountPlan;
export function readKeptPlan(file: string, print: string | null): AccountPlan | undefined;
export function keepPlan(file: string, print: string | null, plan: unknown, now?: number): void;
export function planFromReport(report: { plan?: unknown; shared?: unknown } | null | undefined, options: { hasLicence: boolean }): AccountPlan | undefined;
