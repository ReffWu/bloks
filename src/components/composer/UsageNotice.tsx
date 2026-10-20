// A limit coming, said where the next message is written.
//
// A small panel at the top of the composer's box when the conversation's
// agent is on Bloks AI and the service says something about it, or is on
// Claude Code or Codex and that plan's windows are used up, nearly used
// up, or going faster than they renew. Which of those applies, and what
// it is called, is the server's call (GET /api/usage-notices); this shows
// the worst one the person has not put away, when it resets, and the way
// to the numbers behind it. The X puts it away until it has something new
// to say. It sits inside the box rather than in the tray because it is
// about the next message, the way the box's own chips are.
//
// Nothing tells the app that a plan moved, so it asks again when the
// conversation changes, when a turn starts or ends (the engines report
// their windows on a turn), when the window comes back into view, and
// once a minute while it is in view, which catches Bloks AI spent by
// other agents.
import { useEffect, useState } from "react";
import { X } from "@/components/icons";
import { api, openLaneWorking, useStore, type Bot } from "@/state/store";
import { usePageVisible } from "@/lib/pageVisible";
import { fromBloksAi, noticeToShow, readDismissed, readNotices, resetLine, saveDismissed, withDismissed, type UsageNotice as Said } from "@/lib/usageNotice";

const EVERY_MS = 60_000;

/** Settings opens on its Bloks Cloud page; the Bloks AI card is further
 * down it, and is drawn a moment after the page is. */
function showBloksAiUsage() {
  let tries = 0;
  const look = () => {
    const card = document.getElementById("bloks-ai");
    if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
    else if (++tries < 30) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

export function UsageNotice({ bot, onViewPlan }: { bot: Bot; /** Opens the ring's card, where the plan is. */ onViewPlan: () => void }) {
  const { dispatch } = useStore();
  const laneId = bot.activeTaskId ?? bot.threadId;
  const working = openLaneWorking(bot);
  const visible = usePageVisible();
  // kept with the conversation it is about, so a switch never shows the
  // last one's notice while the new one is asked for
  const [heard, setHeard] = useState<{ laneId: string; notices: Said[] } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    api(`/api/usage-notices?thread=${encodeURIComponent(laneId)}`)
      .then((body) => current && setHeard({ laneId, notices: readNotices(body) }))
      // an older server has no such route, and a failed read is no news
      .catch(() => current && setHeard({ laneId, notices: [] }));
    return () => {
      current = false;
    };
  }, [laneId, working, visible, tick, bot.modelSelection.instanceId, bot.engineAccess]);

  useEffect(() => {
    if (!visible) return;
    const again = () => setTick((n) => n + 1);
    const timer = window.setInterval(again, EVERY_MS);
    window.addEventListener("focus", again);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", again);
    };
  }, [visible]);

  const notice = heard?.laneId === laneId ? noticeToShow(heard.notices, dismissed) : null;
  if (!notice) return null;
  const reset = resetLine(notice.resetsAt, Date.now());
  const dismiss = () =>
    setDismissed((was) => {
      const next = withDismissed(was, notice.id);
      saveDismissed(next);
      return next;
    });
  const viewUsage = () => {
    if (!fromBloksAi(notice)) return onViewPlan();
    dispatch({ type: "toggleAppSettings", open: true, page: "cloud" });
    showBloksAiUsage();
  };

  return (
    <div className="px-2 pt-2">
      <div
        // read out as it appears: at once when it stops the work
        role={notice.level === "stop" ? "alert" : "status"}
        className="animate-fade-in rounded-xl bg-muted px-3 pb-3 pt-2.5 motion-reduce:animate-none"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold leading-snug text-foreground">{notice.title}</p>
            {reset && <p className="mt-0.5 text-small tabular-nums text-muted-foreground">{reset}</p>}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            title="Dismiss"
            className="-mr-1.5 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-95"
          >
            <X size={13} />
          </button>
        </div>
        <button
          type="button"
          onClick={viewUsage}
          className="mt-2.5 h-8 w-full rounded-full border bg-background text-small font-medium text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.99]"
        >
          View usage
        </button>
      </div>
    </div>
  );
}
