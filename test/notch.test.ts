// The agents in the notch (electron/notch.mjs): which display has one,
// where the window goes, how big the island is at rest, what a row
// opens, the window kept and dropped by the setting, the mouse let
// through except over the island, and the setting kept with the theme
// (electron/workspaces.mjs).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EAR_WIDTH,
  FRAME,
  NOTCH_WIDTH,
  compactSize,
  conversationTarget,
  createNotch,
  frameOn,
  hasNotch,
  menuBarHeight,
  notchDisplay,
  notchGeometry,
  notchPlatform,
  type DisplayLike,
} from "../electron/notch.mjs";
import { parseRegistry, setNotch, settle } from "../electron/workspaces.mjs";
import { conversationOf } from "../src/lib/notify.ts";

/** A 14-inch MacBook Pro's own screen: a 38pt menu bar beside the notch. */
const builtIn: DisplayLike = { id: 1, internal: true, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } };
/** A monitor beside it, to the right, with an ordinary menu bar. */
const monitor: DisplayLike = { id: 2, internal: false, bounds: { x: 1512, y: -200, width: 2560, height: 1440 }, workArea: { x: 1512, y: -175, width: 2560, height: 1415 } };
/** An older MacBook Air: built in, but no notch. */
const air: DisplayLike = { id: 3, internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } };

describe("which display, and where", () => {
  test("the menu bar is the gap above the work area", () => {
    assert.equal(menuBarHeight(builtIn), 38);
    assert.equal(menuBarHeight(monitor), 25);
    assert.equal(menuBarHeight(null), 0);
  });

  test("a notch is a built-in screen with a tall menu bar", () => {
    assert.equal(hasNotch(builtIn), true);
    assert.equal(hasNotch(air), false, "built in, but an ordinary menu bar");
    assert.equal(hasNotch({ ...monitor, workArea: { ...monitor.workArea, y: -160 } }), false, "a tall bar on a monitor is not a notch");
  });

  test("the notched screen wins, whichever is primary; without one, the primary", () => {
    assert.equal(notchDisplay([monitor, builtIn], monitor)?.id, 1);
    assert.equal(notchDisplay([monitor, air], monitor)?.id, 2);
    assert.equal(notchDisplay([air], null)?.id, 3);
    assert.equal(notchDisplay([], null), null);
  });

  test("the frame is centred on the top edge, flush with it", () => {
    assert.deepEqual(frameOn(builtIn), { x: (1512 - FRAME.width) / 2, y: 0, width: FRAME.width, height: FRAME.height });
    const right = frameOn(monitor);
    assert.equal(right.y, -200, "a monitor above the laptop keeps its own top");
    assert.equal(right.x, 1512 + (2560 - FRAME.width) / 2);
    const tiny = frameOn({ ...air, bounds: { x: 0, y: 0, width: 500, height: 300 } });
    assert.deepEqual([tiny.width, tiny.height], [500, 300], "never wider or taller than the screen");
  });

  test("at rest the island is the notch's height, and the notch plus an ear each side", () => {
    assert.deepEqual(compactSize({ notched: true, menuBar: 38 }), { width: NOTCH_WIDTH + 2 * EAR_WIDTH, height: 38 });
    const flat = compactSize({ notched: false, menuBar: 25 });
    assert.ok(flat.width < NOTCH_WIDTH + 2 * EAR_WIDTH, "no camera to clear, so the ears sit closer");
    assert.ok(flat.height > 25, "it hangs a little below a short menu bar");
  });

  test("the page is told what it needs, and the frame fits the island open", () => {
    const g = notchGeometry([monitor, builtIn], monitor);
    assert.equal(g.displayId, 1);
    assert.deepEqual(g.page.compact, compactSize({ notched: true, menuBar: 38 }));
    assert.equal(g.page.hasNotch, true);
    assert.ok(g.page.frame.width >= 600 + 24, "room for the island at its widest");
    const flat = notchGeometry([air], air);
    assert.equal(flat.page.hasNotch, false);
    assert.equal(flat.page.menuBar, 25);
  });
});

describe("what a row opens", () => {
  test("one conversation, by name, in the target a banner's click uses", () => {
    const target = conversationTarget({ botId: "bot 1", taskId: "t/2" })!;
    assert.equal(target, "conversation:bot%201/t%2F2");
    assert.deepEqual(conversationOf(target), { id: "bot 1", lane: "t/2" });
  });

  test("anything else is nothing", () => {
    assert.equal(conversationTarget(null), null);
    assert.equal(conversationTarget({ botId: "b" }), null);
    assert.equal(conversationTarget({ botId: 4, taskId: "t" }), null);
    assert.equal(conversationTarget({ botId: "b".repeat(300), taskId: "t" }), null);
    assert.equal(conversationOf("conversation:only-one"), null);
    assert.equal(conversationOf("conversation:a/b/c"), null);
    assert.equal(conversationOf("bot-id"), null);
  });
});

