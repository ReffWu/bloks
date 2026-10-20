// Joining a workspace on someone else's computer, from an invite's link
// or its 8-character code (design: Mac-Join).
//
// A slot for now: the invites work (codes, the claim, the owner's
// approval) fills this in. The switcher already opens it, and once a
// join is approved the main process keeps the membership and lists the
// workspace (addJoinedWorkspace in electron/main.mjs).
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function JoinWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] rounded-[20px] p-6">
        <DialogTitle className="text-balance">Join a workspace</DialogTitle>
        <DialogDescription className="text-pretty">Paste the invite link, or type its 8-character code.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
