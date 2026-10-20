// bloks:// links, as the system hands them to the app. Plain Node on
// purpose, so they can be tested outside Electron (see
// test/links.test.ts).
//
// macOS hands a link over with open-url. Windows and Linux pass it as an
// argument instead: to a second launch when Bloks is already running,
// which hands it on, and to the launch itself when the link is what
// opened Bloks.

/** A link worth passing on, or null. Only a gallery team by name is
 * understood: a link cannot point the app at an arbitrary address. */
export function teamLink(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "bloks:" || url.hostname !== "team") return null;
    const slug = url.pathname.replace(/^\/+|\/+$/g, "");
    return /^[a-z0-9-]{1,60}$/.test(slug) ? { kind: "team", slug } : null;
  } catch {
    return null;
  }
}

/**
 * A workspace invite handed over by bloks.dev's "Open in Bloks", or a QR
 * scanned on this Mac: bloks://join#<code>, the fragment exactly as typed
 * (a dash, any case), sometimes with where the inviting computer answers
 * on this network after a "~". Passed on as text for the join dialog to
 * read the way it reads anything pasted; it opens nothing by itself.
 */
export function joinLink(raw) {
  const text = String(raw ?? "");
  if (!/^bloks:\/\/join\/?#/i.test(text) || text.length > 200) return null;
  const fragment = text.slice(text.indexOf("#") + 1);
  // a code is 8 of the readable characters, give or take dashes and spaces
  if (!/^[0-9A-Za-z\s\-~.:[\]%]{8,120}$/.test(fragment)) return null;
  try {
    return { kind: "join", fragment: decodeURIComponent(fragment) };
  } catch {
    return null;
  }
}

/**
 * bloks://plan, the way bloks.dev sends somebody back after a checkout
 * or a change in billing: it opens Settings on Plan, which looks again.
 * Nothing else rides on it; a path or a query is not read.
 */
export function planLink(raw) {
  try {
    const url = new URL(String(raw));
    return url.protocol === "bloks:" && url.hostname === "plan" ? { kind: "plan" } : null;
  } catch {
    return null;
  }
}

/** The bloks:// link among a launch's arguments, or null. */
export function linkInArgv(argv) {
  return (Array.isArray(argv) ? argv : []).find((arg) => typeof arg === "string" && arg.startsWith("bloks://")) ?? null;
}
