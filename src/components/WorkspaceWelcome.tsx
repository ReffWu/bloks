// The welcome a workspace made beside Personal opens on: short, and
// about what was chosen when it was made (src/lib/workspaceWelcome.ts has
// the rules). A Business starts with its name and logo; any workspace
// then gets the agents for the work done in it; a Team one ends on
// inviting people, and one that is just you never mentions them.
//
// The same frame as the first run (src/components/Onboarding): the
// stepper on top, the way on at the foot, each beat turning like a page.
// Every step can be skipped, the whole of it too, and the step reached is
// kept, so somebody who quits halfway comes back to it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, RefreshCw, Trash2, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { setSetupDone, track } from "@/lib/analytics";
import { act, currentWorkspace, useWorkspaces } from "@/lib/workspaces";
import { AGENT_TEMPLATES } from "@/lib/agentTemplates";
import { membersApi, type MembersData } from "@/lib/members";
import { keepWelcomeStep, readWelcomeStep, resumeAt, welcomeSteps, type WelcomeStep } from "@/lib/workspaceWelcome";
import { useStore } from "@/state/store";
import { BlockField, BloksMark } from "./Brand";
import { BlokAvatar } from "./Avatar";
import { BeatHeading, Stepper, beat } from "./Beats";
import { AgentsBeat, Column, EnginesBeat, ReadyDot, namesOf, useAgentHiring, useEngines } from "./Onboarding";
import { InviteSheet } from "./members/InviteSheet";
import { NeedsTeam } from "./TeamLock";
import { WorkspaceMark } from "./WorkspaceMark";
import { t } from "@/lib/i18n";

const isElectron = navigator.userAgent.includes("Electron");

