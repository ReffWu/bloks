// The review before anything from the catalogue, a link or a file is
// installed: exactly what will be created, and nothing until Install.
//
// A team says who it hires, the room they will share, the skills they
// bring (each one readable before it lands in every turn), the routines
// it files, and that every one of those routines starts paused and every
// new agent starts with connected apps, the browser and tool servers off.
// An update says what changed since the version installed, and that
// nothing is taken away. A skill shows its instructions, or the lines an
// update would change, with the same honest line the skill catalogue
// always had about a copy somebody edited.
//
// Installing sends back only the review's token: the server installs the
// bytes it showed here, not whatever a link serves by then.
import { useMemo, useState } from "react";
import { CalendarClock } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { Crown } from "@/components/icons";
import { Lock } from "@/components/icons";
import { Pause } from "@/components/icons";
import { ShieldAlert } from "@/components/icons";
import { ShieldCheck } from "@/components/icons";
import { Sparkles } from "@/components/icons";
import { TriangleAlert } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { BlokAvatar } from "./Avatar";
import { DiffLines } from "./DiffLines";
import { Markdownish } from "./Markdown";
import { drawNames } from "@/lib/teamLibrary";
import type { InstallResult, PlannedSkill, Review, SkillReview, TeamReview } from "@/lib/catalog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatList, t, tr, type MessageKey } from "@/lib/i18n";

/** A plain run of names or counts ("Ada, Ben"), with no "and". */
const run = (items: string[]) => formatList(items, { type: "unit", style: "short" });

/** A skill's verbs as the server sends them (server/skill-registry.ts),
 * in the reader's language; an unknown one as the server words it. */
const ACTION: Record<string, { label: MessageKey; title: MessageKey }> = {
  Install: { label: "catalogReview.install", title: "catalogReview.installItem" },
  Update: { label: "catalogReview.update", title: "catalogReview.updateItem" },
  Replace: { label: "catalogReview.action.replace", title: "catalogReview.replaceItem" },
  Restore: { label: "catalogReview.action.restore", title: "catalogReview.restoreItem" },
};

