// How words typed while the agent works will meet its turn, said before
// they are sent (server/delivery.ts).
//
// The server reads them, by the same rules it uses when they arrive, so
// what the composer says is what will happen; it is asked again a moment
// after the typing stops rather than on every key. The model a send may
// consult for words the rules cannot read is never asked from here: that
// is a decision for the send, not for each pause in typing.
import { useEffect, useState } from "react";
import { api } from "@/state/store";

export interface DeliveryPreview {
  route: "now" | "stop" | "queue";
  why: string;
  line: string;
  canSteer: boolean;
}

/** Long enough that a word in progress is not asked about. */
const SETTLE_MS = 250;

export function useDeliveryPreview(
  botId: string,
  taskId: string,
  text: string,
  working: boolean,
  choice: "now" | "wait" | null,
): DeliveryPreview | null {
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const asking = working && Boolean(text.trim());
  useEffect(() => {
    if (!asking) {
      setPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api(`/api/bots/${botId}/delivery`, {
        method: "POST",
        body: JSON.stringify({ text, taskId, ...(choice ? { choice } : {}) }),
      })
        .then((r: { busy?: boolean; line?: string | null; route?: DeliveryPreview["route"]; why?: string; canSteer?: boolean }) => {
          if (!live) return;
          setPreview(r.busy && r.line && r.route ? { route: r.route, why: r.why ?? "", line: r.line, canSteer: Boolean(r.canSteer) } : null);
        })
        // an older server, or a hiccup: the composer just says nothing
        .catch(() => live && setPreview(null));
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [botId, taskId, text, asking, choice]);
  return asking ? preview : null;
}
