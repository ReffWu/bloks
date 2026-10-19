// The composer's frame, apart from what it sends to.
//
// The tray, the box, what rides in the box above the words (a reply, the
// files, a rehearsal), the words, and a footer of controls with Send at
// the end. None of it knows about agents: an agent's Composer fills it
// in, and a room can fill in the same frame with its own field, its @
// list and its own send, and look like the same app doing the same job.
import type { DragEvent, ReactNode } from "react";
import { ArrowUp } from "@/components/icons";
import { Square } from "@/components/icons";
import { cn } from "@/lib/cn";
import { NoticeTray, type Notice } from "./Tray";

/**
 * Send, which becomes Stop while the agent works and the box is empty.
 *
 * One button that changes, rather than two that swap. The fill fades in
 * when there is something to send, and the arrow turns into the square
 * in place, so the eye stays on one spot and reads it as the same press
 * meaning something else now. Only transform and opacity move; colours
 * are separate layers faded over each other. A faint ring turns round
 * the button while it means Stop, which is the one sign on the box that
 * work is going on.
 */
export function SendStop({
  mode,
  onSend,
  onStop,
  sendLabel = "Send",
  stopLabel = "Stop (Esc)",
}: {
  /** idle: nothing to send. send: something to send. stop: working, and
   * nothing typed to add to it. */
  mode: "idle" | "send" | "stop";
  onSend: () => void;
  onStop?: () => void;
  sendLabel?: string;
  stopLabel?: string;
}) {
  const stop = mode === "stop";
  const filled = mode !== "idle";
  return (
    <button
      type="button"
      onClick={stop ? onStop : onSend}
      disabled={mode === "idle"}
      title={stop ? stopLabel : sendLabel}
      aria-label={stop ? "Stop" : sendLabel}
      className="relative flex size-8 shrink-0 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-90 disabled:cursor-not-allowed disabled:active:scale-100"
    >
      <span aria-hidden className="absolute inset-0 flex items-center justify-center rounded-full bg-muted text-muted-foreground/60">
        <ArrowUp size={17} strokeWidth={2.4} />
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full bg-primary text-primary-foreground transition-[opacity,transform] duration-200 ease-out-quart",
          filled ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      >
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-200 ease-out-quart",
            stop ? "-rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100",
          )}
        >
          <ArrowUp size={17} strokeWidth={2.4} />
        </span>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-200 ease-out-quart",
            stop ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
        >
          <Square size={11} className="fill-current" />
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-[3px] rounded-full border-[1.5px] border-transparent border-t-foreground/35 transition-opacity duration-200",
          stop ? "animate-spin opacity-100 [animation-duration:1.4s] motion-reduce:animate-none" : "opacity-0",
        )}
      />
    </button>
  );
}

/** A round button for the footer, the size every one of them is. */
export function FooterButton({
  children,
  onClick,
  title,
  pressed,
  className,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  pressed?: boolean;
  className?: string;
  /** Words beside the icon, where there is room for them. */
  label?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label ? undefined : title}
      aria-pressed={pressed}
      className={cn(
        "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-95",
        label ? "px-2.5 max-sm:w-8 max-sm:px-0" : "w-8",
        pressed && "bg-brand-soft text-brand-ink hover:bg-brand-soft hover:text-brand-ink",
        className,
      )}
    >
      {children}
      {label && <span className="text-small font-medium max-sm:hidden">{label}</span>}
    </button>
  );
}

export function ComposerShell({
  notices,
  popover,
  chips,
  children,
  footerStart,
  footerEnd,
  overlay,
  onDragOver,
  onDrop,
}: {
  /** What the tray says, in any order: it sorts them. */
  notices: Notice[];
  /** A list over the box, such as `/` or `@`. */
  popover?: ReactNode;
  /** What the next message carries besides its words. */
  chips?: ReactNode;
  /** The text field. */
  children: ReactNode;
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  /** Drawn over the window, such as the drop target. */
  overlay?: ReactNode;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const tray = notices.length > 0;
  return (
    <div className="px-4 pb-4 pt-1 md:px-6 md:pb-5" onDragOver={onDragOver} onDrop={onDrop}>
      {overlay}
      <div className="mx-auto max-w-[var(--transcript-width,760px)]">
        <NoticeTray notices={notices} />
        <div
          className={cn(
            "relative z-10 rounded-[22px] border bg-background shadow-[0_1px_3px_var(--shadow-color)] transition-[border-color,box-shadow] duration-150",
            "focus-within:border-ring/50 focus-within:shadow-[0_4px_18px_-6px_var(--shadow-color)]",
            tray && "-mt-3",
          )}
        >
          {popover && <div className="absolute inset-x-0 bottom-full z-20 mb-2">{popover}</div>}
          {chips && <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">{chips}</div>}
          <div className="px-2.5 pt-2">{children}</div>
          <div className="flex items-center gap-0.5 px-1.5 pb-1.5 pt-1">
            {footerStart}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">{footerEnd}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
