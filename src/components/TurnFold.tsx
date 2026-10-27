// A finished turn's work as one line (GitHub 257).
//
// What folds and what the line counts is decided in src/lib/turnFold.ts;
// this draws it. The line reads like the collapsed tool line it replaces
// a dozen of: small, muted, a chevron, and the work again in place when
// it is pressed. An agent that asked for the turn is named first, and
// its name is the way into the exchange between the two, which the
// "After a message from" link used to be.
//
// A turn that ends while you watch settles into its line: the work above
// the reply goes, and the line comes up in its place over a beat, rather
// than the page swapping one for the other in a frame. A fold drawn
// because a conversation was opened is simply there.
import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronRight } from "@/components/icons";
import { useStore } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { askerWords, foldWords, type Asker, type TurnFold } from "@/lib/turnFold";
import { kindOf } from "@/lib/tool-summary";
import { goalNoteForPerson } from "@/lib/goalNote";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** How recent a fold's newest row must be for it to count as a turn
 * that ended just now: the last call can come well before the reply. */
const SETTLE_WINDOW_MS = 60_000;
/** When each fold was first drawn on this screen. */
const settled = new Map<string, number>();

export function TurnFoldLine({
  fold,
  open,
  onToggle,
  onOpenExchange,
  onOpenTrace,
  className,
  children,
}: {
  fold: TurnFold;
  open: boolean;
  onToggle: () => void;
  onOpenExchange?: (asker: Extract<Asker, { by: "agent" }>) => void;
  /** Opens the turn's timeline beside the chat. */
  onOpenTrace?: () => void;
  className?: string;
  /** The work, drawn by whoever draws the conversation. Only when open. */
  children?: ReactNode;
}) {
  const { state } = useStore();
  // Just ended: its newest row is recent, and this fold has not settled
  // on this screen before. Decided once, when it is first drawn, so
  // opening it, closing it or coming back to it never plays it again.
  const [settling] = useState(() => {
    const now = Date.now();
    const newest = fold.messages.reduce((at, m) => Math.max(at, m.at ?? 0), 0);
    if (now - newest > SETTLE_WINDOW_MS) return false;
    // the same first drawing, asked twice (React's strict mode), agrees
    if (!settled.has(fold.key)) settled.set(fold.key, now);
    return now - settled.get(fold.key)! < 250;
  });
  const botOf = (id: string) => state.bots.find((b) => b.id === id);
  const asker = fold.asker;
  const askedBy = asker?.by === "agent" ? botOf(asker.peerId) : undefined;
  const speaker = fold.speaker ? botOf(fold.speaker) : undefined;
  const lead = asker
    ? askerWords(asker, { name: askedBy?.name, turn: asker.by === "goal" ? goalNoteForPerson(asker.text).turn : undefined })
    : null;
  // another agent's name is a button of its own, beside the one that opens
  const linked = asker?.by === "agent" && onOpenExchange ? asker : null;
  const counted = foldWords(fold, kindOf).join(" · ");
  const words = linked
    ? counted
    : lead
      ? `${lead} · ${counted}`
      : fold.speaker
        ? `${speaker?.name ?? "An agent"} ${counted}`
        : counted.charAt(0).toUpperCase() + counted.slice(1);
  const messaged = fold.messaged.map((peer) => ({ ...peer, bot: botOf(peer.peerId) }));
  const names = messaged.map((peer) => peer.bot?.name ?? peer.peerName);
  return (
    <motion.div
      className={cn("flex flex-col items-start px-1.5", className)}
      data-turn-fold={fold.key}
      initial={settling ? { opacity: 0, y: 6, scale: 0.985 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
      style={{ transformOrigin: "left center" }}
    >
      <div
        className={cn(
          "group/fold flex min-w-0 max-w-full items-center gap-1.5 text-small",
          // nothing was said to the person: quiet, like a quiet check-in
          fold.alone ? "text-muted-foreground/80" : "text-muted-foreground",
        )}
      >
        {linked && (
          <>
            <button
              onClick={() => onOpenExchange?.(linked)}
              title={t("turnFold.openTheExchange")}
              className="flex min-w-0 max-w-[50%] shrink-0 items-center gap-1.5 rounded-md py-0.5 transition-colors duration-150 hover:text-foreground"
            >
              {askedBy && <AgentAvatar bot={askedBy} size={16} className="shrink-0" />}
              <span className="truncate">{lead}</span>
            </button>
            <span aria-hidden>·</span>
          </>
        )}
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 transition-colors duration-150 hover:text-foreground"
        >
          {speaker && <AgentAvatar bot={speaker} size={16} className="shrink-0" />}
          <span className="truncate">{words}</span>
          {messaged.length > 0 && (
            <span className="flex shrink-0 items-center gap-1" title={`Messaged ${names.join(", ")}`}>
              <span aria-hidden>·</span>
              <span className="sr-only">{t("turnFold.messaged")}</span>
              {messaged.map((peer) => peer.bot && <AgentAvatar key={peer.peerId} bot={peer.bot} size={16} />)}
              {/* one is named; several are faces, and names where a face is gone */}
              {messaged.length === 1 ? (
                <span>{names[0]}</span>
              ) : (
                messaged.some((peer) => !peer.bot) && (
                  <span>
                    {messaged
                      .filter((peer) => !peer.bot)
                      .map((peer) => peer.peerName)
                      .join(", ")}
                  </span>
                )
              )}
            </span>
          )}
          {fold.replied && <span className="shrink-0">{t("turnFold.replied")}</span>}
          <ChevronRight size={12} className={cn("shrink-0 transition-transform duration-200", open && "rotate-90")} />
        </button>
        {/* The same work again, laid out in time, beside the chat so the
            line can stay folded. Said when the line is pointed at or
            reached by keyboard: a page of folds each offering it at
            rest would be a page of the same word. */}
        {onOpenTrace && (
          <span className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover/fold:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <span aria-hidden>·</span>
            <button
              onClick={onOpenTrace}
              title={t("turnFold.seeThisTurnsTimeline")}
              className="rounded-md py-0.5 transition-colors duration-150 hover:text-foreground"
            >
              {t("turnFold.timeline")}
            </button>
          </span>
        )}
      </div>
      {open && (
        <div className="ml-[5px] mt-1.5 flex animate-fade-in flex-col gap-2.5 self-stretch border-l pl-3">{children}</div>
      )}
    </motion.div>
  );
}
