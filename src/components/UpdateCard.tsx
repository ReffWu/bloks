// A new version, said where people look.
//
// The updater downloads a release on its own and installs it on the next
// quit, but most people leave Bloks open for days, and the only place that
// said an update was waiting was the About card in Settings. So once one
// has downloaded, an orange button sits on the main rail above Settings,
// and pressing it opens a card with the one button that matters. "Not
// now" hides that version only; the next release asks again. In a plain
// browser tab there is no updater, so there is never a button.
//
// Relaunching waits for running turns to finish first (server/drain.ts),
// which can take a while, so meanwhile the card says what it is waiting
// for and offers to restart now or to call it off and update later.
//
// A relaunch that came back on the version it left says so here, once,
// with the two ways forward, where it would have offered the same button
// as if it had never been pressed (GitHub 267).
import { useEffect, useState } from "react";
import { ArrowDownToLine } from "@/components/icons";
import { RefreshCw } from "@/components/icons";
import { X } from "@/components/icons";
import type { UpdateState } from "@/types/bridge";
import { cn } from "@/lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const DISMISSED = "bloks.updateCardDismissed";

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED);
  } catch {
    return null;
  }
}

/** What an install is waiting for, while it waits. */
export function drainingLine(draining: NonNullable<UpdateState["draining"]>, now = Date.now()): string {
  const n = draining.running;
  const what = n > 0 ? `${n} running ${n === 1 ? "turn" : "turns"}` : "what is running";
  const minutes = draining.deadline ? Math.ceil((draining.deadline - now) / 60_000) : null;
  const left = minutes === null ? "" : minutes > 1 ? ` (${minutes} minutes left)` : " (under a minute left)";
  return `Finishing ${what} before restarting…${left}`;
}

/**
 * The update, from the main rail: an orange button above Settings while a
 * release waits for a relaunch, and the card itself one press away. The
 * card says what pressing will do, and while it waits for running turns
 * it is the way to restart now or call it off.
 */
export function UpdateRailButton() {
  const [update, setUpdate] = useState<UpdateState>({ state: "idle" });
  const [hidden, setHidden] = useState<string | null>(dismissedVersion);
  useEffect(() => {
    void window.bloks?.updateState?.().then(setUpdate);
    return window.bloks?.onUpdateState?.(setUpdate);
  }, []);
  // the card's own storage event is not heard here, so read the dismissal
  // again whenever the update changes
  useEffect(() => setHidden(dismissedVersion()), [update]);
  const ready = update.state === "ready";
  const missed = update.notInstalled;
  if (!ready && !missed) return null;
  const version = update.version ?? "";
  if (hidden !== null && hidden === version && !update.draining && !missed) return null;
  const label = update.draining
    ? "Restarting to update"
    : missed
      ? "The update did not install"
      : "Update available";
  return (
    <DropdownMenu onOpenChange={(open) => !open && setHidden(dismissedVersion())}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            aria-label={version ? `${label}: Bloks ${version}` : label}
            className="flex size-8 items-center justify-center rounded-full bg-update text-update-foreground outline-none transition-[scale,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.96]"
          >
            {update.draining ? (
              <RefreshCw size={15} strokeWidth={2.25} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <ArrowDownToLine size={15} strokeWidth={2.25} />
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="end" sideOffset={10} className="w-[260px] p-0">
        <UpdateCard />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What the update button opens: what pressing will do, and the button. */
function UpdateCard() {
  const [update, setUpdate] = useState<UpdateState>({ state: "idle" });
  const [hidden, setHidden] = useState<string | null>(dismissedVersion);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    void window.bloks?.updateState?.().then(setUpdate);
    return window.bloks?.onUpdateState?.(setUpdate);
  }, []);

  const ready = update.state === "ready";
  const missed = update.notInstalled;
  if (!ready && !missed) return null;
  const version = update.version ?? "";
  const draining = update.draining;
  // a wait under way shows even on a dismissed card: it is the way out,
  // and so does an update that did not install, whatever was dismissed
  if (hidden !== null && hidden === version && !draining && !missed) return null;

  const relaunch = () => {
    setRestarting(true);
    // answers without restarting only when the wait is called off, and a
    // press the app turned away must not leave the button spinning
    const back = () => setRestarting(false);
    void window.bloks?.updateInstall?.().then(back, back);
  };
  const dismiss = () => {
    setHidden(version);
    try {
      localStorage.setItem(DISMISSED, version);
    } catch {
      /* hidden for this visit only */
    }
  };

  if (draining) {
    return (
      <div className="shrink-0">
        <div className="relative px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
            <RefreshCw size={12} className="animate-spin text-brand-ink motion-reduce:animate-none" />
            Restarting to update
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{drainingLine(draining)}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <button
              onClick={() => {
                setRestarting(true);
                void window.bloks?.updateRestartNow?.();
              }}
              className="rounded-md text-[12.5px] font-medium text-brand-ink transition-opacity duration-150 hover:opacity-80"
            >
              Restart now
            </button>
            <button
              onClick={() => void window.bloks?.updateLater?.()}
              className="rounded-md text-[12.5px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
            Running turns pick up where they left off after the restart.
          </p>
        </div>
      </div>
    );
  }

  if (missed) {
    return (
      <div className="shrink-0">
        <div className="relative px-3 py-2.5">
          <button
            onClick={() => void window.bloks?.updateNotInstalledSeen?.()}
            aria-label="Dismiss"
            title="Dismiss"
            className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
          >
            <X size={12} />
          </button>
          <div className="pr-5 text-[12.5px] font-medium text-foreground">The update did not install</div>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Bloks is still on {missed.from}. {ready ? "Try again, or get" : "Get"} the installer from{" "}
            <a
              href="https://bloks.dev"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2 hover:text-foreground"
            >
              bloks.dev
            </a>
            .
          </p>
          {ready && (
            <button
              onClick={relaunch}
              disabled={restarting}
              className="mt-1.5 flex items-center gap-1.5 rounded-md text-[12.5px] font-medium text-brand-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-60"
            >
              <RefreshCw size={12} className={cn(restarting && "animate-spin motion-reduce:animate-none")} />
              {restarting ? "Relaunching…" : "Try again"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <div className="relative px-3 py-2.5">
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          title="Not now"
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
        >
          <X size={12} />
        </button>
        <div className="pr-5 text-[12.5px] font-medium text-foreground">New version available</div>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
          {version ? `Bloks ${version} is` : "An update is"} downloaded. Relaunch to update.
        </p>
        <button
          onClick={relaunch}
          disabled={restarting}
          className="mt-1.5 flex items-center gap-1.5 rounded-md text-[12.5px] font-medium text-brand-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-60"
        >
          <RefreshCw size={12} className={cn(restarting && "animate-spin motion-reduce:animate-none")} />
          {restarting ? "Relaunching…" : "Relaunch"}
        </button>
      </div>
    </div>
  );
}
