// The line under the title bar while your hosted workspace wakes.
//
// Asleep is the plan working, not anything going wrong: the strip says
// what is happening in the quiet voice of the title bar, shows that it is
// moving, and goes the moment the workspace answers. There is nothing to
// press, because the app is already asking (src/lib/waking.ts). What is
// on screen from before it slept stays where it is under it.
import { Cloud } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useTicking, useWake, wakeProgress } from "@/lib/waking";

/** `follow` for the strip shown before the store's event stream is open,
 * which then hears the wait on a line of its own. */
export function WakingStrip({ className, follow = false }: { className?: string; follow?: boolean }) {
  const wake = useWake(follow);
  const now = useTicking(500, wake.waking);
  if (!wake.waking) return null;
  const share = wakeProgress(now - wake.since, wake.until - wake.since);
  return (
    <div
      role="status"
      className={cn("relative flex h-8 shrink-0 items-center justify-center gap-2 px-4 text-small text-muted-foreground", className)}
    >
      <Cloud size={14} aria-hidden className="shrink-0" />
      <span className="truncate">Waking your hosted workspace…</span>
      {/* how far along it probably is: quick at first, slower as it goes,
          and only the workspace answering finishes it */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-muted">
        <div
          className="h-full origin-left bg-brand-ink motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out"
          style={{ transform: `scaleX(${share})` }}
        />
      </div>
    </div>
  );
}
