// The notices a conversation raises above its composer: approvals
// waiting, another conversation waiting, an engine that is down, mail
// from a guest. Split out of ChatView.tsx, which only wires them in.
import { useEffect, useState } from "react";
import { AlertTriangle } from "@/components/icons";
import { X } from "@/components/icons";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { readApproval } from "@/lib/approvalCard";
import { motion } from "motion/react";
import { EngineSetupActions } from "@/components/EngineSetup";
import { Button } from "@/components/ui/button";


/** Something the agent did, as one quiet line. Spinning while it runs,
 * then a tick or a cross. */
/**
 * The lane mail from senders the person has not listed is answered in.
 * It looks like any other conversation, but the person's own words never
 * run beside those mails: what is typed here goes to the first
 * conversation (typedLane), and this says so before anything is typed.
 */
export function GuestMailLine({ bot }: { bot: Bot }) {
  const open = bot.activeTaskId ?? bot.threadId;
  if (!bot.tasks?.some((t) => t.id === open && t.guestMail)) return null;
  const first = bot.tasks.find((t) => !t.guestMail);
  return (
    <p className="mx-auto w-full max-w-[var(--transcript-width,760px)] px-4 pb-1 text-center text-small leading-snug text-muted-foreground md:px-6">
      Mail from unlisted senders is answered here, in conversation only. What you type goes to{" "}
      {first ? `"${first.title}"` : "the first conversation"}.
    </p>
  );
}

/**
 * Approvals stacked up while the person was away, answered as a queue.
 * The ones that can delete or overwrite something are left out of
 * "Allow all" and said to be: a yes to those is given one at a time,
 * looking at each. Denying is always safe, so Deny all takes them too.
 */
