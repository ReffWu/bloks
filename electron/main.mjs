// The desktop shell.
//
// Three jobs, in this order: bring up the harness servers, one for each
// workspace on this computer, open a window pointed at the one you are
// in, and own the macOS permissions the web layer cannot ask for on its
// own.
//
// The permissions part is the reason this file is more than a window
// factory. Screen Recording and Microphone are granted by macOS to an
// *application*, identified by its signature, so anything that triggers
// those prompts has to run inside the app's own processes. A helper the
// server spawned would prompt as some anonymous binary, or not appear in
// System Settings at all.
import {
  app,
  autoUpdater as nativeUpdater,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  screen,
  session,
  shell,
  ShareMenu,
  systemPreferences,
  utilityProcess,
} from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeBadgeCount, resolveWindowState } from "./window-state.mjs";
import { appMenuTemplate } from "./app-menu.mjs";
import { drainWait } from "./drain-wait.mjs";
import { mayLookAgain, newestBeforeInstall, updateFrame } from "./update-check.mjs";
import { markInstall, restartIntoUpdate, takeInstallMark, within } from "./update-restart.mjs";
import { claimPairLink, startRemoteProxy } from "./remote.mjs";
import { nativeSettingsObservation } from "./settings-observation.mjs";
import { sameAppOrigin } from "./navigation.mjs";
import { joinLink, linkInArgv, teamLink } from "./links.mjs";
import { terminalQuery } from "./terminal-window.mjs";
import os from "node:os";

// vendored by scripts/bundle-updater.mjs: the packaged app has no
// node_modules, so the updater travels inside electron/ pre-bundled
import electronUpdater from "./vendor/electron-updater.cjs";

import { startCua, stopCua, registerCuaIpc } from "./cua.mjs";
import { nativeHelper } from "./native-helper.mjs";
import { anyFreePort, failurePage, parseLsof, portFree, portOrder } from "./ports.mjs";
import { keepServerUp, stopServer } from "./server-life.mjs";
import {
  PERSONAL_ID,
  addWorkspace,
  allowsNotice,
  badgeTotal,
  configuredPort,
  mergeDrains,
  muteFor,
  nextMuteEnd,
  readRegistry,
  removeWorkspace,
  reorder,
  rerollMark,
  setCurrent,
  settle,
  snapshot,
  updateWorkspace,
  writeRegistry,
} from "./workspaces.mjs";
import { startMeeting, startSpeech, stopMeeting, stopSpeech } from "./speech.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ICON = path.join(HERE, "resources/app-icon.png");

// Spelled as an IPv4 literal, not "localhost": Vite binds v4, and the name
// can resolve to ::1 first, which paints an empty window.
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://127.0.0.1:5199";

/** Whether this run starts servers of its own: the installed app always
 * does; a development run only when asked (BLOKS_DEV_WORKSPACES=1, after
 * `pnpm build`), since `pnpm dev` already has its server and its Vite. */
const HOSTS_SERVERS = app.isPackaged || process.env.BLOKS_DEV_WORKSPACES === "1";

const DARK_BACKDROP = "#0e0e10";
const LIGHT_BACKDROP = "#ffffff";

/**
 * The PATH a Finder launch gets has never heard of npm, brew or nvm, so
 * every CLI engine would probe as "not installed" in the packaged app.
 * Ask the user's own login shell what PATH it actually uses, once, and
 * merge that into this process before anything is forked. The harness
 * inherits it, and so does everything the harness spawns.
 *
 * The interactive flag matters: plenty of people export PATH in .zshrc,
 * which only an interactive shell reads. Banners and rc noise are why
 * only the last line of output is trusted.
 */
async function adoptLoginShellPath() {
  // Windows has no login-shell PATH problem: GUI apps inherit the user
  // environment, and %SHELL% does not exist to ask.
  if (process.platform === "win32") return;
  const shell = process.env.SHELL || "/bin/zsh";
  const reported = await new Promise((resolve) => {
    execFile(shell, ["-ilc", 'echo "$PATH"'], { timeout: 4000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim().split("\n").at(-1));
    });
  });
  if (!reported) return; // the backstop in server/path.ts still applies

  const merged = [...new Set([...reported.split(":"), ...(process.env.PATH ?? "").split(":")])]
    .filter(Boolean)
    .join(":");
  process.env.PATH = merged;
}

/** Set once Bloks starts quitting: the servers going away is expected
 * from then on, and none is brought back. */
let quitting = false;

// One Bloks per user. A second launch would fork a second harness onto a
// fallback port and quietly split the workspace in two, so the loser
// exits before it has started anything, and the winner brings its own
// window forward when that happens.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

// bloks:// links from the website ("Add to Bloks" on a team in the
// gallery). Only a gallery team by name is understood: a link cannot
// point the app at an arbitrary address, and what it opens is the same
// review a person sees when importing by hand, so nothing is created
// until they choose the seats. macOS hands links over with open-url, the
// others as an argument, to a second launch or to the one the link
// started (electron/links.mjs).
// A development run that starts its own servers is a throwaway, often on
// a throwaway user data folder, and must not take bloks:// links away
// from the installed app.
if (app.isPackaged || !HOSTS_SERVERS) app.setAsDefaultProtocolClient("bloks");
let pendingLink = null;
function deliverLink(raw) {
  const link = teamLink(raw) ?? joinLink(raw);
  if (!link) return;
  const main = BrowserWindow.getAllWindows().find((w) => isWorkspaceWindow(w));
  if (!main || main.webContents.isLoading()) {
    pendingLink = link;
    return;
  }
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  main.webContents.send("link:open", link);
}
app.on("open-url", (event, url) => {
  event.preventDefault();
  deliverLink(url);
});
handle("link:pending", () => {
  const link = pendingLink;
  pendingLink = null;
  return link;
});

// A choice from the macOS menu bar (electron/app-menu.mjs) that the
// workspace window carries out, such as Settings. macOS keeps the app
// running with every window closed, and the menu still works then, so a
// window is opened for it and asks for the choice once it is listening,
// the same way a link waits above.
let pendingMenuCommand = null;
function menuCommand(command) {
  const main = BrowserWindow.getAllWindows().find((w) => isWorkspaceWindow(w));
  if (!main || main.webContents.isLoading()) {
    pendingMenuCommand = command;
    if (!main) createWindow();
    return;
  }
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  main.webContents.send("menu:command", command);
}
handle("menu:pending", () => {
  const command = pendingMenuCommand;
  pendingMenuCommand = null;
  return command;
});

app.on("second-instance", (_event, argv = []) => {
  const link = linkInArgv(argv);
  if (link) deliverLink(link);
  const main = BrowserWindow.getAllWindows().find((w) => isWorkspaceWindow(w));
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  app.focus?.({ steal: true });
});

// ── the harness servers ────────────────────────────────────────────────
// One per workspace (electron/workspaces.mjs), each on its own data
// folder and its own port, and all of them kept running whichever one
// the window shows: a routine or a watcher in a workspace you are not
// looking at still has to run on time.

/** Where the server and the page it serves come from: the installed
 * app's Resources, or this checkout (built with `pnpm build`). */
function serverSource() {
  if (app.isPackaged) {
    return { entry: path.join(process.resourcesPath, "server", "index.js"), ui: path.join(process.resourcesPath, "ui"), execArgv: [] };
  }
  return { entry: path.join(HERE, "..", "server", "index.ts"), ui: path.join(HERE, "..", "dist"), execArgv: ["--experimental-strip-types", "--no-warnings"] };
}

/**
 * Start a workspace's server on one port and wait for it to prove it is
 * ours.
 *
 * A health check that only looks for HTTP 200 is not enough. A developer
 * running `pnpm dev:server` has the identical API on the identical port,
 * and attaching to it would give the packaged app someone else's
 * workspace. So the probe requires the pid we just forked and that the
 * responder is serving static files, which a dev server does not.
 */
async function startServerOn(port, ws) {
  const source = serverSource();
  const child = utilityProcess.fork(source.entry, [], {
    env: {
      ...process.env,
      BLOKS_STATIC_DIR: source.ui,
      BLOKS_PORT: String(port),
      // the workspace's own folder; Personal's is the ~/.bloks it always had
      BLOKS_DATA_DIR: ws.dataDir,
      // which workspace it is, for its relay space, and where all of them
      // live, so its agents are kept out of the others' folders too
      BLOKS_WORKSPACE_ID: ws.id,
      BLOKS_WORKSPACES_DIR: workspacesDir(),
    },
    execArgv: source.execArgv,
    // stderr is read as well as passed on, so a server that dies while
    // starting can say why on the page instead of "ports".
    //
    // stdout is piped too, never "inherit" next to a "pipe": on Windows,
    // Electron fills an inherited slot with GetStdHandle(), which is NULL
    // for an app opened from a shortcut (no console), and Chromium's
    // LaunchProcess then dies on PCHECK(SetHandleInformation(NULL, ...))
    // before the window exists. Two pipes are always valid handles.
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Pass the server's output on when there is somewhere to pass it; a
  // Windows app opened from a shortcut has no console, and a write that
  // fails there must not take the main process with it.
  const passOn = (target, chunk) => {
    try {
      target.write(chunk);
    } catch {
      /* no console to write to */
    }
  };
  child.stdout?.on("data", (chunk) => passOn(process.stdout, chunk));
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    passOn(process.stderr, chunk);
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  // what the server says to the app: banners and waiting counts
  // (server/desktop-notice.ts), heard for as long as this one runs
  child.on("message", (said) => heardFromServer(ws.id, child, said));

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  // First run on a fresh machine writes its data directories before it
  // listens, so this waits rather than assuming a fast start.
  let why = "slow";
  for (let attempt = 0; attempt < 40; attempt++) {
    if (exited) {
      // lost a race for the port after the check said it was free
      return { child: null, why: /EADDRINUSE/.test(stderr) ? "busy" : "exited", stderr };
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.app === "bloks" && body.pid === child.pid && body.static) return { child, lastWords: () => stderr };
        why = "other-server";
        break; // someone else answers here; try the next port
      }
    } catch {
      /* not listening yet */
    }
    await pause(500);
  }

  try {
    child.kill();
  } catch {
    /* already gone */
  }
  return { child: null, why, stderr };
}

