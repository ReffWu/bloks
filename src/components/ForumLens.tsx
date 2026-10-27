// The room, read as topics instead of as a stream.
//
// Same messages, same order underneath, grouped by what they answer. A
// room with four agents in it flattens badly: a reply to something from
// ten minutes ago lands at the bottom next to three unrelated things, and
// the reader reassembles the conversation from the shape of the
// sentences. This is the other way to look at it.
//
// It is a lens rather than a mode: nothing is stored differently, nothing
// is sent differently, and every message appears in both. Switching is a
// question of what you are trying to read right now.
import { useState } from "react";
import { ChevronDown } from "@/components/icons";
import { ChevronRight } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import { preview, replyLabel, threadsFrom, type Thread } from "@/lib/threads";
import type { Bot, Message, RoomPerson } from "@/state/reducer";
import { AgentAvatar } from "./Avatar";
import { splitAttachments } from "@/lib/attachments";
import { cn } from "@/lib/cn";
import { formatDate, formatList, t } from "@/lib/i18n";

function when(at: number): string {
  if (!at) return "";
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? formatDate(date, { hour: "numeric", minute: "2-digit" })
    : formatDate(date, { month: "short", day: "numeric" });
}

/** What a message says, with the files it carried named rather than
 * spelled out as the tags they travel in. */
function said(message: Message): Message {
  if (!message.text) return message;
  const { display, images, files } = splitAttachments(message.text);
  const carried = images.length + files.length;
  if (!carried) return message;
  const oneImage = carried === 1 && images.length > 0;
  const text = display
    ? oneImage
      ? t("forumLens.withAnImage", { text: display })
      : t("forumLens.withFiles", { text: display, count: carried })
    : oneImage
      ? t("forumLens.sharedAnImage")
      : t("forumLens.sharedFiles", { count: carried });
  return { ...message, text };
}

/** Whoever is not an agent: you, or somebody the room is shared with,
 * by their initial, as the stream draws them. */
function PersonFace({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function ForumLens({
  messages,
  members,
  people = [],
  onOpenInStream,
}: {
  messages: Message[];
  members: Bot[];
  /** The people a shared room is shared with, so their words carry their
   * names rather than reading as yours. */
  people?: RoomPerson[];
  /** Jump to this message in the stream, because a topic worth reading is
   * often a topic worth answering, and answering happens there. */
  onOpenInStream: (messageId: string) => void;
}) {
  const nameOf = (message: Message) =>
    message.role === "user"
      ? message.author
        ? (people.find((p) => p.id === message.author)?.name ?? t("forumLens.aFormerMember"))
        : t("forumLens.you")
      : message.from
        ? (members.find((b) => b.id === message.from)?.name ?? t("common.agent"))
        : // the room's own lines, its opening one among them
          t("forumLens.room");
  const threads = threadsFrom(messages.map(said), nameOf);
  const [open, setOpen] = useState<string | null>(null);

  if (!threads.length) {
    return (
      <div className="mx-auto flex max-w-[var(--transcript-width,760px)] flex-col items-center gap-1 px-4 py-16 text-center md:px-6">
        <span className="mb-2 flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <MessageSquare size={16} />
        </span>
        <span className="text-ui font-medium text-foreground">{t("forumLens.noTopicsYet")}</span>
        <span className="max-w-[280px] text-pretty text-body text-muted-foreground">
          {t("forumLens.whatIsSaidHereShows")}
        </span>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[var(--transcript-width,760px)] flex-col gap-1.5 px-4 pb-6 pt-3 md:px-6">
      {threads.map((thread) => (
        <ThreadRow
          key={thread.root.id}
          thread={thread}
          members={members}
          nameOf={nameOf}
          open={open === thread.root.id}
          onToggle={() => setOpen(open === thread.root.id ? null : thread.root.id)}
          onOpenInStream={onOpenInStream}
        />
      ))}
    </div>
  );
}

function ThreadRow({
  thread,
  members,
  nameOf,
  open,
  onToggle,
  onOpenInStream,
}: {
  thread: Thread;
  members: Bot[];
  nameOf: (message: Message) => string;
  open: boolean;
  onToggle: () => void;
  onOpenInStream: (messageId: string) => void;
}) {
  const author = members.find((b) => b.id === thread.root.from);
  const replies = replyLabel(thread.replies.length);

  return (
    <div className={cn("rounded-2xl border bg-card transition-colors duration-150", open && "border-foreground/20")}>
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-3 text-left">
        <span className="mt-0.5 shrink-0">
          {author ? (
            <AgentAvatar bot={author} size={26} />
          ) : thread.root.role === "user" ? (
            <PersonFace name={nameOf(thread.root)} size={26} />
          ) : (
            <span className="flex size-[26px] items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <MessageSquare size={13} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-body font-medium text-foreground">{nameOf(thread.root)}</span>
            <span className="text-small text-muted-foreground">{when(thread.root.at)}</span>
          </span>
          <span className={cn("mt-0.5 block text-body leading-relaxed text-foreground", !open && "line-clamp-2")}>
            {open ? (thread.root.text ?? preview(thread.root)) : preview(thread.root)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-small text-muted-foreground">
            {replies ? <span className="text-brand-ink">{replies}</span> : <span>{t("forumLens.noRepliesYet")}</span>}
            {thread.participants.length > 1 && <span>· {formatList(thread.participants, { type: "unit" })}</span>}
            {thread.replies.length > 0 && <span>{t("forumLens.lastAt", { when: when(thread.lastAt) })}</span>}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      {open && (
        <div className="border-t px-3 pb-3 pt-2">
          {thread.replies.length === 0 ? (
            <p className="py-2 text-body text-muted-foreground">
              {t("forumLens.nobodyHasAnsweredThisYet")}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {thread.replies.map((reply) => {
                const from = members.find((b) => b.id === reply.from);
                return (
                  <div key={reply.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0">
                      {from ? <AgentAvatar bot={from} size={20} /> : <PersonFace name={nameOf(reply)} size={20} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-small font-medium text-foreground">{nameOf(reply)}</span>
                        <span className="text-caption text-muted-foreground">{when(reply.at)}</span>
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap text-body leading-relaxed text-foreground">
                        {reply.text ?? preview(reply)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button
            onClick={() => onOpenInStream(thread.root.id)}
            className="mt-3 rounded-lg px-2 py-1 text-small text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
          >
            {t("forumLens.findItInTheStream")}
          </button>
        </div>
      )}
    </div>
  );
}
