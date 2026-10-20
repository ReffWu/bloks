// The owner's name: what their agents call them, and what everybody they
// let in sees them as.
//
// It is kept in config.profile.name, beside the rest of what the person
// says about themselves. Setup asks for it once and lets it be skipped;
// after that it is asked for again only at the moment somebody else is
// about to see it (a Team workspace, a shared room, an invite), because
// "The owner" on an invite card, a link preview or a room header reads as
// a product that never asked. So those routes refuse without one, with a
// code the window answers by asking.
//
// The field is prefilled with the name this computer's account already
// carries: the full name on a Mac (`id -F`, or Directory Services when
// that is quiet), the passwd entry's comment elsewhere, and the login
// name only as a last resort. It is read here and handed to the person's
// own window to prefill a field. Nothing else ever sees it unless they
// keep it.
import { execFile } from "node:child_process";
import { userInfo } from "node:os";

import { cleanName } from "./people.ts";

/** The code every refusal for a missing name carries. */
export const NAME_REQUIRED = "name_required";
/** An admin or a collaborator meeting the same wall: only the owner can
 * say the owner's name, so theirs is a different code with nothing to
 * ask for. */
export const OWNER_UNNAMED = "owner_unnamed";

/** The refusal a route answers with, by who asked. */
export function nameRefusal(asker: "owner" | "someone else" = "owner"): { code: string; error: string } {
  return asker === "owner"
    ? { code: NAME_REQUIRED, error: "Say what people should call you first. Everyone you let in sees this name." }
    : { code: OWNER_UNNAMED, error: "The owner has to choose the name people see first. Ask them to set it in Settings." };
}

/**
 * A login name read as a person's name, when it plausibly is one: letters,
 * perhaps split by a dot, a dash or an underscore ("hamed", "ana.lima").
 * Anything with digits or symbols in it is a handle, and a handle is not
 * offered: an empty field asks better than a wrong guess.
 */
export function nameFromLogin(login: string | null | undefined): string | null {
  const raw = (login ?? "").trim();
  if (!/^\p{L}+(?:[._-]\p{L}+)*$/u.test(raw)) return null;
  const words = raw.split(/[._-]/).map((w) => w.charAt(0).toLocaleUpperCase() + w.slice(1));
  return cleanName(words.join(" "));
}

/** The comment of a passwd line ("Ana Lima,,,"), as a name. */
export function nameFromGecos(line: string | null | undefined): string | null {
  const fields = (line ?? "").trim().split(":");
  if (fields.length < 5) return null;
  return cleanName(fields[4].split(",")[0]);
}

/**
 * The best name the account offers: its full name, unless that is only
 * the login name again (an account made without one says so), then the
 * login name read as a name. Pure, for the tests.
 */
export function pickAccountName(said: { full?: string | null; login?: string | null }): string | null {
  const login = (said.login ?? "").trim();
  const full = cleanName(said.full ?? "");
  if (full && full !== login) return full;
  return nameFromLogin(login);
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 2_000, encoding: "utf8", windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

let asked: Promise<string | null> | null = null;

/** What this computer's account calls its person, once per run: an
 * account's name does not change while the server is up, and a field
 * waiting on a subprocess each time it opens would be felt. */
export function accountName(): Promise<string | null> {
  asked ??= readAccountName().catch(() => null);
  return asked;
}

async function readAccountName(): Promise<string | null> {
  let login = "";
  try {
    login = userInfo().username;
  } catch {
    /* no passwd entry at all, in some containers */
  }
  let full: string | null = null;
  if (process.platform === "darwin") {
    full = (await run("/usr/bin/id", ["-F"]))?.trim() || null;
    if (!full && login) {
      // "RealName:\n Ana Lima", or "RealName: Ana Lima" when it is short
      const said = await run("/usr/bin/dscl", [".", "-read", `/Users/${login}`, "RealName"]);
      full = said?.replace(/^RealName:\s*/, "").trim() || null;
    }
  } else if (process.platform !== "win32" && login) {
    full = nameFromGecos(await run("getent", ["passwd", login]));
  }
  return pickAccountName({ full, login });
}
