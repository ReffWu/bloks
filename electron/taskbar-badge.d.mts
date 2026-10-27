// Hand-written twin of taskbar-badge.mjs, so the tests typecheck against
// the same shapes the main process uses.
export type OverlayKind = "none" | "dot" | "count";

export interface OverlayChoice {
  kind: OverlayKind;
  label: string;
  description: string;
}

export const BADGE_RED: { r: number; g: number; b: number };
export function overlayChoice(count: number, showNumber?: boolean): OverlayChoice;
export function renderBadge(kind: OverlayKind, label: string, size: number): Buffer;
