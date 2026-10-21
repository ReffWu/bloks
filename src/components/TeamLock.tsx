// What is Bloks Team's, said where it is offered: a short "Needs Bloks
// Team" and the way to it. In the owner's own window the way is Settings,
// Plan, where the membership is and where Bloks Team is offered as the
// site describes it; anywhere without that page (a member's window) it is
// the upgrade page on bloks.dev the room share panel has always sent
// people to. Nothing here names a price.
import { ArrowUpRight, Lock } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useOptionalStore } from "@/state/store";
import { cn } from "@/lib/cn";

export const TEAM_UPGRADE_URL = "https://bloks.dev/cloud/upgrade/";

/** "Needs Bloks Team · Upgrade", for beside a choice that is not open. */
export function NeedsTeam({ className, what }: { className?: string; what?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <Lock size={12} strokeWidth={2} aria-hidden />
        {what ?? "Needs Bloks Team"}
      </span>
      <UpgradeLink />
    </span>
  );
}

export function UpgradeLink({ className, label = "Upgrade" }: { className?: string; label?: string }) {
  const store = useOptionalStore();
  const look = cn(
    "inline-flex items-center gap-0.5 rounded font-medium text-brand-ink underline-offset-2 outline-none hover:underline",
    className,
  );
  if (store) {
    return (
      <button
        type="button"
        onClick={() => store.dispatch({ type: "toggleAppSettings", open: true, page: "plan" })}
        className={look}
      >
        {label}
        <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
      </button>
    );
  }
  return (
    <a href={TEAM_UPGRADE_URL} target="_blank" rel="noreferrer" className={look}>
      {label}
      <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
    </a>
  );
}

/** The same way to Bloks Team as a button, for where it is the one thing
 * a screen offers rather than a note beside a choice. */
export function UpgradeButton({ label = "Get Bloks Team" }: { label?: string }) {
  const store = useOptionalStore();
  if (store) {
    return (
      <Button size="sm" className="shrink-0 gap-1.5" onClick={() => store.dispatch({ type: "toggleAppSettings", open: true, page: "plan" })}>
        {label}
        <ArrowUpRight size={13} />
      </Button>
    );
  }
  return (
    <Button size="sm" className="shrink-0 gap-1.5" asChild>
      <a href={TEAM_UPGRADE_URL} target="_blank" rel="noreferrer">
        {label}
        <ArrowUpRight size={13} />
      </a>
    </Button>
  );
}
