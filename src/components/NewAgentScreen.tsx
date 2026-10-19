// Making a new agent, as a whole screen with three short beats:
//   1. the job: what you need, in your words, or a role to start from
//      (or a whole team, for a job that needs several)
//   2. who they are: a name, a face, and what they know
//   3. how they work: the engine, how much they ask, where they work
// with the agent on the right the whole way, as it will appear, so every
// choice is seen landing on someone rather than filled into a form.
//
// Only the first beat is needed. The second is already filled in from the
// first, and the third starts on the workspace's own defaults, so "Hire"
// is there from the second beat on and a quick hire stays two clicks. The
// finish is the agent's first conversation, with its greeting waiting.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "@/components/icons";
import { ArrowRight } from "@/components/icons";
import { Check } from "@/components/icons";
import { Crown } from "@/components/icons";
import { FolderOpen } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Plus } from "@/components/icons";
import { RefreshCw } from "@/components/icons";
import { Sparkles } from "@/components/icons";
import { Upload } from "@/components/icons";
import { Users } from "@/components/icons";
import { X } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BrowseFolderButton } from "@/components/ui/browse-folder";
import { track } from "@/lib/analytics";
import { api, useStore, type Bot, type ModelSelection, type NewAgentProfile } from "@/state/store";
import {
  AGENT_TEMPLATES,
  GENERIC_SETUP,
  matchTemplate,
  suggestName,
  suggestTitle,
  type AgentTemplate,
} from "@/lib/agentTemplates";
import {
  createDrafter,
  DRAFT_SETTLE_MS,
  draftKey,
  mergeDraft,
  worthDrafting,
  type AgentDraft,
  type DraftField,
} from "@/lib/agentDraft";
import { BLOK_COLORS, BLOK_COLOR_NAMES, BLOK_SHAPES, type BlokColor, type BlokShape } from "@/lib/mascot";
import { AvatarLanding, BeatHeading, BeatLabel as Label, PreviewCard, Stepper, beat } from "./Beats";
import { TEAM_LIBRARY } from "@/lib/teamLibrary";
import { BlokAvatar } from "./Avatar";
import { BlockField } from "./Brand";
import { ProviderMark } from "./ProviderIcons";
import { ModelPicker } from "./ModelPicker";
import { AGENT_FILE_ACCEPT, ImportAgentDialog, readAgentFile } from "./ImportAgent";
import { TeamHireDialog, type HireableTeam } from "./TeamHireDialog";
import { APPROVAL_MODES, ApprovalsChooser, confirmWidening, useWorkspaceApprovals, type ApprovalMode } from "./ApprovalsChooser";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/plural";
import { useEscape } from "@/lib/useEscape";

const isElectron = navigator.userAgent.includes("Electron");

type Step = "job" | "identity" | "setup";
const STEPS: Array<{ id: Step; label: string }> = [
  { id: "job", label: "The job" },
  { id: "identity", label: "Who they are" },
  { id: "setup", label: "How they work" },
];

/** What the agent knows, before it exists: its line, its standing
 * instructions and its skills. Seeded from a role or a drafted persona,
 * and the person's to edit either way. */
interface Persona {
  title: string;
  description: string;
  skills: string[];
  /** Skills from the workspace's library a draft picked, kept on. */
  skillIds: string[];
}

const NO_PERSONA: Persona = { title: "", description: "", skills: [], skillIds: [] };

/** Drafts for the whole session, so a job typed again, or the screen
 * opened again, is not another wait (src/lib/agentDraft.ts). */
const drafter = createDrafter((body, signal) =>
  api("/api/agents/suggest", { method: "POST", body: JSON.stringify(body), signal }),
);

interface GalleryTeam {
  slug: string;
  name: string;
  blurb: string;
  author?: string;
  members: HireableTeam["members"];
}

/** A role as said in a sentence: "a writer", "an inbox manager". */
function asRole(template: AgentTemplate): string {
  const role = template.name.toLowerCase();
  return `${/^[aeiou]/.test(role) ? "an" : "a"} ${role}`;
}

function randomIdentity(): { color: BlokColor; shape: BlokShape } {
  return {
    color: BLOK_COLOR_NAMES[Math.floor(Math.random() * BLOK_COLOR_NAMES.length)],
    shape: BLOK_SHAPES[Math.floor(Math.random() * BLOK_SHAPES.length)],
  };
}