/** Who is listening on a port, when the system will say. */
function portHolder(port) {
  if (process.platform === "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fcp"], { timeout: 3000 }, (_error, stdout) =>
      resolve(parseLsof(stdout)),
    );
  });
}

const LAST_PORT_FILE = () => path.join(app.getPath("userData"), "server-port.json");

function readLastPort() {
  try {
    return JSON.parse(fs.readFileSync(LAST_PORT_FILE(), "utf8")).port ?? null;
  } catch {
    return null;
  }
}

/** The server that holds a data folder, when ours refused to start beside it. */
function dataFolderHolder(stderr) {
  const found = /DATA_FOLDER_IN_USE pid=(\d+) port=(\d+)/.exec(stderr ?? "");
  return found ? { pid: Number(found[1]), port: Number(found[2]) } : null;
}

/** The ports to try for a workspace. Personal keeps the order it always
 * had (BLOKS_PORT, its config.json, the last port, then the usual three),
 * because a phone paired on this network remembers that port. The others
 * go to the port each had last, or one of its config.json, or any free
 * one, and leave the usual three to Personal. */
function portsFor(ws, prefer) {
  if (ws.kind === "personal") {
    return portOrder({ prefer, env: process.env.BLOKS_PORT, configured: configuredPort(ws.dataDir), last: readLastPort() ?? ws.port });
  }
  return portOrder({ prefer, configured: configuredPort(ws.dataDir), last: ws.port, usual: [] });
}

/** The folder a person would recognise, for the failure page. */
const shownFolder = (dir) => {
  const home = os.homedir();
  return dir && dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : (dir ?? "");
};

/** Starts a workspace's server, trying each port in turn. `prefer` goes
 * first, and `rounds` is how many sweeps of the ports it gets. Answers
 * whether it came up; `run` holds the server, or why there is none. */
async function startServer(run, { prefer = null, rounds = 2 } = {}) {
  const attempts = [];
  let crash = "";
  // Another Bloks server already using this data folder, as the server
  // reports it (server/data-lock.ts). Another port would not help: it is
  // the folder that is taken, and two servers on it undo each other's work.
  let inUse = null;
  // Quit-and-reopen can race the previous instance's teardown, so the
  // whole sweep is tried twice before giving up; a folder still held is
  // given a few more rounds, since that is most often the last instance
  // on its way out.
  for (let round = 0; round < (inUse ? 5 : rounds); round++) {
    const ws = entryOf(run.id);
    if (!ws || run.stopped) return false;
    inUse = null;
    const ports = portsFor(ws, prefer);
    // every usual port busy is not the end: any free port will do
    const spare = await anyFreePort();
    if (spare) ports.push(spare);
    for (const port of ports) {
      if (!(await portFree(port))) {
        if (round === rounds - 1) attempts.push({ port, why: "busy", holder: await portHolder(port) });
        continue;
      }
      const started = await startServerOn(port, ws);
      if (started.child) {
        run.child = started.child;
        run.port = port;
        run.lastWords = started.lastWords;
        run.failure = null;
        run.problem = null;
        run.child.once("exit", () => {
          // on its way back (keepServerUp), unless this is the end
          if (run.child === started.child && !quitting && !run.stopped) setStatus(run, "starting");
        });
        rememberPort(ws, port);
        return true;
      }
      if (started.why === "exited" && started.stderr) crash = started.stderr;
      inUse = dataFolderHolder(started.stderr);
      if (inUse) break;
      if (round === rounds - 1) attempts.push({ port, why: started.why, holder: null });
    }
    await pause(2500);
  }
  const ws = entryOf(run.id);
  run.failure = failurePage({
    attempts,
    crash,
    inUse,
    folder: shownFolder(ws?.dataDir),
    backdrop: DARK_BACKDROP,
    machine: process.platform === "darwin" ? "Mac" : "computer",
  });
  run.problem = inUse
    ? "Another Bloks server is using its folder."
    : crash
      ? "Its server stopped while starting."
      : "No free port to start it on.";
  return false;
}

/** The port a workspace came up on, kept so its window's storage (which
 * belongs to the origin, port included) and a phone on this network find
 * it in the same place next time. */
