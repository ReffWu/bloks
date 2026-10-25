// Archiving, restoring or deleting an agent, sent after the list already
// shows it.
//
// The row moves first, into the drawer or out of it or away, so the press
// feels instant. That is only honest if a refusal undoes it, the same as
// for a room (src/lib/roomPatch.ts): before, a failed archive left the
// agent hidden with no word, and a failed restore left it looking
// restored until the next reload. So a failure is said, and the agents
// are taken from the server again, which is the one place that knows
// what happened.

// The list asked for after a refusal is ordered against the stream like
// any other (src/state/snapshotOrder.ts): `begin` opens that, and the
// list comes back with where it was made and the load it belongs to.

import type { SnapshotLoad } from "@/state/snapshotOrder";

type Api = (path: string, init?: RequestInit) => Promise<any>;

export function sendBotArchive<A = unknown>(
  api: Api,
  botId: string,
  how: "archive" | "forget" | "restore",
  hydrate: (bots: any[], seq?: unknown, load?: SnapshotLoad<A>) => void,
  showError: (e: unknown) => void,
  begin?: () => SnapshotLoad<A>,
): Promise<void> {
  const sent =
    how === "restore"
      ? api(`/api/bots/${botId}/restore`, { method: "POST" })
      : api(`/api/bots/${botId}${how === "forget" ? "?forget=1" : ""}`, { method: "DELETE" });
  return sent.then(
    () => {},
    (e) => {
      showError(e);
      const load = begin?.();
      return api("/api/bots").then(
        ({ bots, seq }) => hydrate(bots, seq, load),
        () => load?.drop(),
      );
    },
  );
}