export function CatalogReview({
  review,
  onClose,
  onInstalled,
}: {
  review: Review;
  onClose: () => void;
  onInstalled?: (result: InstallResult) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] w-full max-w-[580px] flex-col gap-0 overflow-hidden p-0">
        {review.kind === "team" ? (
          <TeamBody review={review} onClose={onClose} onInstalled={onInstalled} />
        ) : (
          <SkillBody review={review} onClose={onClose} onInstalled={onInstalled} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Where it came from, and how far that is worth trusting. */
function Origin({ review }: { review: Review }) {
  if (review.origin === "catalogue") {
    return (
      <p className="flex items-center gap-1.5 text-small text-muted-foreground">
        <ShieldCheck size={13} className="shrink-0 text-success" />
        {!review.item
          ? t("catalogReview.origin.catalogue")
          : review.item.author
            ? t("catalogReview.origin.catalogueVersionBy", { version: review.item.version, author: review.item.author })
            : t("catalogReview.origin.catalogueVersion", { version: review.item.version })}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-small text-warning">
      <ShieldAlert size={13} className="mt-[2px] shrink-0" />
      <span>
        {review.origin === "link"
          ? review.host
            ? t("catalogReview.origin.host", { host: review.host })
            : t("catalogReview.origin.link")
          : t("catalogReview.origin.file")}
      </span>
    </p>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-1">
      <h3 className="mb-2 flex items-baseline justify-between text-body font-semibold text-foreground">
        {title}
        {count !== undefined && <span className="text-small font-normal tabular-nums text-muted-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

const SKILL_CHIP: Record<PlannedSkill["state"], { label: MessageKey; tone: string }> = {
  install: { label: "common.new", tone: "bg-brand/15 text-brand-ink" },
  installed: { label: "catalogReview.chip.alreadyHere", tone: "bg-muted text-muted-foreground" },
  kept: { label: "catalogReview.chip.yoursIsUsed", tone: "bg-muted text-muted-foreground" },
  missing: { label: "catalogReview.chip.leftOut", tone: "bg-warning/15 text-warning" },
};

/** One skill a team brings, readable in place before it is installed. */
function SkillRow({ skill }: { skill: PlannedSkill }) {
  const [open, setOpen] = useState(false);
  const chip = SKILL_CHIP[skill.state];
  const readable = Boolean(skill.body) && skill.state !== "missing";
  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        disabled={!readable}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={readable ? open : undefined}
        className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left disabled:cursor-default"
      >
        <Sparkles size={15} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-foreground">{skill.name}</span>
            <span className={cn("shrink-0 rounded-full px-1.5 text-caption font-medium", chip.tone)}>{t(chip.label)}</span>
          </span>
          <span className="block truncate text-small text-muted-foreground">
            {t("catalogReview.saysFor", { says: skill.says, agents: run(skill.usedBy) })}
          </span>
        </span>
        {readable && <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} />}
      </button>
      {open && (
        <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap border-t bg-muted/40 px-3 py-2.5 font-mono text-small leading-relaxed text-foreground">
          {skill.body}
        </pre>
      )}
    </div>
  );
}

/** Whom a planned routine is for, after its schedule when it has a name
 * (the summary is the server's). */
function routineTarget(routine: { name?: string; summary: string; target: string }): string {
  const target = routine.target === "room" ? t("catalogReview.toTheRoom") : t("catalogReview.forMember", { member: routine.target });
  return routine.name ? t("catalogReview.summaryTarget", { summary: routine.summary, target }) : target;
}

function TeamBody({ review, onClose, onInstalled }: { review: TeamReview; onClose: () => void; onInstalled?: (result: InstallResult) => void }) {
  const { state, dispatch } = useStore();
  const { plan, update } = review;
  // an update onto the room the last install made, unless it is the
  // very same version, which can only be installed again as a copy
  const [mode, setMode] = useState<"update" | "new">(update && !update.same ? "update" : "new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const names = useMemo(() => {
    const taken = state.bots.map((b) => b.name);
    const fresh = drawNames(plan.agents.length, taken);
    return review.team.members.map((m, i) => (m.name && !taken.some((name) => name.toLowerCase() === m.name!.toLowerCase()) ? m.name : fresh[i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.token]);
  const newSkills = plan.skills.filter((s) => s.state === "install").length;
  const updating = mode === "update" && update;

  const install = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: review.token, names, mode }) })
      .then(({ result }: { result: InstallResult }) =>
        api("/api/bloks").then(({ bloks }) => {
          dispatch({ type: "hydrateBloks", bloks });
          if (result.roomId) dispatch({ type: "select", id: result.roomId });
          const parts = [
            result.botIds.length ? t("catalogReview.toast.newAgents", { count: result.botIds.length }) : "",
            result.skillIds.length ? t("catalogReview.toast.skills", { count: result.skillIds.length }) : "",
            result.routineIds.length ? t("catalogReview.toast.routinesPaused", { count: result.routineIds.length }) : "",
          ].filter(Boolean);
          // the notes are the server's, as it words them
          toast.success(updating ? t("catalogReview.updatedItem", { item: review.team.name }) : t("catalogReview.installedItem", { item: review.team.name }), {
            ...(parts.length || result.notes.length ? { description: [parts.length ? run(parts) : "", ...result.notes].filter(Boolean).join(". ") } : {}),
          });
          onInstalled?.(result);
          onClose();
        }),
      )
      .catch((e: Error) => {
        setError(e.message);
        setBusy(false);
      });
  };

  return (
    <>
      <div className="shrink-0 border-b px-5 pb-3.5 pt-4">
        <DialogTitle className="pr-8 text-lead">
          {updating ? t("catalogReview.updateItem", { item: review.team.name }) : t("catalogReview.installItem", { item: review.team.name })}
        </DialogTitle>
        {review.team.blurb && <DialogDescription className="mt-1 text-body">{review.team.blurb}</DialogDescription>}
        <div className="mt-2">
          <Origin review={review} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">
        {update && (
          <div className="mb-4 rounded-xl bg-muted/60 px-3 py-2.5">
            <p className="text-body text-foreground">
              {update.same
                ? t("catalogReview.alreadyInstalledIn", { room: update.roomName })
                : t("catalogReview.versionInstalledIn", { version: update.version, room: update.roomName })}
            </p>
            <Segmented
              size="sm"
              className="mt-2.5"
              aria-label={t("catalogReview.howToInstall")}
              value={mode}
              onChange={(next) => setMode(next)}
              options={[
                { value: "update", label: t("catalogReview.updateTheRoom"), disabled: update.same },
                { value: "new", label: t("catalogReview.installANewRoom") },
              ]}
            />
          </div>
        )}

        {updating ? (
          <Section title={t("catalogReview.whatChanges")} count={update.changes.length}>
            {update.changes.length === 0 ? (
              <p className="text-body text-muted-foreground">{t("catalogReview.nothingThatChangesWhatIs")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {update.changes.map((change, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-body">
                    <span
                      className={cn(
                        "mt-[3px] shrink-0 rounded-full px-1.5 text-caption font-medium",
                        change.kind === "added" ? "bg-success/15 text-success" : change.kind === "removed" ? "bg-muted text-muted-foreground" : "bg-brand/15 text-brand-ink",
                      )}
                    >
                      {change.kind === "added" ? t("common.new") : change.kind === "removed" ? t("catalogReview.gone") : t("catalogReview.changed")}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{change.title}</span>
                      <span className="text-muted-foreground">. {change.says}.</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2.5 text-small leading-relaxed text-muted-foreground">
              {t("catalogReview.agentsYouChangedSinceInstalling")}
            </p>
            {update.diff && update.diff.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowDiff((v) => !v)}
                  aria-expanded={showDiff}
                  className="flex items-center gap-1 text-small text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  <ChevronDown size={12} className={cn("transition-transform duration-150", showDiff && "rotate-180")} />
                  {showDiff ? t("catalogReview.hideTheFilesChanges") : t("catalogReview.showTheFilesChanges")}
                </button>
                {showDiff && (
                  <div className="mt-2 max-h-[280px] overflow-auto rounded-xl border bg-card py-2">
                    <DiffLines lines={update.diff} />
                  </div>
                )}
              </div>
            )}
          </Section>
        ) : (
          <>
            <Section title={t("catalogReview.newAgents")} count={plan.agents.length}>
              <div className="flex flex-col gap-1.5">
                {plan.agents.map((agent, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2">
                    <BlokAvatar color={agent.color} shape={agent.shape} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-body font-medium text-foreground">
                        {names[i]}
                        <span className="font-normal text-muted-foreground">· {agent.title}</span>
                        {agent.seniority === 5 && <Crown size={11} className="shrink-0 text-brand-ink" aria-label={t("catalogReview.leads")} />}
                      </span>
                      <span className="line-clamp-2 text-small text-muted-foreground">{agent.description}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>
            <Section title={t("catalogReview.room")}>
              <p className="text-body text-muted-foreground">
                {tr("catalogReview.roomWithAgents", { room: <span className="text-foreground">{plan.room.name}</span>, count: plan.agents.length })}
              </p>
            </Section>
          </>
        )}

        {plan.skills.length > 0 && (
          <Section title={t("common.skills")} count={plan.skills.length}>
            {newSkills > 0 && (
              <p className="mb-2 flex items-start gap-1.5 text-small leading-relaxed text-warning">
                <ShieldAlert size={13} className="mt-[2px] shrink-0" />
                {t("catalogReview.agentsFollowASkillsInstructions")}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {plan.skills.map((skill) => (
                <SkillRow key={skill.id} skill={skill} />
              ))}
            </div>
          </Section>
        )}

        {/* an update lists its new routines among the changes above */}
        {!updating && plan.routines.length > 0 && (
          <Section title={t("common.routines")} count={plan.routines.length}>
            <div className="flex flex-col gap-1.5">
              {plan.routines.map((routine, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border bg-card px-3 py-2">
                  <CalendarClock size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body font-medium text-foreground">{routine.name ?? routine.summary}</span>
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 text-caption font-medium text-muted-foreground">
                        <Pause size={9} />
                        {t("common.paused")}
                      </span>
                    </span>
                    <span className="block text-small text-muted-foreground">
                      {routineTarget(routine)}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-small text-foreground/80">{routine.prompt}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-small leading-relaxed text-muted-foreground">
              {t("catalogReview.theyStartPausedSwitchEach")}
            </p>
          </Section>
        )}

        {(!updating || plan.agents.length > 0) && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-muted/60 px-3 py-2.5">
            <Lock size={14} className="mt-[3px] shrink-0 text-muted-foreground" />
            <p className="text-body leading-relaxed text-foreground">
              {t("catalogReview.newAgentsStartOff")}
              <span className="text-muted-foreground"> {t("catalogReview.turnOnWhatEachOne")}</span>
            </p>
          </div>
        )}

        {error && <p className="mt-3 text-small text-destructive">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5">
        <span className="text-small tabular-nums text-muted-foreground">
          {updating
            ? t("catalogReview.count.changes", { count: update.changes.length })
            : [
                t("catalogReview.count.agents", { count: plan.agents.length }),
                newSkills ? t("catalogReview.count.newSkills", { count: newSkills }) : "",
                plan.routines.length ? t("catalogReview.count.routines", { count: plan.routines.length }) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={install} disabled={busy}>
            {busy ? (updating ? t("catalogReview.updating") : t("catalogReview.installing")) : updating ? t("catalogReview.update") : t("catalogReview.install")}
          </Button>
        </div>
      </div>
    </>
  );
}

function SkillBody({ review, onClose, onInstalled }: { review: SkillReview; onClose: () => void; onInstalled?: (result: InstallResult) => void }) {
  const { plan } = review;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = plan.standing.action;
  const shown = plan.standing.state !== "available" && plan.standing.state !== "current";

  const install = () => {
    if (busy || !action) return;
    setBusy(true);
    setError(null);
    api("/api/catalog/install", { method: "POST", body: JSON.stringify({ token: review.token }) })
      .then(({ result }: { result: InstallResult }) => {
        toast.success(t("catalogReview.installedItem", { item: plan.skill.name }), { description: t("catalogReview.attachItToAnAgent") });
        onInstalled?.(result);
        onClose();
      })
      .catch((e: Error) => {
        setError(e.message);
        setBusy(false);
      });
  };

  return (
    <>
      <div className="shrink-0 border-b px-5 pb-3.5 pt-4">
        <DialogTitle className="pr-8 text-lead">
          {action && ACTION[action] ? t(ACTION[action].title, { item: plan.skill.name }) : action ? `${action} ${plan.skill.name}` : t("catalogReview.installItem", { item: plan.skill.name })}
        </DialogTitle>
        {plan.skill.description && <DialogDescription className="mt-1 text-body">{plan.skill.description}</DialogDescription>}
        <div className="mt-2">
          <Origin review={review} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">
        <div className="flex items-start gap-2.5 rounded-xl bg-warning/10 px-3 py-2.5">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-body leading-relaxed text-warning">
            {t("catalogReview.agentsUsingThisSkillFollow")}
          </p>
        </div>

        {shown && (
          <div
            className={cn(
              "mt-3 flex gap-2 rounded-xl px-3 py-2 text-body leading-relaxed",
              plan.standing.destructive ? "bg-warning/10 text-warning" : "bg-muted/60 text-foreground",
            )}
          >
            {plan.standing.destructive && <TriangleAlert size={14} className="mt-[3px] shrink-0" />}
            <span>
              {plan.standing.destructive ? t("catalogReview.saysReplaces", { says: plan.standing.says }) : t("catalogReview.saysPeriod", { says: plan.standing.says })}
            </span>
          </div>
        )}

        {plan.diff ? (
          <Section title={t("catalogReview.whatChanges")}>
            <div className="max-h-[360px] overflow-auto rounded-xl border bg-card py-2">
              <DiffLines lines={plan.diff} />
            </div>
          </Section>
        ) : (
          <Section title={t("common.instructions")}>
            <div className="max-h-[400px] overflow-auto rounded-xl border bg-card px-3.5 py-3 text-body leading-relaxed">
              <Markdownish text={plan.skill.body} />
            </div>
          </Section>
        )}
        {error && <p className="mt-3 text-small text-destructive">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3.5">
        <span className="text-small text-muted-foreground">{t("catalogReview.version", { version: plan.skill.version })}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={install}
            disabled={busy || !action}
            variant={plan.standing.destructive ? "outline" : "default"}
            className={cn(plan.standing.destructive && "text-warning hover:text-warning")}
          >
            {plan.standing.destructive && !busy && <TriangleAlert size={13} />}
            {busy ? t("catalogReview.installing") : action ? (ACTION[action] ? t(ACTION[action].label) : action) : t("catalogReview.installed")}
          </Button>
        </div>
      </div>
    </>
  );
}
