// How full this conversation is, and what it has used, where you decide
// what to send next (GitHub 224).
//
// One small ring at the end of the row under the composer, for the
// conversation being typed into. It fills with the context window, and a
// press opens a card with the rest: how full and when it summarises,
// what this conversation has taken in and given out, what the agent has
// cost today, and, where the engine reports them, what its plan has left.
// This is the place a person decides whether to send something long, run
// /compact or start a fresh conversation. Not in a room, where every
// agent has a context of its own and one ring could not say whose.
//
// The ring is always there, so the card is always one press away, but it
// only fills from a reading the server vouches for, made by the engine
// and model the conversation is on now. Without one the card says so
// rather than guessing (src/lib/contextCard.ts).
import { useEffect, useState, type ReactNode } from "react";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import {
  composerContext,
  contextCard,
  planName,
  planRows,
  repliesPhrase,
  ringLabel,
  shortTokens,
  spendPhrase,
  tokensPhrase,
  type PlanUsage,
  type Spent,
} from "@/lib/contextCard";
import { ContextRing } from "./TaskStrip";
import { useDismiss } from "./composer/Shell";

/** Past this the ring and its bar take the warning colour. */
const NEAR = 0.8;

/** A thin bar, filled to a share. The colour is a fill, never text. */
function Bar({ fill, near }: { fill: number; near?: boolean }) {
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full origin-left rounded-full transition-transform duration-300 ease-out", near ? "bg-warning" : "bg-foreground/55")}
        style={{ transform: `scaleX(${Math.max(0, Math.min(1, fill))})` }}
      />
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t px-3.5 py-3 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-foreground">{title}</h3>
        {aside && <span className="truncate tabular-nums text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A label and a number on one line. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1.5 flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

interface Today {
  spent: Spent | null;
  costKnown: boolean;
  /** The tally could not be had, which is not the same as nothing spent. */
  failed?: boolean;
}

/** `open` and `onOpenChange` hand the card to whoever holds the ring,
 * for a parent that opens it from somewhere other than the ring. */
export function ComposerRing({ bot, open: held, onOpenChange }: { bot: Bot; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { state } = useStore();
  const lane = bot.tasks?.find((t) => t.id === (bot.activeTaskId ?? bot.threadId));
  const context = composerContext(lane?.context);
  const instanceId = bot.modelSelection.instanceId;
  const [own, setOwn] = useState(false);
  const open = held ?? own;
  const setOpen = (next: boolean | ((was: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (held === undefined) setOwn(value);
    onOpenChange?.(value);
  };
  const ref = useDismiss(open, () => setOpen(false));
  // kept with the engine it is about, so a switch never shows the last
  // engine's plan while the new one is asked for
  const [heard, setHeard] = useState<{ instanceId: string; plan: PlanUsage | null } | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  // Both asked each time the card opens: a read of what the engine last
  // said and of today's tally, which nothing else brings up to date while
  // the card is shut. A window on a paired device is answered too (GitHub
  // 259); an older server refuses one, and then the card goes without.
  useEffect(() => {
    if (!open) return;
    let current = true;
    api("/api/plan-usage")
      .then((body) => current && setHeard({ instanceId, plan: body?.usage?.[instanceId] ?? null }))
      .catch(() => current && setHeard({ instanceId, plan: null }));
    api("/api/activity")
      .then(
        (body: { agents?: Array<{ botId: string; today: Spent }>; costKnown?: boolean }) =>
          current &&
          setToday({
            spent: body?.agents?.find((a) => a.botId === bot.id)?.today ?? null,
            costKnown: Boolean(body?.costKnown),
          }),
      )
      .catch(() => current && setToday({ spent: null, costKnown: false, failed: true }));
    return () => {
      current = false;
    };
  }, [open, instanceId, bot.id]);

  const fraction = context?.fraction ?? 0;
  const near = fraction >= NEAR;
  const card = context ? contextCard(context) : null;
  const plan = heard?.instanceId === instanceId ? heard.plan : null;
  const rows = planRows(plan, Date.now());
  const engine = state.instances.find((i) => i.instanceId === instanceId)?.displayName;
  const named = planName(plan?.plan);
  const usage = lane?.usage;
  const spent = today?.spent ?? null;

  return (
    // the card hangs from the composer's row (see Shell), edge to edge
    <div ref={ref} className="shrink-0">
      <button
        type="button"
        aria-label={context ? ringLabel(context) : "Context and usage"}
        title={context ? ringLabel(context) : "Context and usage"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex size-7 items-center justify-center rounded-lg transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent active:scale-95 aria-expanded:bg-accent",
          near ? "text-warning" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <ContextRing fraction={fraction} summarised={context?.summarised ?? false} size={16} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Context and usage"
          className="absolute bottom-full right-0 z-30 mb-2 w-[288px] max-w-[calc(100vw-24px)] origin-bottom-right animate-pop-in overflow-hidden rounded-xl border bg-popover text-small text-popover-foreground shadow-lg shadow-(color:--shadow-color)"
        >
          <Section title="Context" aside={card?.share}>
            {context && card ? (
              <>
                <Bar fill={context.fraction} near={near} />
                <div className="mt-1.5 tabular-nums text-muted-foreground">{card.tokens}</div>
                {card.compaction && <p className="mt-1 leading-snug text-muted-foreground">{card.compaction}</p>}
                {card.summarised && <p className="mt-1 leading-snug text-muted-foreground">{card.summarised}</p>}
              </>
            ) : (
              <p className="mt-1 leading-snug text-muted-foreground">Not measured yet. It shows after the next reply.</p>
            )}
          </Section>
          <Section title="This conversation" aside={usage && usage.turns > 0 ? repliesPhrase(usage.turns) : undefined}>
            {usage && usage.turns > 0 ? (
              <>
                <Fact label="Tokens in" value={tokensPhrase(usage.input, usage)} />
                <Fact label="Tokens out" value={tokensPhrase(usage.output, usage)} />
              </>
            ) : (
              <p className="mt-1 leading-snug text-muted-foreground">Nothing sent yet.</p>
            )}
          </Section>
          <Section title={`${bot.name} today`} aside={spent && spent.turns > 0 ? repliesPhrase(spent.turns) : undefined}>
            {today === null || today.failed ? (
              <p className="mt-1 leading-snug text-muted-foreground">{today ? "Couldn't check just now." : "Checking…"}</p>
            ) : (
              <>
                <Fact label="Spend" value={spendPhrase(spent, today.costKnown)} />
                {spent && spent.turns > 0 && (
                  <Fact
                    label="Tokens"
                    value={spent.input + spent.output > 0 ? shortTokens(spent.input + spent.output) : "Not reported"}
                  />
                )}
              </>
            )}
          </Section>
          {rows.length > 0 && (
            <Section title="Plan" aside={[engine, named].filter(Boolean).join(", ") || undefined}>
              {rows.map((row) => (
                <div key={row.id} className="mt-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className={cn("tabular-nums", row.near ? "text-warning" : "text-foreground")}>{row.used}</span>
                  </div>
                  <Bar fill={row.fill} near={row.near} />
                  {(row.note || row.reset) && (
                    <div className="mt-1 text-muted-foreground">{[row.note, row.reset].filter(Boolean).join(". ")}</div>
                  )}
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