export function WorkspaceWelcome({ onDone }: { onDone: () => void }) {
  const { dispatch } = useStore();
  const s = useWorkspaces();
  const ws = currentWorkspace(s);
  // the window knows its own kind before the list arrives (the preload)
  const kind = ws?.kind ?? window.bloks?.workspace?.kind ?? "custom";
  const name = ws?.name ?? window.bloks?.workspace?.name ?? "this workspace";
  const team = ws?.team === true;
  const engines = useEngines();
  const { hiring, hired, hireNote, hire } = useAgentHiring();
  const [work, setWork] = useState<string[]>([]);

  const steps = useMemo(
    () => welcomeSteps({ kind, team, enginesReady: engines.instances === null ? null : engines.ready }),
    [kind, team, engines.instances, engines.ready],
  );
  // The step reached last time, read once. Until somebody moves, it is
  // worked out again as the steps settle: the engines step only exists
  // once the engines have answered, and coming back to it must not fall
  // to the first step in the moment before they do.
  const [saved] = useState(readWelcomeStep);
  const [stage, setStage] = useState<WelcomeStep | null>(null);
  const shown = stage && steps.some((st) => st.id === stage) ? stage : resumeAt(steps, stage ?? saved);
  const at = steps.findIndex((st) => st.id === shown);
  const last = at === steps.length - 1;
  /** Moving is what is kept, so a quit comes back here. */
  const go = (step: WelcomeStep) => {
    setStage(step);
    keepWelcomeStep(step);
  };

  // the engines are asked once at the start, and on their step every few
  // seconds, for somebody installing one in another window
  useEffect(() => {
    void engines.checkEngines();
  }, [engines.checkEngines]);
  useEffect(() => {
    if (shown !== "engines") return;
    const timer = setInterval(() => void engines.checkEngines(), 5000);
    return () => clearInterval(timer);
  }, [shown, engines.checkEngines]);

  useEffect(() => {
    track("workspace_welcome_step", { step: shown, kind, team });
  }, [shown, kind, team]);

  const finish = useCallback(
    (how: "done" | "skipped") => {
      track("workspace_welcome_done", { how, kind, team, agents: hired.length });
      keepWelcomeStep(null);
      setSetupDone();
      onDone();
      if (hired[0]) dispatch({ type: "select", id: hired[0].bot });
    },
    [hired, kind, team, onDone, dispatch],
  );
  const next = () => (last ? finish("done") : go(steps[at + 1]!.id));
  const back = () => at > 0 && go(steps[at - 1]!.id);

  // the business step saves its name on the way on, and says why not
  const [draftName, setDraftName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const goOn = async () => {
    if (shown === "business" && ws && draftName !== null && draftName.replace(/\s+/g, " ").trim() !== ws.name) {
      setSaving(true);
      const error = await act(window.bloks?.workspaceUpdate?.(ws.id, { name: draftName }));
      setSaving(false);
      if (error) return setNameError(error);
    }
    next();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        back();
      }}
    >
      <BlockField />
      <div
        className={cn("relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3", isElectron && "pl-24 pt-9")}
        style={isElectron ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
      >
        <div className="justify-self-start">
          {at > 0 ? (
            <Button variant="ghost" onClick={back} aria-label={t("common.back")} className="max-sm:px-2">
              <ArrowLeft size={15} />
              <span className="max-sm:hidden">{t("common.back")}</span>
            </Button>
          ) : (
            <span className="flex h-8 items-center gap-2 px-2">
              {ws ? <WorkspaceMark mark={ws.mark} logo={ws.logo} size={22} /> : <BloksMark size={22} />}
            </span>
          )}
        </div>
        {steps.length > 1 ? (
          <Stepper steps={steps} step={shown} isOpen={(i) => i < at} onGo={go} layoutId="workspace-welcome-step" />
        ) : (
          <span />
        )}
        <div className="justify-self-end">
          <Button variant="ghost" onClick={() => finish("skipped")} className="max-sm:px-2">
            <span className="max-sm:hidden">{t("common.skipForNow")}</span>
            <span className="sm:hidden">{t("workspaceWelcome.skip")}</span>
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {shown === "business" ? (
            <motion.div key="business" {...beat}>
              <BusinessBeat
                name={draftName ?? ws?.name ?? name}
                onName={(value) => {
                  setDraftName(value);
                  setNameError(null);
                }}
                error={nameError}
                onSubmit={() => void goOn()}
              />
            </motion.div>
          ) : shown === "engines" ? (
            <motion.div key="engines" {...beat}>
              <EnginesBeat
                readiness={engines.readiness}
                versionOf={engines.versionOf}
                ready={engines.ready}
                loaded={engines.instances !== null}
                onChanged={() => void engines.checkEngines()}
              />
            </motion.div>
          ) : shown === "agents" ? (
            <motion.div key="agents" {...beat}>
              <AgentsBeat
                work={work}
                setWork={setWork}
                hired={hired}
                hiring={hiring}
                onHire={hire}
                title={`Who works in ${name}?`}
                says={t("workspaceWelcome.pickTheKindsOfWork")}
              />
            </motion.div>
          ) : (
            <motion.div key="invite" {...beat}>
              <InviteBeat name={name} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* the way on, always in the same place */}
      <div className="relative z-10 border-t bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1080px] items-center gap-2 px-5 py-3 sm:px-8">
          <span className={cn("mr-auto flex min-w-0 items-center gap-2.5 text-body", hireNote && shown === "agents" ? "text-destructive" : "text-muted-foreground")}>
            {shown === "engines" ? (
              <>
                <ReadyDot state={!engines.instances ? "checking" : engines.ready ? "ready" : "missing"} />
                <span className="truncate">{engines.readyEngine ? `${engines.readyEngine.name} is ready` : t("workspaceWelcome.noEngineReadyYetAgents")}</span>
              </>
            ) : shown === "agents" ? (
              <>
                {hired.length > 0 && !hireNote && (
                  <span className="flex shrink-0 items-center">
                    {hired.map((h, i) => {
                      const t = AGENT_TEMPLATES.find((x) => x.id === h.template);
                      return t ? (
                        <span key={h.bot} className={cn("rounded-[8px] ring-2 ring-background", i > 0 && "-ml-1.5")}>
                          <BlokAvatar color={t.color} shape={t.shape} expression="friendly" size={24} />
                        </span>
                      ) : null;
                    })}
                  </span>
                )}
                <span className="truncate max-sm:hidden">
                  {hireNote ??
                    (hired.length
                      ? `${namesOf(hired.map((h) => AGENT_TEMPLATES.find((t) => t.id === h.template)?.name ?? "An agent"))} added`
                      : t("workspaceWelcome.optionalYouCanAddAgents"))}
                </span>
              </>
            ) : (
              <span className="truncate max-sm:hidden">{shown === "business" ? t("workspaceWelcome.changeBothAnyTimeIn") : t("workspaceWelcome.optionalMembersIsInIts")}</span>
            )}
          </span>
          {shown === "engines" && (
            <Button variant="ghost" size="lg" onClick={() => void engines.checkEngines()} aria-label={t("common.checkAgain")} className="max-sm:px-3">
              <RefreshCw size={14} className={cn(engines.checking && "animate-spin")} />
              <span className="max-sm:hidden">{t("common.checkAgain")}</span>
            </Button>
          )}
          <Button size="lg" onClick={() => void goOn()} disabled={saving || hiring.length > 0}>
            {saving && <Loader2 size={15} className="animate-spin" />}
            {last ? `Open ${name}` : t("common.continue")}
            {!last && <ArrowRight size={15} />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A Business first: its name and logo, as clients and members will see
 * them in the switcher, in banners and on an invite. */
function BusinessBeat({ name, onName, error, onSubmit }: { name: string; onName: (name: string) => void; error: string | null; onSubmit: () => void }) {
  const ws = currentWorkspace(useWorkspaces());
  const [busy, setBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logo = async (work: Promise<{ error?: string } | undefined> | undefined) => {
    setBusy(true);
    setLogoError(await act(work));
    setBusy(false);
  };
  return (
    <Column>
      <BeatHeading title={t("workspaceWelcome.nameItAndAddYour")} says={t("workspaceWelcome.howItShowsInThe")} />
      <div className="flex items-center gap-5 rounded-2xl border bg-card p-5 max-sm:flex-col max-sm:items-start">
        <span key={ws?.logo ?? "mark"} className="flex animate-pop-in">
          <WorkspaceMark mark={ws?.mark ?? null} logo={ws?.logo} size={72} label={`${name}'s mark`} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            <label htmlFor="welcome-business-name" className="text-small font-medium text-muted-foreground">
              {t("common.name")}
            </label>
            <Input
              id="welcome-business-name"
              autoFocus
              value={name}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => onName(e.target.value)}
              aria-invalid={Boolean(error) || undefined}
              className="h-10 rounded-[10px]"
            />
            {error && (
              <p role="alert" className="text-small text-destructive">
                {error}
              </p>
            )}
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" className="gap-1.5" disabled={busy || !ws} onClick={() => void logo(window.bloks?.workspaceLogoPick?.(ws!.id))}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {ws?.logo ? t("workspaceWelcome.chooseAnotherLogo") : t("workspaceWelcome.uploadLogo")}
            </Button>
            {ws?.logo && (
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={busy} onClick={() => void logo(window.bloks?.workspaceLogoClear?.(ws.id))}>
                <Trash2 size={13} />
                {t("workspaceWelcome.useTheMark")}
              </Button>
            )}
          </div>
          {logoError && <p className="text-small text-destructive">{logoError}</p>}
        </div>
      </div>
    </Column>
  );
}

/** A Team one ends on its people: one invite at a time, the same sheet
 * Members uses, so the code read out here is the one the page shows. */
function InviteBeat({ name }: { name: string }) {
  const [data, setData] = useState<MembersData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const load = useCallback(() => {
    membersApi
      .list()
      .then((next) => {
        setData(next);
        setProblem(null);
      })
      .catch((e: Error) => setProblem(e.message));
  }, []);
  useEffect(load, [load]);
  const teamOn = data?.team !== false;
  const out = (data?.invites ?? []).filter((i) => i.status === "open" || i.status === "waiting").length;
  return (
    <Column>
      <BeatHeading
        title={`Invite people to ${name}`}
        says={t("workspaceWelcome.eachPersonGetsTheirOwn")}
      />
      <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-5">
        {!data && !problem ? (
          <span className="flex items-center gap-2 text-body text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {t("workspaceWelcome.gettingTheInvitationsReady")}
          </span>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => setInviting(true)} disabled={!data || !teamOn}>
                <Plus size={16} />
                {out ? t("workspaceWelcome.inviteSomeoneElse") : t("workspaceWelcome.inviteSomeone")}
              </Button>
              {out > 0 && (
                <span className="flex items-center gap-1.5 text-body text-muted-foreground">
                  <Check size={14} className="text-success" />
                  {out === 1 ? t("workspaceWelcome.n1InvitationOut") : `${out} invitations out`}
                </span>
              )}
            </div>
            {!teamOn && <NeedsTeam />}
            {data && !data.online.available && data.online.why && <p className="text-pretty text-small text-muted-foreground">{data.online.why}</p>}
            {problem && <p className="text-pretty text-small text-destructive">{problem}</p>}
          </>
        )}
      </div>
      {data && (
        <InviteSheet
          open={inviting}
          onOpenChange={setInviting}
          workspace={data.workspace}
          passwordSet={Boolean(data.joining?.password)}
          approveEach={data.joining?.approveEach !== false}
          onChanged={load}
        />
      )}
    </Column>
  );
}
