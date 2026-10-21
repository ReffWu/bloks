// Hand-written twin of open-inside.mjs, so the tests typecheck against the
// same shapes the main process uses.
import type { Stats } from "node:fs";

export const openHooks: { beforeOpen?: (path: string) => void };

export function within(root: string, path: string): boolean;

export function openInside(root: string, name: string | readonly string[]): { fd: number; stat: Stats; path: string } | null;

export function readInside(root: string, name: string | readonly string[], max?: number): Buffer | null;
