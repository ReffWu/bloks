// Workspace settings' Members page (design: Main): the people in this
// workspace, their roles, the join password, and invitations. The page
// itself is src/components/members/MembersPage.tsx; this is where the
// workspace settings frame draws it, and what it tells the app back: how
// many people there are, for the switcher, and the workspace's name and
// mark, for its invites.
import { useCallback } from "react";
import type { WorkspaceInfo } from "@/types/bridge";
import { useStore } from "@/state/store";
import { MembersPage as Members } from "./members/MembersPage";

export function MembersPage({ workspace }: { workspace: WorkspaceInfo }) {
  const { dispatch } = useStore();
  const counted = useCallback((count: number) => void window.bloks?.workspaceMembers?.(count)?.catch(() => {}), []);
  // "Say hello in a room" leaves settings for the app, where the rooms are
  const back = useCallback(() => dispatch({ type: "toggleAppSettings", open: false }), [dispatch]);
  return <Members workspace={workspace} onCount={counted} onOpenRoom={back} />;
}