export function NewAgentScreen() {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState<Step>("job");
  const [text, setText] = useState("");
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState<Persona>(NO_PERSONA);
  // fields the person has typed into, which a late model draft leaves alone
  const edited = useRef(new Set<string>());
  const seededFor = useRef<string | null>(null);
  const [identity, setIdentity] = useState(randomIdentity);
  // a draft on its way for the job on the second beat
  const [drafting, setDrafting] = useState(false);
  // the fields showing a draft's words, for the hint beside them
  const [drafted, setDrafted] = useState<ReadonlySet<DraftField>>(() => new Set());
  // every name a draft has offered for this job, so "Another" is another
  const offeredNames = useRef<string[]>([]);
  // library skills a draft picked for this job, on or off
  const [offeredSkills, setOfferedSkills] = useState<string[]>([]);
  // the draft for the words being typed, shown while still on the first beat
  const [early, setEarly] = useState<{ key: string; draft: AgentDraft } | null>(null);
  const [engine, setEngine] = useState<ModelSelection | null>(null);
  const [approvals, setApprovals] = useState<ApprovalMode | null>(null);
  const [refused, setRefused] = useState(false);
  const [folder, setFolder] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<HTMLTextAreaElement>(null);
  // the text of a file waiting to be looked at; the dialog does the rest
  const [arriving, setArriving] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hiring, setHiring] = useState<HireableTeam | null>(null);

  const workspace = useWorkspaceApprovals().state;
  const workspaceMode: ApprovalMode = workspace?.mode ?? "ask";
  const mode = approvals ?? workspaceMode;
  const defaults = state.config?.agentDefaults;

  const canGoBack = state.bots.some((b) => !b.hidden);
  // Setup hands off to this screen, so it doubles as the last onboarding
  // step. Same screen, different framing: you are choosing your first
  // agent rather than adding another one.
  const firstRun = state.newAgentFirstRun;
  const close = () => dispatch({ type: "toggleNewAgent", open: false });

  const taken = useMemo(
    () => new Set(state.bots.filter((b) => !b.hidden).map((b) => b.name.trim().toLowerCase())),
    [state.bots],
  );

  const described = text.trim();
  const ready = Boolean(described || template);
  // While the job is being typed the agent on the right takes shape from
  // it: the role the words sound like lends its face, line and greeting,
  // until a role is picked or the look is chosen by hand.
  const heard = step === "job" && described ? matchTemplate(described) : null;
  const role = template ?? heard;
  // the draft for exactly these words, once it is in; a role picked by
  // hand is what was wanted, and no draft speaks over it
  const earlyDraft = step === "job" && !template && early?.key === draftKey(described) ? early.draft : null;
  const shownName =
    step === "job"
      ? template?.name || earlyDraft?.name || (described ? suggestName(described) : "")
      : name.trim() || template?.name || (described ? suggestName(described) : "");
  const greeting = role?.greeting ?? GENERIC_SETUP.greeting;
  const lookChosen = useRef(false);
  useEffect(() => {
    if (heard && !template && !lookChosen.current) setIdentity({ color: heard.color, shape: heard.shape });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard?.id]);
  const chooseLook = (look: { color: BlokColor; shape: BlokShape }) => {
    lookChosen.current = true;
    setIdentity(look);
  };
  const previewTitle =
    step === "job"
      ? (template?.title ?? earlyDraft?.title ?? heard?.title ?? (described ? suggestTitle(described) : ""))
      : persona.title;
  const previewSkills =
    step === "job" ? (template?.skills ?? (earlyDraft?.skills.length ? earlyDraft.skills : (heard?.skills ?? []))) : persona.skills;

  // While the job is typed, its draft is asked for once the words settle,
  // so it is usually in hand by the time Continue is pressed. Each new
  // word cancels the wait, and the drafter drops the call for old words.
  useEffect(() => {
    if (step !== "job" || template || !worthDrafting(described)) return;
    const key = draftKey(described);
    const have = drafter.kept(described);
    if (have) {
      setEarly({ key, draft: have });
      return;
    }
    const timer = setTimeout(() => {
      drafter
        .ask(described)
        .then((draft) => setEarly({ key, draft }))
        .catch(() => {});
    }, DRAFT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [described, step, template]);
  // nothing left asking once the screen is gone
  useEffect(() => () => drafter.stop(), []);

  /** A file, from the picker or from a drop. Read here and judged by the
   * server: whether it is really an agent is not this screen's call. */
  const takeFile = async (file: File | null | undefined) => {
    if (!file) return;
    setFileError(null);
    try {
      setArriving(await readAgentFile(file));
    } catch (e) {
      setFileError((e as Error).message);
    }
  };

  /** Into the second beat, filled in from the first. Only when the job
   * changed: going back to read it and forward again keeps every edit. */
  const toIdentity = (picked: AgentTemplate | null = template) => {
    const key = `${picked?.id ?? ""}|${described}`;
    if (seededFor.current !== key) {
      seededFor.current = key;
      edited.current.clear();
      offeredNames.current = [];
      setOfferedSkills([]);
      const seed = {
        name: picked?.name ?? (described ? suggestName(described) : ""),
        persona: {
          title: picked?.title ?? (described ? suggestTitle(described) : ""),
          description: picked?.description ?? "",
          skills: picked?.skills ?? [],
          skillIds: [],
        },
      };
      // A role chosen by hand says what was wanted; one matched from the
      // words was only a guess, so a model's draft may still improve it.
      const draftable = Boolean(described) && (!picked || picked === matchTemplate(described));
      const have = draftable ? drafter.kept(described) : undefined;
      if (have) applyDraft(have, seed);
      else {
        setName(seed.name);
        setPersona(seed.persona);
        setDrafted(new Set());
        if (draftable) suggest(described);
      }
    }
    setStep("identity");
  };

  /**
   * A draft onto the second beat. A drafted persona is the agent's craft,
   * the same job a role's description does, and it wins over a matched
   * role because it was written for this description rather than matched
   * to it. Nothing the person typed is touched (mergeDraft). `base` is
   * the beat as just seeded, for a draft already in hand; without it the
   * draft lands on whatever the beat shows by then.
   */
  const applyDraft = (draft: AgentDraft, base?: { name: string; persona: Persona }) => {
    const edits = edited.current;
    const merge = (n: string, p: Persona) => mergeDraft({ name: n, ...p }, draft, edits);
    const personaOf = (f: ReturnType<typeof merge>["fields"]): Persona => ({
      title: f.title,
      description: f.description,
      skills: f.skills,
      skillIds: f.skillIds,
    });
    const { filled } = merge("", NO_PERSONA);
    if (base) {
      const { fields } = merge(base.name, base.persona);
      setName(fields.name);
      setPersona(personaOf(fields));
      setDrafted(new Set(filled));
    } else {
      setName((n) => merge(n, NO_PERSONA).fields.name);
      setPersona((p) => personaOf(merge("", p).fields));
      // a field an earlier draft filled, and nobody has touched since,
      // still shows a draft's words
      setDrafted((prev) => new Set([...[...prev].filter((f) => !edits.has(f)), ...filled]));
    }
    if (draft.name) offeredNames.current.push(draft.name);
    if (draft.skillIds?.length) setOfferedSkills((prev) => [...new Set([...prev, ...draft.skillIds!])]);
  };

  /** Upgrade the local guess with a model-written one if a provider is up;
   * the flow never waits on it, and nothing typed is overwritten. `again`
   * asks for a different one than those already offered. */
  const suggest = (description: string, again = false) => {
    setDrafting(true);
    drafter
      .ask(description, again ? { again: true, avoid: [...offeredNames.current, name.trim()] } : {})
      .then((draft) => {
        if (seededFor.current?.split("|").slice(1).join("|") !== description) return;
        applyDraft(draft);
      })
      .catch(() => {})
      .finally(() => setDrafting(false));
  };

  const pickTemplate = (picked: AgentTemplate) => {
    setTemplate(picked);
    setIdentity({ color: picked.color, shape: picked.shape });
    toIdentity(picked);
  };

  const continueFromJob = () => {
    if (!described) return;
    // a role picked by hand stays picked; otherwise the words choose
    const chosen = template ?? matchTemplate(described);
    setTemplate(chosen);
    if (chosen && chosen !== template && !lookChosen.current) setIdentity({ color: chosen.color, shape: chosen.shape });
    toIdentity(chosen);
  };

  const editPersona = (patch: Partial<Persona>) => {
    for (const key of Object.keys(patch)) edited.current.add(key);
    setDrafted((prev) => new Set([...prev].filter((f) => !(f in patch))));
    setPersona((p) => ({ ...p, ...patch }));
  };

  /** Widening asks who is there, the same as in an agent's own settings;
   * narrowing never does. */
  const chooseApprovals = async (next: ApprovalMode) => {
    if (next === mode) return;
    setRefused(false);
    if (!(await confirmWidening(mode, next, shownName || "this agent"))) {
      setRefused(true);
      return;
    }
    setApprovals(next);
  };

  /**
   * Make the agent, then give it what was chosen beyond its profile before
   * it has done anything: a chat's folder is pinned on its first turn, so
   * the folder goes now or not at all. A folder the server refuses is
   * said, and the agent still arrives, rather than nothing arriving.
   */
  const hire = async (profile: NewAgentProfile, from: string) => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    track("bot_created", { from });
    try {
      const { bot } = (await api("/api/bots", {
        method: "POST",
        body: JSON.stringify({ ...identity, ...profile }),
      })) as { bot: Bot };
      let made = bot;
      const extra: Record<string, unknown> = {};
      if (engine) extra.modelSelection = engine;
      if (approvals && approvals !== workspaceMode) extra.approvals = approvals;
      if (Object.keys(extra).length) {
        await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(extra) })
          .then((r: { bot?: Partial<Bot> }) => {
            if (r?.bot) made = { ...made, ...r.bot, messages: made.messages };
          })
          .catch((e: Error) => dispatch({ type: "error", message: `${bot.name} is here, but not everything was set: ${e.message}` }));
      }
      if (folder.trim()) {
        await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd: folder.trim() }) })
          .then((r: { bot?: Partial<Bot> }) => {
            if (r?.bot) made = { ...made, ...r.bot, messages: made.messages };
          })
          .catch((e: Error) => dispatch({ type: "error", message: `${bot.name} is here, but the folder was not set: ${e.message}` }));
      }
      // closes this screen and opens the first conversation
      dispatch({ type: "botAdded", bot: made });
    } catch (e) {
      setCreating(false);
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  };

  const hireDescribed = () => {
    if (!ready || creating) return;
    // the person's own words are the persona; a role or a draft adds its craft
    const craft = persona.description.trim();
    void hire(
      {
        name: shownName || "Assistant",
        title: persona.title.trim() || template?.title || (described ? suggestTitle(described) : ""),
        description: described ? (craft ? `${described}\n\n${craft}` : described) : craft,
        skills: persona.skills.map((s) => s.trim()).filter(Boolean),
        ...(persona.skillIds.length ? { skillIds: persona.skillIds } : {}),
        greeting,
        setup: template?.setup ?? GENERIC_SETUP.setup,
      },
      template?.id ?? "described",
    );
  };

  const back = () => {
    if (step === "setup") setStep("identity");
    else if (step === "identity") setStep("job");
    else if (canGoBack) close();
  };

  /** A step named in the stepper. Leaving the job goes through the same
   * door as Continue, so the second beat is always filled in from it. */
  const goTo = (to: Step) => {
    if (to === "job") return setStep("job");
    if (step === "job") {
      if (!ready) return;
      if (described) continueFromJob();
      else toIdentity();
      if (to === "setup") setStep("setup");
      return;
    }
    setStep(to);
  };

  // a new beat starts at its top, and the job field takes the keyboard
  // whenever the first beat is shown
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Escape with the focus inside is handled on the screen itself, below.
  // With it nowhere in particular, this screen is still the thing on top,
  // so it is the one that goes back, not a page underneath it.
  useEscape(() => {
    if (!root.current?.contains(document.activeElement)) back();
  });
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    if (step !== "job") return;
    const focus = () => jobRef.current?.focus();
    requestAnimationFrame(focus);
    // A menu or the palette that opened this screen hands focus back to
    // its own trigger as it closes, a moment later; take it back then.
    const timer = setTimeout(() => {
      if (!root.current?.contains(document.activeElement)) focus();
    }, 160);
    return () => clearTimeout(timer);
  }, [step]);

  const engineLabel = (() => {
    const pick = engine ?? defaults?.modelSelection ?? null;
    if (!pick) return "Workspace default";
    const inst = state.instances.find((i) => i.instanceId === pick.instanceId);
    const model = inst?.models.options.find((o) => o.id === (pick.model || inst.models.default));
    return model?.label ?? inst?.displayName ?? "Workspace default";
  })();

  return (
    <div
      ref={root}
      className="absolute inset-0 z-30 flex animate-fade-in flex-col bg-background"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented || arriving !== null || hiring) return;
        // a field's own Escape (the model list's search) has had its turn
        if ((e.target as HTMLElement).closest("[data-keep-escape]")) return;
        // taken here, so a page under this screen does not close as well
        e.preventDefault();
        back();
      }}
      // A whole-screen drop target: an agent file is the one thing you
      // would ever drag onto this screen, so anywhere on it will do.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void takeFile(e.dataTransfer.files[0]);
      }}
    >
      <BlockField />

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-primary/50 bg-background/80 backdrop-blur-sm">
          <Upload size={22} className="text-muted-foreground" />
          <div className="text-ui font-medium text-foreground">Drop the agent here</div>
        </div>
      )}

      {/* Top bar. In the desktop shell this screen covers the whole
          frameless window, so the leading control starts to the right of
          the traffic lights and the row is marked no-drag, or its buttons
          would sit in the window's drag strip and never take a click. */}
      <div
        className={cn("relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3", isElectron && "pl-24 pt-9")}
        style={isElectron ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
      >
        <div className="justify-self-start">
          {step !== "job" ? (
            <Button variant="ghost" onClick={back}>
              <ArrowLeft size={15} />
              Back
            </Button>
          ) : firstRun ? (
            // On first run there is nothing to go back to: setup is
            // finished, and Nova is already waiting.
            <Button variant="ghost" onClick={close}>
              Skip for now
            </Button>
          ) : canGoBack ? (
            <Button variant="ghost" onClick={close}>
              <ArrowLeft size={15} />
              Cancel
            </Button>
          ) : null}
        </div>
        <Stepper steps={STEPS} step={step} isOpen={(i) => i === 0 || ready} onGo={goTo} layoutId="new-agent-step" />
        <div className="flex items-center gap-1 justify-self-end">
          <Button variant="ghost" className="max-sm:hidden" onClick={() => fileRef.current?.click()} title="Import an agent from a file">
            <Upload size={14} />
            Import
          </Button>
          <Button variant="ghost" onClick={() => void hire({}, "blank")} disabled={creating}>
            Start blank
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={AGENT_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void takeFile(e.target.files?.[0]);
              // so picking the same file twice still fires
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1080px] grid-cols-1 gap-10 px-5 pb-10 pt-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-14 lg:pt-10">
          <div className="min-w-0">
            {/* on a narrow window the agent rides along above the beat,
                small, instead of in its own column */}
            {step !== "job" && (
              <div className="mb-6 flex items-center gap-3 lg:hidden">
                <AvatarLanding color={identity.color} shape={identity.shape} size={44} excited={creating} />
                <div className="min-w-0">
                  <div className="truncate text-lead font-semibold text-foreground">{shownName || "Your agent"}</div>
                  <div className="truncate text-body text-muted-foreground">{persona.title || "Ready when you are"}</div>
                </div>
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              {step === "job" && (
                <motion.div key="job" {...beat}>
                  <JobBeat
                    firstRun={firstRun}
                    text={text}
                    setText={setText}
                    jobRef={jobRef}
                    template={template}
                    onClearTemplate={() => setTemplate(null)}
                    taken={taken}
                    creating={creating}
                    onContinue={continueFromJob}
                    onPick={pickTemplate}
                    onTeam={setHiring}
                    onImport={() => fileRef.current?.click()}
                    fileError={fileError}
                  />
                </motion.div>
              )}
              {step === "identity" && (
                <motion.div key="identity" {...beat}>
                  <IdentityBeat
                    name={name}
                    shownName={shownName}
                    drafting={drafting}
                    drafted={drafted}
                    // the same rule toIdentity drafts by: words, and no role
                    // picked by hand over them
                    onAnother={described && (!template || template === matchTemplate(described)) ? () => suggest(described, true) : undefined}
                    offeredSkills={offeredSkills}
                    setName={(value) => {
                      edited.current.add("name");
                      setDrafted((prev) => new Set([...prev].filter((f) => f !== "name")));
                      setName(value);
                    }}
                    persona={persona}
                    editPersona={editPersona}
                    described={described}
                    template={template}
                    identity={identity}
                    setIdentity={chooseLook}
                    onEditJob={() => setStep("job")}
                    onHire={hireDescribed}
                  />
                </motion.div>
              )}
              {step === "setup" && (
                <motion.div key="setup" {...beat}>
                  <SetupBeat
                    shownName={shownName}
                    engine={engine}
                    setEngine={setEngine}
                    defaultEngine={defaults?.modelSelection ?? null}
                    mode={mode}
                    workspaceMode={workspaceMode}
                    onApprovals={(next) => void chooseApprovals(next)}
                    refused={refused}
                    folder={folder}
                    setFolder={setFolder}
                    defaultFolder={defaults?.cwd}
                  />
                </motion.div>
              )}
            </AnimatePresence>

          </div>

          <aside aria-label="Preview" className="hidden lg:block">
            <div className="sticky top-6">
              <PreviewCard
                identity={identity}
                name={shownName}
                title={previewTitle}
                greeting={greeting}
                skills={previewSkills}
                facts={[
                  ["Engine", engineLabel],
                  ["Asks", APPROVAL_MODES.find((m) => m.id === mode)?.label ?? "Ask first"],
                  ["Works in", folder.trim() || defaults?.cwd || "Their own workspace"],
                ]}
                creating={creating}
                empty={step === "job" && !ready}
              />
            </div>
          </aside>
        </div>
      </div>

      {/* The finish, always in reach once there is someone to hire: the
          second beat is filled in and the third has defaults, so neither
          has to be scrolled through to get here. */}
      {step !== "job" && (
        <div className="relative z-10 border-t bg-background/85 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1080px] items-center gap-2 px-5 py-3 sm:px-8">
            <span className={cn("mr-auto min-w-0 truncate text-body", createError ? "text-destructive" : "text-muted-foreground max-sm:hidden")}>
              {createError ??
                (step === "identity"
                  ? "You can change all of this later."
                  : "Their greeting will be waiting in your first chat.")}
            </span>
            {step === "identity" && (
              <Button variant="ghost" size="lg" onClick={() => setStep("setup")} disabled={creating} className="max-sm:px-3">
                <span className="sm:hidden">Setup</span>
                <span className="max-sm:hidden">How they work</span>
                <ArrowRight size={15} />
              </Button>
            )}
            <Button size="lg" onClick={hireDescribed} disabled={creating || !shownName} className="min-w-0 shrink">
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              <span className="truncate">{creating ? `Getting ${shownName} ready` : `Hire ${shownName || "them"}`}</span>
            </Button>
          </div>
        </div>
      )}

      {arriving !== null && <ImportAgentDialog text={arriving} onClose={() => setArriving(null)} />}
      {hiring && <TeamHireDialog team={hiring} onClose={() => setHiring(null)} onHired={close} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Beat one: the job

function JobBeat({
  firstRun,
  text,
  setText,
  jobRef,
  template,
  onClearTemplate,
  taken,
  creating,
  onContinue,
  onPick,
  onTeam,
  onImport,
  fileError,
}: {
  firstRun: boolean;
  text: string;
  setText: (value: string) => void;
  jobRef: React.RefObject<HTMLTextAreaElement | null>;
  template: AgentTemplate | null;
  onClearTemplate: () => void;
  taken: Set<string>;
  creating: boolean;
  onContinue: () => void;
  onPick: (template: AgentTemplate) => void;
  onTeam: (team: HireableTeam) => void;
  onImport: () => void;
  fileError: string | null;
}) {
  const [teamsOpen, setTeamsOpen] = useState(false);
  const has = text.trim().length > 0;
  const heard = has ? matchTemplate(text) : null;
  return (
    <>
      <BeatHeading
        title={firstRun ? "Who do you need first?" : "Who do you need?"}
        says={
          firstRun
            ? "Describe the job, or pick a role. You can add more any time."
            : "Describe the job, or start from a role."
        }
      />

      {/* The one field that matters: the job, in the person's words.
          Enter goes on; Shift+Enter is a new line for a longer brief. */}
      <div className="rounded-2xl border bg-card p-1.5 shadow-[0_1px_3px_var(--shadow-color)] transition-[border-color,box-shadow] duration-150 focus-within:border-ring/50 focus-within:shadow-[0_4px_18px_-6px_var(--shadow-color)]">
        <textarea
          ref={jobRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onContinue();
            }
          }}
          rows={3}
          aria-label="What should it do?"
          placeholder="e.g. Keep my inbox at zero and draft replies for me to approve"
          className="block w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-lead leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-2 pl-3">
          {/* what the words were heard as, said back while typing, so the
              role it lands on is never a surprise on the next beat */}
          <span className="flex min-w-0 items-center gap-1.5 truncate text-small text-muted-foreground">
            {template ? (
              <>
                As {asRole(template)}
                <button
                  onClick={onClearTemplate}
                  aria-label="Not this role"
                  className="rounded p-0.5 text-muted-foreground/70 transition-colors duration-150 hover:text-foreground"
                >
                  <X size={11} />
                </button>
              </>
            ) : heard ? (
              `Sounds like ${asRole(heard)}`
            ) : has ? (
              "A role of its own"
            ) : (
              "Enter to continue"
            )}
          </span>
          <Button onClick={onContinue} disabled={!has || creating} className="rounded-xl">
            Continue
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      <section className="mt-10">
        <Label aside={<span className="text-small text-muted-foreground">{AGENT_TEMPLATES.length} roles</span>}>
          Or start from a role
        </Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {AGENT_TEMPLATES.map((t, i) => {
            const have = taken.has(t.name.toLowerCase());
            const on = template?.id === t.id;
            return (
              <motion.button
                key={t.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.025, duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                disabled={creating}
                onClick={() => onPick(t)}
                className={cn(
                  "group flex min-w-0 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left outline-none transition-[border-color,background-color,scale] duration-150 ease-out hover:border-foreground/20 hover:bg-accent/40 active:scale-[0.985]",
                  on && "border-brand bg-brand-soft",
                )}
              >
                <BlokAvatar color={t.color} shape={t.shape} expression="friendly" size={34} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-ui font-medium text-foreground">{t.name}</span>
                    {have && (
                      <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-caption text-muted-foreground">You have one</span>
                    )}
                  </span>
                  <span className="block truncate text-body text-muted-foreground">{t.title}</span>
                </span>
                <ArrowRight
                  size={14}
                  className="shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,translate] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100"
                />
              </motion.button>
            );
          })}
        </div>
      </section>

      <section className="mt-10">
        <Label
          aside={
            <button
              onClick={() => setTeamsOpen((v) => !v)}
              className="text-body text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
            >
              {teamsOpen ? "Hide teams" : "Show teams"}
            </button>
          }
        >
          <span className="flex items-center gap-2">
            <Users size={15} className="text-muted-foreground" />
            Or hire a whole team
          </span>
        </Label>
        {!teamsOpen ? (
          <button
            onClick={() => setTeamsOpen(true)}
            className="flex w-full items-center gap-4 rounded-xl border border-dashed px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-accent/40"
          >
            <span className="flex shrink-0 items-center">
              {TEAM_LIBRARY.slice(0, 4).map((team, i) => (
                <span key={team.slug} className={cn("rounded-[9px] ring-2 ring-background", i > 0 && "-ml-2")}>
                  <BlokAvatar color={team.members[0].color} shape={team.members[0].shape} size={26} />
                </span>
              ))}
            </span>
            <span className="min-w-0 text-body text-muted-foreground">
              A lead and their agents, in a room of their own.
            </span>
          </button>
        ) : (
          <TeamShelf onTeam={onTeam} />
        )}
      </section>

      {/* Someone who already has an agent should not have to build it
          again. Quiet, because most people arrive without one. */}
      <div className="mt-8 flex items-center gap-1.5 text-body text-muted-foreground">
        Already have one?
        <button
          onClick={onImport}
          className="rounded-md px-1 py-0.5 font-medium text-foreground underline-offset-2 transition-colors duration-150 hover:underline"
        >
          Import a file
        </button>
        or drop it here.
      </div>
      {fileError && <div className="mt-2 text-small text-destructive">{fileError}</div>}
    </>
  );
}

/** The premade teams, and the gallery's, asked for only once the shelf is
 * opened, since most people come here for one agent. */
function TeamShelf({ onTeam }: { onTeam: (team: HireableTeam) => void }) {
  const [gallery, setGallery] = useState<GalleryTeam[] | null>(null);
  const [galleryError, setGalleryError] = useState(false);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!asked) return;
    api("/api/teams/gallery")
      .then((r) => {
        // the premade six are on the gallery too, for people without the
        // app; here they are already on the shelf above
        const premade = new Set(TEAM_LIBRARY.map((t) => t.slug));
        setGallery((r.teams ?? []).filter((t: GalleryTeam) => !premade.has(t.slug)));
      })
      .catch(() => {
        setGallery([]);
        setGalleryError(true);
      });
  }, [asked]);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TEAM_LIBRARY.map((team) => (
          <TeamTile key={team.slug} name={team.name} blurb={team.blurb} members={team.members} onHire={() => onTeam(team)} />
        ))}
        {(gallery ?? []).map((team) => (
          <TeamTile
            key={team.slug}
            name={team.name}
            blurb={team.blurb}
            byline={team.author ? `by ${team.author}` : undefined}
            members={team.members}
            onHire={() => onTeam({ name: team.name, members: team.members })}
          />
        ))}
      </div>
      <div className="mt-3 text-body text-muted-foreground">
        {!asked ? (
          <button
            onClick={() => setAsked(true)}
            className="font-medium text-foreground underline-offset-2 transition-colors duration-150 hover:underline"
          >
            More from the gallery at bloks.dev
          </button>
        ) : gallery === null ? (
          <span className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Loading the gallery
          </span>
        ) : galleryError ? (
          "Could not reach the gallery."
        ) : gallery.length === 0 ? (
          "Nothing else in the gallery yet."
        ) : null}
      </div>
    </motion.div>
  );
}

