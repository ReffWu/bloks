// The six steps of a move, each with where it stands, and how much is
// across while it sends. One list for both directions.
import { Check, Loader2 } from "@/components/icons";
import { cn } from "@/lib/cn";
import { MOVE_STEPS, stepLabel, stepState } from "@/lib/hostingMove";
import type { HostingMove } from "@/types/bridge";

export function MoveSteps({ move }: { move: HostingMove }) {
  // a move that stopped or failed shows where it stopped, without a spinner
  const moving = move.phase === "running" || move.phase === "waiting";
  const share = move.size > 0 ? Math.min(1, move.sent / move.size) : 0;
  return (
    <ol aria-label="Steps" className="flex flex-col gap-2">
      {MOVE_STEPS.map(({ step }) => {
        const state = stepState(move, step);
        const now = state === "now";
        return (
          <li key={step} aria-current={now ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                  state === "done" && "border-transparent bg-success/15 text-success",
                  now && moving && "border-brand-ink/40 text-brand-ink",
                  now && !moving && (move.phase === "failed" ? "border-destructive/40 bg-destructive/10" : "border-foreground/25"),
                  state === "next" && "border-border",
                )}
              >
                {state === "done" ? (
                  <Check size={12} />
                ) : now && moving ? (
                  <Loader2 size={12} className="motion-safe:animate-spin" />
                ) : now ? (
                  <span className={cn("size-1.5 rounded-full", move.phase === "failed" ? "bg-destructive" : "bg-foreground/50")} />
                ) : null}
              </span>
              <span
                className={cn(
                  "truncate text-body tabular-nums",
                  state === "next" ? "text-muted-foreground/70" : now ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {stepLabel(move, step)}
              </span>
            </div>
            {step === "sending" && now && move.size > 0 && (
              <div
                role="progressbar"
                aria-label="Sent"
                aria-valuemin={0}
                aria-valuemax={move.size}
                aria-valuenow={move.sent}
                className="ml-[30px] h-1.5 max-w-[320px] overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full origin-left bg-brand-ink motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
                  style={{ transform: `scaleX(${share})` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