function rememberPort(ws, port) {
  if (ws.kind === "personal") {
    try {
      fs.writeFileSync(LAST_PORT_FILE(), JSON.stringify({ port }));
    } catch {
      /* next launch simply starts from the usual ports */
    }
  }
  if (ws.port !== port) {
    registry = updateWorkspace(registry, ws.id, { port });
    saveRegistry();
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each workspace's server as this app knows it: its process and port,
 * whether it is up, and why not when it is not. */
const servers = new Map();

function runFor(id) {
  let run = servers.get(id);
  if (run) return run;
  run = { id, child: null, port: null, status: "stopped", problem: null, failure: null, lastWords: () => "", stopped: false, ready: null, keeper: null };
  // A server that dies after it started is brought back, on the port it
  // had when that is free; see electron/server-life.mjs. Each try is one
  // sweep of the ports, and a server that keeps dying is marked as
  // failed in the switcher, and on the page when it is the one shown,
  // instead of a window calling a port nobody answers on.
  run.keeper = keepServerUp({
    quitting: () => quitting || run.stopped,
    start: async () => ((await startServer(run, { prefer: run.port, rounds: 1 })) ? run.child : null),
    onBack: () => {
      setStatus(run, "running");
      pointWindows(run.id);
    },
    onGaveUp: () => {
      // the last try that failed to start already says why; otherwise the
      // last one started and died like the rest
      run.failure ??= failurePage({
        attempts: [],
        crash: run.lastWords(),
        stopped: true,
        backdrop: DARK_BACKDROP,
        machine: process.platform === "darwin" ? "Mac" : "computer",
      });
      run.problem ??= "Its server kept stopping.";
      setStatus(run, "failed");
      pointWindows(run.id);
    },
  });
  servers.set(id, run);
  return run;
}

function setStatus(run, status) {
  if (run.status === status) return;
  run.status = status;
  tellWorkspaces();
}

/** Brings a workspace's server up, or answers the start already under
 * way. Resolves true once it answers, false when it would not start. */
function launch(id) {
  const run = runFor(id);
  if (run.status === "running") return Promise.resolve(true);
  if (run.status === "starting" && run.ready) return run.ready;
  run.stopped = false;
  run.problem = null;
  setStatus(run, "starting");
  const ws = entryOf(id);
  run.ready = (ws?.kind === "joined" ? openJoined(run, ws) : startServer(run)).then((up) => {
    if (up && run.child && ws?.kind !== "joined") run.keeper.watch(run.child);
    setStatus(run, up ? "running" : "failed");
    return up;
  });
  return run.ready;
}

/** Stops one workspace's server for good (it is being deleted). */
async function halt(id) {
  const run = servers.get(id);
  if (!run) return;
  run.stopped = true;
  if (run.proxy) run.proxy.stop();
  await stopServer(run.child);
  servers.delete(id);
}

/** Every server this app runs, stopped together: quitting, an update, or
 * handing over to a computer elsewhere. */
function stopAllServers() {
  return Promise.allSettled([...servers.values()].map((run) => (run.proxy ? run.proxy.stop() : stopServer(run.child))));
}

/** The servers that are up, for things every workspace has to hear. */
const runningServers = () => [...servers.values()].filter((run) => run.status === "running" && run.port && !run.proxy);


// ── workspaces ─────────────────────────────────────────────────────────
// The list of them lives in the app's own folder (electron/workspaces.mjs
// has its rules). The window shows one at a time; switching points it at
// another workspace's server, which is already running, so a switch is a
// page load on loopback and nothing more.

/** The list, once read. Null in a run that starts no servers of its own
 * (`pnpm dev`, or a Bloks on another computer), which has no workspaces. */
let registry = null;
/** The workspace the window shows. Usually the one last chosen; another
 * one when that one would not start, so the app still opens. */
let shownId = PERSONAL_ID;
/** Added to the next window's address: a workspace just made opens on
 * its first-run welcome rather than on the film (App.tsx). */
let welcomeQuery = "";

const REGISTRY_FILE = () => path.join(app.getPath("userData"), "workspaces.json");
/** Where the workspaces made in the app keep their data, one folder each. */
const workspacesDir = () => path.join(app.getPath("userData"), "workspaces");
const LOGOS_DIR = () => path.join(app.getPath("userData"), "workspace-logos");

/** Personal's folder: the one Bloks always used, which BLOKS_DATA_DIR
 * can move (server/config.ts dataDirFrom says the same). */
function personalDataDir() {
  const said = process.env.BLOKS_DATA_DIR?.trim();
  if (!said) return path.join(os.homedir(), ".bloks");
  if (said === "~") return os.homedir();
  return said.startsWith("~/") ? path.join(os.homedir(), said.slice(2)) : path.resolve(said);
}

const entryOf = (id) => registry?.workspaces.find((w) => w.id === id) ?? null;

function saveRegistry() {
  try {
    writeRegistry(REGISTRY_FILE(), registry);
  } catch (error) {
    // the list in memory is still right for this run; the next change
    // tries the disk again
    console.error("[workspaces] could not save the list:", error?.message ?? error);
  }
}

/** The main window, when there is one. */
const mainWindow = () => BrowserWindow.getAllWindows().find((w) => isWorkspaceWindow(w)) ?? null;

/** Reads the list (writing Personal into it on the first run), and
 * brings up the workspace last chosen. One that will not start is not
 * the end of the app: the next one that does is shown instead, and the
 * switcher says what happened to the first. */
async function openWorkspaces() {
  registry = settle(readRegistry(REGISTRY_FILE()), { personalDataDir: personalDataDir() });
  saveRegistry();
  shownId = registry.current;
  if (await launch(shownId)) return;
  for (const ws of registry.workspaces) {
    if (ws.id === shownId || ws.kind === "joined") continue;
    if (await launch(ws.id)) {
      shownId = ws.id;
      return;
    }
  }
}

/** The rest of the workspaces, a few at a time: one after another made
 * the last of five wait half a minute for its routines, and all at once
 * would make the first minute of a launch a crowd. */
async function launchTheRest() {
  const waiting = registry.workspaces.filter((ws) => ws.kind !== "joined" && !servers.has(ws.id)).map((ws) => ws.id);
  const lane = async () => {
    while (waiting.length && !quitting) await launch(waiting.shift());
  };
  await Promise.all([lane(), lane(), lane()]);
}

/** A logo as the window can draw it: the window's page is on a loopback
 * origin and cannot read a file path, so it gets the picture itself. */
const logoCache = new Map();
function logoData(ws) {
  if (!ws.logo) return null;
  const cached = logoCache.get(ws.id);
  if (cached?.file === ws.logo) return cached.data;
  try {
    const data = `data:image/png;base64,${fs.readFileSync(ws.logo).toString("base64")}`;
    logoCache.set(ws.id, { file: ws.logo, data });
    return data;
  } catch {
    return null;
  }
}

function workspacesState() {
  if (!registry || remoteProfile) return { available: false };
  const live = {};
  for (const ws of registry.workspaces) {
    const run = servers.get(ws.id);
    live[ws.id] = {
      status: run?.status ?? "stopped",
      problem: run?.problem ?? null,
      waiting: waitingCounts.get(ws.id) ?? 0,
      logo: logoData(ws),
    };
  }
  return { ...snapshot(registry, live), current: shownId };
}

/** Every window hears the list again; anything the switcher draws may
 * have changed. A timed mute running out is a change too, so the next
 * one to end is waited for. */
let muteTimer = null;
function tellWorkspaces() {
  if (!registry) return;
  const state = workspacesState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("workspaces:state", state);
  }
  clearTimeout(muteTimer);
  const end = nextMuteEnd(registry.workspaces);
  if (end) {
    muteTimer = setTimeout(() => {
      tellWorkspaces();
      applyBadge();
    }, Math.min(end - Date.now() + 250, 2 ** 31 - 1));
    muteTimer.unref?.();
  }
}

/**
 * Shows another workspace in the window. Its server is already running
 * in the background, or is started now. The choice is remembered for the
 * next launch. `target` is a conversation to open once it has loaded,
 * from a banner's click; `welcome` is a workspace just made.
 */
async function switchWorkspace(id, { target = null, welcome = false } = {}) {
  const ws = entryOf(id);
  if (!ws) throw new Error("There is no such workspace.");
  if (!(await launch(id))) throw new Error(`${ws.name} would not start. ${servers.get(id)?.problem ?? ""}`.trim());
  const moved = shownId !== id;
  shownId = id;
  registry = setCurrent(registry, id);
  saveRegistry();
  pendingNotifyTarget = target;
  const win = mainWindow();
  if (!win) {
    welcomeQuery = welcome ? "welcome=workspace" : "";
    createWindow();
  } else {
    raise(win);
    if (moved || welcome) void showIn(win, id, welcome ? "welcome=workspace" : "");
    else if (target) {
      pendingNotifyTarget = null;
      win.webContents.send("notify:activate", { target });
    }
  }
  // the quick ask goes to the workspace you are in; the next one opens there
  if (moved && quickWin && !quickWin.isDestroyed()) quickWin.destroy();
  tellWorkspaces();
  applyBadge();
}

function noteMembers(id, count) {
  if (!entryOf(id)) return;
  registry = updateWorkspace(registry, id, { members: count });
  saveRegistry();
  tellWorkspaces();
}

/** Inside the app's workspaces folder, and only there: the one check
 * between a delete and a folder that is not ours to delete. */
function insideWorkspacesDir(dir) {
  if (!dir) return false;
  const rel = path.relative(workspacesDir(), dir);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.includes(path.sep);
}

// ── a workspace joined on someone else's computer ─────────────────────
// The joining itself (an invite's code, the claim, the owner's approval)
// is the members work's. What lands here is its result: the member's
// credentials, kept in the keychain like remote.bin, and an entry of kind
// "joined" in the list. Opening one starts the remote proxy
// (electron/remote.mjs) with those credentials, so the window loads it
// like any other workspace.

const joinedFile = (id) => path.join(app.getPath("userData"), `joined-${id}.bin`);

function readJoinedProfile(id) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const profile = JSON.parse(safeStorage.decryptString(fs.readFileSync(joinedFile(id))));
    return profile?.deviceId && profile.deviceToken && profile.relayUrl ? profile : null;
  } catch {
    return null;
  }
}

/** Adds a joined workspace to the list, keeping its credentials in the
 * keychain. For the members work to call once an invite is approved;
 * answers the new entry. */
export function addJoinedWorkspace(profile, { name, mark = null, team = true } = {}) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer cannot keep the membership safely, so it was not saved.");
  const id = `ws_${Date.now().toString(36)}`;
  fs.writeFileSync(joinedFile(id), safeStorage.encryptString(JSON.stringify(profile)), { mode: 0o600 });
  registry = { ...registry, workspaces: [...registry.workspaces, { id, kind: "joined", name, team, mark, logo: null, dataDir: null, mute: null, notify: "all", order: registry.workspaces.length, port: null, accent: null, members: null, createdAt: Date.now(), host: { name: profile.host ?? "", relayUrl: profile.relayUrl } }] };
  registry = settle(registry, { personalDataDir: personalDataDir() });
  saveRegistry();
  tellWorkspaces();
  return entryOf(id);
}

async function openJoined(run, ws) {
  const profile = readJoinedProfile(ws.id);
  if (!profile) {
    run.problem = "Its membership could not be read on this computer.";
    return false;
  }
  try {
    const system = { darwin: "macOS", win32: "Windows", linux: "Linux" }[process.platform] ?? process.platform;
    run.proxy = await startRemoteProxy(profile, {
      staticDir: serverSource().ui,
      client: `${system} ${app.getVersion()}`,
      port: ws.port ?? 0,
    }).catch(() => startRemoteProxy(profile, { staticDir: serverSource().ui, client: `${system} ${app.getVersion()}`, port: 0 }));
    run.port = run.proxy.port;
    rememberPort(ws, run.port);
    return true;
  } catch (error) {
    run.problem = `Could not reach ${ws.host?.name || "its computer"}: ${error?.message ?? error}`;
    return false;
  }
}

// ── what the window asks about workspaces ─────────────────────────────

/** IPC answers are values, not throws: a thrown error reaches the page
 * wrapped in Electron's own words, and the page shows these. */
const answer = async (work) => {
  try {
    return (await work()) ?? { ok: true };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
};

const needsList = () => {
  if (!registry) throw new Error("Workspaces work in the installed app.");
};

handle("workspaces:state", () => workspacesState());

handle("workspaces:switch", (_event, id) =>
  answer(async () => {
    needsList();
    await switchWorkspace(String(id));
  }),
);

handle("workspaces:create", (_event, input) =>
  answer(async () => {
    needsList();
    const made = addWorkspace(
      registry,
      { kind: input?.kind, name: input?.name, team: input?.team === true, mark: input?.mark ?? null },
      { workspacesDir: workspacesDir() },
    );
    fs.mkdirSync(made.entry.dataDir, { recursive: true, mode: 0o700 });
    registry = made.registry;
    saveRegistry();
    tellWorkspaces();
    await switchWorkspace(made.entry.id, { welcome: true });
    return { ok: true, id: made.entry.id };
  }),
);

handle("workspaces:update", (_event, id, patch) =>
  answer(() => {
    needsList();
    const allowed = {};
    for (const key of ["name", "kind", "team", "notify", "mark"]) if (patch?.[key] !== undefined) allowed[key] = patch[key];
    registry = updateWorkspace(registry, String(id), allowed);
    saveRegistry();
    tellWorkspaces();
    applyBadge();
  }),
);

handle("workspaces:reroll", (_event, id) =>
  answer(() => {
    needsList();
    registry = rerollMark(registry, String(id));
    saveRegistry();
    tellWorkspaces();
  }),
);

handle("workspaces:mute", (_event, id, choice) =>
  answer(() => {
    needsList();
    registry = updateWorkspace(registry, String(id), { mute: muteFor(choice === "off" ? "off" : String(choice)) });
    saveRegistry();
    tellWorkspaces();
    applyBadge();
  }),
);

handle("workspaces:retry", (_event, id) =>
  answer(async () => {
    needsList();
    const run = servers.get(String(id));
    if (run?.status === "failed") run.status = "stopped";
    if (!(await launch(String(id)))) throw new Error(servers.get(String(id))?.problem ?? "It would not start.");
    // the window was showing why it would not start; show it now
    if (String(id) === shownId) pointWindows(shownId);
  }),
);

handle("workspaces:reorder", (_event, ids) =>
  answer(() => {
    needsList();
    registry = reorder(registry, Array.isArray(ids) ? ids.map(String) : []);
    saveRegistry();
    tellWorkspaces();
  }),
);

handle("workspaces:delete", (_event, id) =>
  answer(async () => {
    needsList();
    const ws = entryOf(String(id));
    if (!ws) throw new Error("There is no such workspace.");
    if (ws.kind === "personal") throw new Error("Personal cannot be deleted.");
    // out of it first, so nothing is showing a workspace on its way out
    if (shownId === ws.id) await switchWorkspace(PERSONAL_ID);
    await halt(ws.id);
    registry = removeWorkspace(registry, ws.id).registry;
    saveRegistry();
    waitingCounts.delete(ws.id);
    // To the Trash rather than gone: a workspace is months of someone's
    // work, and a wrong click should cost a trip to the Trash, not that.
    // Only ever a folder the app made for it, never Personal's.
    if (insideWorkspacesDir(ws.dataDir)) {
      for (const dir of [ws.dataDir, `${ws.dataDir}-backups`]) {
        if (fs.existsSync(dir)) await shell.trashItem(dir).catch(() => fs.rmSync(dir, { recursive: true, force: true }));
      }
    }
    if (ws.kind === "joined") fs.rmSync(joinedFile(ws.id), { force: true });
    if (ws.logo) fs.rmSync(ws.logo, { force: true });
    tellWorkspaces();
    applyBadge();
  }),
);

/** A logo instead of the mark: picked with the system's own picker, cut
 * to a square from its middle, and kept small beside the list. */
handle("workspaces:logo-pick", (event, id) =>
  answer(async () => {
    needsList();
    const ws = entryOf(String(id));
    if (!ws) throw new Error("There is no such workspace.");
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp"] }],
    });
    if (canceled || !filePaths[0]) return { ok: false };
    const image = nativeImage.createFromPath(filePaths[0]);
    if (image.isEmpty()) throw new Error("That file is not a picture Bloks can read.");
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const square = image
      .crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
      .resize({ width: 256, height: 256, quality: "best" });
    fs.mkdirSync(LOGOS_DIR(), { recursive: true });
    const file = path.join(LOGOS_DIR(), `${ws.id}-${Date.now().toString(36)}.png`);
    fs.writeFileSync(file, square.toPNG());
    if (ws.logo && ws.logo !== file) fs.rmSync(ws.logo, { force: true });
    registry = updateWorkspace(registry, ws.id, { logo: file });
    saveRegistry();
    tellWorkspaces();
  }),
);

