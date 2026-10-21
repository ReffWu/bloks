// What the screenshot scripts share: a throwaway machine for the desktop
// app to run on, the app itself in its real Electron window, and the
// careful last look every picture gets before it is kept.
//
//   import { launchDesktop, ... } from "./screenshot-kit.mjs";
//
// Used by scripts/shoot-screenshots.mjs, and by anyone else who wants
// pictures of the app that match it exactly.
//
// The rules it keeps, because a screenshot script runs on a maintainer's
// own computer, next to the Bloks they actually use:
//
//   Nothing real. Every run gets a home of its own under /tmp, an Electron
//   user data folder inside it, and a free port the system hands out. The
//   person's own ~/.bloks, the app's own folder in Application Support and
//   the port the installed app listens on are never touched, and a port
//   that turns out to be that one is refused outright.
//
//   Nothing leaves. Each workspace's server is started with a preload that
//   lets fetch reach this computer's loopback and nothing else, and the
//   services Bloks would ask (bloks.dev, Bloks Cloud, the price list) are
//   a small stand-in served here, with made-up answers.
//
//   Nothing in the way. The window is real but invisible: drawn at full
//   size and full resolution, captured from its own contents, with zero
//   opacity, no Dock icon, no focus taken and no notifications shown.
//
//   Nothing private in a picture. The throwaway home's paths are written
//   as a made-up person's own folder, the way the app would print them on
//   their Mac. Then the words on the page inside the region are read
//   back, and any other home folder path, a temp folder path or the name
//   of whoever is running the script stops it.
import { _electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCustomMark } from "../electron/workspace-marks.mjs";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The port the installed app listens on. Nothing here goes near it. */
const OWNERS_PORT = 8799;
/** Who is running this, and where their own files are, for the last look. */
const REAL_HOME = homedir();
const REAL_USER = userInfo().username;

// ── ports and folders ─────────────────────────────────────────────────

/** A port nothing is listening on, as the system hands one out. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => (port === OWNERS_PORT ? freePort().then(resolve, reject) : resolve(port)));
    });
  });
}

/** A short folder under /tmp. Short on purpose: the server's permission
 * bridge is a unix socket inside it, and a socket path over 104 bytes
 * fails without saying why. */
export function tempHome(tag) {
  // the real path, so a shell's ~ and the app's paths agree on it
  return realpathSync(mkdtempSync(`/tmp/bks-${tag}-`));
}

// ── the stand-in engine ───────────────────────────────────────────────

/**
 * A signed-in Claude Code for screenshots: it speaks the stream-json the
 * claudeAgent driver reads and does what $HOME/stand-in.json says, the
 * first scene whose `match` (a regex) hits the prompt and whose `agent`,
 * when set, is the agent asking. A scene can write and remove files in
 * the folder it runs in, write the agent's memory with the agent's own
 * credential, report a price and tokens, and report the plan's windows
 * the way Claude Code does on the side of a turn.
 */
export function writeStandIn(home, scenes) {
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "stand-in.json"), JSON.stringify(scenes, null, 2));
  const file = join(home, "bin", "claude");
  writeFileSync(file, `#!${process.execPath}\n${STAND_IN}`);
  chmodSync(file, 0o755);
  return file;
}

