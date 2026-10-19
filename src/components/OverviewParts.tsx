// The few pieces every Overview panel is built from: the morning brief,
// Activity, Projects and Rehearsals. One header, one way to say "nothing
// here yet", one shape for "still reading", so the page reads as one page
// rather than four windows that happen to sit together.
import { cn } from "@/lib/cn";

/**
 * A panel's head: what it is, a line on what it holds, and whatever it
 * lets you do, at the right. No box around it; the space above is the
 * frame.
 */
export function PanelHeader({
  icon,
  title,
  hint,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    // on a phone the actions take the next line rather than squeezing the
    // title onto two
    <header className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 whitespace-nowrap text-title font-semibold text-foreground">
          {icon && <span className="flex shrink-0 text-muted-foreground">{icon}</span>}
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-pretty text-body text-muted-foreground">{hint}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

/**
 * Nothing here yet, said plainly, with the one thing that would change
 * that. Never two buttons: an empty panel is a suggestion, not a menu.
 */
export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl bg-muted/40 px-5 py-5">
      <p className="text-pretty text-body leading-relaxed text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

/** A line of text that has not arrived yet. Pulses by opacity only, and
 * holds still when motion is turned down. */
export function Bone({ className }: { className?: string }) {
  return <div aria-hidden className={cn("h-3 animate-pulse rounded-full bg-muted motion-reduce:animate-none", className)} />;
}

/** Rows of bones, the shape of a list that is on its way. */
export function SkeletonRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div aria-hidden className="size-6 shrink-0 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bone className={i % 2 ? "w-2/3" : "w-4/5"} />
            <Bone className="h-2.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A section inside a panel: a small label over its rows. */
export function SubHead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("mb-2 text-small font-medium text-muted-foreground", className)}>{children}</h3>;
}
