// What a window does when the page inside it dies or stops answering.
//
// Electron leaves a window whose renderer process is gone exactly as it
// was: a blank rectangle that never comes back, which reads as Bloks
// having crashed even though the servers and every agent are still
// working. So the window loads the app again. A page that dies every time
// it loads would turn that into a loop that eats the machine, so after a
// few deaths close together it stops, and shows a plain page with a
// Reload link instead. A page that stops answering is waited on and
// written down, never killed.
//
// Plain Node on purpose, so it can be tested without Electron (see
// test/renderer-watch.test.ts).

/** This many deaths within DEATH_WINDOW_MS and the window stops reloading. */
export const DEATH_LIMIT = 3;
export const DEATH_WINDOW_MS = 60_000;

/** Where the stopped page's Reload link points. A scheme nothing opens,
 * so the window hears it as a navigation it then calls off, and a link
 * nobody catches goes nowhere rather than to a browser. */
export const RELOAD_URL = "bloks-window:reload";

/** Whether a navigation is the stopped page's Reload. */
export const isReloadAsk = (url) => url === RELOAD_URL;

/** Counts deaths. `note()` answers "reload" while they are few enough,
 * and "stop" once DEATH_LIMIT of them fall within DEATH_WINDOW_MS;
 * `reset()` is the person asking to try again. */
export function deathGuard({ limit = DEATH_LIMIT, windowMs = DEATH_WINDOW_MS } = {}) {
  let deaths = [];
  return {
    note(now = Date.now()) {
      deaths = deaths.filter((at) => now - at < windowMs);
      deaths.push(now);
      return deaths.length >= limit ? "stop" : "reload";
    },
    reset() {
      deaths = [];
    },
  };
}

/** The page a window shows once it has stopped reloading. */
export function stoppedPage({ backdrop = "#0e0e10", dark = true } = {}) {
  const text = dark ? "#ededf0" : "#1b1b1f";
  const quiet = dark ? "#8f8f99" : "#68686f";
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:${backdrop};color:${text};font:15px -apple-system,system-ui">` +
        `<div style="text-align:center;max-width:420px;padding:24px">` +
        `<h2 style="font-weight:600;margin:0 0 8px">Bloks stopped responding</h2>` +
        `<p style="color:${quiet};line-height:1.5;margin:0 0 18px">This window closed unexpectedly several times in a row, so it has stopped reopening on its own. Your agents and their work are not affected. What happened is in the app log.</p>` +
        `<a href="${RELOAD_URL}" style="display:inline-block;padding:8px 18px;border-radius:999px;background:${text};color:${backdrop};text-decoration:none;font-weight:500">Reload</a>` +
        `</div></body>`,
    )
  );
}

/**
 * Watches one window. `log(text)` writes a line to the app log,
 * `reopen()` loads the app in the window again, `stopped()` is the URL of
 * the stopped page, and `quitting()` says whether Bloks is on its way out,
 * when a page going away is expected.
 */
export function watchRenderer(win, { log, reopen, stopped, quitting = () => false, now = Date.now }) {
  const deaths = deathGuard();
  let stuckSince = 0;
  win.webContents.on("render-process-gone", (_event, details) => {
    log(`window: its page process is gone (${details?.reason ?? "unknown"}, exit code ${details?.exitCode ?? "unknown"})`);
    if (quitting() || win.isDestroyed()) return;
    if (deaths.note(now()) === "reload") {
      log("window: loading the app again");
      reopen();
      return;
    }
    log(`window: ${DEATH_LIMIT} in under a minute, so it shows the stopped page instead of loading again`);
    Promise.resolve(win.loadURL(stopped())).catch(() => {});
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isReloadAsk(url) || win.isDestroyed()) return;
    event.preventDefault();
    deaths.reset();
    log("window: Reload pressed on the stopped page");
    reopen();
  });
  // Waited on, never killed: a long piece of work in the page usually
  // finishes, and killing it would lose what was on screen.
  win.on("unresponsive", () => {
    stuckSince = now();
    log("window: its page is not responding; waiting for it");
  });
  win.on("responsive", () => {
    if (!stuckSince) return;
    log(`window: its page is responding again, after ${Math.round((now() - stuckSince) / 1000)} s`);
    stuckSince = 0;
  });
}