handle("workspaces:logo-clear", (_event, id) =>
  answer(() => {
    needsList();
    const ws = entryOf(String(id));
    if (!ws) throw new Error("There is no such workspace.");
    if (ws.logo) fs.rmSync(ws.logo, { force: true });
    registry = updateWorkspace(registry, ws.id, { logo: null });
    saveRegistry();
    tellWorkspaces();
  }),
);

/** How many people a team workspace has, from its Members page (or its
 * server, heardFromServer), for the switcher's count. The members work
 * calls this; nothing here counts people itself. */
handle("workspaces:members", (event, count) => {
  const id = senderWorkspace(event);
  if (id && Number.isInteger(count) && count >= 0) noteMembers(id, count);
});

// The theme is the person's, so it follows them into every workspace;
// the accent is the workspace's, so each one can look like itself
// (src/lib/accent.ts). Both are kept here as well as in the page's own
// storage: storage belongs to an origin, every workspace is an origin of
// its own, and a port that moves would forget it. The preload hands both
// back before the page draws (workspaces:boot).
handle("prefs:theme", (_event, theme) => {
  if (!registry || !["light", "dark", "system"].includes(theme)) return;
  registry = { ...registry, prefs: { ...registry.prefs, theme } };
  saveRegistry();
});
handle("prefs:accent", (event, accent) => {
  const id = senderWorkspace(event);
  if (!registry || !id || typeof accent !== "string") return;
  registry = updateWorkspace(registry, id, { accent });
  saveRegistry();
});

/** Asked by the preload, synchronously, before the page's own scripts
 * run, so the first frame is already in the right theme and accent. */
ipcMain.on("workspaces:boot", (event) => {
  // returnValue answers the moment it is set, so it is set once
  const ws = fromOurPage(event) && registry ? entryOf(senderWorkspace(event)) : null;
  event.returnValue = ws
    ? { theme: registry.prefs.theme, accent: ws.accent, workspace: { id: ws.id, kind: ws.kind, name: ws.name, mark: ws.mark } }
    : null;
});

// ── the window ─────────────────────────────────────────────────────────

const isHttpUrl = (url) => {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

// The app's own page is the exact origin of a server this app started and
// proved is its own (startServerOn), port included: one per workspace.
// Any page on localhost used to count, and agents run dev servers,
// notebooks and desktops on localhost: one of those loaded into the app
// window would have had the preload's bridge (pairing a remote, Touch ID,
// the screen). A server on its way back after dying is not counted until
// it has proved itself again, since its old port is anybody's meanwhile.
function ownOrigins() {
  const own = [];
  if (remoteProfile && remotePort) own.push(`http://127.0.0.1:${remotePort}`);
  else if (!HOSTS_SERVERS) own.push(DEV_URL);
  for (const run of servers.values()) {
    if (run.status === "running" && run.port) own.push(`http://127.0.0.1:${run.port}`);
  }
  return own;
}
const isOurOwnPage = (url) => ownOrigins().some((own) => sameAppOrigin(url, own));

/** The workspace whose server served this origin, or null. */
function workspaceAt(origin) {
  for (const run of servers.values()) {
    if (run.status === "running" && run.port && sameAppOrigin(origin, `http://127.0.0.1:${run.port}`)) return run.id;
  }
  return null;
}

/** The workspace of the page that sent an IPC call. */
const senderWorkspace = (event) => workspaceAt(event?.senderFrame?.origin ?? "") ?? (HOSTS_SERVERS ? null : shownId);

/** Only the app's own page may use the bridge: the top frame of one of
 * its windows, judged by the frame's real origin. A frame inside the page
 * (an artifact, an app, an agent's desktop) has its own origin, and a
 * sandboxed one says "null", so neither passes. */
const fromOurPage = (event) => {
  const frame = event?.senderFrame;
  if (!frame || frame !== event.sender?.mainFrame) return false;
  return isOurOwnPage(frame.origin ?? "");
};

/** ipcMain.handle, answering only the app's own page (fromOurPage). Every
 * bridge goes through this, so a new one cannot forget the check. */
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOurPage(event)) throw new Error("not from the app");
    return fn(event, ...args);
  });
}

/** The same rules for every window that loads the app: links go to the
 * real browser, and the window itself never leaves the app's origin. */
function guardNavigation(target) {
  target.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  target.webContents.on("will-navigate", (event, url) => {
    if (isOurOwnPage(url)) return; // the app reloading itself
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  });
  // A compromised renderer must not be able to grow itself new surfaces.
  target.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

/**
 * Right-click, the way native apps mean it.
 *
 * Electron ships no context menu at all, so without this a right-click
 * in the composer does nothing: no Paste, no spelling fixes. The menu
 * is built from what was actually clicked, and when nothing there is
 * actionable, no menu appears rather than a column of grey items.
 */
function installContextMenu(win) {
  win.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable && !params.selectionText && !params.linkURL && !params.misspelledWord)
      return;
    const items = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion),
        });
      }
      if (items.length) items.push({ type: "separator" });
    }
    if (params.linkURL) {
      items.push(
        { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" },
      );
    }
    if (params.isEditable) {
      items.push(
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "pasteAndMatchStyle", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else {
      items.push({ role: "copy", enabled: params.editFlags.canCopy });
    }
    Menu.buildFromTemplate(items).popup({ window: win, frame: params.frame });
  });
}

// ── where the window was ───────────────────────────────────────────────

const windowStateFile = () => path.join(app.getPath("userData"), "window-state.json");

function readWindowState() {
  try {
    return fs.readFileSync(windowStateFile(), "utf8");
  } catch {
    return null; // first run, or the file was cleaned away
  }
}

/** Written whole and renamed into place, so a crash mid-save leaves the
 * previous state rather than half a JSON object. */
function writeWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const file = windowStateFile();
  const staging = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      staging,
      JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }),
    );
    fs.renameSync(staging, file);
  } catch {
    fs.rmSync(staging, { force: true });
  }
}

/** Every resize and move schedules a save; the debounce means a drag is
 * one write, not hundreds. Close flushes so the last position wins. */
function persistWindowState(win) {
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    writeWindowState(win);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };
  for (const event of ["resize", "move", "maximize", "unmaximize"]) win.on(event, schedule);
  win.on("close", flush);
}

/**
 * Where the three window buttons sit.
 *
 * The cluster is 52px wide (three 12px buttons, 20px apart). It sits in
 * the 44px title bar (TitleBar.tsx), y:16 centring the 12px buttons in
 * it, and reaches past the slim 56px main rail below (AppRail.tsx); the
 * title bar keeps 78px clear for it before its own buttons. macOS
 * forgets this position on its own: leaving full screen, changing
 * display scale and some resizes all reset it, which is how the green
 * button ends up back over the divider after a while. So it is applied
 * again on each of those, rather than only at creation.
 */
const BUTTONS = { x: 16, y: 16 };

function keepButtonsInPlace(win) {
  if (process.platform !== "darwin") return;
  const apply = () => {
    if (win.isDestroyed() || win.isFullScreen()) return;
    try {
      win.setWindowButtonPosition(BUTTONS);
    } catch {
      /* older macOS, or a window without a hidden titlebar */
    }
  };
  for (const event of ["leave-full-screen", "enter-full-screen", "resize", "focus", "show"]) {
    win.on(event, () => setTimeout(apply, 120));
  }
  apply();
}

// ── the quick ask ─────────────────────────────────────────────────────
// A one-line window that appears over whatever you are doing, sends a
// message to an agent, and gets out of the way. It is the difference
// between an app you open and one you use: the thought arrives while you
// are in another window, and going to find Bloks first is where most of
// them die.

