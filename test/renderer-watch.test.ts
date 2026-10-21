// A window whose page dies loads the app again, and stops at a plain page
// with Reload once the page keeps dying (electron/renderer-watch.mjs).
// A page that stops answering is written down and waited on.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  DEATH_LIMIT,
  DEATH_WINDOW_MS,
  deathGuard,
  isReloadAsk,
  RELOAD_URL,
  stoppedPage,
  watchRenderer,
} from "../electron/renderer-watch.mjs";

test("the guard reloads until three deaths fall within a minute", () => {
  const guard = deathGuard();
  assert.equal(DEATH_LIMIT, 3);
  assert.equal(guard.note(0), "reload");
  assert.equal(guard.note(1_000), "reload");
  assert.equal(guard.note(2_000), "stop", "the third inside the minute");
  const spaced = deathGuard();
  for (let i = 0; i < 10; i++) assert.equal(spaced.note(i * (DEATH_WINDOW_MS / 2 + 1)), "reload", "deaths far apart never stop it");
  guard.reset();
  assert.equal(guard.note(3_000), "reload", "Reload starts the count again");
});

test("only the stopped page's own link is a reload, and it is no web address", () => {
  const page = stoppedPage();
  assert.match(decodeURIComponent(page), /Bloks stopped responding/);
  assert.ok(decodeURIComponent(page).includes(`href="${RELOAD_URL}"`));
  assert.equal(isReloadAsk(RELOAD_URL), true);
  assert.equal(isReloadAsk("http://127.0.0.1:8123/"), false);
  assert.equal(/^https?:/.test(RELOAD_URL), false, "a link nobody catches must never reach a browser");
});

function fakeWindow() {
  const win = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    destroyed: false,
    loaded: [] as string[],
    isDestroyed() {
      return win.destroyed;
    },
    loadURL(url: string) {
      win.loaded.push(url);
      return Promise.resolve();
    },
  });
  return win;
}

test("a dead page is loaded again, a third death in a minute shows the stopped page, and Reload loads again", () => {
  const win = fakeWindow();
  const lines: string[] = [];
  let reopened = 0;
  let clock = 0;
  watchRenderer(win, { log: (t) => lines.push(t), reopen: () => reopened++, stopped: () => "data:stopped", now: () => clock });

  win.webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 5 });
  assert.equal(reopened, 1);
  assert.match(lines[0], /gone \(oom, exit code 5\)/);
  clock = 5_000;
  win.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  clock = 10_000;
  win.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  assert.equal(reopened, 2, "the third is not loaded again");
  assert.deepEqual(win.loaded, ["data:stopped"]);

  let called = false;
  win.webContents.emit("will-navigate", { preventDefault: () => (called = true) }, RELOAD_URL);
  assert.equal(called, true, "the navigation itself is called off");
  assert.equal(reopened, 3);
  win.webContents.emit("will-navigate", { preventDefault: () => assert.fail("not ours") }, "http://127.0.0.1:8123/");
  assert.equal(reopened, 3, "any other navigation is left to the navigation guard");
  win.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 11 });
  assert.equal(reopened, 4, "after Reload the count starts again");
});

test("nothing is reloaded while Bloks quits, or into a closed window", () => {
  let quitting = true;
  let reopened = 0;
  const win = fakeWindow();
  watchRenderer(win, { log: () => {}, reopen: () => reopened++, stopped: () => "", quitting: () => quitting });
  win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });
  quitting = false;
  win.destroyed = true;
  win.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 9 });
  assert.equal(reopened, 0);
});

test("a page that stops answering is waited on and written down, never reloaded", () => {
  const win = fakeWindow();
  const lines: string[] = [];
  let reopened = 0;
  let clock = 1_000;
  watchRenderer(win, { log: (t) => lines.push(t), reopen: () => reopened++, stopped: () => "", now: () => clock });
  win.emit("unresponsive");
  clock = 13_400;
  win.emit("responsive");
  assert.equal(reopened, 0);
  assert.deepEqual(win.loaded, []);
  assert.match(lines[0], /not responding; waiting/);
  assert.match(lines[1], /responding again, after 12 s/);
});
