// Hand-written twin of notch.mjs, so the tests typecheck against the
// same shapes the main process uses.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  id?: number;
  internal?: boolean;
  bounds: Rect;
  workArea: Rect;
}

export interface NotchPage {
  hasNotch: boolean;
  notchWidth: number;
  menuBar: number;
  compact: { width: number; height: number };
  frame: { width: number; height: number };
}

export const NOTCH_MENU_BAR: number;
export const NOTCH_WIDTH: number;
export const EAR_WIDTH: number;
export const FRAME: Readonly<{ width: number; height: number }>;

export function menuBarHeight(display: DisplayLike | null | undefined): number;
export function hasNotch(display: DisplayLike | null | undefined): boolean;
export function notchDisplay<D extends DisplayLike>(displays: D[] | null | undefined, primary?: D | null): D | null;
export function compactSize(input: { notched: boolean; menuBar: number; notchWidth?: number }): { width: number; height: number };
export function frameOn(display: DisplayLike | null | undefined, frame?: { width: number; height: number }): Rect;
export function notchGeometry(displays: DisplayLike[], primary: DisplayLike | null): { displayId: number | null; bounds: Rect; page: NotchPage };
export function conversationTarget(target: unknown): string | null;
export function notchPlatform(platform?: string): boolean;

export interface NotchWindowLike {
  isDestroyed(): boolean;
  destroy(): void;
  setBounds(bounds: Rect): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  setAlwaysOnTop(flag: boolean, level?: string, relative?: number): void;
  setVisibleOnAllWorkspaces(flag: boolean, options?: Record<string, boolean>): void;
  showInactive(): void;
  once(event: string, fn: () => void): unknown;
  on(event: string, fn: () => void): unknown;
  webContents: { send(channel: string, payload: unknown): void };
}

export function createNotch(options: {
  BrowserWindow: new (options: Record<string, unknown>) => NotchWindowLike;
  screen: {
    getAllDisplays(): DisplayLike[];
    getPrimaryDisplay(): DisplayLike;
    on(event: string, fn: () => void): unknown;
    removeListener(event: string, fn: () => void): unknown;
  };
  preload: string;
  load: (win: NotchWindowLike) => void;
  guard?: (win: NotchWindowLike) => void;
  platform?: string;
}): {
  window(): NotchWindowLike | null;
  sync(on: boolean): void;
  hover(over: boolean): void;
  geometry(): NotchPage | null;
};