let quickWin = null;
let quickAccelerator = null;

/** What a window shows while its workspace's server is still starting:
 * the app's own backdrop and its name, rather than an error page. */
function openingPage(name) {
  const dark = nativeTheme.shouldUseDarkColors;
  const said = String(name ?? "Bloks").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:${dark ? DARK_BACKDROP : LIGHT_BACKDROP};color:${dark ? "#8f8f99" : "#68686f"};font:13px -apple-system,system-ui">Opening ${said}…</body>`,
    )
  );
}

/** Where a window showing workspace `id` points: its server, the page
 * saying it is starting, or the page saying why it will not. */
function appUrl(query = "", id = shownId) {
  let base;
  if (remoteProfile) base = `http://127.0.0.1:${remotePort}`;
  else if (!HOSTS_SERVERS) base = DEV_URL;
  else {
    const run = servers.get(id);
    base =
      run?.status === "running" && run.port
        ? `http://127.0.0.1:${run.port}`
        : run?.status === "failed" && run.failure
          ? run.failure
          : openingPage(entryOf(id)?.name);
  }
  if (!query || !base.startsWith("http")) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

/** Which workspace each window shows: the main window the one you are
 * in, a terminal the one it came out of, the quick ask the one that was
 * current when it opened. */
const windowWorkspace = new WeakMap();

function showIn(win, id, query = "") {
  windowWorkspace.set(win, id);
  return win.loadURL(appUrl(query, id)).catch(() => {});
}

/** The windows of workspace `id` at the app again, after its server came
 * back (perhaps on another port), or at the failure page once it will
 * not. The app keeps nothing in its address, so loading it afresh loses
 * nothing a reload would keep. */
function pointWindows(id) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || (windowWorkspace.get(win) ?? shownId) !== id) continue;
    // a server that died again at once fails the load, and the next try
    // or the failure page points the window again
    const query = win === quickWin ? "quick=1" : (terminalWins.get(win) ?? "");
    void showIn(win, id, query);
  }
}

function quickWindow() {
  if (quickWin && !quickWin.isDestroyed()) return quickWin;
  quickWin = new BrowserWindow({
    width: 620,
    height: 190,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    // Over full-screen apps too, and never in the app switcher: this is a
    // panel, not a second window of the app.
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(HERE, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  quickWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // it loads the same page, with the same bridge, so the same guards
  guardNavigation(quickWin);
  installContextMenu(quickWin);
  void showIn(quickWin, shownId, "quick=1");
  // Clicking away is a dismissal. Anything else would leave a floating
  // box on somebody's screen with no obvious way to close it.
  quickWin.on("blur", () => quickWin?.hide());
  quickWin.on("closed", () => {
    quickWin = null;
  });
  return quickWin;
}

// ── a terminal window ─────────────────────────────────────────────────
// An agent's terminal, popped out of the conversation into a window of
// its own: the same page, loaded with ?terminal=<agent>, which draws
// nothing but that agent's terminal (App.tsx). One per agent; asking again
// brings the one already open forward. Each remembers its query so a
// server restart can point it back at the same terminal.

/** Terminal windows, and the query each one loads. */
const terminalWins = new Map();

/** The main workspace window, rather than the quick ask panel or a
 * terminal of its own: the one links, menu commands and the Dock icon
 * are for. */
function isWorkspaceWindow(win) {
  return Boolean(win) && !win.isDestroyed() && win !== quickWin && !terminalWins.has(win);
}

function openTerminalWindow(botId, workspace = shownId) {
  const query = terminalQuery(botId);
  if (!query) throw new Error("not an agent");
  for (const [win, has] of terminalWins) {
    if (has === query && windowWorkspace.get(win) === workspace && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
  }
  const parent = BrowserWindow.getAllWindows().find((w) => isWorkspaceWindow(w));
  const near = parent?.getBounds();
  const win = new BrowserWindow({
    width: 900,
    height: 560,
    // a little down and across from the window it came out of
    ...(near ? { x: near.x + 48, y: near.y + 48 } : {}),
    minWidth: 420,
    minHeight: 240,
    icon: APP_ICON,
    title: "Terminal",
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BACKDROP : LIGHT_BACKDROP,
    // the same settings as the main window, written out for the same
    // reason: this page draws a shell, and a shell's output is somebody
    // else's text
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      preload: path.join(HERE, "preload.cjs"),
    },
  });
  terminalWins.set(win, query);
  win.on("closed", () => terminalWins.delete(win));
  guardNavigation(win);
  installContextMenu(win);
  void showIn(win, workspace, query);
}

function toggleQuickAsk() {
  const win = quickWindow();
  if (win.isVisible()) return win.hide();
  // Near the top of whichever display the pointer is on, the way every
  // launcher does it, rather than the middle of the primary screen.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  win.setPosition(Math.round(x + width / 2 - 310), Math.round(y + 140));
  win.showInactive();
  win.focus();
  win.webContents.send("quick:opened");
}

/** Registers the hotkey, or clears it. Returns what actually took. */
function applyQuickShortcut(accelerator) {
  if (quickAccelerator) {
    try {
      globalShortcut.unregister(quickAccelerator);
    } catch {}
    quickAccelerator = null;
  }
  if (!accelerator) return null;
  try {
    // register returns false when another app already owns the keys,
    // which the settings screen reports rather than silently ignoring
    const ok = globalShortcut.register(accelerator, toggleQuickAsk);
    quickAccelerator = ok ? accelerator : null;
    return quickAccelerator;
  } catch {
    return null;
  }
}

function createWindow() {
  // Open where the window was last time, resolved against the displays
  // that exist right now; a saved position on an unplugged monitor
  // re-centres instead of restoring off-screen. First run falls back to
  // fitting the primary display, never exceeding it: a window taller
  // than the screen puts the composer below the bottom edge, which
  // reads as "the app has no way to type" rather than "too big".
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((d) => d.id !== primary.id);
  const restored = resolveWindowState(
    readWindowState(),
    [primary, ...others].map((d) => d.workArea),
  );
  const { width: screenW, height: screenH } = primary.workAreaSize;

  const win = new BrowserWindow({
    ...restored.bounds,
    // never larger than the screen, whatever the minimum would prefer
    minWidth: Math.min(900, screenW),
    minHeight: Math.min(600, screenH),
    icon: APP_ICON,
    // Painted before the renderer has anything, so it should match where
    // the app is about to land. The in-app theme follows the system by
    // default, which makes this right nearly always.
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BACKDROP : LIGHT_BACKDROP,
    titleBarStyle: "hiddenInset",
    // macOS draws its three buttons as a 52px cluster. The main rail has
    // to be wider than that plus both insets, or the green one sits on the
    // panel's edge; see BUTTONS below for the arithmetic.
    trafficLightPosition: BUTTONS,
    webPreferences: {
      // Written out rather than inherited: these are the settings that
      // decide whether a page an agent produced can reach the machine, and
      // a default that changes between Electron versions should not be
      // able to change that quietly.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      preload: path.join(HERE, "preload.cjs"),
    },
  });
  keepButtonsInPlace(win);
  installContextMenu(win);
  if (process.platform !== "darwin") {
    // Zoom and devtools without the stock menu bar, which used to own
    // their accelerators. macOS keeps its menu and its roles instead.
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type !== "keyDown") return;
      const isZoomIn = input.control && (input.key === "=" || input.key === "+");
      if (isZoomIn) {
        win.webContents.setZoomLevel(Math.min(win.webContents.getZoomLevel() + 0.5, 5));
        return;
      }
      const isZoomOut = input.control && input.key === "-";
      if (isZoomOut) {
        win.webContents.setZoomLevel(Math.max(win.webContents.getZoomLevel() - 0.5, -4));
        return;
      }
      const isZoomReset = input.control && input.key === "0";
      if (isZoomReset) {
        win.webContents.setZoomLevel(0);
        return;
      }
      const isDevtools =
        input.control && input.shift && input.key.toLowerCase() === "i";
      // devtools without a menu bar: the stock View menu was the only
      // way in, and packaged builds have no use for it
      if (isDevtools && !app.isPackaged) win.webContents.toggleDevTools();
    });
  }
  persistWindowState(win);
  if (restored.maximized) win.maximize();

  // Links in this app come from models and from web pages the agent read,
  // so every URL is treated as hostile until proven to be plain http(s):
  // those open in the real browser, and everything else is dropped. The
  // app frame itself never navigates anywhere but its own origin.
  guardNavigation(win);

  void showIn(win, shownId, welcomeQuery);
  welcomeQuery = "";
  return win;
}

// ── permissions the web layer cannot ask for ───────────────────────────

handle("screen:frame", async (event) => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 800 },
  });
  return sources[0]?.thumbnail.toDataURL() ?? null;
});

handle("perm:status", () => ({
  mic: systemPreferences.getMediaAccessStatus?.("microphone") ?? "unknown",
  screen: systemPreferences.getMediaAccessStatus?.("screen") ?? "unknown",
}));

handle("perm:request-mic", async () => {
  try {
    return await systemPreferences.askForMediaAccess("microphone");
  } catch {
    return false;
  }
});

/**
 * Screen Recording has no request API, and an app does not even appear in
 * the System Settings pane until macOS has seen it attempt a capture.
 * Electron's thumbnail call does not reliably register one on current
 * macOS, so a tiny signed helper calls CGRequestScreenCaptureAccess
 * directly. Being a child of this app, it inherits the app's identity, so
 * the prompt and the pane entry both say Bloks.
 */