/** A BrowserWindow and a screen that only remember what was done. */
function fakes(displays: DisplayLike[] = [builtIn]) {
  const made: FakeWindow[] = [];
  const listeners = new Map<string, () => void>();
  class FakeWindow {
    options: Record<string, unknown>;
    destroyed = false;
    bounds: unknown = null;
    ignore: Array<[boolean, unknown]> = [];
    level: unknown[] = [];
    spaces: unknown[] = [];
    sent: Array<[string, unknown]> = [];
    handlers = new Map<string, () => void>();
    webContents = { send: (channel: string, payload: unknown) => void this.sent.push([channel, payload]) };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      made.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.handlers.get("closed")?.();
    }
    setBounds(bounds: unknown) {
      this.bounds = bounds;
    }
    setIgnoreMouseEvents(ignore: boolean, options?: unknown) {
      this.ignore.push([ignore, options]);
    }
    setAlwaysOnTop(...args: unknown[]) {
      this.level = args;
    }
    setVisibleOnAllWorkspaces(...args: unknown[]) {
      this.spaces = args;
    }
    showInactive() {}
    once(event: string, fn: () => void) {
      this.handlers.set(event, fn);
    }
    on(event: string, fn: () => void) {
      this.handlers.set(event, fn);
    }
  }
  const screen = {
    displays,
    getAllDisplays: () => screen.displays,
    getPrimaryDisplay: () => screen.displays[0],
    on: (event: string, fn: () => void) => void listeners.set(event, fn),
    removeListener: (event: string) => void listeners.delete(event),
  };
  return { made, listeners, screen, BrowserWindow: FakeWindow };
}

describe("the window", () => {
  test("made on a Mac when on, as a clear panel over the menu bar that lets clicks through", () => {
    const { made, screen, BrowserWindow } = fakes();
    let loaded = 0;
    const notch = createNotch({ BrowserWindow, screen, preload: "/p.cjs", load: () => void loaded++, platform: "darwin" });
    notch.sync(true);
    assert.equal(made.length, 1);
    const [win] = made;
    const o = win.options;
    assert.equal(o.type, "panel");
    assert.equal(o.transparent, true);
    assert.equal(o.frame, false);
    assert.equal(o.hasShadow, false);
    assert.equal(o.focusable, false);
    assert.equal(o.resizable, false);
    assert.deepEqual([o.x, o.y, o.width, o.height], [(1512 - FRAME.width) / 2, 0, FRAME.width, FRAME.height]);
    assert.deepEqual((o.webPreferences as Record<string, unknown>).contextIsolation, true);
    assert.deepEqual(win.level, [true, "status", 1], "above the menu bar");
    assert.deepEqual(win.spaces, [true, { visibleOnFullScreen: true, skipTransformProcessType: true }]);
    assert.deepEqual(win.ignore.at(-1), [true, { forward: true }], "clicks through, moves forwarded");
    assert.equal(loaded, 1);
    notch.sync(true);
    assert.equal(made.length, 1, "one window, however often it is asked");
  });

  test("the island takes the mouse only while the pointer is over it", () => {
    const { made, screen, BrowserWindow } = fakes();
    const notch = createNotch({ BrowserWindow, screen, preload: "", load: () => {}, platform: "darwin" });
    notch.sync(true);
    notch.hover(true);
    assert.deepEqual(made[0].ignore.at(-1), [false, undefined]);
    notch.hover(false);
    assert.deepEqual(made[0].ignore.at(-1), [true, { forward: true }]);
  });

  test("a display change puts it back over the notch and tells the page", () => {
    const { made, listeners, screen, BrowserWindow } = fakes([monitor]);
    const notch = createNotch({ BrowserWindow, screen, preload: "", load: () => {}, platform: "darwin" });
    notch.sync(true);
    assert.equal(notch.geometry()?.hasNotch, false);
    screen.displays = [monitor, builtIn];
    listeners.get("display-added")!();
    assert.deepEqual(made[0].bounds, frameOn(builtIn));
    const [channel, page] = made[0].sent.at(-1)!;
    assert.equal(channel, "notch:geometry");
    assert.equal((page as { hasNotch: boolean }).hasNotch, true);
  });

  test("turned off it is destroyed and stops listening; never made off a Mac", () => {
    const { made, listeners, screen, BrowserWindow } = fakes();
    const notch = createNotch({ BrowserWindow, screen, preload: "", load: () => {}, platform: "darwin" });
    notch.sync(true);
    notch.sync(false);
    assert.equal(made[0].destroyed, true);
    assert.equal(notch.window(), null);
    assert.equal(listeners.size, 0);
    assert.equal(notch.geometry(), null);

    const elsewhere = fakes();
    const off = createNotch({ ...elsewhere, preload: "", load: () => {}, platform: "win32" });
    off.sync(true);
    assert.equal(elsewhere.made.length, 0);
    assert.equal(notchPlatform("darwin"), true);
    assert.equal(notchPlatform("linux"), false);
  });
});

describe("the setting", () => {
  test("on unless turned off, and kept across a restart", () => {
    let registry = settle(parseRegistry(null), { personalDataDir: "/tmp/bloks-personal" });
    assert.equal(registry.prefs.notch, true);
    registry = setNotch(registry, false);
    assert.equal(registry.prefs.notch, false);
    assert.equal(parseRegistry(JSON.stringify(registry)).prefs.notch, false);
    assert.equal(parseRegistry(JSON.stringify(setNotch(registry, true))).prefs.notch, true);
  });

  test("only a yes or a no changes it", () => {
    const registry = settle(parseRegistry(null), { personalDataDir: "/tmp/bloks-personal" });
    assert.equal(setNotch(registry, "off"), registry);
    assert.equal(setNotch(registry, true), registry, "already on: the same registry back");
    // a list written before the setting existed reads as on
    assert.equal(parseRegistry(JSON.stringify({ prefs: { theme: "dark" } })).prefs.notch, true);
    assert.equal(parseRegistry(JSON.stringify({ prefs: { notch: "no" } })).prefs.notch, true);
  });
});
