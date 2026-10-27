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
import { ShieldCheck } from "@/components/icons";
import { Wallet } from "@/components/icons";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { readApproval } from "@/lib/approvalCard";
import { suggestionsFor, useRuleSuggestions, whatParts, type RuleSuggestion } from "@/lib/ruleSuggestions";
import { EngineSetupActions } from "@/components/EngineSetup";
import { RANK, TrayButton, type Notice } from "@/components/composer/Tray";
import { toast } from "@/components/ui/toast";
import { refusalToShow, runsOnCredits } from "@/lib/credits";
import { t, tr } from "@/lib/i18n";

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
    title: t("banners.guestMail"),
    detail: first ? t("banners.typedGoesTo", { title: first.title }) : t("banners.typedGoesToFirst"),
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
    ? t("banners.caution", { count: risky.length })
    : undefined;
  return {
    id: "approvals",
    tone: "urgent",
    rank: RANK.approvals,
    icon: <ShieldAlert size={14} />,
    title: t("banners.approvalsWaiting", { count: pending.length }),
    detail: caution,
    hint: caution,
    actions: (
      <>
        <TrayButton onClick={() => answerAll(pending, "Deny")}>{t("banners.denyAll")}</TrayButton>
        {allowable.length > 0 && (
          <TrayButton strong onClick={() => answerAll(allowable, "Allow")}>
            {risky.length ? (
              <>
                {tr("banners.allowTheOther", {
                  theOther: <span className="max-sm:hidden">{t("banners.theOther")} </span>,
                  count: allowable.length,
                })}
              </>
            ) : (
              t("banners.allowAll")
            )}
          </TrayButton>
        )}
      </>
    ),
  };
}

/** What a suggestion lets through, with its command or path in type. */
export function SuggestionWhat({ what }: { what: string }) {
  return (
    <>
      {whatParts(what).map((part, i) =>
        part.code ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-small text-foreground">
            {part.text}
          </code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Saying yes to a suggestion, with what happened said once. */
export function takeSuggestion(
  accept: (id: string, scope: "agent" | "everyone") => Promise<unknown>,
  suggestion: RuleSuggestion,
  scope: "agent" | "everyone",
) {
  accept(suggestion.id, scope).then(
    () =>
      toast.success(
        scope === "agent" && suggestion.forAgent
          ? t("banners.wontAskAgain", { name: suggestion.forAgent.name })
          : t("banners.noAgentWillAsk"),
        { description: t("banners.savedAsRule") },
      ),
    (e: Error) => toast.error(t("banners.ruleNotSaved", { error: e.message })),
  );
}

/**
 * The person keeps approving the same thing for this agent, and a rule
 * could answer it (server/rule-suggestions.ts). One at a time, after
 * anything that is actually waiting, and quiet in tone: it is an offer,
 * not a question the agent is stuck on. Not now keeps it away for a
 * month; the server decides what may be offered, including whether
 * "everyone" is, so this never offers more than was approved.
 */
export function useSuggestionNotice(bot: Bot): Notice | null {
  const { suggestions, accept, dismiss } = useRuleSuggestions();
  const mine = suggestionsFor(suggestions, bot.id);
  const first = mine[0];
  if (!first) return null;
  const forThis = first.forAgent?.botId === bot.id;
  return {
    id: `suggestion:${first.id}`,
    tone: "info",
    rank: RANK.suggestion,
    icon: <ShieldCheck size={14} />,
    title: first.title,
    detail: <SuggestionWhat what={first.what} />,
    hint: `${first.title} ${first.what.replace(/`/g, "")}`,
    actions: (
      <>
        <TrayButton onClick={() => void dismiss(first.id)}>{t("common.notNow")}</TrayButton>
        {first.forEveryone && (
          <TrayButton strong={!forThis} onClick={() => takeSuggestion(accept, first, "everyone")}>
            {t("banners.allowForEveryone")}
          </TrayButton>
        )}
        {forThis && (
          <TrayButton strong onClick={() => takeSuggestion(accept, first, "agent")}>
            {tr("banners.allowForThisAgent", { forThisAgent: <span className="max-sm:hidden">{t("banners.forThisAgent")}</span> })}
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
        ? t("banners.laneWaiting", { title: first.title })
        : t("banners.lanesWaiting", { count: waiting.length }),
    actions: (
      <TrayButton onClick={() => dispatch({ type: "selectTask", botId: bot.id, taskId: first.id })}>{t("common.open")}</TrayButton>
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
  // An agent that works in a container or over SSH runs the engine there:
  // this computer's copy, installed or signed in or not, is not the one it
  // uses, and the Test in its settings says how the other one stands.
  const elsewhere = Boolean(bot.workplace);
  const missing = instance && !elsewhere ? instance.snapshot.state !== "available" : false;
  const signedOut = Boolean(instance) && !elsewhere && !missing && instance!.snapshot.authenticated === false;
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
      ? t("banners.engineMissing", { engine: instance.displayName, name: bot.name })
      : t("banners.engineSignedOut", { engine: instance.displayName, name: bot.name }),
    actions: alternative && (
      <TrayButton
        strong
        title={t("banners.useInstead", { engine: alternative.displayName })}
        onClick={() =>
          dispatch({
            type: "setModel",
            botId: bot.id,
            selection: { instanceId: alternative.instanceId, model: alternative.models.default },
          })
        }
      >
        {t("banners.use", { engine: alternative.displayName })}
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
          {t("banners.engineSettings")}
        </button>
      </div>
    ),
    onDismiss: dismiss,
  };
}

/**
 * A run this agent asked for was refused because the Bloks AI allowance
 * is used up. Said once, quietly, in the service's own words, with the
 * one press that fixes it: Top up, on bloks.dev in the browser, never a
 * purchase inside the app. Coming back to the window reads the balance
 * again, and once there is more the server takes the refusal back and
 * this goes by itself. Put away, it stays away until the next refusal.
 */
export function useCreditsNotice(bot: Bot): Notice | null {
  const { state } = useStore();
  const refused = state.config?.credits?.refused ?? null;
  const onCredits = runsOnCredits(bot, state.instances);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const showing = refusalToShow(refused, onCredits, dismissedAt);
  useEffect(() => {
    if (!showing) return;
    const look = () => void api("/api/credits?fresh=1").catch(() => {});
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, [showing]);
  if (!showing) return null;
  const checkout = state.config?.credits?.checkoutUrl;
  return {
    id: "credits",
    tone: "warn",
    rank: RANK.engine,
    icon: <Wallet size={14} />,
    title: showing.message,
    hint: showing.message,
    actions: checkout ? (
      <TrayButton strong onClick={() => window.open(checkout, "_blank", "noopener")}>
        {t("banners.topUp")}
      </TrayButton>
    ) : undefined,
    onDismiss: () => setDismissedAt(showing.at),
  };
}
