// Hand-written twin of workspace-marks.mjs, so the window and the tests
// typecheck against the same shapes the main process uses.

export interface Mark {
  color: string;
  pattern: string;
}

export const PERSONAL_MARK: Readonly<Mark>;
export const BUSINESS_MARK: Readonly<Mark>;
export const MARK_PALETTE: readonly string[];
export const RESERVED_COLORS: readonly string[];
export const RESERVED_PATTERNS: readonly string[];
export const CUSTOM_PATTERNS: readonly string[];

export function litCount(pattern: string): number;
export function isCustomPattern(pattern: unknown): boolean;
export function isCustomMark(mark: unknown): boolean;
export function fixedMark(kind: string): Mark | null;
export function sameMark(a: Mark | null | undefined, b: Mark | null | undefined): boolean;
export function generateMark(
  taken?: ReadonlyArray<Mark | null | undefined>,
  options?: { random?: () => number; avoid?: Mark | null },
): Mark | null;
