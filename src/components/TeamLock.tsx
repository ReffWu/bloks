// What is Bloks Team's, said where it is offered: a short "Needs Bloks
// Team" and the way to it. The way is the same upgrade page the room
// share panel has always sent people to; nothing here names a price.
import { ArrowUpRight, Lock } from "@/components/icons";
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
  return (
    <a
      href={TEAM_UPGRADE_URL}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-0.5 rounded font-medium text-brand-ink underline-offset-2 outline-none hover:underline",
        className,
      )}
    >
      {label}
      <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
    </a>
  );
}
