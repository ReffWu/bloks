// A plain word on a hosted team workspace whose agents run on somebody's
// personal Claude or ChatGPT sign-in.
//
// A personal sign-in is one person's, and a hosted team workspace is
// everyone's: the team ends up working on one person's account. That is
// worth saying where the choice is made (Settings, and an agent's engine)
// and nowhere louder. It never blocks anything, and once put away it
// stays away on this computer.
import { useState } from "react";
import { TriangleAlert, X } from "@/components/icons";
import { cn } from "@/lib/cn";
import { TEAM_WARNING_KEY, teamSignInWarning } from "@/lib/credits";
import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";

function dismissed(): boolean {
  try {
    return localStorage.getItem(TEAM_WARNING_KEY) === "1";
  } catch {
    return false;
  }
}

/** For every agent, or for one (`bot`) on its own engine choice. */
export function TeamSignInNotice({ bot, className }: { bot?: Bot; className?: string }) {
  const { state } = useStore();
  const [hidden, setHidden] = useState(dismissed);
  const words = teamSignInWarning({
    hosted: Boolean(state.config?.hosted?.on),
    team: state.config?.credits?.team,
    agents: bot ? [bot] : state.bots.filter((b) => !b.archivedAt),
    instances: state.instances,
  });
  if (!words || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(TEAM_WARNING_KEY, "1");
    } catch {
      /* hidden for this visit only */
    }
  };

  return (
    <div role="note" className={cn("flex items-start gap-2 rounded-xl border bg-card px-3 py-2.5", className)}>
      <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 text-pretty text-small leading-relaxed text-foreground">{words}</div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.dismiss")}
        className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
      >
        <X size={13} />
      </button>
    </div>
  );
}
