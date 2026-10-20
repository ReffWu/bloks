// Joining a workspace on someone else's computer, from an invite's link
// or its 8-character code (design: Mac-Join). The dialog itself is
// src/components/members/JoinWorkspaceDialog.tsx; this is where the
// switcher opens it, and what a finished join becomes here: the main
// process keeps the membership in the keychain, lists the workspace, and
// switches to it when the person presses Open (workspaces:joined).
import { useMemo } from "react";
import { toast } from "@/components/ui/toast";
import { currentWorkspace, useWorkspaces } from "@/lib/workspaces";
import { takeJoinInput } from "@/lib/members";
import { JoinWorkspaceDialog as Join, type Joined } from "./members/JoinWorkspaceDialog";

async function keep(joined: Joined) {
  const { credentials, welcome, open } = joined;
  const answer = await window.bloks?.workspaceJoined?.({
    profile: {
      relayUrl: credentials.relayUrl,
      relayToken: credentials.relayToken,
      deviceId: credentials.deviceId,
      deviceToken: credentials.deviceToken,
      // where it answers on the owner's network: the only way in for a
      // join that never touched Bloks Cloud
      lan: credentials.lan,
    },
    role: credentials.role,
    name: welcome.workspace.name,
    mark: welcome.workspace.mark,
    host: welcome.inviter,
    open,
  });
  if (answer?.error) toast.error(answer.error);
}

export function JoinWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const here = currentWorkspace(useWorkspaces());
  // what it was opened with (a bloks://join link), taken once per opening
  const initial = useMemo(() => (open ? takeJoinInput() : ""), [open]);
  return (
    <Join
      open={open}
      onOpenChange={onOpenChange}
      initialInput={initial}
      currentWorkspace={here?.name}
      onJoined={(joined) => void keep(joined)}
    />
  );
}
