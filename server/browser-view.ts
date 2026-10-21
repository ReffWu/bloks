// The agent's browser, seen from the chat.
//
// The agent drives its own Chrome over the debugging protocol (see
// server/browser-proxy.ts). This is the person's side of the same
// connection: a picture of the page while a turn runs, and a way to
// click or type into it when the agent is stuck on something only a
// person can do, like a login or a cookie wall.
//
// Each call attaches, does one thing and lets go. Chrome is happy to
// have several clients on one page, and holding a socket open here would
// be one more thing to clean up when the agent closes its tab.
import { listTargets, Session } from "./cdp.ts";

/** The page the agent means, by the same rule its browser tool uses:
 * the newest one open. */
async function withPage<T>(port: number, act: (page: Session) => Promise<T>): Promise<T> {
  const targets = await listTargets(port);
  if (!targets.length) throw new Error("the agent's browser has no page open");
  const page = new Session(targets[targets.length - 1].webSocketDebuggerUrl);
  await page.open();
  try {
    return await act(page);
  } finally {
    page.close();
  }
}

/** A JPEG of what is on screen. Quality is kept low on purpose: this is a
 * preview that refreshes every second or two, not a record. */
export function captureFrame(port: number): Promise<{ png: string; mime: string }> {
  return withPage(port, async (page) => {
    const shot = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 60 }, 8_000);
    return { png: String(shot.data), mime: "image/jpeg" };
  });
}

/** A click where the person clicked on the preview. The preview is the
 * visible viewport, so a position given as a fraction of it lands on the
 * same spot whatever size the picture was drawn at. */
export function clickAt(port: number, fx: number, fy: number): Promise<void> {
  return withPage(port, async (page) => {
    const metrics = await page.send("Page.getLayoutMetrics", {}, 5_000);
    const viewport = metrics.cssVisualViewport ?? metrics.layoutViewport;
    const x = Math.round(fx * viewport.clientWidth);
    const y = Math.round(fy * viewport.clientHeight);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (const type of ["mousePressed", "mouseReleased"] as const) {
      await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    }
  });
}

/** Text into whatever has focus, and Enter after it when asked. */
export function typeText(port: number, text: string, enter: boolean): Promise<void> {
  return withPage(port, async (page) => {
    if (text) await page.send("Input.insertText", { text });
    if (enter) {
      const key = { key: "Enter", code: "Enter", keyCode: 13, windowsVirtualKeyCode: 13 };
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r" });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
    }
  });
}

/** The keys a person can press from a phone, by the names the phone sends,
 * with what the page should see. Text goes through typeText; these are
 * the ones a phone keyboard has no way to send into someone else's page. */
export const PAGE_KEYS: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

/** One of PAGE_KEYS, pressed and let go. */
export function pressKey(port: number, name: string): Promise<void> {
  const def = PAGE_KEYS[name];
  if (!def) return Promise.reject(new Error("that key cannot be pressed from here"));
  return withPage(port, async (page) => {
    const key = { ...def, windowsVirtualKeyCode: def.keyCode };
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...key, ...(name === "Enter" ? { text: "\r" } : {}) });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  });
}

/** The wheel at a spot on the page, a screenful at a time: up is
 * negative, as the page counts it. */
export function scrollAt(port: number, fx: number, fy: number, screens: number): Promise<void> {
  return withPage(port, async (page) => {
    const metrics = await page.send("Page.getLayoutMetrics", {}, 5_000);
    const viewport = metrics.cssVisualViewport ?? metrics.layoutViewport;
    const x = Math.round(fx * viewport.clientWidth);
    const y = Math.round(fy * viewport.clientHeight);
    const deltaY = Math.round(screens * viewport.clientHeight * 0.8);
    await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
  });
}
