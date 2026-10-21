// What a move says on its own, outside the Plan page: the few seconds'
// toast before a move started without asking begins ("Moving Personal to
// your hosted machine.", with Change), and the one calm sentence in the
// workspace it landed in once it is done. Each is said once.
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { useStore } from "@/state/store";
import { useHostingMove } from "./useHostingMove";

export function HostingMoveToasts() {
  const state = useHostingMove();
  const { dispatch } = useStore();
  const toldStart = useRef<string | null>(null);
  const move = state?.move ?? null;

  useEffect(() => {
    if (!move || move.phase !== "waiting" || toldStart.current === move.id) return;
    toldStart.current = move.id;
    const left = Math.max(1_000, (move.startsAt ?? Date.now()) - Date.now());
    toast.info(move.starting, {
      id: `move-${move.id}`,
      duration: left,
      // the card under Hosting has the list of workspaces to choose from
      action: { label: "Change", onClick: () => dispatch({ type: "toggleAppSettings", open: true, page: "plan" }) },
    });
  }, [move?.id, move?.phase]);

  useEffect(() => {
    if (!move || move.phase !== "done" || move.announced || !move.done) return;
    // said where the work is now, which is where the app switched to
    if (window.bloks?.workspace?.id !== move.to.id) return;
    toast.success(move.done, { id: `moved-${move.id}`, duration: 8_000 });
    void window.bloks?.hostingMoveAnnounced?.();
  }, [move?.id, move?.phase, move?.announced]);

  return null;
}
