// What the Apps card says when a server's apps could not be had
// (src/components/McpApps.tsx).
//
// A server that would not answer is said in the workspace's own words,
// which name the server and why. A refusal is not: an older Bloks on the
// computer the workspace runs on answers "not from here" to every device
// but its own window (GitHub 356), and those words tell the person
// reading them nothing about what to do.

import { t, type MessageKey } from "./i18n.ts";

/** Said instead of a refusal of the owner's own device: the key, so the
 * words are read in the reader's language when the card draws them. */
export const APPS_ELSEWHERE: MessageKey = "libMcpApps.appsElsewhere";

/** The line the card shows for an answer that was not a success.
 * `said` is the answer's error, if it had one; `fallback` is for one that
 * said nothing. A tool the server did not publish is a refusal too, but
 * one worth its own words, so only the routes' refusal is replaced. */
export function appsTrouble(status: number, said: unknown, fallback: string): string {
  if (status === 403 && said === "not from here") return t(APPS_ELSEWHERE);
  return typeof said === "string" && said.trim() ? said : fallback;
}
