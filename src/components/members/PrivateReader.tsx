// Members' private conversations with one agent, for the owner to read,
// and only while "Owner and admins can read members' private
// conversations" is on (GET /api/workspace/private/:botId). Off, the
// server lists nobody and this draws nothing at all.
//
// Quiet on purpose: a list under the agent's settings, each line a
// member's name, and a reader that only reads. Members are told this
// setting is on, and the page says so, so nobody forgets which way it is.
import { useEffect, useState } from "react";
import { Eye } from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/state/store";
import { shortDate, tintOf, initials } from "@/lib/members";
import type { MemberMessage } from "@/lib/memberRules";
import { Transcript } from "@/components/member/MemberParts";
import { t } from "@/lib/i18n";

interface PrivateConversation {
  threadId: string;
  personId: string;
  name: string;
  count: number;
  lastAt: number;
}

export function PrivateReader({ botId, botName }: { botId: string; botName: string }) {
  const [list, setList] = useState<{ line: string; conversations: PrivateConversation[] } | null>(null);
  const [open, setOpen] = useState<PrivateConversation | null>(null);
  const [messages, setMessages] = useState<MemberMessage[] | null>(null);
  useEffect(() => {
    api(`/api/workspace/private/${botId}`)
      .then((r: { readable: boolean; line?: string; conversations: PrivateConversation[] }) =>
        setList(r.readable && r.conversations.length ? { line: r.line ?? "", conversations: r.conversations } : null),
      )
      .catch(() => setList(null));
  }, [botId]);
  useEffect(() => {
    if (!open) return setMessages(null);
    api(`/api/bots/${botId}/messages?thread=${open.threadId}&limit=300`)
      .then((r: { messages: MemberMessage[] }) => setMessages(r.messages))
      .catch(() => setMessages([]));
  }, [open, botId]);
  if (!list) return null;
  return (
    <section className="pt-12">
      <div className="mb-4 px-1">
        <h2 className="text-title font-semibold text-foreground">{t("privateReader.privateConversations")}</h2>
        <p className="mt-1 text-pretty text-body text-muted-foreground">
          Members' own conversations with {botName}, to read only. {list.line}
        </p>
      </div>
      <div className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
        {list.conversations.map((c) => (
          <button
            key={c.threadId}
            type="button"
            onClick={() => setOpen(c)}
            className="flex items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/50"
          >
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full text-small font-semibold text-white/90" style={{ background: tintOf(c.personId) }}>
              {initials(c.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui text-foreground">{c.name}</span>
              <span className="block text-small tabular-nums text-muted-foreground">
                {c.count} {c.count === 1 ? "message" : "messages"} · last {shortDate(c.lastAt)}
              </span>
            </span>
            <Eye size={15} className="shrink-0 text-muted-foreground" aria-hidden />
          </button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="flex h-[min(720px,calc(100dvh-4rem))] w-[calc(100%-2rem)] max-w-[680px] flex-col p-0">
          <div className="border-b px-5 py-4 pr-12">
            <DialogTitle>{open?.name} and {botName}</DialogTitle>
            <DialogDescription>Read only. {open?.name} was told that you and the admins can read this.</DialogDescription>
          </div>
          {messages && open ? (
            <Transcript
              messages={messages}
              me={open.personId}
              people={{ [open.personId]: open.name }}
              owner="You"
              shared={false}
              agentName={() => botName}
              streaming=""
              busy={false}
            />
          ) : (
            <div className="flex-1" />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