function TeamTile({
  name,
  blurb,
  byline,
  members,
  onHire,
}: {
  name: string;
  blurb: string;
  byline?: string;
  members: HireableTeam["members"];
  onHire: () => void;
}) {
  return (
    <button
      onClick={onHire}
      className="group flex min-w-0 flex-col rounded-xl border bg-card p-3 text-left outline-none transition-[border-color,background-color,scale] duration-150 ease-out hover:border-foreground/20 hover:bg-accent/40 active:scale-[0.985]"
    >
      <span className="flex items-center">
        {members.map((member, i) => (
          <span
            key={`${member.title}-${i}`}
            className={cn("relative rounded-[8px] ring-2 ring-card", i > 0 && "-ml-1.5")}
            title={member.title}
          >
            <BlokAvatar color={member.color} shape={member.shape} size={24} />
            {member.seniority === 5 && (
              <Crown size={9} className="absolute -right-1 -top-1 rounded-full bg-card text-brand-ink" />
            )}
          </span>
        ))}
        <span className="ml-auto text-small text-muted-foreground">{plural(members.length, "agent")}</span>
      </span>
      <span className="mt-2.5 text-ui font-medium text-foreground">{name}</span>
      <span className="mt-0.5 line-clamp-2 text-small leading-relaxed text-muted-foreground">
        {blurb}
        {byline ? ` ${byline}.` : ""}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Beat two: who they are

function IdentityBeat({
  name,
  shownName,
  drafting,
  drafted,
  onAnother,
  offeredSkills,
  setName,
  persona,
  editPersona,
  described,
  template,
  identity,
  setIdentity,
  onEditJob,
  onHire,
}: {
  name: string;
  shownName: string;
  /** A draft is on its way. */
  drafting: boolean;
  /** The fields showing a draft's words. */
  drafted: ReadonlySet<DraftField>;
  /** Asks for a different draft; absent when there is nothing to draft from. */
  onAnother?: () => void;
  /** Library skills a draft picked, by id, whether kept on or not. */
  offeredSkills: string[];
  setName: (value: string) => void;
  persona: Persona;
  editPersona: (patch: Partial<Persona>) => void;
  described: string;
  template: AgentTemplate | null;
  identity: { color: BlokColor; shape: BlokShape };
  setIdentity: (identity: { color: BlokColor; shape: BlokShape }) => void;
  onEditJob: () => void;
  onHire: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [newSkill, setNewSkill] = useState("");
  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.select());
  }, []);

  // The library's names for the skills a draft picked, asked for only
  // when there are some to show.
  const [library, setLibrary] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!offeredSkills.length || library) return;
    api("/api/skills")
      .then((r: { skills?: Array<{ id: string; name: string }> }) =>
        setLibrary(Object.fromEntries((r.skills ?? []).map((s) => [s.id, s.name]))),
      )
      .catch(() => setLibrary({}));
  }, [offeredSkills.length, library]);
  const offered = offeredSkills.filter((id) => library?.[id]);
  const toggleLibrary = (id: string) =>
    editPersona({
      skillIds: persona.skillIds.includes(id) ? persona.skillIds.filter((s) => s !== id) : [...persona.skillIds, id],
    });
  const personaDrafted = drafted.has("description") || drafted.has("skills");

  const addSkill = () => {
    const value = newSkill.trim();
    if (!value) return;
    editPersona({ skills: [...persona.skills, value] });
    setNewSkill("");
  };

  return (
    <>
      <BeatHeading
        title={shownName ? `Meet ${shownName}` : "Who are they?"}
        says={
          template
            ? `Set up as ${asRole(template)}, with ${plural(persona.skills.length, "skill")}. Make them yours.`
            : "Change anything you like."
        }
      />

      <div className="flex flex-col gap-3">
        <div className="relative">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onHire()}
            placeholder="Name your agent"
            aria-label="Name"
            spellCheck={false}
            className={cn(
              "h-12 w-full rounded-xl border bg-card px-4 text-title font-semibold tracking-tight text-foreground outline-none transition-[border-color] duration-150 placeholder:font-normal placeholder:text-muted-foreground focus:border-ring/60",
              (drafting || onAnother) && "pr-44",
            )}
          />
          {/* Where a draft says itself: on its way, then that the name is
              its suggestion, with another to be had. Quiet, because the
              person can hire without ever looking here. */}
          {(drafting || onAnother) && (
            <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-small text-muted-foreground">
              {drafting ? (
                <span className="flex items-center gap-1.5 px-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  Thinking
                </span>
              ) : (
                <>
                  {drafted.has("name") && (
                    <span className="flex items-center gap-1 px-1">
                      <Sparkles size={11} />
                      Suggested
                    </span>
                  )}
                  <button
                    onClick={onAnother}
                    title="Suggest another"
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground active:scale-[0.96]"
                  >
                    <RefreshCw size={11} />
                    Another
                  </button>
                </>
              )}
            </span>
          )}
        </div>
        <Input
          value={persona.title}
          onChange={(e) => editPersona({ title: e.target.value })}
          placeholder="What they do, in a line"
          aria-label="Title"
          className="h-10 rounded-xl bg-card px-4 text-ui"
        />
      </div>

      <section className="mt-9">
        <Label
          aside={
            <button
              onClick={() => setIdentity(randomIdentity())}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-body text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]"
            >
              <RefreshCw size={12} />
              Surprise me
            </button>
          }
        >
          A face
        </Label>
        <div className="rounded-2xl border bg-card p-4">
          <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2.5">
            {BLOK_COLOR_NAMES.map((color) => (
              <button
                key={color}
                role="radio"
                aria-checked={identity.color === color}
                aria-label={color}
                title={color}
                onClick={() => setIdentity({ ...identity, color })}
                className={cn(
                  "size-8 rounded-full outline-none transition-[scale,box-shadow] duration-150 ease-out hover:scale-110 active:scale-95",
                  identity.color === color && "shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--foreground)]",
                )}
                style={{ backgroundColor: BLOK_COLORS[color] }}
              />
            ))}
          </div>
          <div role="radiogroup" aria-label="Shape" className="mt-4 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {BLOK_SHAPES.map((shape) => (
              <button
                key={shape}
                role="radio"
                aria-checked={identity.shape === shape}
                aria-label={`${shape} shape`}
                title={shape}
                onClick={() => setIdentity({ ...identity, shape })}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-xl outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-accent active:scale-[0.94]",
                  identity.shape === shape && "bg-accent shadow-[inset_0_0_0_1.5px_var(--foreground)]",
                )}
              >
                <BlokAvatar color={identity.color} shape={shape} expression="friendly" size={34} />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-9">
        <Label
          aside={
            <span className="text-small text-muted-foreground">
              {personaDrafted ? "Suggested, " : ""}
              {plural(persona.skills.length, "skill")}
            </span>
          }
        >
          What {shownName || "they"} know{shownName ? "s" : ""}
        </Label>
        <div className="rounded-2xl border bg-card p-4">
          {/* The person's own words lead, as written: they become the top
              of the agent's instructions, with the craft below them. */}
          {described && (
            <div className="mb-3 flex items-start gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
              <span className="min-w-0 flex-1 text-pretty text-body leading-relaxed text-foreground">“{described}”</span>
              <button
                onClick={onEditJob}
                className="shrink-0 text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
              >
                Edit
              </button>
            </div>
          )}
          <textarea
            value={persona.description}
            onChange={(e) => editPersona({ description: e.target.value })}
            placeholder={described ? "Anything else about how they work (optional)" : "What they care about and how they work"}
            aria-label="How they work"
            rows={4}
            className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-body leading-relaxed text-foreground outline-none transition-[border-color] duration-150 placeholder:text-muted-foreground focus:border-ring/60"
          />
          <div className="mt-3 flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {persona.skills.map((skill, i) => (
                <motion.div
                  key={`${i}-${skill.slice(0, 10)}`}
                  layout="position"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                  className="group flex items-start gap-2"
                >
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand" />
                  <input
                    value={skill}
                    onChange={(e) => {
                      const skills = [...persona.skills];
                      skills[i] = e.target.value;
                      editPersona({ skills });
                    }}
                    aria-label={`Skill ${i + 1}`}
                    className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-body leading-relaxed text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent/50 focus:bg-accent/60 focus:text-foreground"
                  />
                  <button
                    onClick={() => editPersona({ skills: persona.skills.filter((_, j) => j !== i) })}
                    className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-[opacity,color] duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    title="Remove skill"
                    aria-label="Remove skill"
                  >
                    <X size={12} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
            <div className="flex items-center gap-2">
              <span className="flex size-1.5 shrink-0" />
              <input
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSkill()}
                placeholder="Add a skill: when to use it, and what to return"
                aria-label="New skill"
                className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-body text-foreground outline-none placeholder:text-muted-foreground/70 hover:bg-accent/50 focus:bg-accent/60"
              />
              <button
                onClick={addSkill}
                disabled={!newSkill.trim()}
                aria-label="Add skill"
                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
          {/* Skills already in the library that fit the job, which a draft
              picked: on unless switched off, and the agent gets the whole
              skill, not a line about it. */}
          {offered.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
              <span className="mr-1 text-small text-muted-foreground">From your library</span>
              {offered.map((id) => {
                const on = persona.skillIds.includes(id);
                return (
                  <button
                    key={id}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleLibrary(id)}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2.5 py-1 text-small outline-none transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.96]",
                      on
                        ? "border-brand bg-brand-soft text-foreground"
                        : "text-muted-foreground hover:border-foreground/25 hover:text-foreground focus-visible:border-foreground/25",
                    )}
                  >
                    {on ? <Check size={11} /> : <Plus size={11} />}
                    {library?.[id]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Beat three: how they work

function SetupBeat({
  shownName,
  engine,
  setEngine,
  defaultEngine,
  mode,
  workspaceMode,
  onApprovals,
  refused,
  folder,
  setFolder,
  defaultFolder,
}: {
  shownName: string;
  engine: ModelSelection | null;
  setEngine: (selection: ModelSelection | null) => void;
  defaultEngine: ModelSelection | null;
  mode: ApprovalMode;
  workspaceMode: ApprovalMode;
  onApprovals: (mode: ApprovalMode) => void;
  refused: boolean;
  folder: string;
  setFolder: (value: string) => void;
  defaultFolder?: string;
}) {
  const { state } = useStore();
  const usable = state.instances.filter((i) => i.snapshot.state === "available");
  const label = (instanceId: string, model: string) => {
    const inst = state.instances.find((i) => i.instanceId === instanceId);
    return inst?.models.options.find((o) => o.id === (model || inst.models.default))?.label ?? (model || inst?.models.default || "");
  };

  return (
    <>
      <BeatHeading
        title={shownName ? `How ${shownName} works` : "How they work"}
        says="Defaults are set. Change anything, now or later."
      />

      <section>
        <Label>The engine</Label>
        <p className="-mt-1.5 mb-3 text-pretty text-body leading-relaxed text-muted-foreground">
          Bigger models think better and cost more. Smaller ones are faster.
        </p>
        <div role="radiogroup" aria-label="Engine" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <EngineOption
            on={!engine}
            onPick={() => setEngine(null)}
            mark={
              <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Sparkles size={14} />
              </span>
            }
            title="Workspace default"
            line={defaultEngine ? label(defaultEngine.instanceId, defaultEngine.model) : "What Bloks gives every new agent"}
          />
          {usable.map((inst) => (
            <EngineOption
              key={inst.instanceId}
              on={engine?.instanceId === inst.instanceId}
              onPick={() => setEngine({ instanceId: inst.instanceId, model: inst.models.default })}
              mark={
                <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-foreground">
                  <ProviderMark driverKind={inst.driverKind} size={15} />
                </span>
              }
              title={inst.displayName}
              line={engine?.instanceId === inst.instanceId ? label(inst.instanceId, engine.model) : label(inst.instanceId, inst.models.default)}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-body text-muted-foreground" data-keep-escape>
          Or pick a model:
          <div className="rounded-lg border bg-card">
            <ModelPicker value={engine} onPick={setEngine} noneLabel="Workspace default" />
          </div>
        </div>
      </section>

      <section className="mt-9">
        <Label
          aside={
            approvalsNote(mode, workspaceMode) && (
              <span className="text-small text-muted-foreground">{approvalsNote(mode, workspaceMode)}</span>
            )
          }
        >
          How much they ask
        </Label>
        <ApprovalsChooser value={mode} onChange={onApprovals} compact />
        {refused && <div className="mt-2 text-small text-warning">Not confirmed. Nothing changed.</div>}
      </section>

      <section className="mt-9">
        <Label>
          <span className="flex items-center gap-2">
            <FolderOpen size={15} className="text-muted-foreground" />
            Where they work
          </span>
        </Label>
        <p className="-mt-1.5 mb-3 text-pretty text-body leading-relaxed text-muted-foreground">
          Pick a project folder, or leave it empty for their own workspace.
        </p>
        <div className="flex gap-2">
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={defaultFolder || "Their own workspace"}
            spellCheck={false}
            aria-label="Working folder"
            className="h-9 rounded-xl bg-card font-mono text-body"
          />
          <BrowseFolderButton onPick={setFolder} className="h-9 rounded-xl" />
        </div>
      </section>
    </>
  );
}

function approvalsNote(mode: ApprovalMode, workspaceMode: ApprovalMode): string | null {
  if (mode === workspaceMode) return "Workspace default";
  return "This agent only";
}

function EngineOption({
  on,
  onPick,
  mark,
  title,
  line,
}: {
  on: boolean;
  onPick: () => void;
  mark: React.ReactNode;
  title: string;
  line: string;
}) {
  return (
    <button
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.99]",
        on ? "border-brand bg-brand-soft" : "bg-card hover:border-foreground/25",
      )}
    >
      {mark}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-foreground">{title}</span>
        <span className="block truncate text-small text-muted-foreground">{line}</span>
      </span>
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
          on ? "border-brand bg-brand text-background" : "border-foreground/25",
        )}
      >
        {on && <Check size={10} strokeWidth={3} />}
      </span>
    </button>
  );
}

