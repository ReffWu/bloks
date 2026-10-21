// The app's own log: a few lines about the window and its processes.
//
// A renderer that died, a window that stopped answering, a helper process
// that went away: until this, none of it was written anywhere, so a
// freeze or a blank window left nothing to read afterwards. Lines go to
// one small file in the app's logs folder (on a Mac, ~/Library/Logs/bloks,
// beside updater.log), never to the data folder, and never anywhere off
// this computer. Written synchronously, because these are rare and the
// moment one matters is the moment the process may be about to die.
//
// Plain Node on purpose, so it can be tested without Electron (see
// test/app-log.test.ts).
import fs from "node:fs";
import path from "node:path";

/** The file grows to this and is then moved aside to app.1.log, so the
 * two together never pass twice this. */
export const APP_LOG_MAX_BYTES = 512 * 1024;

/** The longest single line; a stack or a page's message is cut to it. */
export const APP_LOG_MAX_LINE = 4000;

/** One line as written: a time, then the text on one line. */
export function logLine(text, now = new Date()) {
  const flat = String(text).replace(/\s*[\r\n]+\s*/g, " | ").slice(0, APP_LOG_MAX_LINE);
  return `${now.toISOString()} ${flat}\n`;
}

/** A log in `dir`. `write` never throws: a log that cannot be written is
 * not a reason for anything else to fail. */
export function createAppLog(dir, { name = "app", maxBytes = APP_LOG_MAX_BYTES, now = () => new Date() } = {}) {
  const file = path.join(dir, `${name}.log`);
  const older = path.join(dir, `${name}.1.log`);
  return {
    file,
    write(text) {
      try {
        const line = logLine(text, now());
        fs.mkdirSync(dir, { recursive: true });
        let size = 0;
        try {
          size = fs.statSync(file).size;
        } catch {
          /* not there yet */
        }
        if (size > 0 && size + Buffer.byteLength(line) > maxBytes) fs.renameSync(file, older);
        fs.appendFileSync(file, line, { mode: 0o600 });
      } catch {
        /* nowhere to write it */
      }
    },
  };
}

/** At most `limit` lines in any `windowMs`, for what a page asks to write:
 * a page in a loop of errors must not fill the disk. Answers whether this
 * one may go. */
export function lineBudget({ limit = 20, windowMs = 60_000 } = {}) {
  const times = [];
  return (now = Date.now()) => {
    while (times.length && now - times[0] >= windowMs) times.shift();
    if (times.length >= limit) return false;
    times.push(now);
    return true;
  };
}