const STAND_IN = String.raw`
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("2.1.300 (Claude Code)"); process.exit(0); }
if (argv[0] === "auth") { console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })); process.exit(0); }
if (["mcp", "plugin", "update", "doctor"].includes(argv[0])) process.exit(0);

const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const session = flag("--session-id") ?? flag("--resume") ?? randomUUID();
const out = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => process.exit(0), 10 * 60_000).unref();

let buffer = "";
let started = false;
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let cut; (cut = buffer.indexOf("\n")) !== -1; ) {
    const line = buffer.slice(0, cut);
    buffer = buffer.slice(cut + 1);
    let frame;
    try { frame = JSON.parse(line); } catch { continue; }
    if (frame.type === "control_request") {
      out({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} } });
    } else if (frame.type === "user" && !started) {
      started = true;
      const content = frame.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => b.text ?? "").join("\n") : "";
      run(text).catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
    }
  }
});
process.stdin.on("end", () => { if (!started) process.exit(0); });

// Claude Code's cost is the session's running total; the server books
// each turn the difference, so the stand-in keeps the same total.
function runningTotal(cost) {
  const file = join(process.env.HOME, "stand-in-sessions.json");
  let all = {};
  try { all = JSON.parse(readFileSync(file, "utf8")); } catch {}
  all[session] = Math.round(((all[session] ?? 0) + cost) * 10000) / 10000;
  writeFileSync(file, JSON.stringify(all));
  return all[session];
}

async function whoami(headers) {
  const r = await fetch(process.env.BLOKS_URL + "/api/agent/whoami", { headers });
  return r.json();
}

async function run(prompt) {
  const scenes = JSON.parse(readFileSync(join(process.env.HOME, "stand-in.json"), "utf8"));
  const headers = { authorization: "Bearer " + process.env.BLOKS_TOKEN, "content-type": "application/json" };
  const me = await whoami(headers).catch(() => ({}));
  const scene = scenes.find((s) => new RegExp(s.match, "i").test(prompt) && (!s.agent || s.agent === me.name)) ?? { text: "Done." };
  out({ type: "system", subtype: "init", session_id: session, model: flag("--model") ?? "claude-sonnet-5", tools: [] });
  for (const [path, body] of Object.entries(scene.files ?? {})) {
    if (body === null) rmSync(path, { force: true });
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
    }
  }
  if (scene.memory && me.botId) {
    await fetch(process.env.BLOKS_URL + "/api/bots/" + me.botId + "/memory", { method: "PUT", headers, body: JSON.stringify({ text: scene.memory }) });
  }
  await wait(scene.delay ?? 300);
  const usage = { input_tokens: scene.input ?? 18400, output_tokens: scene.output ?? 960 };
  out({ type: "assistant", session_id: session, message: { role: "assistant", content: [{ type: "text", text: scene.text }], usage } });
  if (scene.limits) out({ type: "rate_limit_event", rate_limit_info: scene.limits });
  out({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 2400, duration_api_ms: 2100, session_id: session, total_cost_usd: runningTotal(scene.cost ?? 0.04), usage, result: scene.text });
}
`;

// ── what the servers may reach ────────────────────────────────────────

/**
 * The preload every workspace's server starts with (NODE_OPTIONS, handed
 * on by the main process). fetch reaches loopback and nothing else, so a
 * made-up licence or a stray price lookup never goes anywhere. A server
 * asked to listen on every interface listens on loopback instead, unless
 * this run is about a phone on the network (`lan`).
 */
export function writeGuard(home, { lan = false } = {}) {
  const file = join(home, "guard.mjs");
  writeFileSync(
    file,
    `import net from "node:net";
const real = globalThis.fetch;
const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
globalThis.fetch = async (input, init) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  let url;
  try { url = new URL(href); } catch { return real(input, init); }
  if (loopback.has(url.hostname)) return real(input, init);
  throw new TypeError("fetch failed");
};
if (${!lan}) {
  const listen = net.Server.prototype.listen;
  const everywhere = (host) => host === "0.0.0.0" || host === "::";
  net.Server.prototype.listen = function (...args) {
    if (args[0] && typeof args[0] === "object" && everywhere(args[0].host)) args[0] = { ...args[0], host: "127.0.0.1" };
    else if (typeof args[1] === "string" && everywhere(args[1])) args[1] = "127.0.0.1";
    return listen.apply(this, args);
  };
}
`,
  );
  return file;
}

/**
 * bloks.dev and Bloks Cloud, as far as the app asks them, answered here.
 * `site` is what the plan and the team check say; the relay part accepts
 * a workspace's connection and says hello, so a workspace with a relay
 * in its config reads as online, and takes whatever it is sent.
 */
