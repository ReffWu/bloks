// The two dialogs a workspace opens from anywhere (the switcher, the
// command palette, the settings), drawn once at the top of the app.
import { openWorkspaceDialog, useWorkspaceDialog } from "@/lib/workspaces";
import { JoinWorkspaceDialog } from "./JoinWorkspaceDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";

export function WorkspaceDialogs() {
  const open = useWorkspaceDialog();
  const close = (next: boolean) => !next && openWorkspaceDialog(null);
  return (
    <>
      <NewWorkspaceDialog open={open === "new"} onOpenChange={close} />
      <JoinWorkspaceDialog open={open === "join"} onOpenChange={close} />
    </>
  );
}
