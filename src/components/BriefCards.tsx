// The cards at the top of the morning brief: what each routine and
// watcher the person set up last reported (server/brief.ts BriefResult).
//
// A card is the agent's own report, as it wrote it, so the tally line,
// the list and the link it chose are what the person reads; the card adds
// only what the report cannot say about itself: whose it is, when it was
// said, whether that was this morning, and the way to the rest of it.
// A gap is said as one. A run that did not happen, or failed, says so in
// the card's own place rather than leaving yesterday's words standing in
// for today's, and a run that went fine is never drawn as a green tick:
// it ran, which says nothing about whether what it checked is healthy.
import { ArrowUpRight } from "@/components/icons";
import { BellOff } from "@/components/icons";
import { Eye } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Repeat } from "@/components/icons";
import { useStore } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { Markdownish } from "./Markdown";
import { cn } from "@/lib/cn";
import { formatDate, t } from "@/lib/i18n";

export interface BriefResult {
  key: string;
  kind: "routine" | "watcher";
  id: string;
  name: string;
  botId?: string;
  agent?: string;
  state: "reported" | "quiet" | "changed" | "unchanged" | "failed" | "late" | "running" | "none";
  text?: string;
  more?: boolean;
  error?: string;
  at?: number;
  checkedAt?: number;
  dueAt?: number;
  nextAt?: number;
  fresh: boolean;
  threadId?: string;
  briefOnly?: boolean;
}

const startOfDay = (at: number) => {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const clock = (at: number) => formatDate(at, { hour: "numeric", minute: "2-digit" });

/** "8:42 AM", "Yesterday 8:40 PM", "Tue 8:40 AM": as near as it is. */
export function when(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return clock(at);
  if (days === -1) return t("briefCards.when.tomorrow", { time: clock(at) });
  if (days === 1) return t("briefCards.when.yesterday", { time: clock(at) });
  return t("briefCards.when.weekday", { day: formatDate(at, { weekday: "short" }), time: clock(at) });
}

/** The line under a card's name: where it stands, in a few words, and
 * how much that should catch the eye. */
function standing(r: BriefResult): { words: string; tone: "plain" | "muted" | "warning" | "destructive" } {
  switch (r.state) {
    case "failed":
      return { words: r.at ? t("briefCards.standing.failedAt", { when: when(r.at) }) : t("briefCards.standing.failed"), tone: "destructive" };
    case "late":
      return { words: r.dueAt ? t("briefCards.standing.dueNotRun", { when: when(r.dueAt) }) : t("briefCards.standing.notRunYet"), tone: "warning" };
    case "running":
      return { words: t("briefCards.standing.runningNow"), tone: "plain" };
    case "quiet":
      return { words: r.at ? t("briefCards.standing.quietAt", { when: when(r.at) }) : t("briefCards.standing.quiet"), tone: "muted" };
    case "unchanged":
      return { words: r.checkedAt ? t("briefCards.standing.unchangedAt", { when: when(r.checkedAt) }) : t("briefCards.standing.unchanged"), tone: "muted" };
    case "none":
      return { words: r.nextAt ? t("briefCards.standing.noReportFirst", { when: when(r.nextAt) }) : t("briefCards.standing.noReport"), tone: "muted" };
    default:
      // words from before this brief's stretch of time are said as old
      return r.at
        ? {
            words: r.fresh
              ? t(r.state === "changed" ? "briefCards.standing.changedAt" : "briefCards.standing.reportedAt", { when: when(r.at) })
              : t("briefCards.standing.lastReportAt", { when: when(r.at) }),
            tone: r.fresh ? "plain" : "muted",
          }
        : { words: t("briefCards.standing.reported"), tone: "plain" };
  }
}

/**
 * One card. `after` is set when the words came in after the brief was
 * made, which the newest brief shows as they arrive rather than waiting
 * for tomorrow's: a late report updates its card, quietly.
 */
export function ResultCard({ result, after, onOpen }: { result: BriefResult; after?: boolean; onOpen: (r: BriefResult) => void }) {
  const { state } = useStore();
  const agent = result.botId ? state.bots.find((b) => b.id === result.botId) : undefined;
  const line = standing(result);
  // the words of an earlier run, kept under a gap so the card still says
  // what was known, marked as the earlier run's
  const earlier = (result.state === "late" || result.state === "running") && result.text;
  const words = result.state === "reported" || result.state === "changed" ? result.text : undefined;
  const Kind = result.kind === "watcher" ? Eye : Repeat;
  return (
    <article
      aria-label={result.name}
      className={cn(
        "rounded-2xl bg-muted/40 px-4 py-3.5",
        // a gap or a failure is the one card that should be found first
        result.state === "failed" && result.fresh && "bg-destructive/[0.06]",
        result.state === "late" && "bg-warning/[0.07]",
      )}
    >
      <header className="flex items-start gap-2.5">
        {agent ? (
          <AgentAvatar bot={agent} size={22} />
        ) : (
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Kind size={12} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-ui font-semibold text-foreground">{result.name}</h3>
          <p
            className={cn(
              "flex flex-wrap items-center gap-x-1.5 text-small",
              line.tone === "destructive" ? "text-destructive" : line.tone === "warning" ? "text-warning" : line.tone === "muted" ? "text-muted-foreground" : "text-foreground/75",
            )}
          >
            {result.state === "running" && <Loader2 size={11} className="animate-spin" />}
            <span>{line.words}</span>
            {after && <span className="text-muted-foreground">{t("briefCards.cameInAfterTheBrief")}</span>}
          </p>
        </div>
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-small text-muted-foreground" title={result.kind === "watcher" ? t("briefCards.aWatcher") : t("briefCards.aRoutine")}>
          <Kind size={12} />
          <span className="max-sm:hidden">{result.agent ?? (result.kind === "watcher" ? t("briefCards.watcher") : t("briefCards.routine"))}</span>
        </span>
      </header>

      {words && (
        <div className="mt-2.5 min-w-0 text-body leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
          <Markdownish text={words} />
        </div>
      )}
      {earlier && (
        <div className="mt-2.5 min-w-0 text-body leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          <p className="mb-1 text-small">{result.at ? t("briefCards.itsLastReportAt", { when: when(result.at) }) : t("briefCards.itsLastReport")}</p>
          <Markdownish text={result.text!} />
        </div>
      )}
      {result.error && (result.state === "failed" || result.state === "late") && (
        <p className="mt-2 line-clamp-3 text-body text-muted-foreground [overflow-wrap:anywhere]">{result.error}</p>
      )}

      <footer className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
        {result.threadId && result.botId && (
          <button
            onClick={() => onOpen(result)}
            className="group -mx-1 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 font-medium text-foreground/80 transition-colors duration-150 hover:bg-accent/60 hover:text-foreground"
          >
            {result.more ? t("briefCards.readTheRest") : result.state === "failed" || result.state === "late" ? t("briefCards.openTheConversation") : t("briefCards.openTheFullReport")}
            <ArrowUpRight size={12} className="text-muted-foreground transition-colors duration-150 group-hover:text-foreground" />
          </button>
        )}
        {result.nextAt && result.state !== "none" && <span>{t("briefCards.nextAt", { when: when(result.nextAt) })}</span>}
        {result.briefOnly && (
          <span className="inline-flex items-center gap-1" title={t("briefCards.itsReportsWaitHereWith")}>
            <BellOff size={11} />
            {t("briefCards.onlyInTheBrief")}
          </span>
        )}
      </footer>
    </article>
  );
}