export async function startStandInServices({ account = null, offers = [], team = true, ai = null } = {}) {
  const port = await freePort();
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const streams = new Set();
  // the invites a workspace put on Bloks Cloud, so a typed code finds one
  const invites = new Map();
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* not JSON; nothing here needs it */
    }
    if (url.pathname === "/api/cloud/account") return account ? json(res, 200, account) : json(res, 404, { error: "unknown key" });
    if (url.pathname === "/api/cloud/offers") return json(res, 200, { offers });
    if (url.pathname === "/api/hosting/status") return json(res, 200, { team, plan: team ? "team" : "cloud" });
    // Bloks AI's allowance, as shares; it is never used for a turn here
    if (url.pathname === "/api/ai/token") return ai ? json(res, 200, { token: "stand-in" }) : json(res, 403, { error: "No Bloks AI on this key." });
    if (url.pathname === "/api/ai/balance") return ai ? json(res, 200, ai) : json(res, 403, { error: "No Bloks AI on this key." });
    if (url.pathname === "/space/agent/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      res.write(`data: ${JSON.stringify({ kind: "hello", spaceId: "space_demo" })}\n\n`);
      const beat = setInterval(() => res.write(": keepalive\n\n"), 20_000);
      streams.add(res);
      res.on("close", () => {
        clearInterval(beat);
        streams.delete(res);
      });
      return;
    }
    if (url.pathname === "/space/agent/plan") return json(res, 200, { plan: team ? "team" : "cloud", sharedRoom: true, spaces: { online: 2, limit: team ? null : 3 } });
    if (url.pathname === "/space/agent/clients" && req.method === "POST") return json(res, 201, { clientToken: `client-${randomUUID()}` });
    if (url.pathname === "/space/agent/invites" && req.method === "POST") {
      invites.set(body.codeHash, body);
      return json(res, 200, {});
    }
    if (url.pathname === "/invites/lookup") {
      const found = invites.get(createHash("sha256").update(url.searchParams.get("code") ?? "").digest("hex"));
      if (!found) return json(res, 404, { error: "no such invite" });
      return json(res, 200, { publicId: found.publicId, preview: found.preview, expiresAt: found.expiresAt, host: { key: found.host.key, token: found.host.token } });
    }
    // a joiner asking the host through Bloks Cloud is not carried here
    if (url.pathname.startsWith("/space/client/") || url.pathname.startsWith("/invites/")) return json(res, 503, { error: "not carried" });
    if (url.pathname.startsWith("/space/")) return json(res, 200, {});
    json(res, 404, { error: "not here" });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((r) => {
        for (const s of streams) s.destroy();
        server.close(() => r());
      }),
  };
}

// ── a workspace's files ───────────────────────────────────────────────

/** An agent as bots.json keeps one, with its first conversation. */
export function agent(name, title, look, over = {}) {
  const general = { id: randomUUID(), title: "General", resumeCursors: {}, createdAt: over.createdAt ?? Date.now() - 6 * 86_400_000 };
  return {
    id: randomUUID(),
    threadId: general.id,
    activeTaskId: general.id,
    tasks: [general],
    name,
    title,
    description: "",
    notifications: true,
    unread: false,
    seniority: 1,
    modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
    resumeCursors: {},
    createdAt: Date.now() - 6 * 86_400_000,
    ...look,
    ...over,
  };
}

/**
 * Writes a workspace's folder before its server starts: agents, rooms,
 * transcripts, config, and anything else by file name (people.json,
 * reads.json, usage.json, owner-plan.json). Values that are not strings
 * are written as JSON.
 */
export function writeWorkspace(dir, { bots = [], rooms = [], transcripts = {}, config = {}, files = {} }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const put = (name, value) =>
    writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  put("bots.json", bots);
  put("bloks.json", rooms);
  for (const [threadId, messages] of Object.entries(transcripts)) put(`messages-${threadId}.json`, messages);
  put("config.json", { setupDoneAt: Date.now() - 6 * 86_400_000, ...config });
  for (const [name, value] of Object.entries(files)) put(name, value);
}

// ── the desktop app ───────────────────────────────────────────────────

const ELECTRON = () => execFileSync(process.execPath, ["-e", "process.stdout.write(require('electron'))"], { cwd: REPO, encoding: "utf8" }).trim();

/**
 * Starts the real desktop app on a throwaway home.
 *
 * `workspaces` is the switcher's list as the main process keeps it
 * (workspaces.json): Personal's folder is <home>/.bloks, every other one
 * lives in the user data folder, and each one's folder must already be
 * written (writeWorkspace). `ports` gives each workspace the port its
 * server starts on, by id. `services` is startStandInServices().
 *
 * Returns the window's page and a way to reach each workspace's API.
 */
