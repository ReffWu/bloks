// Workspace settings' Members page (design: Main): the people in this
// workspace, their roles, the join password, and invitations.
//
// A slot for now: the members work fills this in. It is drawn inside
// WorkspaceSettings.tsx, which gives it the page's heading area, and it
// can tell the switcher how many people there are with
// window.bloks.workspaceMembers(count).
import type { WorkspaceInfo } from "@/types/bridge";

export function MembersPage({ workspace }: { workspace: WorkspaceInfo }) {
  return (
    <div data-workspace={workspace.id}>
      <h1 className="text-balance text-heading font-semibold text-foreground">Members</h1>
    </div>
  );
}
