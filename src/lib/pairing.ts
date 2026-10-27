// What the Phone access card says about where its phones reach, and when
// it could not ask (src/components/DevicesSection.tsx).
//
// The desktop app can be a window onto a workspace on another computer,
// a server with no screen among them, and the card used to say "this Mac"
// about it and show an older server's bare refusal (GitHub 403). The
// server now says which computer it is and whether that is this one; this
// is the reading of that, kept apart so it can be tested without a window.

/** The fields of the server's pairing status this reads. A server from
 * before 3.0.15 sends none of `computer`, `here` and `thisDevice`. */
export interface PairingWhere {
  enabled: boolean;
  restartRequired?: boolean;
  listening?: "loopback" | "network";
  computer?: string;
  here?: boolean;
}

/** Said instead of an older server's refusal of the owner's own device. */
export const PAIRING_ELSEWHERE =
  "The computer this workspace runs on has an older Bloks, which pairs phones only there. Update it to 3.0.15 or newer to pair from here. On a server, bloks-server pair prints a link in the meantime.";

/** The line the card shows for an answer that was not a success. `said`
 * is the answer's error, if it had one; `fallback` is for one that said
 * nothing. Only the bare refusal is replaced: everything else the server
 * says is already in words meant for the person. */
export function pairingTrouble(status: number, said: unknown, fallback: string): string {
  if (status === 403 && said === "not from here") return PAIRING_ELSEWHERE;
  return typeof said === "string" && said.trim() ? said : fallback;
}

/** The computer the phones reach, by its name, when it is not the one this
 * window is on; null when it is, or when the server did not say. */
export function pairingAway(status: PairingWhere | null): string | null {
  if (!status || status.here !== false) return null;
  return status.computer?.trim() || "the workspace's computer";
}

/** On, and reached through Bloks Cloud alone: a server that answers
 * nothing on its network (bloks-server), where no restart would change
 * that, so a six digit code is one no phone could trade in and a link is
 * the way. */
export function cloudOnly(status: PairingWhere | null): boolean {
  return Boolean(status?.enabled && !status.restartRequired && status.listening === "loopback");
}