handle("perm:request-screen", async () => {
  try {
    const helper = nativeHelper("perm-helper");
    await new Promise((resolve) => {
      execFile(helper, ["request"], { timeout: 15_000 }, () => resolve());
    });
  } catch {
    // No helper and no toolchain to build one. Report whatever macOS
    // already believes instead of failing the call.
  }
  return systemPreferences.getMediaAccessStatus?.("screen") ?? "unknown";
});

/** Once denied, macOS will not ask again. Deep-link to the exact pane. */
handle("perm:open-settings", (_event, pane) => {
  const panes = {
    mic: "Privacy_Microphone",
    screen: "Privacy_ScreenCapture",
    accessibility: "Privacy_Accessibility",
    speech: "Privacy_SpeechRecognition",
  };
  return shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${panes[pane] ?? "Privacy"}`,
  );
});

/**
 * A banner, and a way back to what it is about.
 *
 * The workspace on screen decides for itself whether anything is worth
 * showing (see src/lib/notify.ts), and a workspace in the background says
 * the same through its server (server/desktop-notice.ts, heard in
 * heardFromServer below). Either way this end shows it, because
 * Notification belongs to the main process and the click has to raise a
 * window the renderer cannot raise itself; and either way each
 * workspace's own mute and notification level have the last word.
 */
/** The banner each conversation currently has up, so a chatty agent
 * replaces its own banner rather than papering the corner of the screen
 * with copies. Keyed by workspace and target: one banner per
 * conversation. */
const standingBanners = new Map();

/** The agent's face for the banner, fetched from its workspace's server.
 * Answers null quickly and quietly whenever it cannot: an iconless banner
 * is fine, a banner that arrives late is not. */
async function bannerIcon(avatar, port) {
  if (typeof avatar !== "string" || !avatar.startsWith("/api/") || !port) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${avatar}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
}

/** Shows one banner for workspace `id`, if its mute and level allow a
 * notice of this weight. `open` runs on a click. */
async function showBanner(id, notice, open) {
  if (!Notification.isSupported()) return;
  const ws = id ? entryOf(id) : null;
  const level = notice?.urgent ? "needs-me" : "activity";
  // no list means a development run with one server, as before
  if (ws && !allowsNotice(ws, level)) return;
  const target = String(notice?.target ?? "");
  const run = id ? servers.get(id) : null;
  const icon = await bannerIcon(notice?.avatar, run?.port ?? null);
  const shown = new Notification({
    title: String(notice?.title ?? "Bloks").slice(0, 120),
    // which workspace, once there is more than one to tell apart
    ...(ws && registry.workspaces.length > 1 ? { subtitle: ws.name } : {}),
    body: String(notice?.body ?? "").slice(0, 400),
    silent: !notice?.urgent,
    ...(icon ? { icon } : {}),
  });
  // the previous banner from this conversation is old news now
  if (target) {
    const key = `${id ?? ""}:${target}`;
    standingBanners.get(key)?.close();
    standingBanners.set(key, shown);
    shown.on("close", () => {
      if (standingBanners.get(key) === shown) standingBanners.delete(key);
    });
  }
  shown.on("click", () => void open(target));
  shown.show();
}

/** Raises a window, the way a click on a banner or the Dock should. */
function raise(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  app.focus?.({ steal: true });
}

handle("notify:show", async (event, notice) => {
  const id = senderWorkspace(event);
  await showBanner(id, notice, (target) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // the page that asked may have moved to another workspace since
    if (win && !win.isDestroyed() && (windowWorkspace.get(win) ?? shownId) === id) {
      raise(win);
      win.webContents.send("notify:activate", { target });
    } else if (id) {
      void switchWorkspace(id, { target }).catch(() => {});
    }
  });
});

/** What a banner's click was about, for a window that loaded after the
 * click: switching workspaces loads the page afresh, and it asks for
 * this once it is listening, the way a link waits above. */
let pendingNotifyTarget = null;
handle("notify:pending", () => {
  const target = pendingNotifyTarget;
  pendingNotifyTarget = null;
  return target;
});

/**
 * What a workspace's server tells the app (server/desktop-notice.ts):
 * a banner for something it would have shown, and how many of its
 * conversations are waiting. The workspace on screen shows its own
 * banners from its page, so its server's are only used when no window
 * is showing it, with the app running in the Dock.
 */
function heardFromServer(id, child, said) {
  const run = servers.get(id);
  // a server from before a restart, still saying its last words
  if (!run || (run.child && run.child !== child)) return;
  if (said?.kind === "desktop.unread" && Number.isInteger(said.count)) {
    waitingCounts.set(id, Math.max(0, said.count));
    applyBadge();
    tellWorkspaces();
  } else if (said?.kind === "desktop.notice" && said.notice) {
    if (id === shownId && mainWindow()) return;
    const level = said.notice.level === "needs-me";
    void showBanner(id, { ...said.notice, urgent: level }, (target) => void switchWorkspace(id, { target }).catch(() => {}));
  } else if (said?.kind === "desktop.members" && Number.isInteger(said.count)) {
    // how many people are in a team workspace, from its own server, for
    // the switcher's "3 members" (the members work fills this in)
    noteMembers(id, said.count);
  }
}

/**
 * The Dock badge: what is waiting, across every workspace.
 *
 * The workspace on screen counts its own (the renderer owns that
 * arithmetic, because only it knows what counts as unread right now);
 * the others count on their servers. Each workspace's mute and level
 * decide whether its number is added at all. Windows has no badge, so it
 * gets a small overlay on the taskbar icon instead.
 */
let badgeOverlay = null;
/** The count the window on screen last reported. */
let shownCount = 0;
/** What each workspace's server last said is waiting. */
const waitingCounts = new Map();

function applyBadge() {
  let count = shownCount;
  if (registry) {
    const counts = {};
    for (const ws of registry.workspaces) {
      counts[ws.id] = ws.id === shownId && mainWindow() ? shownCount : (waitingCounts.get(ws.id) ?? 0);
    }
    count = badgeTotal(registry.workspaces, counts);
  }
  count = normalizeBadgeCount(count);
  if (process.platform === "win32") {
    const win = mainWindow();
    if (!win) return;
    badgeOverlay ??= nativeImage.createFromPath(APP_ICON).resize({ width: 16, height: 16 });
    win.setOverlayIcon(
      count > 0 && !badgeOverlay.isEmpty() ? badgeOverlay : null,
      count > 0 ? `${count} unread` : "",
    );
    return;
  }
  app.setBadgeCount(count);
}

handle("badge:set", (event, value) => {
  const id = senderWorkspace(event);
  // a terminal window of another workspace has no say over the one shown
  if (registry && id !== shownId) return;
  shownCount = normalizeBadgeCount(value);
  applyBadge();
});

/**
 * The real folder picker, for every place the app asks for a folder.
 * Typing a path stays possible; this is for everyone who should not
 * have to know what an absolute path is. Answers null on cancel.
 */
handle("dialog:pick-folder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"],
  });
  return canceled ? null : (filePaths[0] ?? null);
});

// The system share sheet, for a workspace invite's link: Messages, Mail,
// AirDrop, whatever this Mac has. Only an https link to bloks.dev is ever
// shared from here, so a page cannot dress anything else up as an invite.
// False where there is no share sheet (Windows, Linux), and the window
// copies the link instead.
handle("share:link", (event, url) => {
  if (process.platform !== "darwin" || typeof ShareMenu !== "function") return false;
  if (typeof url !== "string" || !/^https:\/\/bloks\.dev\/j\/[a-z0-9]{6}#[0-9A-Z~.:[\]-]{8,80}$/.test(url)) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  new ShareMenu({ urls: [url] }).popup({ window: win });
  return true;
});

// ── the About card's three questions ───────────────────────────────────
// What version am I, is there a newer one, and how do I get it. The
// updater itself runs on its own (see the whenReady block); these exist
// so a person can ask instead of waiting.

/**
 * Which kind of trouble an updater error is, so the About card can say
 * something true. A download or install that fails after the check went
 * through is not "didn't reach the server", and saying so sends people
 * looking at their wifi.
 */
function updateTrouble(message) {
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|net::ERR_|socket hang up|getaddrinfo/i.test(message)) {
    return "offline";
  }
  if (/latest-mac\.yml|ERR_UPDATER_(LATEST_VERSION_NOT_FOUND|CHANNEL_FILE_NOT_FOUND|NO_PUBLISHED_VERSIONS)|\b(403|429)\b|rate limit/i.test(message)) {
    return "server";
  }
  return "install";
}

/** Updater lines to ~/Library/Logs/Bloks/updater.log, trimmed at 1 MB. */
function updaterLogger() {
  const file = path.join(app.getPath("logs"), "updater.log");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.statSync(file, { throwIfNoEntry: false })?.size > 1_000_000) fs.rmSync(file);
  } catch {
    // no log is better than no updater
  }
  const write = (level) => (...parts) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${parts.map(String).join(" ")}\n`);
    } catch {
      // same
    }
  };
  return { info: write("info"), warn: write("warn"), error: write("error"), debug: write("debug") };
}

/** How often a running app looks for a newer release. */
const RECHECK_UPDATES_MS = 4 * 60 * 60 * 1000;

/** The last thing the updater said, replayed to windows that ask. */
let updaterState = { state: "idle" };
/** The wait for a drain before an update installs, while there is one. */
let drainWaiting = null;
/** The updater's log, once there is an updater. A restart into an update
 * writes its own steps there too, so one file tells the whole of it. */
let updaterLog = null;
/** Set at start when the last restart into an update came back on the
 * version it left (electron/update-restart.mjs), until the card that
 * says so is closed or the restart is tried again. */
let notInstalled = null;

/** The note of the version a restart is leaving, read at the next start. */
const INSTALL_MARK_FILE = () => path.join(app.getPath("userData"), "update-restart.json");

/** What the windows are told: the updater's state, and the update that
 * did not install while that is still to be said. */
