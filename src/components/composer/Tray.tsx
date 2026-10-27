// The one tray above the composer.
//
// A conversation can have a dozen things to say above the box: approvals
// waiting, an engine that is down, a message queued, a goal, a draft that
// never went. Each used to bring its own strip, border and shade of amber,
// and a busy conversation stacked them until the box was pushed half way
// up the window. Here they are one list in one style, the most pressing
// first, and only two are open at a time. The rest wait behind "+N more",
// which says how many without making anyone read them.
//
// A notice is data, not a component, so the tray can count and order
// them before anything is drawn. What a notice needs that is more than a
// line (the fix for an engine, a queued message being edited) rides along
// as its body and shows under its row.
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "@/components/icons";
import { X } from "@/components/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/** How much a notice is asking for. Urgent ones block the work. */
export type NoticeTone = "urgent" | "warn" | "info";

export interface Notice {
  id: string;
  tone: NoticeTone;
  /** Lower comes first (see RANK). */
  rank: number;
  icon: ReactNode;
  title: ReactNode;
  /** A second, quieter part of the line. */
  detail?: ReactNode;
  /** Buttons at the end of the line. */
  actions?: ReactNode;
  /** More than a line: drawn under the row, and only while the row is. */
  body?: ReactNode;
  /** The whole of a line that may be cut short, on hover. */
  hint?: string;
  /** Open even when it would fold: something in it has the keyboard,
   * and folding it away would throw the typing away with it. */
  keepOpen?: boolean;
  onDismiss?: () => void;
  dismissLabel?: string;
}

/**
 * Where each kind sits. Things that stop the agent come first, then what
 * the person just did and did not land (a refused file, a microphone),
 * because they are looking for it, then what is waiting elsewhere, then
 * what is only worth knowing.
 */
export const RANK = {
  approvals: 10,
  engine: 20,
  feedback: 30,
  goalStuck: 35,
  otherLanes: 40,
  unsent: 45,
  queued: 50,
  goal: 60,
  suggestion: 65,
  guestMail: 70,
} as const;

/** How many are open before the rest fold behind "+N more". */
const OPEN = 2;

const ease = [0.23, 1, 0.32, 1] as const;

const TONE: Record<NoticeTone, string> = {
  urgent: "text-warning",
  warn: "text-warning",
  info: "text-muted-foreground",
};

/** A small button for a notice's line, all of them the same size. */
export function TrayButton({
  children,
  onClick,
  strong,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  /** The one press most people want. */
  strong?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-7 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-small font-medium transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        strong ? "bg-primary text-primary-foreground hover:opacity-90" : "text-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function Row({ notice: n }: { notice: Notice }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.18, ease }}
      role="group"
      aria-label={typeof n.title === "string" ? n.title : undefined}
      className="border-t border-border/70 first:border-t-0"
    >
      <div className="flex min-h-10 items-center gap-2.5 py-1.5 pl-3 pr-1.5">
        <span className={cn("flex size-4 shrink-0 items-center justify-center", TONE[n.tone])} aria-hidden>
          {n.icon}
        </span>
        <span className="line-clamp-2 min-w-0 flex-1 py-0.5 text-body leading-snug" title={n.hint}>
          <span className="text-foreground">{n.title}</span>
          {n.detail && <span className="text-muted-foreground"> {n.detail}</span>}
        </span>
        {n.actions && <span className="flex shrink-0 items-center gap-0.5">{n.actions}</span>}
        {n.onDismiss && (
          <button
            type="button"
            onClick={n.onDismiss}
            aria-label={n.dismissLabel ?? t("common.dismiss")}
            title={n.dismissLabel ?? t("common.dismiss")}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-95"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {n.body && <div className="pb-2 pl-[38px] pr-3">{n.body}</div>}
    </motion.div>
  );
}

/**
 * The tray itself. Nothing at all with nothing to say. It tucks under the
 * top edge of the composer, so the two read as one object rather than a
 * card balanced on another card.
 */
export function NoticeTray({ notices, className }: { notices: Notice[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const sorted = [...notices].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const collapsed = sorted.filter((n, i) => i < OPEN || n.keepOpen);
  // a list that shrank back to two has nothing left to fold, so the next
  // time it grows it starts folded again
  const folds = collapsed.length < sorted.length;
  useEffect(() => {
    if (!folds) setOpen(false);
  }, [folds]);
  const expanded = open && folds;
  const shown = expanded ? sorted : collapsed;
  const hidden = sorted.length - collapsed.length;
  if (!sorted.length) return null;
  return (
    <section
      aria-label={t("tray.notices")}
      className={cn(
        "relative mx-3 max-h-[45vh] overflow-y-auto overscroll-contain rounded-t-2xl border border-b-0 bg-card pb-3 shadow-[0_-1px_3px_var(--shadow-color)] sm:mx-4",
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {shown.map((n) => (
          <Row key={n.id} notice={n} />
        ))}
      </AnimatePresence>
      {folds && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          className="flex h-8 w-full items-center gap-1.5 border-t border-border/70 pl-[38px] text-left text-small text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          {expanded ? t("tray.showLess") : `+${hidden} more`}
          <ChevronDown
            size={12}
            className={cn("transition-transform duration-200 ease-out", expanded && "rotate-180")}
          />
        </button>
      )}
    </section>
  );
}
