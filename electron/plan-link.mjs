// Opening bloks.dev from the Plan page with the licence attached, and
// forgetting a licence for good. Plain Node, so it can be tested outside
// Electron (test/plan-link.test.ts).
//
// The licence lives in this process, kept in the keychain, and the page
// never holds it. When the page opens one of the site's offers, this end
// adds the key, and only in the fragment: a fragment never leaves the
// browser in a request, so no server log, proxy or referrer on the way
// sees it, and only the site's own page reads it to know who is buying.
// It is added for the site's own origin alone; a link anywhere else
// opens as it came.
import { createHash } from "node:crypto";

const LICENCE = /^blok_live_[0-9a-f]{32}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The address to open, or null for one that is not a web page Bloks
 * should open at all. `site` is bloks.dev, or a test's stand-in. */
export function withLicence(raw, licence, site = "https://bloks.dev") {
  let url;
  let home;
  try {
    url = new URL(String(raw));
    home = new URL(String(site));
  } catch {
    return null;
  }
  const local = LOOPBACK.has(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local))) return null;
  if (typeof licence === "string" && LICENCE.test(licence) && url.origin === home.origin) {
    url.hash = `key=${licence}`;
  } else if (/(^|[#&])key=/.test(url.hash)) {
    // a key that came in the link itself is nobody's to pass on
    url.hash = "";
  }
  return url.toString();
}

/** What is kept of a forgotten licence: enough to recognise it when a
 * workspace that still held it offers it back, and nothing to use. */
export function licencePrint(key) {
  return createHash("sha256").update(`bloks-forgotten:${String(key)}`).digest("hex");
}