export async function launchDesktop({ home, workspaces, ports, services, ownerName, theme = "light", size = { width: 1360, height: 880 }, lan = false, tz = "UTC", current = "personal" }) {
  for (const port of Object.values(ports)) {
    if (Number(port) === OWNERS_PORT) throw new Error(`refusing port ${OWNERS_PORT}: the installed app listens there`);
  }
  const userData = join(home, "app");
  mkdirSync(userData, { recursive: true });
  // Every workspace's own config says its port, so each server comes up
  // where this script expects it, and Personal's is in the environment too.
  for (const ws of workspaces) {
    const dir = ws.kind === "personal" ? join(home, ".bloks") : join(userData, "workspaces", ws.id);
    const file = join(dir, "config.json");
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...cfg, port: ports[ws.id] }, null, 2), { mode: 0o600 });
    if (ws.mark && ws.kind === "custom" && !isCustomMark(ws.mark)) throw new Error(`${ws.name}'s mark is not one a named workspace may wear`);
  }
  writeFileSync(
    join(userData, "workspaces.json"),
    JSON.stringify({
      version: 1,
      current,
      prefs: { theme, sameAccent: false, accent: null, ownerName },
      workspaces: workspaces.map((ws, order) => ({
        order,
        createdAt: Date.now() - 30 * 86_400_000,
        notify: "all",
        ...ws,
        dataDir: ws.kind === "personal" ? join(home, ".bloks") : join(userData, "workspaces", ws.id),
      })),
    }),
  );
  // The window's position, kept where the app keeps it, so it opens at
  // the size of the pictures.
  writeFileSync(join(userData, "window-state.json"), JSON.stringify({ bounds: { x: 40, y: 40, width: size.width, height: size.height + 28 } }));
  // A terminal opened in a picture says where it is and nothing about
  // whose computer it is on.
  writeFileSync(join(home, ".zshrc"), `export PATH="$HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin"\nPROMPT='%F{8}%~%f %# '\nunsetopt PROMPT_SP\n`);
  const guard = writeGuard(home, { lan });
  // Playwright takes NODE_OPTIONS away from the app it starts, so the
  // guard travels under another name and is put back before the main
  // process has started anything; each server it forks inherits it.
  const handOn = join(home, "hand-on.cjs");
  writeFileSync(handOn, "process.env.NODE_OPTIONS = process.env.SHOTS_NODE_OPTIONS;\n");

  const app = await _electron.launch({
    executablePath: ELECTRON(),
    args: [
      "-r",
      handOn,
      REPO,
      `--user-data-dir=${userData}`,
      // a keychain of its own: the app asks the keychain for its licence
      // as it starts, and the real one would ask the person first
      "--use-mock-keychain",
      "--force-device-scale-factor=2",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
    cwd: REPO,
    env: {
      HOME: home,
      USER: "demo",
      LOGNAME: "demo",
      SHELL: "/bin/zsh",
      PATH: `${join(home, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      TZ: tz,
      SHOTS_NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`,
      BLOKS_DEV_WORKSPACES: "1",
      BLOKS_PORT: String(ports.personal),
      BLOKS_DATA_DIR: join(home, ".bloks"),
      BLOKS_SITE_URL: services.url,
      BLOKS_CREDITS_URL: `${services.url}/api/ai`,
      BLOKS_RELAY_URL: services.url,
      BLOKS_PRICES_URL: `${services.url}/api/prices`,
      BLOKS_SKILLS_URL: `${services.url}/skills/index.json`,
      BLOKS_TEAMS_URL: `${services.url}/teams/index.json`,
      OLLAMA_HOST: "127.0.0.1:9",
      DO_NOT_TRACK: "1",
    },
  });
  // Before any window: invisible, quiet, and never in front of anything.
  await app.evaluate(({ app: electronApp, BrowserWindow, Notification }) => {
    electronApp.on("browser-window-created", (_event, win) => {
      win.setOpacity(0);
      win.setIgnoreMouseEvents(true);
    });
    electronApp.dock?.hide();
    electronApp.focus = () => {};
    BrowserWindow.prototype.focus = function () {};
    Notification.prototype.show = function () {};
  });
  const context = app.context();
  await context.addInitScript(() => {
    try {
      localStorage.setItem("bloks-intro-v1", "1");
      localStorage.setItem("bloks-setup-done", "1");
    } catch {
      /* storage refused; the intro shows */
    }
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  await app.evaluate(({ BrowserWindow }, s) => {
    for (const win of BrowserWindow.getAllWindows()) win.setContentSize(s.width, s.height);
  }, size);
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(1500);

  showHomeAs(home);
  const desktop = {
    app,
    page,
    home,
    userData,
    ports,
    size,
    url: (id) => `http://127.0.0.1:${ports[id]}`,
    /** A workspace's API, as the window calls it. */
    api: async (id, path, method = "GET", body) => {
      const res = await fetch(`http://127.0.0.1:${ports[id]}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    /** Waits until a workspace's server answers. */
    up: async (id, ms = 60_000) => {
      const end = Date.now() + ms;
      for (;;) {
        try {
          if ((await fetch(`http://127.0.0.1:${ports[id]}/api/health`)).ok) return;
        } catch {
          /* not yet */
        }
        if (Date.now() > end) throw new Error(`the ${id} workspace's server did not start`);
        await wait(300);
      }
    },
    /** Shows another workspace in the window, the way the switcher does. */
    show: async (id) => {
      await desktop.up(id);
      if (!page.url().startsWith(desktop.url(id))) {
        // the page goes away as the switch happens, so nothing is waited on
        await page
          .evaluate((target) => {
            void window.bloks.workspaceSwitch(target);
          }, id)
          .catch(() => {});
        await page.waitForURL((u) => u.href.startsWith(desktop.url(id)), { timeout: 30_000 });
      }
      await page.waitForLoadState("networkidle").catch(() => {});
      await wait(1800);
    },
    /** The app's own theme, as Settings sets it, then a fresh page. */
    theme: async (want) => {
      await page.evaluate(async (t) => {
        localStorage.setItem("bloks-theme", t);
        await window.bloks?.prefsTheme?.(t);
      }, want);
      await page.reload({ waitUntil: "networkidle" });
      await wait(1500);
    },
    /** Window size, in CSS pixels; captures are at twice this. */
    resize: async (s) => {
      await app.evaluate(({ BrowserWindow }, next) => {
        for (const win of BrowserWindow.getAllWindows()) win.setContentSize(next.width, next.height);
      }, s);
      await wait(700);
    },
    close: async () => {
      await app.close().catch(() => {});
    },
  };
  return desktop;
}

// ── moving around the window ──────────────────────────────────────────

/** Clicks the first button (or menu item, tab, link) whose words or label
 * match, the way a person would pick it out. */
export async function click(page, match, { within = "body" } = {}) {
  const found = await page.evaluate(
    ({ source, flags, within }) => {
      const re = new RegExp(source, flags);
      const root = document.querySelector(within) ?? document.body;
      const all = [...root.querySelectorAll("button, [role=menuitem], [role=menuitemradio], [role=tab], [role=option], a, [role=button]")];
      // what a person could click: something on top where it is drawn,
      // since a page can keep another place's list mounted out of sight;
      // failing that, anything drawn at all, for a row scrolled away
      const matches = all.filter((el) => re.test((el.getAttribute("aria-label") || "").trim()) || re.test((el.textContent || "").trim()));
      const drawn = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const onTop = (el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(top && (top === el || el.contains(top)));
      };
      const hit = matches.find((el) => drawn(el) && onTop(el)) ?? matches.find(drawn);
      if (!hit) return false;
      hit.scrollIntoView({ block: "nearest" });
      hit.click();
      return true;
    },
    { source: match.source, flags: match.flags, within },
  );
  if (!found) throw new Error(`nothing to click for ${match}`);
  await wait(700);
}

/** Radix menus open on pointer down, not on click. */
export async function openMenu(page, label) {
  const found = await page.evaluate((source) => {
    const re = new RegExp(source);
    const b = [...document.querySelectorAll("button")].find((x) => re.test(x.getAttribute("aria-label") || "") || re.test((x.textContent || "").trim()));
    if (!b) return false;
    b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    return true;
  }, label.source);
  if (!found) throw new Error(`no menu ${label}`);
  await wait(600);
}

/** One of the rail's places: Chat, Overview, Automations, Memory, Plugins,
 * Usage or Settings. */
export async function rail(page, place) {
  await click(page, new RegExp(`^${place}`), { within: 'nav[aria-label="Bloks"]' });
  await wait(900);
}

/** A Settings page by its name in the list. */
export async function settingsPage(page, label) {
  await rail(page, "Settings");
  await click(page, new RegExp(`^${label}($|\\d)`), { within: 'nav[aria-label="Settings"]' });
  await wait(1000);
}

/** No focus ring, no tooltip, no hover: what a person sees after looking
 * away from the mouse. */
export async function settle(page, ms = 900) {
  await page.mouse.move(2, 600).catch(() => {});
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
  await wait(ms);
}

// ── the last look, and the picture ────────────────────────────────────

/** Where the throwaway home is said to be in a picture: the made-up
 * person's own folder, as the app would name it on their Mac. */
export const SHOWN_HOME = "/Users/elena";

const FORBIDDEN = [
  [new RegExp(REAL_HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "the home folder of whoever runs this"],
  [/\/Users\/(?!elena\b)|\/home\//, "a home folder path"],
  [/\/private\/tmp|\/tmp\/bks-|\/var\/folders/, "a temp folder path"],
  [new RegExp(`\\b${REAL_USER}\\b`, "i"), "the name of whoever runs this"],
];

/** The words the page paints inside a region, form fields included. */
export async function wordsIn(page, clip) {
  return page.evaluate((clip) => {
    const out = [];
    const inside = (r) => r.width && r.height && (!clip || (r.right > clip.x && r.left < clip.x + clip.width && r.bottom > clip.y && r.top < clip.y + clip.height));
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some(inside)) out.push(node.textContent);
    }
    for (const el of document.querySelectorAll("input, textarea")) if (inside(el.getBoundingClientRect())) out.push(el.value || "");
    // a terminal draws its lines on rows of its own
    for (const el of document.querySelectorAll(".xterm-rows > div")) if (inside(el.getBoundingClientRect())) out.push(el.textContent || "");
    return out.join("\n");
  }, clip ?? null);
}

/**
 * Takes one picture: the whole window, a region (`clip`, CSS pixels), or
 * an element with a margin (`element`, a selector or a locator, and
 * `pad`). Refuses before writing anything if the words inside show a
 * path or a name that is nobody's business.
 */
export async function shoot(page, file, { clip = null, element = null, pad = 0 } = {}) {
  let region = clip;
  if (element) {
    const target = typeof element === "string" ? page.locator(element).first() : element;
    const box = await target.boundingBox();
    if (!box) throw new Error(`${file}: nothing to crop to`);
    const vw = await page.evaluate(() => [innerWidth, innerHeight]);
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    region = { x, y, width: Math.min(vw[0] - x, Math.ceil(box.width + pad * 2)), height: Math.min(vw[1] - y, Math.ceil(box.height + pad * 2)) };
  }
  // The app names folders in full, and this run's live in a throwaway
  // home under /tmp: said as the made-up person's own, the way the app
  // would print them on their Mac. Only the words change, nothing else.
  if (shownFrom) {
    await page.evaluate(
      ({ from, to }) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent.includes(from)) node.textContent = node.textContent.split(from).join(to);
        }
      },
      { from: shownFrom, to: SHOWN_HOME },
    );
  }
  const words = await wordsIn(page, region);
  for (const [re, why] of FORBIDDEN) {
    if (re.test(words)) throw new Error(`refusing ${file}: it would show ${why}`);
  }
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, ...(region ? { clip: region } : {}) });
  console.log(`wrote ${file}`);
}

let shownFrom = null;
/** The throwaway home whose paths shoot() says as SHOWN_HOME. */
export function showHomeAs(home) {
  shownFrom = home;
}

/** Removes a throwaway home and everything the run put in it. */
export function removeHome(home) {
  if (!home.startsWith("/tmp/bks-") && !home.startsWith("/private/tmp/bks-")) throw new Error(`not a throwaway home: ${home}`);
  rmSync(home, { recursive: true, force: true });
}
