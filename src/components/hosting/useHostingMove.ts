// The move as the app tells it (electron/main.mjs, hosting:move), for
// every screen that shows a part of it: the card, the toast, the banner.
// Null outside the desktop app, where there is no move to carry.
import { useEffect, useState } from "react";
import type { HostingMoveState } from "@/types/bridge";

export function useHostingMove(): HostingMoveState | null {
  const [state, setState] = useState<HostingMoveState | null>(null);
  useEffect(() => {
    const bridge = window.bloks;
    if (!bridge?.hostingMoveState) return;
    let live = true;
    void bridge
      .hostingMoveState()
      .then((said) => live && setState(said))
      .catch(() => {});
    const off = bridge.onHostingMove?.((said) => setState(said));
    return () => {
      live = false;
      off?.();
    };
  }, []);
  return state;
}

/** A bridge call that answers `{ error }` rather than throwing, as a
 * promise that throws it, so a screen can show it in its sentence. */
export async function said<T extends { error?: string }>(call: Promise<T> | undefined): Promise<T> {
  const answer = await call;
  if (answer?.error) throw new Error(answer.error);
  return answer as T;
}
