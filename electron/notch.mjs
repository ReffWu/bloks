// The agents at work, in the MacBook's notch.
//
// A window with no frame, no shadow and nothing of its own to draw,
// pinned over the top edge of the screen that has the notch, above the
// menu bar, on every space and over full-screen apps. The page in it
// (src/components/notch/NotchIsland.tsx) draws the island; this keeps
// the window where it belongs and decides what the mouse does.
//
// The window is a fixed, clear frame larger than the island at its
// largest, centred on the notch. It never resizes while the island
// animates: a native resize every frame of a spring is a stutter, and
// the island is only CSS inside a frame that holds still. The frame
// lets every click through to whatever is under it, the menu bar above
// all, except while the pointer is over the island itself. Mouse moves
// are still forwarded to the page while clicks pass through, which is
// how the page knows the pointer has arrived; it says so (notch:hover),
// and the frame takes the mouse until the page says it has left.
//
// Which display: the built-in one, when its menu bar is taller than a
// notchless one's (the notch makes the menu bar as tall as itself);
// else the primary display, where the island hangs from the top centre
// as the same black shape. The page follows the workspace of the
// frontmost window, as the quick ask does (electron/main.mjs).
//
// The geometry is plain arithmetic and tested on its own
// (test/notch.test.ts); the window manager takes Electron's pieces from
// its caller, so this file never imports Electron itself.

/** A menu bar taller than this has a notch beside it: 24pt without one,
 * 32 to 38 with. */
export const NOTCH_MENU_BAR = 30;
/** The camera housing's width, in points. macOS does not tell an app,
 * and every notched MacBook's is near this. */
export const NOTCH_WIDTH = 200;
/** Each ear: room for three stacked faces on one side and a clock or
 * "Needs you" on the other. */
export const EAR_WIDTH = 72;
/** Without a notch the ears sit closer, with a little black between. */
const NO_NOTCH_GAP = 40;
/** And the shape hangs a little below a short menu bar, so it reads as
 * a shape and not a stripe. */
const NO_NOTCH_HEIGHT = 30;
/** The clear frame: wide and deep enough for the island fully open,
 * with room around it for its shadow. */
export const FRAME = Object.freeze({ width: 680, height: 540 });

/** How tall a display's menu bar is: the gap between the top of the
 * screen and the top of the area windows may use. */
export function menuBarHeight(display) {
  const top = display?.bounds?.y ?? 0;
  const work = display?.workArea?.y ?? top;
  return Math.max(0, work - top);
}

/** Whether a display has a notch: a built-in screen whose menu bar is
 * taller than one without. */
export function hasNotch(display) {
  return Boolean(display?.internal) && menuBarHeight(display) > NOTCH_MENU_BAR;
}

/** The display the island lives on: the notched one, else the primary. */
export function notchDisplay(displays, primary) {
  return (displays ?? []).find(hasNotch) ?? primary ?? displays?.[0] ?? null;
}

/** The island at rest: as tall as the notch (or a short tab below a
 * notchless menu bar) and the notch plus an ear each side. */
export function compactSize({ notched, menuBar, notchWidth = NOTCH_WIDTH }) {
  if (notched) return { width: notchWidth + EAR_WIDTH * 2, height: Math.round(menuBar) };
  return { width: NO_NOTCH_GAP + EAR_WIDTH * 2, height: Math.max(Math.round(menuBar), NO_NOTCH_HEIGHT) };
}

/** The frame on a display: centred on its top edge, flush with it, never
 * wider than the display. */
