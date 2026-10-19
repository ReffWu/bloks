// What a conversation raises above its composer: approvals waiting,
// another conversation waiting, an engine that is down, mail from a
// guest. Each is a notice for the composer's tray (composer/Tray.tsx),
// which orders them and decides how many are open, so these say what
// and how pressing, and never where or how big.
import { useEffect, useState } from "react";
import { AlertTriangle } from "@/components/icons";
import { Info } from "@/components/icons";
import { MessagesSquare } from "@/components/icons";
import { ShieldAlert } from "@/components/icons";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { readApproval } from "@/lib/approvalCard";
import { EngineSetupActions } from "@/components/EngineSetup";
import { RANK, TrayButton, type Notice } from "@/components/composer/Tray";

/**
 * The lane mail from senders the person has not listed is answered in.
 * It looks like any other conversation, but the person's own words never
 * run beside those mails: what is typed here goes to the first
 * conversation (typedLane), and this says so before anything is typed.
 */
export function guestMailNotice(bot: Bot): Notice | null {
  const open = bot.activeTaskId ?? bot.threadId;
  if (!bot.tasks?.some((t) => t.id === open && t.guestMail)) return null;
  const first = bot.tasks.find((t) => !t.guestMail);
  return {
    id: "guest-mail",
    tone: "info",
    rank: RANK.guestMail,
    icon: <Info size={14} />,
    title: "Mail from unlisted senders is answered here.",
    detail: `What you type goes to ${first ? `"${first.title}"` : "the first conversation"}.`,
  };
}

/**
 * Approvals stacked up while the person was away, answered as a queue.
 * One is a conversation, and its card is right there; several are a
 * queue, and a queue deserves queue controls rather than a scroll of
 * identical presses. The ones that can delete or overwrite something
 * are left out of "Allow all" and said to be: a yes to those is given
 * one at a time, looking at each. Denying is always safe, so Deny all
 * takes them too.
 */
export function useApprovalsNotice(bot: Bot, pending: Message[] | undefined): Notice | null {
  const { dispatch } = useStore();
  if (!pending || pending.length < 2) return null;
  const risky = pending.filter((m) => m.card && readApproval(m.card, bot).risk);
  const allowable = pending.filter((m) => !risky.includes(m));
  const answerAll = (list: Message[], answer: string) => {
    for (const m of list) dispatch({ type: "answerCard", botId: bot.id, messageId: m.id, answer });
  };
  const caution = risky.length
    ? `${risky.length === 1 ? "One can" : `${risky.length} can`} delete or overwrite things. Answer ${risky.length === 1 ? "it" : "those"} on ${risky.length === 1 ? "its" : "their"} own.`
    : undefined;
  return {
    id: "approvals",
    tone: "urgent",
    rank: RANK.approvals,
    icon: <ShieldAlert size={14} />,
    title: `${pending.length} approvals waiting.`,
    detail: caution,
    hint: caution,
    actions: (
      <>
        <TrayButton onClick={() => answerAll(pending, "Deny")}>Deny all</TrayButton>
        {allowable.length > 0 && (
          <TrayButton strong onClick={() => answerAll(allowable, "Allow")}>
            {risky.length ? (
              <>
                Allow <span className="max-sm:hidden">the other </span>
                {allowable.length}
              </>
            ) : (
              "Allow all"
            )}
          </TrayButton>
        )}
      </>
    ),
  };
}

/**
 * Another of this agent's conversations stopped on a question or an
 * approval. The card lives in that conversation's transcript, so from this
 * one it could be listed as waiting and still not be anywhere on screen.
 */
export function useOtherLanesNotice(bot: Bot): Notice | null {
  const { dispatch } = useStore();
  const open = bot.activeTaskId ?? bot.threadId;
  const waiting = (bot.tasks ?? []).filter((t) => t.state === "needs-you" && t.id !== open);
  if (!waiting.length) return null;
  const first = waiting[0];
  return {
    id: "other-lanes",
    tone: "warn",
    rank: RANK.otherLanes,
    icon: <MessagesSquare size={14} />,
    title:
      waiting.length === 1
        ? `"${first.title}" is waiting on you.`
        : `${waiting.length} other conversations are waiting on you.`,
    actions: (
      <TrayButton onClick={() => dispatch({ type: "selectTask", botId: bot.id, taskId: first.id })}>Open</TrayButton>
    ),
  };
}

/**
 * Said before the first message rather than after it: this agent's engine
 * is missing or signed out, so anything sent now would come back as an
 * error. The fix is right here, the same Install or Sign in the first-run
 * check has, or Settings for an engine that runs on a key.
 */
export function useEngineNotice(bot: Bot): Notice | null {
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
  useEffect(() => {
    if (!showing) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing]);
  if (!instance || !showing || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      /* hidden for this visit only */
    }
  };
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
  return {
    id: "engine",
    tone: "urgent",
    rank: RANK.engine,
    icon: <AlertTriangle size={14} />,
    title: missing
      ? `${instance.displayName} isn't set up, so ${bot.name} can't answer.`
      : `${instance.displayName} isn't signed in, so ${bot.name} can't answer.`,
    actions: alternative && (
      <TrayButton
        strong
        title={`Use ${alternative.displayName} instead`}
        onClick={() =>
          dispatch({
            type: "setModel",
            botId: bot.id,
            selection: { instanceId: alternative.instanceId, model: alternative.models.default },
          })
        }
      >
        Use {alternative.displayName}
      </TrayButton>
    ),
    body: (
      <div className="text-small text-muted-foreground">
        <EngineSetupActions
          kind={instance.driverKind}
          name={instance.displayName}
          installed={!missing}
          signedOut={signedOut}
          onChanged={refresh}
        />
        <button
          type="button"
          onClick={() => dispatch({ type: "toggleAppSettings", open: true, page: "engines" })}
          className="mt-1.5 underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
        >
          Engine settings
        </button>
      </div>
    ),
    onDismiss: dismiss,
  };
}
