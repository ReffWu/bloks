// The way back to the end of a conversation, once you have left it.
//
// Scrolled up to read, nothing below moves under you (useStickToBottom),
// which also meant a reply could arrive down there with no sign at all.
// This small pill floats over the bottom of the transcript while you are
// away from the end: a plain arrow when nothing has happened, "3 new"
// when the agent has said something since you left. One press takes you
// down. It is a real button in the tab order, so the keyboard gets there
// too, and the count is read out politely as it changes.
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown } from "@/components/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export function JumpToLatest({
  show,
  fresh,
  onJump,
}: {
  show: boolean;
  /** Replies that arrived below since the reader left the end. */
  fresh: number;
  onJump: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <AnimatePresence initial={false}>
        {show && (
          <motion.div
            key="jump"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.12, ease: "easeOut" } }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            // the shadow sits on this wrapper, so the app's one focus
            // ring (also a shadow) is never overridden on the button
            className="pointer-events-auto rounded-full shadow-[0_6px_20px_-6px_var(--shadow-color)]"
          >
            <button
              type="button"
              onClick={onJump}
              aria-label={fresh > 0 ? `${fresh} new, jump to latest` : t("jumpToLatest.jumpToLatest")}
              title={t("jumpToLatest.jumpToLatest")}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full border text-small font-medium transition-[background-color,scale] duration-150 ease-out active:scale-[0.96]",
                // news is said in the colour of your own messages, so it
                // reads at a glance over any bubble; no news stays quiet
                fresh > 0
                  ? "border-transparent bg-primary pl-2.5 pr-3 text-primary-foreground hover:bg-primary/90"
                  : "w-8 justify-center border-foreground/10 bg-background text-foreground hover:bg-accent",
              )}
            >
              <ArrowDown size={14} strokeWidth={2.25} className="shrink-0" />
              {fresh > 0 && (
                <span aria-live="polite" className="tabular-nums">
                  {fresh > 99 ? "99+" : fresh} new
                </span>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
