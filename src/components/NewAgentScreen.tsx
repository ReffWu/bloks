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
import { BLOK_COLORS, BLOK_COLOR_NAMES, BLOK_SHAPES, type BlokColor, type BlokShape } from "@/lib/mascot";
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
}

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

/** Quick, and over before the eye has finished moving: a beat changing is
 * a page turning, not a show. Reduce motion keeps only the fade. */
const beat = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.23, 1, 0.32, 1] as const } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12, ease: "easeOut" as const } },
};

export function NewAgentScreen() {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState<Step>("job");
  const [text, setText] = useState("");
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState<Persona>({ title: "", description: "", skills: [] });
  // fields the person has typed into, which a late model draft leaves alone
  const edited = useRef(new Set<string>());
  const seededFor = useRef<string | null>(null);
  const [identity, setIdentity] = useState(randomIdentity);
  const [naming, setNaming] = useState(false);
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
  const shownName =
    step === "job"
      ? template?.name || (described ? suggestName(described) : "")
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
    step === "job" ? (role?.title ?? (described ? suggestTitle(described) : "")) : persona.title;
  const previewSkills = step === "job" ? (role?.skills ?? []) : persona.skills;

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
      setPersona({
        title: picked?.title ?? (described ? suggestTitle(described) : ""),
        description: picked?.description ?? "",
        skills: picked?.skills ?? [],
      });
      setName(picked?.name ?? (described ? suggestName(described) : ""));
      // A role chosen by hand says what was wanted; one matched from the
      // words was only a guess, so a model's draft may still improve it.
      if (described && (!picked || picked === matchTemplate(described))) suggest(described);
    }
    setStep("identity");
  };

  /** Upgrade the local guess with a model-written one if a provider is up;
   * the flow never waits on it, and nothing typed is overwritten. */
  const suggest = (description: string) => {
    setNaming(true);
    api("/api/agents/suggest", { method: "POST", body: JSON.stringify({ description }) })
      .then((s) => {
        if (seededFor.current?.split("|").slice(1).join("|") !== description) return;
        if (s?.name && !edited.current.has("name")) setName(s.name);
        // A drafted persona is the agent's craft, the same job a role's
        // description does. It wins over a matched role, because it was
        // written for this description rather than matched to it.
        setPersona((p) => ({
          title: s?.title && !edited.current.has("title") ? s.title : p.title,
          description: s?.description && !edited.current.has("description") ? s.description : p.description,
          skills: s?.skills?.length && !edited.current.has("skills") ? s.skills : p.skills,
        }));
      })
      .catch(() => {})
      .finally(() => setNaming(false));
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
          <div className="text-[14px] font-medium text-foreground">Drop the agent here</div>
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
        <Stepper step={step} ready={ready} onGo={goTo} />
        <div className="flex items-center gap-1 justify-self-end">
          <Button variant="ghost" className="max-sm:hidden" onClick={() => fileRef.current?.click()} title="Bring in an agent from a file">
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
                  <div className="truncate text-[15px] font-semibold text-foreground">{shownName || "Your agent"}</div>
                  <div className="truncate text-[12.5px] text-muted-foreground">{persona.title || "Ready when you are"}</div>
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
                    naming={naming}
                    setName={(value) => {
                      edited.current.add("name");
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
                engine={engineLabel}
                approvals={APPROVAL_MODES.find((m) => m.id === mode)?.label ?? "Ask first"}
                folder={folder.trim() || defaults?.cwd || ""}
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
            <span className={cn("mr-auto min-w-0 truncate text-[12.5px]", createError ? "text-destructive" : "text-muted-foreground max-sm:hidden")}>
              {createError ??
                (step === "identity"
                  ? "Everything here can change later, in their settings."
                  : "Their greeting will be waiting in your first conversation.")}
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

/** Where you are in the three beats; the ones already open are a click away. */
function Stepper({ step, ready, onGo }: { step: Step; ready: boolean; onGo: (step: Step) => void }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <nav aria-label="Steps" className="flex items-center gap-1 rounded-full border bg-card/80 p-1 backdrop-blur-sm">
      {STEPS.map((s, i) => {
        const on = s.id === step;
        const open = i === 0 || ready;
        return (
          <button
            key={s.id}
            onClick={() => open && onGo(s.id)}
            disabled={!open}
            aria-current={on ? "step" : undefined}
            className={cn(
              "relative flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium outline-none transition-colors duration-150 disabled:opacity-45",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {on && (
              <motion.span
                layoutId="new-agent-step"
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                className="absolute inset-0 z-0 rounded-full bg-accent"
              />
            )}
            <span
              className={cn(
                "relative z-[1] flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums transition-colors duration-150",
                i < at ? "bg-brand-ink text-brand-foreground" : on ? "bg-foreground text-background" : "border border-current",
              )}
            >
              {i < at ? <Check size={9} strokeWidth={3} /> : i + 1}
            </span>
            <span className="relative z-[1] max-sm:hidden">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** A face that lands when it changes: a small settle, never a cut. */
function AvatarLanding({
  color,
  shape,
  size,
  excited,
}: {
  color: BlokColor;
  shape: BlokShape;
  size: number;
  excited?: boolean;
}) {
  return (
    <motion.span
      key={`${color}-${shape}`}
      initial={{ scale: 0.86, opacity: 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", duration: 0.42, bounce: 0.4 }}
      className="block shrink-0"
    >
      <BlokAvatar color={color} shape={shape} expression={excited ? "excited" : "friendly"} size={size} />
    </motion.span>
  );
}

function BeatHeading({ title, says }: { title: string; says: string }) {
  return (
    <header className="mb-7">
      <h1 className="text-balance text-[28px] font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1.5 text-pretty text-[14px] text-muted-foreground">{says}</p>
    </header>
  );
}

function Label({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold text-foreground">{children}</h2>
      {aside}
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
            : "Describe the job in your own words, or start from a role. They come with the skills to do it."
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
          className="block w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-2 pl-3">
          {/* what the words were heard as, said back while typing, so the
              role it lands on is never a surprise on the next beat */}
          <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-muted-foreground">
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
        <Label aside={<span className="text-[12px] text-muted-foreground">{AGENT_TEMPLATES.length} roles</span>}>
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
                    <span className="truncate text-[13.5px] font-medium text-foreground">{t.name}</span>
                    {have && (
                      <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground">You have one</span>
                    )}
                  </span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">{t.title}</span>
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
              className="text-[12.5px] text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
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
            <span className="min-w-0 text-[13px] text-muted-foreground">
              A job that needs several people: a lead and the agents under them, in a room of their own.
            </span>
          </button>
        ) : (
          <TeamShelf onTeam={onTeam} />
        )}
      </section>

      {/* Someone who already has an agent should not have to build it
          again. Quiet, because most people arrive without one. */}
      <div className="mt-8 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        Already have one?
        <button
          onClick={onImport}
          className="rounded-md px-1 py-0.5 font-medium text-foreground underline-offset-2 transition-colors duration-150 hover:underline"
        >
          Bring it in from a file
        </button>
        or drop it anywhere here.
      </div>
      {fileError && <div className="mt-2 text-[12px] text-destructive">{fileError}</div>}
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
      <div className="mt-3 text-[12.5px] text-muted-foreground">
        {!asked ? (
          <button
            onClick={() => setAsked(true)}
            className="font-medium text-foreground underline-offset-2 transition-colors duration-150 hover:underline"
          >
            More from the gallery at bloks.dev
          </button>
        ) : gallery === null ? (
          <span className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Asking the gallery
          </span>
        ) : galleryError ? (
          "The gallery could not be reached right now."
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
        <span className="ml-auto text-[11.5px] text-muted-foreground">{plural(members.length, "agent")}</span>
      </span>
      <span className="mt-2.5 text-[13.5px] font-medium text-foreground">{name}</span>
      <span className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
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
  naming,
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
  naming: boolean;
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
            : "We picked a name from your description. Change anything you like."
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
            className="h-12 w-full rounded-xl border bg-card px-4 text-[18px] font-semibold tracking-tight text-foreground outline-none transition-[border-color] duration-150 placeholder:font-normal placeholder:text-muted-foreground focus:border-ring/60"
          />
          {naming && (
            <span className="absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              Thinking of a name
            </span>
          )}
        </div>
        <Input
          value={persona.title}
          onChange={(e) => editPersona({ title: e.target.value })}
          placeholder="What they do, in a line"
          aria-label="Title"
          className="h-10 rounded-xl bg-card px-4 text-[14px]"
        />
      </div>

      <section className="mt-9">
        <Label
          aside={
            <button
              onClick={() => setIdentity(randomIdentity())}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]"
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
        <Label aside={<span className="text-[12px] text-muted-foreground">{plural(persona.skills.length, "skill")}</span>}>
          What {shownName || "they"} know{shownName ? "s" : ""}
        </Label>
        <div className="rounded-2xl border bg-card p-4">
          {/* The person's own words lead, as written: they become the top
              of the agent's instructions, with the craft below them. */}
          {described && (
            <div className="mb-3 flex items-start gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
              <span className="min-w-0 flex-1 text-pretty text-[13px] leading-relaxed text-foreground">“{described}”</span>
              <button
                onClick={onEditJob}
                className="shrink-0 text-[12px] text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
              >
                Edit
              </button>
            </div>
          )}
          <textarea
            value={persona.description}
            onChange={(e) => editPersona({ description: e.target.value })}
            placeholder={described ? "How they work, beyond your words above (optional)" : "How they work: what they care about and how they go about it"}
            aria-label="How they work"
            rows={4}
            className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none transition-[border-color] duration-150 placeholder:text-muted-foreground focus:border-ring/60"
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
                    className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[12.5px] leading-relaxed text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent/50 focus:bg-accent/60 focus:text-foreground"
                  />
                  <button
                    onClick={() => editPersona({ skills: persona.skills.filter((_, j) => j !== i) })}
                    className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-[opacity,color] duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    title="Drop this skill"
                    aria-label="Drop this skill"
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
                className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70 hover:bg-accent/50 focus:bg-accent/60"
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
  const who = shownName || "they";

  return (
    <>
      <BeatHeading
        title={shownName ? `How ${shownName} works` : "How they work"}
        says="Sensible defaults are already set. Change what matters to you; all of it can change later."
      />

      <section>
        <Label>The engine</Label>
        <p className="-mt-1.5 mb-3 text-pretty text-[13px] leading-relaxed text-muted-foreground">
          The model that does the thinking for {who === "they" ? "them" : who}. Larger models reason better and cost more;
          smaller ones are quicker. Switching later takes one click.
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
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground" data-keep-escape>
          A particular model:
          <div className="rounded-lg border bg-card">
            <ModelPicker value={engine} onPick={setEngine} noneLabel="Workspace default" />
          </div>
        </div>
      </section>

      <section className="mt-9">
        <Label
          aside={
            approvalsNote(mode, workspaceMode) && (
              <span className="text-[12px] text-muted-foreground">{approvalsNote(mode, workspaceMode)}</span>
            )
          }
        >
          How much they ask
        </Label>
        <ApprovalsChooser value={mode} onChange={onApprovals} compact />
        {refused && <div className="mt-2 text-[12px] text-warning">Not confirmed, so the mode is unchanged.</div>}
      </section>

      <section className="mt-9">
        <Label>
          <span className="flex items-center gap-2">
            <FolderOpen size={15} className="text-muted-foreground" />
            Where they work
          </span>
        </Label>
        <p className="-mt-1.5 mb-3 text-pretty text-[13px] leading-relaxed text-muted-foreground">
          Point them at a project to work in that folder. Left empty, they get a workspace of their own.
        </p>
        <div className="flex gap-2">
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={defaultFolder || "Their own workspace"}
            spellCheck={false}
            aria-label="Working folder"
            className="h-9 rounded-xl bg-card font-mono text-[12.5px]"
          />
          <BrowseFolderButton onPick={setFolder} className="h-9 rounded-xl" />
        </div>
      </section>
    </>
  );
}

function approvalsNote(mode: ApprovalMode, workspaceMode: ApprovalMode): string | null {
  if (mode === workspaceMode) return "Your workspace's setting";
  return "Just for this agent";
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
        <span className="block truncate text-[13px] font-medium text-foreground">{title}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{line}</span>
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

// ---------------------------------------------------------------------------

/**
 * The agent as it will be, before it is: the face, the name and line, the
 * first thing it will say, and the few facts that decide how it works.
 * Everything chosen on the left lands here as it is chosen.
 */
function PreviewCard({
  identity,
  name,
  title,
  greeting,
  skills,
  engine,
  approvals,
  folder,
  creating,
  empty,
}: {
  identity: { color: BlokColor; shape: BlokShape };
  name: string;
  title: string;
  greeting: string;
  skills: string[];
  engine: string;
  approvals: string;
  folder: string;
  creating: boolean;
  empty: boolean;
}) {
  const shownSkills = skills.filter((s) => s.trim());
  return (
    <div className="overflow-hidden rounded-3xl border bg-card shadow-[0_12px_40px_-16px_var(--shadow-color)]">
      {/* the agent's own colour, faint, behind its face */}
      <div
        className="relative flex flex-col items-center px-6 pb-5 pt-8 transition-[background-color] duration-300"
        style={{ backgroundColor: `color-mix(in srgb, ${BLOK_COLORS[identity.color]} 13%, transparent)` }}
      >
        <motion.div
          animate={creating ? { y: [0, -6, 0] } : { y: 0 }}
          transition={creating ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        >
          <AvatarLanding color={identity.color} shape={identity.shape} size={88} excited={creating} />
        </motion.div>
        <div className="mt-4 w-full text-center">
          <div className={cn("truncate text-[18px] font-semibold tracking-tight", name ? "text-foreground" : "text-muted-foreground")}>
            {name || "Your agent"}
          </div>
          <div className="mt-0.5 line-clamp-2 min-h-[20px] text-[13px] text-muted-foreground">
            {empty ? "Describe a job and they take shape here." : title || " "}
          </div>
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        {/* the first thing they will say, as it will look in the chat */}
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">First words</div>
        <div className="mt-2 flex items-end gap-2">
          <BlokAvatar color={identity.color} shape={identity.shape} expression="friendly" size={22} />
          <div className="min-w-0 rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
            <span className={cn(empty && "text-muted-foreground")}>{greeting}</span>
          </div>
        </div>

        {shownSkills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {shownSkills.slice(0, 3).map((skill, i) => (
              <span key={i} className="max-w-full truncate rounded-full border px-2.5 py-0.5 text-[11.5px] text-muted-foreground">
                {skill.split(":")[0].slice(0, 32)}
              </span>
            ))}
            {shownSkills.length > 3 && (
              <span className="rounded-full border px-2.5 py-0.5 text-[11.5px] text-muted-foreground">+{shownSkills.length - 3}</span>
            )}
          </div>
        )}

        <dl className="mt-4 flex flex-col divide-y rounded-xl border text-[12px]">
          {[
            ["Engine", engine],
            ["Asks", approvals],
            ["Works in", folder || "Their own workspace"],
          ].map(([term, value]) => (
            <div key={term} className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="shrink-0 text-muted-foreground">{term}</dt>
              <dd className="min-w-0 truncate text-right font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