export function ApprovalsBar({ bot, pending }: { bot: Bot; pending: Message[] }) {
  const { dispatch } = useStore();
  const risky = pending.filter((m) => m.card && readApproval(m.card, bot).risk);
  const allowable = pending.filter((m) => !risky.includes(m));
  const answerAll = (list: Message[], answer: string) => {
    for (const m of list) dispatch({ type: "answerCard", botId: bot.id, messageId: m.id, answer });
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="px-4 md:px-6"
    >
      <div
        role="region"
        aria-label="Approvals waiting"
        className="mx-auto mb-2 flex max-w-[var(--transcript-width,760px)] flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-card py-2 pl-2.5 pr-2 shadow-[0_1px_3px_var(--shadow-color)]"
      >
        <span className="flex h-6 min-w-6 items-center justify-center overflow-hidden rounded-full bg-warning/12 px-1.5 text-small font-semibold tabular-nums text-warning">
          <motion.span
            key={pending.length}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            {pending.length}
          </motion.span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-foreground">approvals waiting</p>
          {risky.length > 0 && (
            <p className="text-pretty text-small text-warning">
              {risky.length === 1 ? "One can" : `${risky.length} can`} delete or overwrite things. Answer{" "}
              {risky.length === 1 ? "it" : "those"} on {risky.length === 1 ? "its" : "their"} own.
            </p>
          )}
        </div>
        <div className="flex gap-1.5 max-sm:w-full">
          <Button variant="secondary" size="sm" onClick={() => answerAll(pending, "Deny")} className="max-sm:flex-1">
            Deny all
          </Button>
          {allowable.length > 0 && (
            <Button variant="brand" size="sm" onClick={() => answerAll(allowable, "Allow")} className="max-sm:flex-1">
              {risky.length ? `Allow the other ${allowable.length}` : "Allow all"}
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Another of this agent's conversations stopped on a question or an
 * approval. The card lives in that conversation's transcript, so from this
 * one it could be listed as waiting and still not be anywhere on screen.
 */
export function OtherLaneWaiting({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const open = bot.activeTaskId ?? bot.threadId;
  const waiting = (bot.tasks ?? []).filter((t) => t.state === "needs-you" && t.id !== open);
  if (!waiting.length) return null;
  const first = waiting[0];
  return (
    <div className="mx-auto w-full max-w-[var(--transcript-width,760px)] px-4 md:px-6">
      <button
        onClick={() => dispatch({ type: "selectTask", botId: bot.id, taskId: first.id })}
        className="mb-2 flex w-full items-center gap-2 rounded-xl bg-warning/10 px-3.5 py-2 text-left text-body text-warning transition-colors duration-150 hover:bg-warning/15"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-warning" />
        <span className="min-w-0 flex-1 truncate">
          {waiting.length === 1
            ? `"${first.title}" is waiting on you`
            : `${waiting.length} other conversations are waiting on you`}
        </span>
        <span className="shrink-0 font-medium">Open</span>
      </button>
    </div>
  );
}

/**
 * Said before the first message rather than after it: this agent's engine
 * is missing or signed out, so anything sent now would come back as an
 * error. The fix is right here, the same Install or Sign in the first-run
 * check has, or Settings for an engine that runs on a key.
 */
export function EngineBanner({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const instance = state.instances.find((i) => i.instanceId === bot.modelSelection?.instanceId);
  const missing = instance ? instance.snapshot.state !== "available" : false;
  const signedOut = Boolean(instance) && !missing && instance!.snapshot.authenticated === false;
  const refresh = () => {
    api("/api/instances")
      .then(({ instances }) => dispatch({ type: "instances", instances }))
      .catch(() => {});
  };
  // Signing in happens in Terminal; coming back to this window is the
  // moment to look again, so the warning goes without a click.
  const showing = missing || signedOut;
  // Dismissed per engine and per problem, so closing "not signed in" does
  // not also hide a later "not installed" for the same engine.
  const dismissKey = instance ? `bloks.engineBanner.${instance.instanceId}.${missing ? "missing" : "signedOut"}` : "";
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Boolean(dismissKey) && localStorage.getItem(dismissKey) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      setDismissed(Boolean(dismissKey) && localStorage.getItem(dismissKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      /* hidden for this visit only */
    }
  };
  useEffect(() => {
    if (!showing) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing]);
  if (!instance || !showing || dismissed) return null;
  // Another engine that would answer right now, preferring one that runs
  // tools, so the quickest fix is a single click rather than a setup.
  const ready = state.instances.filter(
    (i) =>
      i.instanceId !== instance.instanceId &&
      i.snapshot.state === "available" &&
      i.snapshot.authenticated !== false &&
      Boolean(i.models.default),
  );
  const agentic = new Set(state.providers.filter((p) => p.agentic).map((p) => p.kind));
  const alternative = ready.find((i) => agentic.has(i.driverKind)) ?? ready[0];
  return (
    <div className="mx-auto w-full max-w-[var(--transcript-width,760px)] px-4 md:px-6">
      <div className="mb-2 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-2.5 text-body leading-relaxed">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <span className="text-foreground">
              {missing
                ? `${instance.displayName} isn't set up, so ${bot.name} can't answer.`
                : `${instance.displayName} isn't signed in, so ${bot.name} can't answer.`}
            </span>{" "}
            <span className="text-muted-foreground">Set it up here or pick another engine.</span>
            {alternative && (
              <div className="mt-2">
                <Button
                  size="sm"
                  onClick={() =>
                    dispatch({
                      type: "setModel",
                      botId: bot.id,
                      selection: { instanceId: alternative.instanceId, model: alternative.models.default },
                    })
                  }
                >
                  Use {alternative.displayName} instead
                </Button>
              </div>
            )}
            <EngineSetupActions
              kind={instance.driverKind}
              name={instance.displayName}
              installed={!missing}
              signedOut={signedOut}
              onChanged={refresh}
            />
            <button
              onClick={() => dispatch({ type: "toggleAppSettings", open: true, page: "engines" })}
              className="mt-1.5 text-small text-muted-foreground underline hover:text-foreground"
            >
              Open engine settings
            </button>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            title="Dismiss"
            className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-warning/10 hover:text-foreground"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
