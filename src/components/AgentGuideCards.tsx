// Two cards an agent puts in a conversation about the app itself.
//
// An Open card is a way there: an agent asked where something lives
// answers in words and leaves one button that takes this window to the
// page (server/where.ts). Pressing it only navigates. A window that
// cannot show the page, a browser with no workspaces of its own, keeps
// the words, which is all a phone ever had.
//
// A proposed change is a setting an agent would change for you
// (server/settings-proposals.ts): the setting, what it is now, what the
// agent would make it and why, then Change and Keep. Nothing changes
// until Change, and the change is the one the Settings page itself
// makes, recorded as yours.
import { useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "@/components/icons";
import { api, useStore, type OpenPlacePlan, type SettingsProposalPlan } from "@/state/store";
import { PLACE_INDEX } from "../../server/settings-index.ts";
import { settingsPage } from "@/lib/settingsPages";
import { currentWorkspace, useWorkspaces } from "@/lib/workspaces";
import { hasMessage, inEnglish, t, type MessageKey } from "@/lib/i18n";

/** The places' words held to the catalogue's keys, as Settings' are in
 * src/lib/settingsPages.ts. */
const PLACES: ReadonlyArray<{ id: string; label: MessageKey; parent?: string; description: MessageKey }> = PLACE_INDEX;

/** A place's name and the way there, in the reader's language. */
function placeWords(page: string, row: string | undefined, agentName: string): { name: string; path: string } {
  const settings = settingsPage(page);
  if (settings) {
    const shown = row ? settings.rowMessages.find((key) => inEnglish(key) === row) : undefined;
    const base = t("openCard.step", { from: t("common.settings"), to: settings.label });
    return { name: settings.label, path: row ? t("openCard.step", { from: base, to: shown ? t(shown) : row }) : base };
  }
  if (page === "agent") {
    const name = t("openCard.agentSettings", { name: agentName });
    return { name, path: name };
  }
  const place = PLACES.find((p) => p.id === page);
  if (!place) return { name: page, path: page };
  const parent = place.parent ? PLACES.find((p) => p.id === place.parent) : undefined;
  const name = t(place.label);
  return { name, path: parent ? t("openCard.step", { from: t(parent.label), to: name }) : name };
}

/** The actions that take this window to a place. */
function goActions(plan: OpenPlacePlan): Array<Parameters<ReturnType<typeof useStore>["dispatch"]>[0]> {
  if (plan.kind === "settings") return [{ type: "toggleAppSettings", open: true, page: plan.page, ...(plan.row ? { row: plan.row } : {}) }];
  switch (plan.page) {
    case "overview":
    case "usage":
      return [{ type: "openPage", page: plan.page }];
    case "memory":
      return [{ type: "openMemory" }];
    case "plugins:apps":
      return [{ type: "openCustomize", tab: "plugins" }];
    case "plugins:skills":
      return [{ type: "openCustomize", tab: "skills" }];
    case "plugins:catalog":
      return [{ type: "openCustomize", tab: "catalog" }];
    case "agent":
      // selecting closes an agent's settings, so they are opened after
      return plan.botId ? [{ type: "select", id: plan.botId }, { type: "toggleSettings", open: true }] : [];
    default: {
      if (plan.page === "automations") return [{ type: "toggleRoutines", open: true }];
      const tab = plan.page.startsWith("automations:") ? plan.page.slice("automations:".length) : null;
      if (tab === "schedules" || tab === "watchers" || tab === "intents" || tab === "workflows" || tab === "webhooks" || tab === "jobs") {
        return [{ type: "toggleRoutines", open: true, tab }];
      }
      return [];
    }
  }
}

const shell = "w-full max-w-[560px] animate-rise-in overflow-hidden rounded-2xl border bg-card shadow-[0_1px_3px_var(--shadow-color)]";
const eyebrow = "text-caption font-semibold uppercase tracking-[0.1em] text-brand-ink";
const primary =
  "flex items-center gap-1.5 rounded-xl bg-brand-ink px-3.5 py-2 text-ui font-medium text-brand-foreground transition-[transform,filter] duration-150 hover:brightness-95 active:scale-[0.98] disabled:opacity-60";
const quiet = "rounded-xl px-3 py-2 text-ui text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-60";

export function OpenPlaceCard({ plan, agentName }: { plan: OpenPlacePlan; agentName: string }) {
  const { dispatch } = useStore();
  const workspaces = useWorkspaces();
  const words = placeWords(plan.page, plan.row, agentName);
  const actions = goActions(plan);
  // a workspace's own page is drawn only where there are workspaces, and
  // a page nobody can draw here is a button that would do nothing
  const here = actions.length > 0 && (!plan.workspace || Boolean(currentWorkspace(workspaces)));
  return (
    <div className={shell}>
      <div className="px-4 py-4">
        <div className={eyebrow}>{t("openCard.eyebrow")}</div>
        <div className="mt-1 text-lead font-semibold text-foreground">{words.name}</div>
        <div className="mt-1 text-body text-muted-foreground">{t("openCard.pointsYou", { name: agentName, path: words.path })}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
        {here ? (
          <button onClick={() => actions.forEach((action) => dispatch(action))} className={primary}>
            <ArrowUpRight size={14} />
            {t("openCard.open", { page: words.name })}
          </button>
        ) : (
          <span className="text-body text-muted-foreground">{t("openCard.notHere", { path: words.path })}</span>
        )}
      </div>
    </div>
  );
}

/** A value as the card shows it: its choice's words, or itself. */
function valueWords(value: { key?: string; text: string }): string {
  return value.key && hasMessage(value.key) ? t(value.key) : value.text;
}

export function SettingsProposalCard({ plan, messageId }: { plan: SettingsProposalPlan; messageId: string }) {
  const [busy, setBusy] = useState<"change" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = hasMessage(plan.nameKey) ? t(plan.nameKey) : plan.name;
  const where = placeWords(plan.page, undefined, plan.agentName).path;
  const answer = (change: boolean) => {
    setBusy(change ? "change" : "keep");
    setError(null);
    api(`/api/settings-proposals/${encodeURIComponent(plan.laneId)}/${encodeURIComponent(messageId)}/${change ? "change" : "keep"}`, {
      method: "POST",
      body: "{}",
    })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 px-4 py-2">
      <span className="w-[112px] shrink-0 text-body text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-body text-foreground">{value}</span>
    </div>
  );
  const heading =
    plan.outcome === "changed"
      ? t("settingsProposal.changed")
      : plan.outcome === "kept"
        ? t("settingsProposal.kept")
        : plan.outcome === "failed"
          ? t("settingsProposal.notChanged")
          : t("settingsProposal.eyebrow");
  return (
    <div className={shell}>
      <div className="px-4 pt-4">
        <div className={eyebrow}>{heading}</div>
        <div className="mt-1 text-lead font-semibold text-foreground">{t("settingsProposal.title", { name: plan.agentName, setting: name })}</div>
      </div>
      <div className="mt-3 flex flex-col divide-y border-t">
        {row(t("settingsProposal.setting"), name)}
        {row(t("settingsProposal.where"), where)}
        {row(t("settingsProposal.now"), valueWords(plan.current))}
        {row(t("settingsProposal.proposed"), <span className="font-medium">{valueWords(plan.proposed)}</span>)}
        {plan.why && row(t("settingsProposal.why"), <span className="whitespace-pre-wrap">{plan.why}</span>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
        {plan.outcome === "changed" ? (
          <span className="flex items-center gap-1.5 text-body text-muted-foreground">
            <Check size={14} /> {t("settingsProposal.changedSentence", { where })}
          </span>
        ) : plan.outcome === "kept" ? (
          <span className="text-body text-muted-foreground">{t("settingsProposal.keptSentence")}</span>
        ) : plan.outcome === "failed" ? (
          <span className="text-body text-muted-foreground">{t("settingsProposal.failedSentence", { error: plan.error ?? "" })}</span>
        ) : (
          <>
            <button onClick={() => answer(true)} disabled={busy !== null} className={primary}>
              {busy === "change" && <Loader2 size={14} className="animate-spin" />}
              {t("common.change")}
            </button>
            <button onClick={() => answer(false)} disabled={busy !== null} className={quiet}>
              {t("common.keep")}
            </button>
            <span className="text-small text-muted-foreground">{t("settingsProposal.onlyIfYouSay")}</span>
          </>
        )}
        {error && <div className="w-full text-body text-destructive">{error}</div>}
      </div>
    </div>
  );
}
