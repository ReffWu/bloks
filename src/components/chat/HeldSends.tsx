// A message sent while your hosted workspace wakes, standing where it will
// land: your own bubble, a little faded, with why it waits. It sends
// itself once the workspace is up (src/lib/waking.ts), and its own copy
// takes its place. If the workspace never wakes, the words go back into
// the composer, which says why.
//
// Before the workspace has said it is asleep (Bloks Cloud holds the first
// ask a few seconds before it does), a send that is slow to go is only on
// its way, and says no more than that.
import { Cloud } from "@/components/icons";
import { Hourglass } from "@/components/icons";
import { RANK, type Notice } from "@/components/composer/Tray";
import { cn } from "@/lib/cn";
import { dismissUnsent, heldToShow, isHostedWindow, useHeldSends, useUnsentReason, useWake, type HeldSend } from "@/lib/waking";
import type { Message } from "@/state/store";
import { GroupMessage } from "./Group";

/** The composer's word on a send that waited for your hosted workspace and
 * came back because it never woke: the reason, beside the words it handed
 * back (in the box, or kept for it when the box had others). */
export function useUnsentNotice(conversation: string): Notice | null {
  const reason = useUnsentReason(conversation);
  if (!reason) return null;
  return {
    id: "unsent-waking",
    tone: "warn",
    rank: RANK.feedback,
    icon: <Cloud size={14} />,
    title: reason,
    detail: "Your message is back here to send again.",
    onDismiss: () => dismissUnsent(conversation),
  };
}

export function HeldSends({
  conversation,
  said,
  queued,
  group,
}: {
  /** The conversation's key, the composer's own. */
  conversation: string;
  /** What the conversation shows, so a send whose copy arrived is not drawn twice. */
  said: readonly Message[];
  /** What waits to be said in it. */
  queued?: readonly Message[];
  /** Drawn among several voices (chat/Group.tsx). */
  group?: boolean;
}) {
  const wake = useWake();
  const held = useHeldSends(conversation);
  const shown = heldToShow(held, { waking: wake.waking, hosted: isHostedWindow() }, said, queued);
  if (!shown.length) return null;
  const why = wake.waking ? "Sends when your hosted workspace is awake" : "Sending";
  return (
    <>
      {shown.map((send, i) =>
        group ? (
          <GroupMessage
            key={`held:${send.id}`}
            mine
            first={i === 0}
            last={false}
            at={send.at}
            bubbleClassName="opacity-60"
            bubble={<div className="whitespace-pre-wrap">{send.text}</div>}
            under={i === shown.length - 1 ? <Why words={why} /> : undefined}
          />
        ) : (
          <Solo key={`held:${send.id}`} send={send} why={i === shown.length - 1 ? why : null} />
        ),
      )}
    </>
  );
}

function Solo({ send, why }: { send: HeldSend; why: string | null }) {
  return (
    <div data-bubble="user" className="flex flex-col items-end">
      <div className="flex max-w-[82%] flex-col items-end sm:max-w-[68%]">
        <div className="min-w-0 whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-lead text-foreground opacity-60 [overflow-wrap:anywhere]">
          {send.text}
        </div>
        {why && <Why words={why} />}
      </div>
    </div>
  );
}

function Why({ words, className }: { words: string; className?: string }) {
  return (
    <div role="status" className={cn("mt-1 flex items-center gap-1 px-1 text-caption text-muted-foreground", className)}>
      <Hourglass size={12} className="shrink-0" />
      {words}
    </div>
  );
}