const updateToShow = () => (notInstalled ? { ...updaterState, notInstalled } : updaterState);

function showUpdate(next) {
  updaterState = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("update:state", updateToShow());
  }
}

handle("app:version", () => app.getVersion());
handle("update:state", () => updateToShow());
handle("update:check", async () => {
  if (!app.isPackaged) return { state: "dev" };
  try {
    await electronUpdater.autoUpdater.checkForUpdates();
  } catch {
    // the error event has already told the windows
  }
  return updateToShow();
});
handle("update:not-installed-seen", () => {
  notInstalled = null;
  showUpdate(updaterState);
});
/** Before an update restarts Bloks, the harness finishes what is running
 * and starts nothing new, and this waits until it has or until its
 * deadline passes (server/drain.ts). Anything still running then is
 * picked up after the restart, and anything that arrived meanwhile waits
 * on disk. A harness that does not answer has nothing to wait for.
 * While it waits, the update card says what for, and can restart now or
 * call it off (electron/drain-wait.mjs). Answers how the wait ended. */
async function drainBeforeRestart() {
  // agents on another computer are that computer's to finish
  if (remoteProfile || !runningServers().length) return "done";
  // every workspace's server drains, and the wait is for the slowest
  // (mergeDrains in electron/workspaces.mjs)
  const askOne = async (port, method) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/maintenance/drain`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
        signal: AbortSignal.timeout(2000),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  const ask = async (method) => mergeDrains(await Promise.all(runningServers().map((run) => askOne(run.port, method))));
  drainWaiting = drainWait(ask, {
    onProgress: (state) =>
      showUpdate({ ...updaterState, draining: { running: state.running.length, deadline: state.deadline } }),
  });
  try {
    return await drainWaiting.finished;
  } finally {
    // however it ended: a wait left standing would turn away every later
    // press of the button
    drainWaiting = null;
    const { draining: _, ...rest } = updaterState;
    showUpdate(rest);
  }
}

/** On macOS the updater hands each download to the native installer,
 * which fetches and unpacks it again before it can install it, a few
 * seconds after the card already reads ready. A quit asked for in
 * between installs nothing. So a restart waits for the installer to have
 * what it was last handed, or to have said that it failed. */
let staging = false;
let stagingOver = () => {};
const nativelyStaged = () =>
  new Promise((resolve) => {
    if (!staging) return resolve();
    stagingOver = resolve;
  });

/** A restart asked for and on its way, so a second press joins it and
 * does not start another. */
let restart = null;

/** A line of the restart's own in the updater's log. */
const restartLog = (line) => updaterLog?.info(line);

// Every step has a time limit and none can stop the next, and once the
// drain is past the process ends: by an exit, if the quit does not get
// there (electron/update-restart.mjs).
handle("update:install", () => {
  if (!app.isPackaged) return;
  if (notInstalled) {
    // trying again is the answer to it
    notInstalled = null;
    showUpdate(updaterState);
  }
  restart ??= restartIntoUpdate(
    {
      // a newer release than the one downloaded is the one to restart
      // into (electron/update-check.mjs)
      look: () => newestBeforeInstall(electronUpdater.autoUpdater, { waiting: updaterState.version }),
      drain: drainBeforeRestart,
      mark: () => markInstall(INSTALL_MARK_FILE(), { from: app.getVersion(), to: updaterState.version }),
      staged: nativelyStaged,
      // same teardown as a normal quit, then the installer takes over
      quit: () => electronUpdater.autoUpdater.quitAndInstall(),
      // destroyed, not asked: asking is what did not work
      closeWindows: () => {
        const open = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
        for (const win of open) win.destroy();
        return open.length;
      },
      // exit skips before-quit, so the server is stopped here, as it is
      // where pairing restarts the app
      teardown: () => {
        quitting = true;
        return stopAllServers();
      },
      // Not relaunched. The installer starts the new version when the
      // quit got as far as telling it to, and a copy of this one started
      // now would be running inside the app it is about to replace.
      exit: () => app.exit(0),
    },
    { log: restartLog, from: app.getVersion(), to: updaterState.version },
  ).finally(() => {
    restart = null;
  });
  return restart;
});
handle("update:restart-now", () => drainWaiting?.stop("now"));
handle("update:later", () => drainWaiting?.stop("cancel"));

// Some settings only take effect at start, pairing above all: widening
// what the server listens on is deliberately not a live change. This is
// how the renderer offers to do the restart instead of asking somebody to
// find Quit and then find the app again. relaunch() schedules the new
// process; quit() then runs the normal teardown, daemon and all.
handle("app:relaunch", () => {
  app.relaunch();
  app.quit();
});

handle("shortcut:apply", (_event, accelerator) =>
  applyQuickShortcut(typeof accelerator === "string" && accelerator ? accelerator : null),
);
handle("quick:hide", () => quickWin?.hide());
handle("terminal:window", (event, botId) => openTerminalWindow(botId, senderWorkspace(event) ?? shownId));
handle("quick:open-main", () => {
  quickWin?.hide();
  const [main] = BrowserWindow.getAllWindows().filter((w) => isWorkspaceWindow(w));
  if (!main || main.isDestroyed()) return;
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  app.focus?.({ steal: true });
});

/**
 * Touch ID, for the few things that deserve it.
 *
 * A signed helper rather than a node module: LocalAuthentication needs
 * to be asked by the app itself for the prompt to carry the app's name,
 * which is the same reason the screen and dictation helpers exist. The
 * answer is one word, and "unavailable" is a normal answer rather than
 * an error: plenty of Macs have no sensor, and the caller decides what
 * that means rather than being handed an exception.
 */
function askHelper(args) {
  return new Promise((resolve) => {
    let helper;
    try {
      helper = nativeHelper("auth-helper");
    } catch {
      resolve("unavailable");
      return;
    }
    execFile(helper, args, { timeout: 130_000 }, (error, stdout) => {
      resolve(error ? "unavailable" : stdout.trim() || "unavailable");
    });
  });
}

handle("auth:status", () =>
  process.platform === "darwin" ? askHelper(["check"]) : Promise.resolve("unavailable"),
);

handle("auth:confirm", (_event, reason) => {
  if (process.platform !== "darwin") return "unavailable";
  const said = typeof reason === "string" ? reason.slice(0, 120) : "";
  return askHelper(["ask", said]);
});

handle("speech:start", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) startSpeech(win);
});
handle("speech:stop", () => stopSpeech());
handle("meeting:start", (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) startMeeting(win, { system: Boolean(options?.system) });
});
handle("meeting:stop", () => stopMeeting());

// ── lifecycle ──────────────────────────────────────────────────────────

/** Whatever the user saved last time, straight from the config file the
 * harness owns. Read rather than waited for: the hotkey should work
 * before anyone opens a window. */
async function restoreQuickShortcut() {
  try {
    // the hotkey is the person's, not a workspace's, so it is the one
    // Personal keeps, as it always was
    const raw = JSON.parse(fs.readFileSync(path.join(personalDataDir(), "config.json"), "utf8"));
    applyQuickShortcut(raw?.shortcuts?.quickAsk ?? null);
  } catch {
    // no config yet, which means no shortcut yet
  }
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock.setIcon(APP_ICON);

  // The stock File/Edit/View menu says nothing this app needs: it has its
  // own right-click menu for editing, and nothing else in the bar is
  // reachable from the UI. macOS keeps a menu: the hidden-inset titlebar
  // and the platform conventions expect one, and it is the stock one with
  // Settings added (electron/app-menu.mjs).
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(appMenuTemplate({ name: app.name, packaged: app.isPackaged, command: menuCommand })),
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  // getDisplayMedia in the renderer routed through here keeps the whole
  // capture inside the app's processes, which is the path macOS reliably
  // attributes to the app.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0] } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );

  // Electron grants permission requests by default. This app needs exactly
  // two, and the renderer shows untrusted content, so everything else is
  // refused explicitly rather than left to a default.
  const GRANTED = new Set(["media", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(GRANTED.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    GRANTED.has(permission),
  );

  // Must precede every fork below, or the children keep launchd's PATH.
  await adoptLoginShellPath();

  registerCuaIpc(handle);
  // Started before the window so the harness can read the connection
  // descriptor on its first turn. Failure is survivable: computer use
  // reports itself unavailable and everything else works.
  startCua().catch((error) => console.error("[cua] start failed:", error));

  if (app.isPackaged) {
    const remote = readRemoteProfile();
    if (remote) await startRemote(remote);
    else await openWorkspaces();
  } else if (HOSTS_SERVERS) {
    await openWorkspaces();
  }
  createWindow();
  // the others come up behind the window, one at a time, so the one you
  // are looking at never waits on them
  if (registry && !remoteProfile) void launchTheRest();
  // On Windows and Linux a link that opened Bloks is one of its own
  // arguments, and only a second launch's were ever read. It waits for
  // the window to ask, like any link that arrives while the page loads.
  const opening = linkInArgv(process.argv);
  if (opening) deliverLink(opening);

  // Update check, after the window exists so a prompt has somewhere to
  // land. Packaged builds only: a dev checkout updating itself from
  // GitHub releases would be chaos. Failures are logged and swallowed,
  // because "the update server was unreachable" is never worth
  // interrupting anyone over.
  if (app.isPackaged) {
    const { autoUpdater } = electronUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Every updater event folds into one state frame the renderer can
    // draw: the About card shows checking, downloading, ready or quiet,
    // and never has to know the updater's own event vocabulary.
    // One waiting to be installed goes on saying so through a look past
    // it (electron/update-check.mjs).
    const tellWindows = (event, detail) => {
      const next = updateFrame(updaterState, event, detail);
      if (next) showUpdate(next);
    };
    autoUpdater.on("checking-for-update", () => tellWindows("checking"));
    autoUpdater.on("update-available", (info) => tellWindows("available", { version: info?.version }));
    autoUpdater.on("update-not-available", () => tellWindows("not-available"));
    autoUpdater.on("download-progress", (progress) =>
      tellWindows("progress", { percent: Math.round(progress?.percent ?? 0) }),
    );
    autoUpdater.on("update-downloaded", (info) => tellWindows("downloaded", { version: info?.version }));
    if (process.platform === "darwin") {
      // each download goes to the native installer the moment the updater
      // has it (nativelyStaged, above)
      autoUpdater.on("update-downloaded", () => {
        staging = true;
      });
      for (const event of ["update-downloaded", "update-not-available", "error"]) {
        nativeUpdater.on(event, () => {
          staging = false;
          stagingOver();
        });
      }
      // Said when the quit is asked for, and again once every window has
      // closed and the installer is told: a log with only the first is a
      // window that would not close.
      nativeUpdater.on("before-quit-for-update", () => restartLog("restart: the native updater is quitting to install"));
    }
    // A Finder launch sends stdout to /dev/null, so the updater writes its
    // own log. Without it a failed update leaves nothing to read afterwards.
    updaterLog = updaterLogger();
    autoUpdater.logger = updaterLog;
    // A restart into an update that came back on the version it left is
    // said once, on the update card, with what to do about it.
    notInstalled = takeInstallMark(INSTALL_MARK_FILE(), app.getVersion());
    if (notInstalled) {
      updaterLog.warn(
        `restart: the install did not take, still on ${notInstalled.from}${notInstalled.to ? `, not ${notInstalled.to}` : ""}`,
      );
      showUpdate(updaterState);
    }
    autoUpdater.on("error", (error) => {
      const message = String(error?.message ?? error);
      console.error("[updater]", message);
      autoUpdater.logger.error(message);
      tellWindows("error", { reason: updateTrouble(message) });
    });
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    // Again every few hours. Most people leave Bloks open for days, and a
    // check only at launch meant they never heard about a release until
    // they happened to quit. Not while one is already downloading. One
    // waiting to be installed is looked past: a release since it came
    // down is the one to install (GitHub 247).
    setInterval(() => {
      // nor under a restart into one, which has its own look
      if (!mayLookAgain(updaterState) || restart) return;
      autoUpdater.checkForUpdates().catch(() => {});
    }, RECHECK_UPDATES_MS).unref?.();
  }

  void restoreQuickShortcut();
  watchPower();

  app.on("activate", () => {
    // the panel is not a window worth reopening the app for, and nor is
    // a terminal on its own: the workspace is what the Dock icon opens
    const windows = BrowserWindow.getAllWindows().filter((w) => isWorkspaceWindow(w));
    if (windows.length === 0) createWindow();
  });
});

// ── sleep ─────────────────────────────────────────────────────────────
// Two small things so a laptop is a better home for agents.
//
// While any agent is mid-turn, the Mac is kept from idle sleep: walking
// away from a long task should not end it. Only idle sleep. Closing the
// lid still sleeps the machine, which is macOS's call and the right one,
// and the lock is let go the moment nothing is working.
//
// And the harness is told when the machine sleeps and wakes, so a turn
// the sleep cut off is picked up again rather than left failed.
let awakeLock = null;

async function powerOn(port, state) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/power`, {
      method: state ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: state ? JSON.stringify({ state }) : undefined,
      signal: AbortSignal.timeout(2000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Every workspace's server hears it, and any one of them working keeps
 * the Mac awake: a routine in the background is work like any other.
 * A development run without servers of its own asks the one it uses. */
async function power(state) {
  const ports = HOSTS_SERVERS ? runningServers().map((run) => run.port) : [Number(process.env.BLOKS_PORT) || 8799];
  const said = await Promise.all(ports.map((port) => powerOn(port, state)));
  return { working: said.some((status) => status?.working) };
}

function watchPower() {
  // agents on another computer are that computer's to keep awake
  if (remoteProfile) return;
  const check = async () => {
    const status = await power();
    const working = Boolean(status?.working);
    if (working && awakeLock === null) awakeLock = powerSaveBlocker.start("prevent-app-suspension");
    if (!working && awakeLock !== null) {
      powerSaveBlocker.stop(awakeLock);
      awakeLock = null;
    }
  };
  setInterval(() => void check(), 15_000).unref?.();
  void check();
  powerMonitor.on("suspend", () => void power("suspend"));
  powerMonitor.on("resume", () => void power("resume"));
}

// ── a Bloks on another computer ───────────────────────────────────────
// When this app is paired with an always-on computer (bloks-server), it
// runs no server of its own: electron/remote.mjs stands in on loopback
// and carries every call through Bloks Cloud. Running both would mean two
// copies of the same agents answering, so it is one or the other, and
// switching restarts the app.
//
// The profile holds the device token its keys come from, so it is kept
// encrypted by the operating system's keychain, never in plain text.
let remoteProfile = null;
let remoteState = { connected: false };
/** The loopback port the remote proxy stands in on. */
let remotePort = null;

function remoteFile() {
  return path.join(app.getPath("userData"), "remote.bin");
}

function readRemoteProfile() {
  try {
    if (!fs.existsSync(remoteFile()) || !safeStorage.isEncryptionAvailable()) return null;
    const profile = JSON.parse(safeStorage.decryptString(fs.readFileSync(remoteFile())));
    return profile?.deviceId && profile.deviceToken && profile.relayUrl ? profile : null;
  } catch {
    return null;
  }
}

function saveRemoteProfile(profile) {
  if (!profile) {
    fs.rmSync(remoteFile(), { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer cannot keep the pairing safely, so it was not saved.");
  fs.writeFileSync(remoteFile(), safeStorage.encryptString(JSON.stringify(profile)), { mode: 0o600 });
}

/** The port the remote proxy had last time. The window's storage (folded
 * sections, the sidebar's width, cards you closed) belongs to its origin,
 * and the origin includes the port, so a fresh port every launch quietly
 * forgot all of it. */
const REMOTE_PORT_FILE = () => path.join(app.getPath("userData"), "remote-port.json");

function readRemotePort() {
  try {
    const port = JSON.parse(fs.readFileSync(REMOTE_PORT_FILE(), "utf8")).port;
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

async function startRemote(profile) {
  try {
    const system = { darwin: "macOS", win32: "Windows", linux: "Linux" }[process.platform] ?? process.platform;
    const options = {
      staticDir: path.join(process.resourcesPath, "ui"),
      client: `${system} ${app.getVersion()}`,
      onState: (state) => {
        remoteState = state;
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send("remote:state", { host: profile.host, ...state });
        }
      },
    };
    const remembered = readRemotePort();
    let proxy;
    try {
      proxy = await startRemoteProxy(profile, { ...options, port: remembered ?? 0 });
    } catch (error) {
      // that port is someone else's now; any free one, remembered from here
      if (!remembered) throw error;
      proxy = await startRemoteProxy(profile, { ...options, port: 0 });
    }
    try {
      fs.writeFileSync(REMOTE_PORT_FILE(), JSON.stringify({ port: proxy.port }));
    } catch {
      /* next launch picks another, as before */
    }
    remoteProfile = profile;
    remotePort = proxy.port;
    return true;
  } catch (error) {
    console.error("[remote] could not start:", error?.message ?? error);
    return false;
  }
}

handle("settings:observation", (event) => nativeSettingsObservation({
  window: BrowserWindow.fromWebContents(event.sender),
  remote: Boolean(remoteProfile), shortcut: quickAccelerator, update: updaterState.state,
  media: (kind) => systemPreferences.getMediaAccessStatus?.(kind),
}));

handle("remote:status", () =>
  remoteProfile ? { mode: "remote", host: remoteProfile.host, ...remoteState } : { mode: "local" },
);
handle("remote:connect", async (event, link) => {
  if (!app.isPackaged) return { error: "Connecting to another computer works in the installed app." };
  try {
    const profile = await claimPairLink(String(link ?? ""), `${os.hostname().replace(/\.local$/, "")} (desktop)`);
    saveRemoteProfile(profile);
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
  // exit skips before-quit, so the server is stopped here, or on Windows
  // it would be ended outright and leave its lock behind
  quitting = true;
  await stopAllServers();
  app.relaunch();
  app.exit(0);
  return { ok: true };
});
handle("remote:disconnect", () => {
  saveRemoteProfile(null);
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

// The system keeps handing us these keys until we say otherwise.
app.on("will-quit", () => {
  if (restart) restartLog("restart: exiting");
  globalShortcut.unregisterAll();
  stopMeeting();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// The embedded daemon cleans up asynchronously, and none of that can run
// once the host process is gone. So the first quit is deferred until it
// finishes, then allowed through. The server is asked to stop before it
// is killed, so it ends its engines and gives up the data folder itself
// (electron/server-life.mjs).
//
// Deferred, never dropped. The daemon's stop had no time limit, and one
// that never answers would mean the second quit never comes: the windows
// are closed by then, and an update's installer is left waiting for
// Bloks to go (GitHub 267). The daemon exits with this process anyway.
const STOP_BEFORE_QUIT_MS = 5_000;
let daemonStopped = false;
app.on("before-quit", (event) => {
  quitting = true;
  if (daemonStopped) return;
  event.preventDefault();
  if (restart) restartLog("restart: quit under way, stopping the server and the computer use helper");
  within(() => Promise.allSettled([stopAllServers(), stopCua()]), STOP_BEFORE_QUIT_MS).then((went) => {
    if (restart) restartLog(`restart: ${went.outcome === "late" ? "they had not stopped in time" : "they stopped"}, quitting`);
    daemonStopped = true;
    app.quit();
  });
});
