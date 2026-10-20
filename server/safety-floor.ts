// What no shortcut ever reaches.
//
// Rules decide most requests before a person sees them (server/policy.ts),
// and Bloks now offers to write some of those rules itself, from what a
// person keeps approving (server/rule-suggestions.ts). Both are ways of
// saying yes without being asked, and there is a short list of things a
// yes like that must never cover, however many times the person said yes
// to something nearby: losing files for good, moving money, and handing
// over a credential. Those are the floor.
//
// Two decisions about it worth stating.
//
//   It is a list of shapes, not an understanding. A command is read for
//   the words that do the damage (rm, a force push, a payment provider),
//   and a path for the places secrets live. Something dangerous it does
//   not name gets past it, which is why it never allows anything: it only
//   takes things off the table for a shortcut, and what it misses still
//   reaches a person the ordinary way.
//
//   It errs toward the floor. A tool called "remove_label" is not deleting
//   anyone's files, and it is still kept away from an automatic yes,
//   because the cost of a person answering one more card is small and the
//   cost of the other mistake is not.
//
// The card says the same thing to a person (src/lib/approvalCard.ts, its
// RISKY list); this is the server's copy, a little wider, since nobody is
// looking at it before it applies.
import { homedir } from "node:os";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

/** The parts of a request the floor reads. The same shape as policy's
 * Ask, so either can be handed in. */
export interface FloorAsk {
  tool: string;
  command?: string;
  path?: string;
  url?: string;
}

/** Words in a tool's name that put it on the floor, by the reason said. */
const TOOL_WORDS: Array<[string[], string]> = [
  [["delete", "remove", "rm", "rmdir", "unlink", "trash", "destroy", "drop", "purge", "erase", "wipe", "truncate", "shred"], "it deletes things"],
  [["pay", "payment", "payments", "payout", "charge", "refund", "transfer", "withdraw", "deposit", "purchase", "buy", "checkout", "invoice", "wire", "money", "wallet", "crypto", "stripe", "paypal", "venmo", "trade", "order"], "it can move money"],
  [["secret", "secrets", "password", "passwords", "passphrase", "credential", "credentials", "token", "tokens", "keychain", "apikey", "key", "keys", "oauth", "login", "auth", "ssh", "gpg", "vault"], "it touches credentials"],
];

/** Commands that lose work for good, act as someone else, or pipe the
 * internet into a shell. */