export function frameOn(display, frame = FRAME) {
  const bounds = display?.bounds ?? { x: 0, y: 0, width: frame.width, height: frame.height };
  const width = Math.min(frame.width, bounds.width);
  const height = Math.min(frame.height, bounds.height);
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Everything the window and the page need to know, for the displays
 * there are now. */
export function notchGeometry(displays, primary) {
  const display = notchDisplay(displays, primary);
  const notched = hasNotch(display);
  const menuBar = menuBarHeight(display) || 24;
  const notchWidth = notched ? NOTCH_WIDTH : NO_NOTCH_GAP;
  const bounds = frameOn(display);
  return {
    displayId: display?.id ?? null,
    bounds,
    // what the page is told (src/types/bridge.d.ts, NotchGeometry)
    page: {
      hasNotch: notched,
      notchWidth,
      menuBar,
      compact: compactSize({ notched, menuBar, notchWidth }),
      frame: { width: bounds.width, height: bounds.height },
    },
  };
}

/** What a row in the notch opens: one conversation, in the target the
 * window already understands from a banner's click (src/lib/notify.ts,
 * CONVERSATION_TARGET). */
export function conversationTarget(target) {
  const botId = typeof target?.botId === "string" ? target.botId : "";
  const taskId = typeof target?.taskId === "string" ? target.taskId : "";
  if (!botId || !taskId || botId.length > 200 || taskId.length > 200) return null;
  return `conversation:${encodeURIComponent(botId)}/${encodeURIComponent(taskId)}`;
}

/** Whether this computer can have the island at all. */
export const notchPlatform = (platform = process.platform) => platform === "darwin";

/**
 * The window, made and kept by the caller's lights: `sync(on)` makes it
 * or takes it away; `load(win)` points it at the page (the caller knows
 * which workspace and which server); `hover(over)` is the page saying
 * where the pointer is. Electron's BrowserWindow and screen come in from
 * main.mjs, with the preload path.
 */
export function createNotch({ BrowserWindow, screen, preload, load, guard = () => {}, platform = process.platform }) {
  let win = null;
  let geometry = null;
  let over = false;

  const measure = () => (geometry = notchGeometry(screen.getAllDisplays(), screen.getPrimaryDisplay()));

  /** Clicks go through, moves still reach the page; or, over the island,
   * the window takes the mouse. */
  const passThrough = () => {
    if (!win || win.isDestroyed()) return;
    if (over) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  };

  /** A display came, went or changed (a lid opened, a monitor plugged
   * in, the menu bar's size): back over the notch, and the page told. */
  const place = () => {
    if (!win || win.isDestroyed()) return;
    measure();
    win.setBounds(geometry.bounds);
    win.webContents.send("notch:geometry", geometry.page);
  };

  const build = () => {
    measure();
    win = new BrowserWindow({
      ...geometry.bounds,
      // a panel, so showing it never takes focus from the app in front
      type: "panel",
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      roundedCorners: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // the first click on a row opens it, rather than waking the window
      acceptFirstMouse: true,
      // the top of the screen is the menu bar's; a frame allowed to sit
      // over it is the whole point
      enableLargerThanScreen: true,
      webPreferences: {
        // the same settings as every window that loads the app, written
        // out for the same reason (electron/main.mjs)
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        // its clock and its springs run while another app is in front,
        // which is all of the time
        backgroundThrottling: false,
        preload,
      },
    });
    // over the menu bar and the status items in it, under the menus they
    // open; on every space, and over a full-screen app. Leaving the
    // process type alone keeps the Dock icon from blinking as it is made.
    win.setAlwaysOnTop(true, "status", 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    over = false;
    passThrough();
    guard(win);
    win.once("ready-to-show", () => win && !win.isDestroyed() && win.showInactive());
    win.on("closed", () => {
      win = null;
      over = false;
    });
    load(win);
  };

  const listen = (on) => {
    for (const event of ["display-added", "display-removed", "display-metrics-changed"]) {
      if (on) screen.on(event, place);
      else screen.removeListener(event, place);
    }
  };

  return {
    /** The window, while there is one. */
    window: () => (win && !win.isDestroyed() ? win : null),
    /** Made when on (and on a Mac), destroyed when off. */
    sync(on) {
      const want = Boolean(on) && notchPlatform(platform);
      if (want && !win) {
        build();
        listen(true);
      } else if (!want && win) {
        listen(false);
        if (!win.isDestroyed()) win.destroy();
        win = null;
        over = false;
      }
    },
    hover(next) {
      over = Boolean(next);
      passThrough();
    },
    geometry: () => (win ? geometry?.page ?? measure().page : null),
  };
}