const COMMANDS: Array<[RegExp, string]> = [
  [/(^|[\s;&|(`])(sudo|doas)\b/, "it asks for admin rights"],
  [/(^|[\s;&|(`])(rm|rmdir|unlink|shred|srm)\b/, "it deletes files"],
  [/\s-delete\b/, "it deletes files"],
  [/\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b|\s\+\S)/, "it can overwrite history on the remote"],
  [/\bgit\s+reset\s+--hard\b/, "it throws away uncommitted work"],
  [/\bgit\s+clean\b/, "it deletes untracked files"],
  [/\bgit\s+checkout\s+--?\s*\.(\s|$)/, "it throws away uncommitted work"],
  [/\bgit\s+(branch|tag)\s+(-D|-d|--delete)\b/, "it deletes branches or tags"],
  [/\b(mkfs|diskutil\s+erase\w*|fdisk)\b/, "it can erase a disk"],
  [/\bdd\s+[^\n]*\bof=/, "it writes straight to a disk or file"],
  [/\b(drop|truncate)\s+(table|database|schema)\b/i, "it deletes data from a database"],
  [/\bdelete\s+from\b/i, "it deletes data from a database"],
  [/\b(chmod|chown)\s+-R\b/, "it changes permissions on everything under a folder"],
  [/\|\s*(sh|bash|zsh|python3?|node)\b/, "it runs whatever it downloads"],
  [/\b(stripe|paypal|venmo|payments?|charges?|payouts?|invoices?|checkout|purchase|withdraw|wire)\b/i, "it can move money"],
  [/\bsecurity\s+(find-\w+-password|dump-keychain|export)\b/, "it reads saved passwords"],
  [/(^|[\s;&|(`])(printenv|env)(\s*$|\s*[;&|])/, "it prints secrets in the environment"],
  [/\b(gh|glab|aws|gcloud|az|op|vault|npm|heroku|fly|wrangler)\s+[^\n]*\b(auth|token|login|secrets?|credentials?)\b/i, "it handles credentials"],
  [/(\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.env\b|id_rsa|id_ed25519|\.pem\b|\.p12\b|Keychains)/, "it reads where secrets are kept"],
  [/\b(api[_-]?key|secret|password|passwd|token)\s*=/i, "it carries a credential"],
];

/** Where secrets live, and where an automatic yes has no business. */
function secretPlace(path: string): string | null {
  const p = path.replace(/\\/g, "/");
  const lower = p.toLowerCase();
  const base = lower.split("/").filter(Boolean).pop() ?? "";
  if (/(^|\/)\.(ssh|aws|gnupg|gpg|kube|docker|azure|config\/gcloud|password-store)(\/|$)/.test(lower)) return "it is where credentials are kept";
  if (/(^|\/)(\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.htpasswd)$/.test(lower)) return "it holds credentials";
  if (/^\.env(\..*)?$/.test(base) || /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/.test(base)) return "it holds credentials";
  if (/\.(pem|key|p12|pfx|keychain|keychain-db|kdbx|asc|gpg)$/.test(base)) return "it holds a key";
  if (/(secret|password|passwd|credential|token)/.test(base)) return "it sounds like it holds a secret";
  if (/\/library\/keychains(\/|$)/.test(lower)) return "it is the keychain";
  if (/^\/(etc|system|usr|bin|sbin|private\/etc|library)(\/|$)/.test(lower)) return "it is part of the system";
  // Bloks' own folder holds every agent's keys and the workspace's
  // settings; an agent reading or writing there on a standing yes is
  // exactly what the floor exists to stop.
  // Every workspace's folder counts, not only this one's: an agent in one
  // workspace has no business in another's keys either (nothing moves
  // between workspaces), and the desktop app names where they all live.
  const owned = [DATA_DIR, join(homedir(), ".bloks"), process.env.BLOKS_WORKSPACES_DIR ?? ""]
    .filter(Boolean)
    .map((dir) => dir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());
  if (owned.some((own) => lower === own || lower.startsWith(`${own}/`)) || /(^|\/)\.bloks(\/|$)/.test(lower)) return "it is Bloks' own folder, with your keys in it";
  return null;
}

function moneyOrSecretUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // not something the floor can read, so not something to say yes to
    return "it is not an address that can be read";
  }
  if (parsed.username || parsed.password) return "it carries a password";
  const host = parsed.hostname.toLowerCase();
  if (/(^|\.)(stripe|paypal|venmo|wise|revolut|coinbase|binance|kraken|cash\.app|squareup|plaid)\.[a-z.]+$/.test(host)) return "it can move money";
  if (/(^|\.)(bank|banking)[a-z-]*\./.test(host)) return "it can move money";
  for (const key of parsed.searchParams.keys()) {
    if (/(token|secret|password|passwd|api[_-]?key|auth|session|signature|sig)$/i.test(key)) return "it carries a credential";
  }
  if (/\/(checkout|payments?|pay|charges?|transfers?|billing|wallet)(\/|$)/i.test(parsed.pathname)) return "it can move money";
  return null;
}

/** A tool's name split into its words: "mcp__stripe__create_payout" is
 * mcp, stripe, create, payout; "deleteFile" is delete, file. */
function wordsOf(tool: string): string[] {
  return tool
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Why this request is on the floor, or null when it is not.
 *
 * The reason is said rather than a yes or no, so a screen that leaves a
 * suggestion out could say why, and a test can tell one shape from
 * another.
 */
export function dangerous(ask: FloorAsk): string | null {
  const words = wordsOf(ask.tool ?? "");
  for (const [list, why] of TOOL_WORDS) {
    if (words.some((word) => list.includes(word))) return why;
  }
  if (ask.command) {
    for (const [pattern, why] of COMMANDS) if (pattern.test(ask.command)) return why;
  }
  if (ask.path) {
    const why = secretPlace(ask.path);
    if (why) return why;
  }
  if (ask.url) {
    const why = moneyOrSecretUrl(ask.url);
    if (why) return why;
  }
  return null;
}
