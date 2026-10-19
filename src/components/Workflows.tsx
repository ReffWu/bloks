// Workflows: what happens, in order, and where you get a say.
//
// The hard part to show is not the list of steps. It is that a run can be
// sitting still, waiting for a person, and that this is a normal state
// rather than a stuck one. So a run in progress is drawn as its steps
// with one of them highlighted, and a run parked on an approval says who
// it is waiting for and until when, in words rather than a spinner.
//
// The editor is a form rather than a canvas. A canvas is the obvious way
// to draw a workflow and the wrong way to write one: dragging boxes is
// slower than typing for anything under a dozen steps, and a dozen steps
// is the cap. What it borrows from a canvas is the picture: the chain sits
// on the left the whole time, trigger first, and the step being written
// is the one lit up in it.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { ChevronRight } from "@/components/icons";
import { ChevronUp } from "@/components/icons";
import { CircleDot } from "@/components/icons";
import { CornerDownRight } from "@/components/icons";
import { Hand } from "@/components/icons";
import { Hourglass } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import { Play } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Search } from "@/components/icons";
import { SmilePlus } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { Users } from "@/components/icons";
import { Webhook } from "@/components/icons";
import { Workflow as WorkflowIcon } from "@/components/icons";
import { X } from "@/components/icons";
import { useStore, type Bot } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Slider, type SliderStop } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/plural";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

export type StepAction = "ask" | "post" | "approve";
export type ConditionOp =
  | "contains"
  | "not-contains"
  | "equals"
  | "starts-with"
  | "ends-with"
  | "empty"
  | "not-empty";

export interface Step {
  id: string;
  action: StepAction;
  targetId?: string;
  text: string;
  when?: { left: string; op: ConditionOp; right?: string };
  timeoutMin?: number;
  onTimeout?: "stop" | "continue";
}

export interface RunStep {
  stepId: string;
  startedAt: number;
  endedAt?: number;
  state: "running" | "ok" | "skipped" | "waiting" | "failed" | "timed-out";
  summary?: string;
  error?: string;
}

export interface Run {
  id: string;
  startedAt: number;
  endedAt?: number;
  state: "running" | "waiting" | "done" | "failed" | "stopped";
  steps: RunStep[];
  waiting?: { stepId: string; until: number; onTimeout: "stop" | "continue" };
  error?: string;
  /** Why a running run is waiting on an engine pause. */
  held?: string;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: {
    kind: "manual" | "message" | "reaction" | "webhook";
    targetId?: string;
    targetKind?: "agent" | "room";
    contains?: string;
    emoji?: string;
    from?: "user" | "anyone";
  };
  steps: Step[];
  enabled: boolean;
  lastRunAt?: number;
  runs?: Run[];
  summary?: string;
}

type Room = { id: string; name: string; memberIds?: string[] };

/** Said as the middle of a sentence: "Only if Nova's answer mentions urgent". */
const OPS: Array<[ConditionOp, string]> = [
  ["contains", "mentions"],
  ["not-contains", "does not mention"],
  ["equals", "is exactly"],
  ["starts-with", "starts with"],
  ["ends-with", "ends with"],
  ["not-empty", "says anything"],
  ["empty", "says nothing"],
];
const opWord = (op: ConditionOp) => OPS.find(([o]) => o === op)?.[1] ?? op;
const needsRight = (op: ConditionOp) => op !== "empty" && op !== "not-empty";

/**
 * What a step will be called, so an earlier answer can be referenced
 * before the workflow has ever been saved.
 *
 * The same rule as slug() in server/workflows.ts, which stays the
 * authority: whatever is sent gets normalised there. This produces a
 * string that rule leaves alone, so the two agree. If they ever drifted,
 * the save would be refused with the reference named rather than
 * silently leaving a gap in a prompt, which is the failure worth having.
 */
function stepId(text: string, taken: string[]): string {
  const base =
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "step";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) {
    if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${taken.length + 1}`;
}

function when(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return today ? time : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/** "3 hours from now", for a deadline somebody has to act inside. */
function until(at: number): string {
  const minutes = Math.round((at - Date.now()) / 60_000);
  if (minutes <= 0) return "any moment";
  if (minutes < 90) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} from now`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} ${hours === 1 ? "hour" : "hours"} from now`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} from now`;
}

// ── earlier answers, by name ───────────────────────────────────────────
//
// The saved format is a template: {{steps.triage.text}}. That is the
// right thing to store and the wrong thing to show, because nobody thinks
// of an answer by the slug of the words that asked for it. They think of
// it by who gave it. So every reference is drawn under a name built from
// the step it points at, and the template stays underneath, untouched.

/** The same pattern the server fills, so a pill is exactly a reference. */
const REFERENCE = /\{\{\s*([\w.-]+)\s*\}\}/g;

interface Reference {
  /** The template text, as saved. */
  token: string;
  label: string;
}

function possessive(name: string): string {
  return `${name}'s`;
}

/** What each trigger hands its steps as text, in its own terms. */
function triggerTextLabel(kind: Workflow["trigger"]["kind"]): string {
  if (kind === "message") return "The message";
  if (kind === "reaction") return "The reacted message";
  if (kind === "webhook") return "What the webhook sent";
  return "What you typed";
}

/**
 * Names for every reference a workflow can make, and the ones on offer at
 * each step: only what has run by then, which is the same line the server
 * draws when it refuses a forward reference.
 */
function referencesFor(draft: Workflow, bots: Bot[]) {
  const asks = new Map<string, number>();
  for (const s of draft.steps) if (s.action === "ask" && s.targetId) asks.set(s.targetId, (asks.get(s.targetId) ?? 0) + 1);
  const approvals = draft.steps.filter((s) => s.action === "approve").length;

  const stepName = (step: Step, index: number): string => {
    if (step.action === "ask") {
      const who = bots.find((b) => b.id === step.targetId)?.name;
      if (!who) return `Step ${index + 1}'s answer`;
      // two steps asking the same agent need telling apart
      return (asks.get(step.targetId!) ?? 0) > 1 ? `${possessive(who)} answer (step ${index + 1})` : `${possessive(who)} answer`;
    }
    if (step.action === "post") return `Step ${index + 1}'s post`;
    return approvals > 1 ? `Your answer (step ${index + 1})` : "Your answer";
  };

  const label = (path: string): { label: string; known: boolean } => {
    const parts = path.split(".");
    if (parts[0] === "trigger" && parts.length === 2) {
      if (parts[1] === "text") return { label: triggerTextLabel(draft.trigger.kind), known: true };
      if (parts[1] === "emoji") return { label: "The emoji", known: true };
      if (parts[1] === "from") return { label: "Who set it off", known: true };
      return { label: `Trigger ${parts[1]}`, known: true };
    }
    if (parts[0] === "steps" && parts.length === 3) {
      const index = draft.steps.findIndex((s) => s.id === parts[1]);
      if (index < 0) return { label: `Missing step "${parts[1]}"`, known: false };
      const step = draft.steps[index];
      if (step.action === "approve") {
        if (parts[2] === "approved") return { label: approvals > 1 ? `Whether you approved (step ${index + 1})` : "Whether you approved", known: true };
        return { label: stepName(step, index), known: true };
      }
      return { label: stepName(step, index), known: true };
    }
    return { label: path, known: false };
  };

  /** The answers a step at this index can use, newest first. The first
   * of each step is the one worth a button; the rest are for conditions. */
  const offered = (index: number, all = false): Reference[] => {
    const out: Reference[] = [];
    draft.steps.slice(0, index).forEach((s, i) => {
      if (!s.id) return;
      if (s.action === "approve") {
        out.push({ token: `{{steps.${s.id}.answer}}`, label: stepName(s, i) });
        if (all) out.push({ token: `{{steps.${s.id}.approved}}`, label: label(`steps.${s.id}.approved`).label });
      } else {
        out.push({ token: `{{steps.${s.id}.text}}`, label: stepName(s, i) });
      }
    });
    out.reverse();
    if (draft.trigger.kind !== "manual") out.push({ token: "{{trigger.text}}", label: triggerTextLabel(draft.trigger.kind) });
    if (all && draft.trigger.kind === "reaction") out.push({ token: "{{trigger.emoji}}", label: "The emoji" });
    return out;
  };

  return { label, offered };
}

type LabelFor = (path: string) => { label: string; known: boolean };

/** A template as words, every reference replaced by its name. */
function readable(text: string, labelFor: LabelFor): string {
  return String(text ?? "").replace(REFERENCE, (_whole, path: string) => labelFor(path).label);
}

// ── saying a workflow in words ─────────────────────────────────────────

function placeName(id: string | undefined, bots: Bot[], rooms: Room[]): string | null {
  if (!id) return null;
  return bots.find((b) => b.id === id)?.name ?? rooms.find((r) => r.id === id)?.name ?? null;
}

function triggerSentence(trigger: Workflow["trigger"], bots: Bot[], rooms: Room[]): string {
  if (trigger.kind === "manual") return "You run it";
  if (trigger.kind === "webhook") return "Its webhook is called";
  const place = placeName(trigger.targetId, bots, rooms);
  const room = trigger.targetKind === "room";
  if (trigger.kind === "reaction") {
    const what = trigger.emoji ? `A ${trigger.emoji} reaction` : "A reaction";
    return place ? `${what} in ${room ? place : `${possessive(place)} chat`}` : what;
  }
  if (!place) return "A message";
  const where = room ? `in ${place}` : `to ${place}`;
  return trigger.contains ? `A message ${where} mentions “${trigger.contains}”` : `Any message ${where}`;
}

function stepTitle(step: Step, bots: Bot[], rooms: Room[]): string {
  if (step.action === "ask") {
    const who = bots.find((b) => b.id === step.targetId)?.name;
    return who ? `Ask ${who}` : "Ask an agent";
  }
  if (step.action === "post") {
    const room = rooms.find((r) => r.id === step.targetId)?.name;
    return room ? `Post in ${room}` : "Post in a room";
  }
  return "Ask you";
}

/** The same line the server writes for the list, said while editing. */
function describeDraft(draft: Workflow, bots: Bot[], rooms: Room[]): string {
  const count = draft.steps.length;
  const gates = draft.steps.filter((s) => s.action === "approve").length;
  const body = plural(count, "step");
  const opener = triggerSentence(draft.trigger, bots, rooms);
  return gates ? `${opener}, then ${body}. ${gates === 1 ? "One waits for you." : `${gates} wait for you.`}` : `${opener}, then ${body}.`;
}

// ── what is missing, before the server says so ─────────────────────────
//
// The server's problems() stays the authority and its answer is what a
// failed save shows. This is the same list said earlier, against the
// chain, so a step that needs an agent is marked as one before anybody
// presses Save. One addition the server does not make: a condition with
// nothing to look for, which saves fine and then skips its step forever.

/** One thing to fix, and which part of the pane it belongs to. */
interface Problem {
  field: "where" | "emoji" | "target" | "text" | "condition";
  say: string;
}

function findProblems(draft: Workflow): { trigger: Problem | null; steps: Array<Problem | null> } {
  const t = draft.trigger;
  const trigger: Problem | null =
    (t.kind === "message" || t.kind === "reaction") && !t.targetId
      ? { field: "where", say: "Pick where to watch." }
      : t.kind === "reaction" && !t.emoji
        ? { field: "emoji", say: "Pick an emoji." }
        : null;
  const seen: string[] = [];
  const steps = draft.steps.map((step, index): Problem | null => {
    let found: Problem | null = null;
    if (step.action === "ask" && !step.targetId) found = { field: "target", say: "Pick an agent to ask." };
    else if (step.action === "post" && !step.targetId) found = { field: "target", say: "Pick a room to post in." };
    else if (!step.text.trim()) {
      found = {
        field: "text",
        say: step.action === "approve" ? "Say what you are approving." : step.action === "post" ? "Say what to post." : "Say what to ask.",
      };
    } else if (step.action === "approve" && !step.targetId && !draft.steps.slice(0, index).some((s) => s.targetId) && !t.targetId) {
      found = { field: "target", say: "Pick where to ask you." };
    } else if (step.when && needsRight(step.when.op) && !String(step.when.right ?? "").trim()) {
      found = { field: "condition", say: "Finish the condition, or remove it." };
    } else {
      const refs = [step.text, step.when?.left ?? "", step.when?.right ?? ""].flatMap((text) => [...text.matchAll(REFERENCE)].map((m) => m[1]));
      for (const ref of refs) {
        const parts = ref.split(".");
        if (parts[0] === "trigger") continue;
        if (parts[0] !== "steps" || parts.length !== 3 || !seen.includes(parts[1])) {
          found = { field: "text", say: "Uses an answer that is not ready by then." };
          break;
        }
      }
    }
    if (step.id) seen.push(step.id);
    return found;
  });
  return { trigger, steps };
}

/** A quiet note beside a section's title, amber once it matters. */
function Needs({ problem, field, loud }: { problem: Problem | null | undefined; field: Problem["field"]; loud: boolean }) {
  if (!problem || problem.field !== field) return null;
  return <span className={cn("text-small", loud ? "text-warning" : "text-muted-foreground")}>{problem.say}</span>;
}

export function Workflows() {
  const { state } = useStore();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [editing, setEditing] = useState<Workflow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api("/api/workflows")
      .then((r) => setWorkflows(r.workflows ?? []))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    // the same cadence the job board uses: a run advances on its own, so
    // the list has to change without anybody pressing anything
    const timer = setInterval(load, 4_000);
    return () => clearInterval(timer);
  }, [load]);

  // Existing steps still resolve a name from everyone, so a workflow
  // pointing at an archived agent stays readable. The picker offers only
  // the ones that can act: a step aimed at a retired agent is a workflow
  // that fails at the moment it fires.
  const bots = state.bots ?? [];
  const choosable = bots.filter((b) => !b.archivedAt);
  const rooms: Room[] = state.bloks ?? [];

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-3 px-1 py-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
        <p className="max-w-[560px] text-body leading-relaxed text-muted-foreground">
          Work in steps. Each step passes its result on, and any step can wait for your OK.
        </p>
        <Button size="sm" className="shrink-0" onClick={() => setEditing("new")}>
          <Plus size={14} /> New workflow
        </Button>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 px-3 py-2 text-body text-destructive">{error}</div>
      )}

      {workflows?.length === 0 && (
        <div className="px-4 py-10 text-center">
          <div className="text-ui text-foreground">No workflows yet.</div>
        </div>
      )}

      {workflows?.map((workflow) => (
        <WorkflowCard
          key={workflow.id}
          workflow={workflow}
          bots={bots}
          rooms={rooms}
          onChanged={load}
          onEdit={() => setEditing(workflow)}
          onError={setError}
        />
      ))}

      {editing && (
        <Editor
          workflow={editing === "new" ? null : editing}
          bots={bots}
          choosable={choosable}
          rooms={rooms}
          onClose={() => {
            setEditing(null);
            load();
          }}
          onChanged={load}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function WorkflowCard({
  workflow,
  bots,
  rooms,
  onChanged,
  onEdit,
  onError,
}: {
  workflow: Workflow;
  bots: Bot[];
  rooms: Room[];
  onChanged: () => void;
  onEdit: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const runs = workflow.runs ?? [];
  const latest = runs[0];
  const waiting = runs.find((run) => run.state === "waiting");
  const labelFor = referencesFor(workflow, bots).label;

  const run = () => {
    setBusy(true);
    api(`/api/workflows/${workflow.id}/run`, { method: "POST", body: JSON.stringify({}) })
      .then(onChanged)
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className={cn("rounded-2xl border bg-card", waiting && "border-warning/50")}>
      <div className="flex items-start gap-3 p-4">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? `Hide steps in ${workflow.name}` : `Show steps in ${workflow.name}`}
          title={open ? "Hide steps" : "Show steps"}
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-ui font-semibold text-foreground">{workflow.name}</span>
            {!workflow.enabled && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">off</span>
            )}
          </div>
          <div className="mt-0.5 text-body text-muted-foreground">{workflow.summary}</div>
          {/* The state worth putting on the outside of the card: a run
              that is sitting still because it is waiting for you looks
              exactly like a run that is stuck, unless it says so. */}
          {waiting?.waiting && (
            <div className="mt-2 flex items-center gap-1.5 text-body text-warning">
              <Hourglass size={13} />
              Waiting for you. It {waiting.waiting.onTimeout === "continue" ? "carries on" : "stops"}{" "}
              {until(waiting.waiting.until)}.
            </div>
          )}
          {!waiting && latest && (
            <div className="mt-1 text-small text-muted-foreground">
              Last run {when(latest.startedAt)} · {stateWord(latest)}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Switch
            aria-label={`${workflow.name}: on or off`}
            checked={workflow.enabled}
            onCheckedChange={(enabled) =>
              api(`/api/workflows/${workflow.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) })
                .then(onChanged)
                .catch((e: Error) => onError(e.message))
            }
          />
          <Button variant="ghost" size="icon-sm" title="Run now" disabled={busy} onClick={run}>
            <Play size={14} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t px-4 py-3">
          <div className="flex flex-col gap-1.5">
            {workflow.steps.map((step, i) => (
              <div key={step.id} className="flex items-start gap-2.5 text-body">
                <span className="mt-[3px] flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-caption text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">{stepTitle(step, bots, rooms)}:</span>
                  <span className="ml-1.5 text-muted-foreground">{readable(step.text, labelFor)}</span>
                  {step.when && (
                    <span className="mt-0.5 block text-small text-muted-foreground">
                      Only if {readable(step.when.left, labelFor)} {opWord(step.when.op)}
                      {needsRight(step.when.op) && step.when.right ? ` “${readable(step.when.right, labelFor)}”` : ""}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!confirm(`Delete "${workflow.name}"?`)) return;
                api(`/api/workflows/${workflow.id}`, { method: "DELETE" })
                  .then(onChanged)
                  .catch((e: Error) => onError(e.message));
              }}
            >
              <Trash2 size={13} /> Delete
            </Button>
          </div>

          {runs.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="text-small font-medium text-muted-foreground">
                Runs
              </div>
              <div className="mt-1.5 flex flex-col gap-2">
                {runs.slice(0, 6).map((entry) => (
                  <RunRow
                    key={entry.id}
                    run={entry}
                    steps={workflow.steps}
                    nameOf={(id) => {
                      const step = workflow.steps.find((s) => s.id === id);
                      return step ? stepTitle(step, bots, rooms) : id;
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function stateWord(run: Run): string {
  switch (run.state) {
    case "running":
      return run.held ?? "running";
    case "waiting":
      return "waiting for you";
    case "done":
      return "finished";
    case "stopped":
      return run.error ?? "stopped";
    default:
      return run.error ?? "failed";
  }
}

function RunRow({ run, steps, nameOf: named }: { run: Run; steps: Step[]; nameOf?: (stepId: string) => string }) {
  const nameOf = named ?? ((stepId: string) => steps.find((s) => s.id === stepId)?.text ?? stepId);
  return (
    <div className="rounded-xl bg-muted/40 px-2.5 py-2">
      <div className="flex items-center justify-between text-small">
        <span className="text-muted-foreground">{when(run.startedAt)}</span>
        <span
          className={cn(
            run.state === "done" && "text-success",
            run.state === "waiting" && "text-warning",
            (run.state === "failed" || run.state === "stopped") && "text-destructive",
            run.state === "running" && "text-muted-foreground",
          )}
        >
          {stateWord(run)}
        </span>
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        {run.steps.map((entry, i) => (
          <div key={`${entry.stepId}-${i}`} className="flex items-start gap-1.5 text-small">
            <span className="mt-[2px] shrink-0">
              {entry.state === "ok" ? (
                <Check size={11} className="text-success" />
              ) : entry.state === "waiting" ? (
                <Hourglass size={11} className="text-warning" />
              ) : entry.state === "skipped" ? (
                <ChevronRight size={11} className="text-muted-foreground/60" />
              ) : entry.state === "running" ? (
                <CircleDot size={11} className="text-muted-foreground" />
              ) : (
                <X size={11} className="text-destructive" />
              )}
            </span>
            <span className="min-w-0 flex-1 text-muted-foreground">
              <span className={cn(entry.state === "skipped" && "line-through opacity-60")}>
                {nameOf(entry.stepId)}
              </span>
              {entry.summary && <span className="ml-1 opacity-70">· {entry.summary.slice(0, 90)}</span>}
              {entry.error && <span className="ml-1 text-destructive">· {entry.error}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── the editor ─────────────────────────────────────────────────────────

const EMPTY: Workflow = {
  id: "",
  name: "",
  trigger: { kind: "manual", from: "user" },
  steps: [{ id: "", action: "ask", text: "", targetId: "" }],
  enabled: true,
};

/** The part of a workflow that is the person's to change, for telling
 * whether anything has been. */
const shapeOf = (w: Workflow) => JSON.stringify({ name: w.name, trigger: w.trigger, steps: w.steps });

/** A step's identity in this editor, steady across reordering, which its
 * id is not until it has words. Random rather than counted, so no two
 * editors (or one editor across a reload of this file) can hand out the
 * same one. */
const freshKey = () => Math.random().toString(36).slice(2, 10);

/** A pane appearing: quick, and over before the eye has finished moving.
 * MotionConfig below drops the travel for reduced motion; the fade stays. */
const pane = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] as const } },
  exit: { opacity: 0, transition: { duration: 0.08, ease: "easeOut" as const } },
};

function Editor({
  workflow,
  bots,
  choosable,
  rooms,
  onClose,
  onChanged,
  onSaved,
}: {
  workflow: Workflow | null;
  /** Everyone, for names. */
  bots: Bot[];
  /** The ones a step may be aimed at. */
  choosable: Bot[];
  rooms: Room[];
  onClose: () => void;
  onChanged: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Workflow>(workflow ?? EMPTY);
  const [keys, setKeys] = useState<string[]>(() => (workflow ?? EMPTY).steps.map(freshKey));
  const [selected, setSelected] = useState<string>("trigger");
  const [problems, setProblems] = useState<string[]>([]);
  // Missing pieces are said quietly while a workflow is being written,
  // and in amber once somebody has tried to save or run it.
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const baseline = useRef(shapeOf(workflow ?? EMPTY));
  const dirty = shapeOf(draft) !== baseline.current;

  const refs = useMemo(() => referencesFor(draft, bots), [draft, bots]);
  const missing = useMemo(() => findProblems(draft), [draft]);

  // A try: the run started from here, followed until it settles.
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [asking, setAsking] = useState(false);
  const [sample, setSample] = useState("");

  const patchStep = (index: number, change: Partial<Step>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => {
        if (i !== index) return s;
        const next = { ...s, ...change };
        // A step gets its name the moment it has words, not when the
        // workflow is first saved. Without that, a workflow being written
        // for the first time has nothing for a later step to refer to,
        // which is most of the point of having steps at all. Named once
        // and then left alone, so editing the words later does not break
        // a reference somebody already wrote. Named from the words as
        // they read, so a step that is only "Writer's answer" is called
        // that rather than after the braces underneath it.
        if (!next.id && next.text.trim()) {
          next.id = stepId(readable(next.text, refs.label), d.steps.filter((_, j) => j !== index).map((other) => other.id));
        }
        return next;
      }),
    }));

  const addStep = () => {
    if (draft.steps.length >= 12) return;
    const key = freshKey();
    setDraft((d) => ({ ...d, steps: [...d.steps, { id: "", action: "ask", text: "", targetId: "" }] }));
    setKeys((k) => [...k, key]);
    setSelected(key);
  };

  const removeStep = (index: number) => {
    const next = keys[index + 1] ?? keys[index - 1] ?? "trigger";
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, i) => i !== index) }));
    setKeys((k) => k.filter((_, i) => i !== index));
    setSelected(next);
  };

  const moveStep = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= draft.steps.length) return;
    const swap = <T,>(list: T[]) => {
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    };
    setDraft((d) => ({ ...d, steps: swap(d.steps) }));
    setKeys(swap);
  };

  /** Write the draft down, and carry on from what the server kept: it
   * names steps and trims words, and the next save starts from that. */
  const persist = async (): Promise<Workflow> => {
    // the space a pill leaves for the caret is for typing, not keeping
    const steps = draft.steps.map((s) => ({ ...s, text: s.text.replace(/[ \t]+$/, "") }));
    const body = JSON.stringify({ ...draft, steps, id: undefined });
    const saved = draft.id
      ? await api(`/api/workflows/${draft.id}`, { method: "PATCH", body })
      : await api("/api/workflows", { method: "POST", body });
    const kept = saved.workflow as Workflow;
    baseline.current = shapeOf(kept);
    setDraft(kept);
    onChanged();
    return kept;
  };

  const save = () => {
    // nothing changed since the last save, so there is nothing to send
    if (draft.id && !dirty) return onSaved();
    if (!ready()) return;
    setBusy(true);
    setProblems([]);
    persist()
      .then(onSaved)
      .catch((e: Error) => setProblems([e.message]))
      .finally(() => setBusy(false));
  };

  /** Whether a try needs words to stand in for what would set it off. */
  const readsTrigger = draft.steps.some((s) =>
    [s.text, s.when?.left ?? "", s.when?.right ?? ""].some((text) => /\{\{\s*trigger\./.test(text)),
  );

  const startTry = (text: string) => {
    setBusy(true);
    setProblems([]);
    setAsking(false);
    // a try runs what is on screen, so what is on screen is saved first
    (dirty || !draft.id ? persist() : Promise.resolve(draft))
      .then((saved) =>
        api(`/api/workflows/${saved.id}/run`, { method: "POST", body: JSON.stringify(text ? { text } : {}) }),
      )
      .then((r: { run: Run }) => {
        setRunId(r.run.id);
        setRun(r.run);
        onChanged();
      })
      .catch((e: Error) => setProblems([e.message]))
      .finally(() => setBusy(false));
  };

  // Followed closely while it moves, so each step lights as it happens
  // rather than on the list's slower beat. A run waiting on you is still
  // followed: the answer may come from the chat as easily as from here.
  const settled = run && (run.state === "done" || run.state === "failed" || run.state === "stopped");
  useEffect(() => {
    if (!runId || settled || !draft.id) return;
    const id = draft.id;
    const timer = setInterval(() => {
      api("/api/workflows")
        .then((r) => {
          const found = (r.workflows as Workflow[]).find((w) => w.id === id)?.runs?.find((x) => x.id === runId);
          if (found) setRun(found);
        })
        .catch(() => {});
    }, 1_000);
    return () => clearInterval(timer);
  }, [runId, settled, draft.id]);

  const answer = (reply: "Approve" | "Decline") => {
    if (!run) return;
    api(`/api/workflows/runs/${run.id}/answer`, { method: "POST", body: JSON.stringify({ answer: reply }) })
      .then(() => setRun({ ...run, state: reply === "Approve" ? "running" : "stopped" }))
      .catch((e: Error) => setProblems([e.message]));
  };

  const close = () => {
    if (dirty && !confirm("Close without saving your changes?")) return;
    onClose();
  };

  const index = keys.indexOf(selected);
  const step = index >= 0 ? draft.steps[index] : null;
  const firstAt = missing.steps.findIndex(Boolean);
  const firstProblem = missing.trigger
    ? `What sets it off: ${missing.trigger.say}`
    : firstAt >= 0
      ? `Step ${firstAt + 1}: ${missing.steps[firstAt]!.say}`
      : null;

  /** Before sending anything, go to the first thing missing, if there
   * is one. The server would refuse it too, but from here the person is
   * taken to it rather than told about it. */
  const ready = () => {
    setAttempted(true);
    if (missing.trigger) setSelected("trigger");
    else if (firstAt >= 0) setSelected(keys[firstAt]);
    return !firstProblem;
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          // a new workflow starts at its name; an old one starts nowhere,
          // so a stray key does not rename it
          if (draft.id) e.preventDefault();
        }}
        className="flex h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(880px,94vh)] sm:w-[calc(100vw-32px)] sm:max-w-[1080px] sm:rounded-2xl sm:border"
      >
        <MotionConfig reducedMotion="user">
          <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
              <WorkflowIcon size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="sr-only">{draft.id ? "Edit workflow" : "New workflow"}</DialogTitle>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Name this workflow"
                aria-label="Name"
                spellCheck={false}
                maxLength={80}
                className="w-full bg-transparent text-title font-semibold tracking-tight text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
              />
              <DialogDescription className="mt-0 truncate text-small leading-normal">
                {describeDraft(draft, bots, rooms)}
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={close}>
              <X size={17} />
            </Button>
          </header>

          {/* Side by side, each column scrolls on its own; stacked on a
              phone, the whole sheet scrolls and the footer stays put. */}
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[320px_minmax(0,1fr)] md:overflow-hidden">
            <aside aria-label="The flow" className="border-b bg-sidebar/50 md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r">
              <div className="px-4 py-4 md:px-5 md:py-5">
                <Chain
                  draft={draft}
                  keys={keys}
                  selected={selected}
                  onSelect={setSelected}
                  onAdd={addStep}
                  bots={bots}
                  rooms={rooms}
                  labelFor={refs.label}
                  missing={missing}
                  loud={attempted}
                  run={run}
                />
                <AnimatePresence initial={false}>
                  {run && (
                    <motion.div key="try" {...pane} className="mt-5">
                      <TryPanel
                        run={run}
                        steps={draft.steps}
                        nameOf={(id) => {
                          const s = draft.steps.find((x) => x.id === id);
                          return s ? stepTitle(s, bots, rooms) : id;
                        }}
                        onAnswer={answer}
                        onDismiss={() => {
                          setRun(null);
                          setRunId(null);
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </aside>

            <section aria-label="Edit" className="md:min-h-0 md:overflow-y-auto">
              <div className="mx-auto w-full max-w-[640px] px-4 py-5 sm:px-7 sm:py-7">
                <AnimatePresence mode="wait" initial={false}>
                  {selected === "trigger" || !step ? (
                    <motion.div key="trigger" {...pane}>
                      <TriggerPane
                        trigger={draft.trigger}
                        onChange={(trigger) => setDraft({ ...draft, trigger })}
                        bots={choosable}
                        rooms={rooms}
                        allBots={bots}
                        problem={missing.trigger}
                        loud={attempted}
                      />
                    </motion.div>
                  ) : (
                    <motion.div key={selected} {...pane}>
                      <StepPane
                        step={step}
                        index={index}
                        count={draft.steps.length}
                        bots={choosable}
                        allBots={bots}
                        rooms={rooms}
                        offered={refs.offered(index)}
                        conditions={refs.offered(index, true)}
                        labelFor={refs.label}
                        fallbackAsk={whereItAsks(draft, index, bots, rooms)}
                        problem={missing.steps[index]}
                        loud={attempted}
                        onChange={(change) => patchStep(index, change)}
                        onMove={(by) => moveStep(index, by)}
                        onRemove={() => removeStep(index)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>
          </div>

          <AnimatePresence initial={false}>
            {asking && (
              <motion.form
                key="sample"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                onSubmit={(e) => {
                  e.preventDefault();
                  startTry(sample.trim());
                }}
                className="flex flex-wrap items-center gap-2 border-t bg-sidebar/50 px-4 py-2.5 sm:px-6"
              >
                <label htmlFor="try-sample" className="text-body text-muted-foreground">
                  Try it with
                </label>
                <Input
                  id="try-sample"
                  autoFocus
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  placeholder={draft.trigger.kind === "webhook" ? "What the webhook might send" : "A message to test with"}
                  className="h-8 min-w-[180px] flex-1 bg-background text-body"
                />
                <Button type="submit" size="sm" disabled={busy}>
                  <Play size={12} /> Run it
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </motion.form>
            )}
          </AnimatePresence>

          <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3 sm:px-6">
            <span
              className={cn(
                "mr-auto min-w-0 text-body",
                problems.length ? "text-destructive" : attempted && firstProblem ? "text-warning" : "text-muted-foreground max-sm:hidden",
              )}
            >
              {problems[0] ?? ((attempted && firstProblem) || "Try it runs the workflow for real.")}
            </span>
            <div className="flex gap-2 max-sm:w-full">
              <Button
                variant="secondary"
                disabled={busy || (run !== null && !settled)}
                onClick={() => ready() && (readsTrigger ? setAsking((v) => !v) : startTry(""))}
                className="max-sm:flex-1"
                title="Saves, then runs it for real"
              >
                <Play size={13} /> Try it
              </Button>
              <Button disabled={busy} onClick={save} className="min-w-[96px] max-sm:flex-1">
                {draft.id ? (dirty ? "Save" : "Done") : "Create"}
              </Button>
            </div>
          </footer>
        </MotionConfig>
      </DialogContent>
    </Dialog>
  );
}

/** Where an approval with no place of its own will ask, said as a name:
 * the same walk back as whereToAsk() on the server. */
function whereItAsks(draft: Workflow, index: number, bots: Bot[], rooms: Room[]): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const earlier = draft.steps[i];
    if (earlier.targetId) return placeName(earlier.targetId, bots, rooms);
  }
  return placeName(draft.trigger.targetId, bots, rooms);
}

// ── the chain ──────────────────────────────────────────────────────────

/** The last thing a run said about one step. */
function runStateOf(run: Run | null, stepId: string): RunStep["state"] | null {
  if (!run || !stepId) return null;
  for (let i = run.steps.length - 1; i >= 0; i--) if (run.steps[i].stepId === stepId) return run.steps[i].state;
  return null;
}

/**
 * The flow as a picture: what sets it off, then each step, joined by a
 * line. On a phone the same nodes run across in a strip, so the step
 * being written is never a scroll away from the chain it sits in.
 *
 * During a try the line fills in behind the run as it goes, which is the
 * whole of the "it is working" signal: no spinner, just the next node
 * lighting up.
 */
function Chain({
  draft,
  keys,
  selected,
  onSelect,
  onAdd,
  bots,
  rooms,
  labelFor,
  missing,
  loud,
  run,
}: {
  draft: Workflow;
  keys: string[];
  selected: string;
  onSelect: (key: string) => void;
  onAdd: () => void;
  bots: Bot[];
  rooms: Room[];
  labelFor: LabelFor;
  missing: ReturnType<typeof findProblems>;
  loud: boolean;
  run: Run | null;
}) {
  const full = draft.steps.length >= 12;
  const states = draft.steps.map((s) => runStateOf(run, s.id));
  // a step's line is lit once the one before it has finished
  const reached = (i: number) => (i === 0 ? Boolean(run) : states[i - 1] === "ok" || states[i - 1] === "skipped");

  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>("[aria-current='step']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  return (
    <>
      {/* wide: a column */}
      <ol aria-label="Steps" className="hidden md:block">
        <li>
          <div className="mb-2 text-small font-medium text-muted-foreground">When</div>
          <TriggerNode
            trigger={draft.trigger}
            sentence={triggerSentence(draft.trigger, bots, rooms)}
            on={selected === "trigger"}
            onSelect={() => onSelect("trigger")}
            problem={missing.trigger?.say ?? null}
            loud={loud}
            lit={Boolean(run)}
          />
        </li>
        <AnimatePresence initial={false}>
          {draft.steps.map((step, i) => (
            <motion.li
              key={keys[i]}
              layout="position"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
            >
              <Link lit={reached(i)} />
              <StepNode
                step={step}
                index={i}
                title={stepTitle(step, bots, rooms)}
                snippet={readable(step.text, labelFor)}
                condition={
                  step.when
                    ? `Only if ${readable(step.when.left, labelFor) || "…"} ${opWord(step.when.op)}${
                        needsRight(step.when.op) ? ` ${step.when.right?.trim() ? `“${readable(step.when.right, labelFor)}”` : "…"}` : ""
                      }`
                    : null
                }
                bots={bots}
                on={selected === keys[i]}
                onSelect={() => onSelect(keys[i])}
                problem={missing.steps[i]?.say ?? null}
                loud={loud}
                state={states[i]}
              />
            </motion.li>
          ))}
        </AnimatePresence>
        <li>
          <Link lit={false} dashed />
          <button
            onClick={onAdd}
            disabled={full}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed px-2.5 py-2 text-left text-body text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent/50 hover:text-foreground active:scale-[0.985] disabled:opacity-50"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
              <Plus size={14} />
            </span>
            {full ? "That is the most steps one holds" : "Add a step"}
          </button>
        </li>
      </ol>

      {/* narrow: a strip */}
      <div ref={strip} aria-label="Steps" role="list" className="-mx-4 flex items-center overflow-x-auto px-4 py-1.5 [scrollbar-width:none] md:hidden">
        <StripNode on={selected === "trigger"} onSelect={() => onSelect("trigger")} warn={loud && Boolean(missing.trigger)} label="When">
          <TriggerGlyph kind={draft.trigger.kind} size={24} />
        </StripNode>
        {draft.steps.map((step, i) => (
          <div key={keys[i]} role="listitem" className="flex items-center">
            <span aria-hidden className={cn("h-px w-4 shrink-0 transition-colors duration-200", reached(i) ? "bg-brand" : "bg-border")} />
            <StripNode on={selected === keys[i]} onSelect={() => onSelect(keys[i])} warn={loud && Boolean(missing.steps[i])} label={`${i + 1}`} state={states[i]}>
              <StepGlyph step={step} bots={bots} size={24} />
            </StripNode>
          </div>
        ))}
        <span aria-hidden className="h-px w-4 shrink-0 border-t border-dashed" />
        <button
          onClick={onAdd}
          disabled={full}
          aria-label="Add a step"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed text-muted-foreground outline-none transition-[background-color,scale] duration-150 active:scale-95 disabled:opacity-50"
        >
          <Plus size={15} />
        </button>
      </div>
    </>
  );
}

/** The line between two nodes, filling from the top when a run passes. */
function Link({ lit, dashed }: { lit: boolean; dashed?: boolean }) {
  return (
    <div aria-hidden className={cn("relative ml-[26px] h-4 w-px overflow-hidden", dashed ? "border-l border-dashed" : "bg-border")}>
      {!dashed && (
        <motion.span
          className="absolute inset-0 origin-top bg-brand"
          initial={false}
          animate={{ scaleY: lit ? 1 : 0 }}
          transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
        />
      )}
    </div>
  );
}

const NODE =
  "group relative flex w-full items-start gap-3 rounded-xl border px-2.5 py-2 text-left outline-none transition-[border-color,background-color,opacity,scale] duration-150 ease-out active:scale-[0.99]";
const nodeTone = (on: boolean) => (on ? "border-foreground/15 bg-card shadow-[0_1px_3px_var(--shadow-color)]" : "border-transparent hover:bg-accent/60");

function TriggerGlyph({ kind, size = 32 }: { kind: Workflow["trigger"]["kind"]; size?: number }) {
  const Icon = kind === "message" ? MessageSquare : kind === "reaction" ? SmilePlus : kind === "webhook" ? Webhook : Play;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.45)} />
    </span>
  );
}

function StepGlyph({ step, bots, size = 32 }: { step: Step; bots: Bot[]; size?: number }) {
  if (step.action === "ask") {
    const bot = bots.find((b) => b.id === step.targetId);
    if (bot) return <AgentAvatar bot={bot} size={size} />;
    return <span className="shrink-0 rounded-lg border-2 border-dashed border-border" style={{ width: size, height: size }} />;
  }
  const Icon = step.action === "post" ? Users : Hand;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        step.action === "approve" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
      )}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.45)} />
    </span>
  );
}

function TriggerNode({
  trigger,
  sentence,
  on,
  onSelect,
  problem,
  loud,
  lit,
}: {
  trigger: Workflow["trigger"];
  sentence: string;
  on: boolean;
  onSelect: () => void;
  problem: string | null;
  loud: boolean;
  lit: boolean;
}) {
  return (
    <button onClick={onSelect} aria-current={on ? "step" : undefined} className={cn(NODE, nodeTone(on))}>
      <TriggerGlyph kind={trigger.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-foreground">{sentence}</span>
        <span className={cn("block truncate text-small", problem && loud ? "text-warning" : "text-muted-foreground")}>
          {problem ?? (trigger.kind === "manual" ? "From the list, or Try it" : trigger.from === "anyone" ? "Agents count too" : "Only you set it off")}
        </span>
      </span>
      {lit && <NodeMark state="ok" />}
    </button>
  );
}

function StepNode({
  step,
  index,
  title,
  snippet,
  condition,
  bots,
  on,
  onSelect,
  problem,
  loud,
  state,
}: {
  step: Step;
  index: number;
  title: string;
  snippet: string;
  condition: string | null;
  bots: Bot[];
  on: boolean;
  onSelect: () => void;
  problem: string | null;
  loud: boolean;
  state: RunStep["state"] | null;
}) {
  return (
    <button
      onClick={onSelect}
      aria-current={on ? "step" : undefined}
      aria-label={`Step ${index + 1}: ${title}`}
      className={cn(NODE, nodeTone(on), state === "skipped" && "opacity-55")}
    >
      <StepGlyph step={step} bots={bots} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-foreground">{title}</span>
        <span className={cn("line-clamp-2 text-small leading-snug", problem && loud ? "text-warning" : "text-muted-foreground")}>
          {problem ?? snippet}
        </span>
        {condition && (
          <span className="mt-1 flex items-start gap-1 text-caption text-muted-foreground">
            <CornerDownRight size={11} className="mt-[2px] shrink-0" />
            <span className="line-clamp-1">{condition}</span>
          </span>
        )}
      </span>
      {state ? (
        <NodeMark state={state} />
      ) : (
        <span className="mt-0.5 shrink-0 text-caption tabular-nums text-muted-foreground/70">{index + 1}</span>
      )}
    </button>
  );
}

function StripNode({
  on,
  onSelect,
  warn,
  label,
  state,
  children,
}: {
  on: boolean;
  onSelect: () => void;
  warn: boolean;
  label: string;
  state?: RunStep["state"] | null;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onSelect}
      aria-current={on ? "step" : undefined}
      aria-label={label === "When" ? "What sets it off" : `Step ${label}`}
      className={cn(
        "relative flex shrink-0 items-center gap-1.5 rounded-xl border px-2 py-1.5 outline-none transition-[border-color,background-color,scale] duration-150 active:scale-95",
        on ? "border-foreground/15 bg-card shadow-[0_1px_3px_var(--shadow-color)]" : "border-transparent",
        state === "skipped" && "opacity-55",
      )}
    >
      {children}
      <span className={cn("text-small font-medium", on ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      {(warn || state) && (
        <span className="absolute -right-1 -top-1">{state ? <NodeMark state={state} small /> : <span className="block size-2 rounded-full bg-warning ring-2 ring-background" />}</span>
      )}
    </button>
  );
}

/** How a step went in the try, as a small mark at the end of its node. */
function NodeMark({ state, small }: { state: RunStep["state"]; small?: boolean }) {
  const reduce = useReducedMotion();
  const box = small ? "size-3.5" : "size-5";
  const icon = small ? 8 : 11;
  if (state === "running") {
    return (
      <span className={cn("flex shrink-0 items-center justify-center", box)} aria-label="Running">
        <motion.span
          className="size-2 rounded-full bg-brand"
          animate={reduce ? { opacity: 1 } : { opacity: [0.35, 1, 0.35] }}
          transition={reduce ? undefined : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
    );
  }
  const look =
    state === "ok"
      ? { cls: "bg-success/15 text-success", el: <Check size={icon} strokeWidth={3} />, say: "Done" }
      : state === "waiting"
        ? { cls: "bg-warning/15 text-warning", el: <Hourglass size={icon} />, say: "Waiting for you" }
        : state === "skipped"
          ? { cls: "bg-muted text-muted-foreground", el: <ChevronRight size={icon} />, say: "Skipped" }
          : { cls: "bg-destructive/10 text-destructive", el: <X size={icon} strokeWidth={3} />, say: state === "timed-out" ? "Timed out" : "Failed" };
  return (
    <motion.span
      key={state}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", duration: 0.28, bounce: 0.35 }}
      aria-label={look.say}
      title={look.say}
      className={cn("flex shrink-0 items-center justify-center rounded-full", box, look.cls)}
    >
      {look.el}
    </motion.span>
  );
}

/** The run started from Try it, with the gate answerable right here. */
function TryPanel({
  run,
  steps,
  nameOf,
  onAnswer,
  onDismiss,
}: {
  run: Run;
  steps: Step[];
  nameOf: (stepId: string) => string;
  onAnswer: (reply: "Approve" | "Decline") => void;
  onDismiss: () => void;
}) {
  const done = run.state === "done" || run.state === "failed" || run.state === "stopped";
  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-small font-medium text-foreground">This try</span>
        {/* Hiding a run that is still going stops following it here, not
            the run: it carries on, and shows in the list like any other. */}
        <button onClick={onDismiss} className="text-small text-muted-foreground transition-colors duration-150 hover:text-foreground">
          {done ? "Clear" : "Hide"}
        </button>
      </div>
      {run.state === "waiting" && (
        <div className="mb-2.5 rounded-xl bg-warning/10 px-3 py-2.5">
          <div className="text-body text-foreground">Waiting for your answer.</div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => onAnswer("Approve")}>
              <Check size={12} /> Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onAnswer("Decline")}>
              Decline
            </Button>
          </div>
        </div>
      )}
      <RunRow run={run} steps={steps} nameOf={nameOf} />
    </div>
  );
}

// ── the panes ──────────────────────────────────────────────────────────

function PaneHeading({ eyebrow, title, aside }: { eyebrow: string; title: string; aside?: React.ReactNode }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-small font-medium text-muted-foreground">{eyebrow}</div>
        <h2 className="mt-0.5 text-heading font-semibold text-foreground">{title}</h2>
      </div>
      {aside}
    </header>
  );
}

function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mt-8", className)}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const TRIGGER_KINDS: Array<{ kind: Workflow["trigger"]["kind"]; label: string; line: string }> = [
  { kind: "manual", label: "You run it", line: "Whenever you like" },
  { kind: "message", label: "A message", line: "When something is said" },
  { kind: "reaction", label: "A reaction", line: "When someone reacts" },
  { kind: "webhook", label: "A webhook", line: "When another app calls" },
];

const EMOJI = ["👍", "✅", "🚀", "👀", "❤️", "🔥"];

function TriggerPane({
  trigger,
  onChange,
  bots,
  allBots,
  rooms,
  problem,
  loud,
}: {
  trigger: Workflow["trigger"];
  onChange: (trigger: Workflow["trigger"]) => void;
  bots: Bot[];
  allBots: Bot[];
  rooms: Room[];
  problem: Problem | null;
  loud: boolean;
}) {
  const watches = trigger.kind === "message" || trigger.kind === "reaction";
  return (
    <>
      <PaneHeading eyebrow="When" title="What sets it off" />

      <div role="radiogroup" aria-label="What sets it off" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TRIGGER_KINDS.map((option) => (
          <PickCard
            key={option.kind}
            on={trigger.kind === option.kind}
            onPick={() => onChange({ ...trigger, kind: option.kind })}
            face={<TriggerGlyph kind={option.kind} />}
            title={option.label}
            line={option.line}
          />
        ))}
      </div>

      {watches && (
        <>
          <Section title="Where to watch" aside={<Needs problem={problem} field="where" loud={loud} />} className="mt-8">
            <PlacePicker
              value={trigger.targetId}
              agents={bots}
              allBots={allBots}
              rooms={rooms}
              onPick={(id, kind) => onChange({ ...trigger, targetId: id, targetKind: kind })}
            />
          </Section>

          {trigger.kind === "message" ? (
            <Section title="Only if it mentions" aside={<span className="text-small text-muted-foreground">Optional</span>}>
              <Input
                value={trigger.contains ?? ""}
                placeholder="invoice"
                onChange={(e) => onChange({ ...trigger, contains: e.target.value })}
                className="h-10 rounded-xl bg-card"
              />
              <p className="mt-1.5 text-small text-muted-foreground">Leave empty for any message.</p>
            </Section>
          ) : (
            <Section title="Which emoji" aside={<Needs problem={problem} field="emoji" loud={loud} />}>
              <div className="flex flex-wrap items-center gap-1.5">
                {EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    role="radio"
                    aria-checked={trigger.emoji === emoji}
                    aria-label={emoji}
                    onClick={() => onChange({ ...trigger, emoji })}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-xl border text-title outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-95",
                      trigger.emoji === emoji ? "border-brand bg-brand-soft" : "bg-card hover:border-foreground/20",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
                <Input
                  value={EMOJI.includes(trigger.emoji ?? "") ? "" : (trigger.emoji ?? "")}
                  placeholder="Another"
                  aria-label="Another emoji"
                  onChange={(e) => onChange({ ...trigger, emoji: e.target.value })}
                  className="h-10 w-[104px] rounded-xl bg-card text-center"
                />
              </div>
            </Section>
          )}

          {/* The default is the person, and the reason is worth saying: a
              workflow that posts where it watches would otherwise set
              itself off, forever. */}
          <label className="mt-8 flex items-center justify-between gap-4 rounded-xl border bg-card px-3.5 py-3">
            <span className="min-w-0">
              <span className="block text-body font-medium text-foreground">Agents can set it off too</span>
              <span className="block text-small leading-relaxed text-muted-foreground">
                Off by default, so it can't keep setting itself off.
              </span>
            </span>
            <Switch
              aria-label="Agents can set it off too"
              checked={trigger.from === "anyone"}
              onCheckedChange={(on) => onChange({ ...trigger, from: on ? "anyone" : "user" })}
            />
          </label>
        </>
      )}

      {trigger.kind === "webhook" && (
        <p className="mt-6 text-pretty text-body leading-relaxed text-muted-foreground">
          Save, then add a webhook for it under Webhooks. What it sends arrives as{" "}
          <span className={PILL}>{triggerTextLabel("webhook")}</span>, ready to use in any step.
        </p>
      )}
      {trigger.kind === "manual" && (
        <p className="mt-6 text-pretty text-body leading-relaxed text-muted-foreground">
          Run it from the list, or press Try it below to run it now.
        </p>
      )}
    </>
  );
}

function StepPane({
  step,
  index,
  count,
  bots,
  allBots,
  rooms,
  offered,
  conditions,
  labelFor,
  fallbackAsk,
  problem,
  loud,
  onChange,
  onMove,
  onRemove,
}: {
  step: Step;
  index: number;
  count: number;
  bots: Bot[];
  allBots: Bot[];
  rooms: Room[];
  offered: Reference[];
  conditions: Reference[];
  labelFor: LabelFor;
  fallbackAsk: string | null;
  problem: Problem | null;
  loud: boolean;
  onChange: (change: Partial<Step>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const field = useRef<TokenFieldHandle>(null);
  const title = step.action === "ask" ? "What to ask" : step.action === "post" ? "What to post" : "What you are approving";

  return (
    <>
      <PaneHeading
        eyebrow={`Step ${index + 1} of ${count}`}
        title={step.action === "ask" ? "Ask an agent" : step.action === "post" ? "Post in a room" : "Ask you"}
        aside={
          <div className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ChevronUp size={15} />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move down" title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ChevronDown size={15} />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Remove step" title="Remove step" disabled={count === 1} onClick={onRemove}>
              <Trash2 size={14} />
            </Button>
          </div>
        }
      />

      <Segmented
        aria-label="What this step does"
        value={step.action}
        onChange={(action) => action !== step.action && onChange({ action, targetId: "" })}
        options={[
          { value: "ask", label: "Ask an agent" },
          { value: "post", label: "Post in a room" },
          { value: "approve", label: "Ask you" },
        ]}
      />

      {step.action === "ask" && (
        <Section title="Who" className="mt-8" aside={<Needs problem={problem} field="target" loud={loud} />}>
          <AgentPicker value={step.targetId} agents={bots} onPick={(id) => onChange({ targetId: id })} />
        </Section>
      )}
      {step.action === "post" && (
        <Section title="Where" className="mt-8" aside={<Needs problem={problem} field="target" loud={loud} />}>
          {rooms.length === 0 ? (
            <p className="text-body text-muted-foreground">No rooms yet. Make one, then come back.</p>
          ) : (
            <div role="radiogroup" aria-label="Room" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {rooms.map((room) => (
                <PickCard
                  key={room.id}
                  on={step.targetId === room.id}
                  onPick={() => onChange({ targetId: room.id })}
                  face={<RoomFace room={room} bots={allBots} />}
                  title={room.name}
                  line={plural(room.memberIds?.length ?? 0, "member")}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title={title} className="mt-8" aside={<Needs problem={problem} field="text" loud={loud} />}>
        <TokenField
          ref={field}
          value={step.text}
          onChange={(text) => onChange({ text })}
          labelFor={labelFor}
          aria-label={title}
          placeholder={
            step.action === "approve"
              ? "Send the refund to this customer?"
              : step.action === "post"
                ? "Here is today's summary."
                : "Sort this message: urgent, normal or ignore."
          }
          className="min-h-[96px] rounded-xl border bg-card px-3.5 py-2.5 text-ui leading-relaxed shadow-[0_1px_2px_var(--shadow-color)] transition-[border-color] duration-150 focus-within:border-ring/50"
        />
        {offered.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-small text-muted-foreground">Add</span>
            {offered.map((ref) => (
              <button
                key={ref.token}
                // keeps the caret in the field, so it lands where it was
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => field.current?.insert(ref.token)}
                className="flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-small font-medium text-brand-ink outline-none transition-[opacity,scale] duration-150 hover:opacity-80 active:scale-95"
              >
                <Plus size={11} />
                {ref.label}
              </button>
            ))}
          </div>
        )}
      </Section>

      {step.action === "approve" && (
        <>
          <Section title="How long it waits">
            <WaitSlider value={step.timeoutMin ?? 24 * 60} onChange={(timeoutMin) => onChange({ timeoutMin })} />
          </Section>
          <Section title="If nobody answers">
            <Segmented
              aria-label="If nobody answers"
              className="max-w-[320px]"
              value={step.onTimeout === "continue" ? "continue" : "stop"}
              onChange={(onTimeout) => onChange({ onTimeout })}
              options={[
                { value: "stop", label: "Stop" },
                { value: "continue", label: "Carry on" },
              ]}
            />
            <p className="mt-2 text-small leading-relaxed text-muted-foreground">
              {step.onTimeout === "continue"
                ? "Silence counts as a yes. Use it only for steps that are safe to run."
                : "Silence counts as a no, which is the safe choice."}
            </p>
          </Section>
          <Section title="Where to ask you" aside={<Needs problem={problem} field="target" loud={loud} />}>
            <div role="radiogroup" aria-label="Where to ask you" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <PickCard
                on={!step.targetId}
                onPick={() => onChange({ targetId: "" })}
                face={
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <CornerDownRight size={14} />
                  </span>
                }
                title="Where it got to"
                line={fallbackAsk ? `In ${fallbackAsk}` : "Nowhere yet, so pick an agent"}
              />
              {bots.map((bot) => (
                <PickCard
                  key={bot.id}
                  on={step.targetId === bot.id}
                  onPick={() => onChange({ targetId: bot.id })}
                  face={<AgentAvatar bot={bot} size={32} />}
                  title={bot.name}
                  line={bot.title || "In their chat"}
                />
              ))}
            </div>
          </Section>
        </>
      )}

      <Section title="Condition" aside={<Needs problem={problem} field="condition" loud={loud} />}>
        <ConditionEditor when={step.when} options={conditions} labelFor={labelFor} onChange={(next) => onChange({ when: next })} />
      </Section>
    </>
  );
}

/** A row of choosable things, each a card: face, name, one line. */
function PickCard({
  on,
  onPick,
  face,
  title,
  line,
}: {
  on: boolean;
  onPick: () => void;
  face: React.ReactNode;
  title: string;
  line: string;
}) {
  return (
    <button
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.985]",
        on ? "border-brand bg-brand-soft" : "bg-card hover:border-foreground/20 hover:bg-accent/40",
      )}
    >
      {face}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-foreground">{title}</span>
        <span className="block truncate text-small text-muted-foreground">{line}</span>
      </span>
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
          on ? "border-brand-ink bg-brand-ink text-brand-foreground" : "border-foreground/25",
        )}
      >
        {on && <Check size={10} strokeWidth={3} />}
      </span>
    </button>
  );
}

/** A room's face: the first few of its members, overlapping. */
function RoomFace({ room, bots }: { room: Room; bots: Bot[] }) {
  const members = (room.memberIds ?? []).map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => Boolean(b)).slice(0, 3);
  if (!members.length) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Users size={14} />
      </span>
    );
  }
  return (
    <span className="flex w-8 shrink-0 items-center">
      {members.map((bot, i) => (
        <span key={bot.id} className={cn("rounded-[7px] ring-2 ring-card", i > 0 && "-ml-3")}>
          <AgentAvatar bot={bot} size={20} />
        </span>
      ))}
    </span>
  );
}

/** Lists longer than this get a search box; shorter ones read at a glance. */
const SEARCH_ABOVE = 8;

function useSearch<T extends { name: string; title?: string }>(list: T[]) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((x) => `${x.name} ${x.title ?? ""}`.toLowerCase().includes(q)) : list;
  const box =
    list.length > SEARCH_ABOVE ? (
      <label className="mb-2.5 flex h-8 items-center gap-2 rounded-full border bg-card px-3 transition-colors duration-150 focus-within:border-ring/50">
        <Search size={13} className="shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find"
          aria-label="Find"
          className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
    ) : null;
  return { shown, box, query };
}

function AgentPicker({ value, agents, onPick }: { value?: string; agents: Bot[]; onPick: (id: string) => void }) {
  const { shown, box, query } = useSearch(agents);
  if (!agents.length) return <p className="text-body text-muted-foreground">No agents yet.</p>;
  return (
    <>
      {box}
      <div role="radiogroup" aria-label="Agent" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((bot) => (
          <PickCard
            key={bot.id}
            on={value === bot.id}
            onPick={() => onPick(bot.id)}
            face={<AgentAvatar bot={bot} size={32} />}
            title={bot.name}
            line={bot.title || "No stated role"}
          />
        ))}
        {shown.length === 0 && <p className="col-span-full py-3 text-body text-muted-foreground">Nobody matches “{query.trim()}”.</p>}
      </div>
    </>
  );
}

function PlacePicker({
  value,
  agents,
  allBots,
  rooms,
  onPick,
}: {
  value?: string;
  agents: Bot[];
  allBots: Bot[];
  rooms: Room[];
  onPick: (id: string, kind: "agent" | "room") => void;
}) {
  const places = useMemo(
    () => [
      ...agents.map((b) => ({ id: b.id, name: b.name, title: b.title, kind: "agent" as const })),
      ...rooms.map((r) => ({ id: r.id, name: r.name, title: "room", kind: "room" as const })),
    ],
    [agents, rooms],
  );
  const { shown, box } = useSearch(places);
  const group = (kind: "agent" | "room") => shown.filter((p) => p.kind === kind);
  return (
    <>
      {box}
      {(["agent", "room"] as const).map((kind) =>
        group(kind).length ? (
          <div key={kind} className="mb-3 last:mb-0">
            <div className="mb-1.5 text-small text-muted-foreground">{kind === "agent" ? "A chat with an agent" : "A room"}</div>
            <div role="radiogroup" aria-label={kind === "agent" ? "Agent" : "Room"} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group(kind).map((place) => {
                const bot = place.kind === "agent" ? allBots.find((b) => b.id === place.id) : undefined;
                const room = place.kind === "room" ? rooms.find((r) => r.id === place.id) : undefined;
                return (
                  <PickCard
                    key={place.id}
                    on={value === place.id}
                    onPick={() => onPick(place.id, place.kind)}
                    face={bot ? <AgentAvatar bot={bot} size={32} /> : <RoomFace room={room!} bots={allBots} />}
                    title={place.name}
                    line={bot ? bot.title || "Their chat" : plural(room?.memberIds?.length ?? 0, "member")}
                  />
                );
              })}
            </div>
          </div>
        ) : null,
      )}
    </>
  );
}

// ── how long an approval waits ─────────────────────────────────────────

/** Named stops, saved as the same minutes the server has always taken.
 * Seven days is the server's cap (MAX_TIMEOUT_MIN). */
const WAITS: Array<SliderStop<number>> = [
  { value: 60, label: "1h" },
  { value: 4 * 60, label: "4h" },
  { value: 12 * 60, label: "12h" },
  { value: 24 * 60, label: "1 day" },
  { value: 3 * 24 * 60, label: "3 days" },
  { value: 7 * 24 * 60, label: "7 days" },
];

function waitLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60 || minutes % (24 * 60)) return `${Math.round((minutes / 60) * 10) / 10}h`;
  return plural(minutes / (24 * 60), "day");
}

function WaitSlider({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  // A wait saved before there were stops (two hours, typed by hand) keeps
  // its own stop, in its place, rather than being moved to the nearest
  // one just because the editor was opened.
  const stops = useMemo(
    () =>
      WAITS.some((s) => s.value === value)
        ? WAITS
        : [...WAITS, { value, label: waitLabel(value) }].sort((a, b) => a.value - b.value),
    [value],
  );
  // The slider's thumb rides a rail as wide as the track, moved by
  // transform, and a moved box still counts toward its scroller's width.
  // Clipped sideways here, with room left for the focus ring, so the pane
  // does not grow a horizontal scrollbar when the wait is long.
  return (
    <div className="-mx-1 overflow-x-clip px-1">
      <Slider aria-label="How long it waits" stops={stops} value={value} onChange={onChange} onCommit={onChange} />
    </div>
  );
}

// ── a condition, as a sentence ─────────────────────────────────────────

function ConditionEditor({
  when: condition,
  options,
  labelFor,
  onChange,
}: {
  when?: Step["when"];
  options: Reference[];
  labelFor: LabelFor;
  onChange: (next: Step["when"]) => void;
}) {
  // a condition just added goes straight to the words it looks for, the
  // one part with no sensible default
  const fresh = useRef(false);
  if (!condition) {
    if (!options.length) {
      return <p className="text-body text-muted-foreground">Always runs. There is nothing earlier to check yet.</p>;
    }
    return (
      <button
        onClick={() => {
          fresh.current = true;
          onChange({ left: options[0].token, op: "contains", right: "" });
        }}
        className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-body text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent/50 hover:text-foreground active:scale-[0.985]"
      >
        <CornerDownRight size={14} />
        Only run this step if…
      </button>
    );
  }

  // A left side someone wrote by hand stays as written, and is still
  // offered back in the list so choosing again is a real choice.
  const custom = !options.some((o) => o.token === condition.left);
  const leftLabel = readable(condition.left, labelFor) || "Pick an answer";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border bg-card px-3 py-2.5 text-ui"
    >
      <span className="text-muted-foreground">Only if</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={cn(CHOICE, "max-w-full")}>
            <span className={cn(PILL, "mx-0 truncate")}>{leftLabel}</span>
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {options.map((o) => (
            <DropdownMenuItem key={o.token} onSelect={() => onChange({ ...condition, left: o.token })}>
              <span className="flex-1">{o.label}</span>
              {o.token === condition.left && <Check size={13} />}
            </DropdownMenuItem>
          ))}
          {custom && (
            <DropdownMenuItem disabled>
              <span className="flex-1 truncate">{leftLabel}</span>
              <Check size={13} />
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={CHOICE}>
            <span className="font-medium text-foreground">{opWord(condition.op)}</span>
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {OPS.map(([op, word]) => (
            <DropdownMenuItem key={op} onSelect={() => onChange({ ...condition, op })}>
              <span className="flex-1">{word}</span>
              {op === condition.op && <Check size={13} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {needsRight(condition.op) && (
        <TokenField
          value={condition.right ?? ""}
          onChange={(right) => onChange({ ...condition, right })}
          labelFor={labelFor}
          multiline={false}
          autoFocus={fresh.current}
          aria-label="Words to look for"
          placeholder="urgent"
          className="min-w-[120px] flex-1 rounded-lg border border-input bg-background px-2.5 py-1 text-ui transition-[border-color] duration-150 focus-within:border-ring/60"
        />
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Remove condition" title="Remove condition" className="ml-auto" onClick={() => onChange(undefined)}>
        <X size={13} />
      </Button>
    </motion.div>
  );
}

const CHOICE =
  "inline-flex h-8 min-w-0 items-center gap-1 rounded-lg bg-muted px-2 outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-accent active:scale-[0.97] data-[state=open]:bg-accent";

// ── words with answers in them ─────────────────────────────────────────
//
// A field where an earlier answer is one solid thing, a pill with its
// name on it, while the text underneath stays the template the server
// fills. It is a contentEditable rather than a textarea because a pill
// has to be deleted whole and stepped over whole by the caret, and a
// textarea can only ever show the braces.
//
// The DOM is drawn from the value only when the value changes from
// outside (another step renamed, a pill inserted), never on the way back
// from typing, so the caret and the browser's own undo are left alone.

/** One reference, drawn. Built by hand rather than by React, so these are
 * the whole of its look, in one place Tailwind can see. */
const PILL =
  "mx-px inline-block rounded-md bg-brand-soft px-1.5 align-baseline text-small font-medium leading-[1.6] text-brand-ink";
const PILL_UNKNOWN =
  "mx-px inline-block rounded-md bg-destructive/10 px-1.5 align-baseline text-small font-medium leading-[1.6] text-destructive";

function makePill(raw: string, path: string, labelFor: LabelFor): HTMLElement {
  const { label, known } = labelFor(path);
  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.token = raw;
  pill.className = known ? PILL : PILL_UNKNOWN;
  pill.textContent = label;
  pill.title = known ? label : `${label}: not something a step can read`;
  return pill;
}

function paint(root: HTMLElement, value: string, labelFor: LabelFor) {
  const nodes: Node[] = [];
  const text = (chunk: string) =>
    chunk.split("\n").forEach((line, i) => {
      if (i) nodes.push(document.createElement("br"));
      if (line) nodes.push(document.createTextNode(line));
    });
  let last = 0;
  for (const match of value.matchAll(REFERENCE)) {
    text(value.slice(last, match.index));
    nodes.push(makePill(match[0], match[1], labelFor));
    last = (match.index ?? 0) + match[0].length;
  }
  text(value.slice(last));
  // a last line break only shows with something after it
  if (value.endsWith("\n")) nodes.push(document.createElement("br"));
  root.replaceChildren(...nodes);
}

/** The template back out of the field: text as typed, each pill as the
 * reference it stands for, each line break as a newline. */
function read(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child as Text).data;
      } else if (child instanceof HTMLElement) {
        if (child.dataset.token) out += child.dataset.token;
        else if (child.tagName === "BR") out += "\n";
        else {
          if (/^(DIV|P)$/.test(child.tagName) && out && !out.endsWith("\n")) out += "\n";
          walk(child);
        }
      }
    });
  };
  walk(root);
  // the break the browser keeps at the very end so an empty last line
  // has somewhere to be
  if (root.lastChild?.nodeName === "BR") out = out.slice(0, -1);
  return out.replace(/ /g, " ").replace(/​/g, "");
}

interface TokenFieldHandle {
  insert: (token: string) => void;
}

const TokenField = forwardRef<
  TokenFieldHandle,
  {
    value: string;
    onChange: (value: string) => void;
    labelFor: LabelFor;
    multiline?: boolean;
    autoFocus?: boolean;
    placeholder?: string;
    className?: string;
    "aria-label": string;
  }
>(function TokenField({ value, onChange, labelFor, multiline = true, autoFocus, placeholder, className, "aria-label": ariaLabel }, ref) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) root.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saved = useRef<Range | null>(null);
  const keyOf = (v: string) => [...v.matchAll(REFERENCE)].map((m) => labelFor(m[1]).label).join("|");
  // what the field is showing now, and under which names
  const shown = useRef<{ value: string; key: string } | null>(null);
  const key = keyOf(value);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (shown.current && shown.current.value === value && shown.current.key === key) return;
    paint(el, value, labelFor);
    shown.current = { value, key };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, key]);

  // where the caret was last, so a pill added from a button goes there
  useEffect(() => {
    const remember = () => {
      const selection = document.getSelection();
      if (selection?.rangeCount && root.current?.contains(selection.anchorNode)) {
        saved.current = selection.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);

  const emit = () => {
    const el = root.current;
    if (!el) return;
    const next = read(el);
    shown.current = { value: next, key: keyOf(next) };
    onChange(next);
  };

  useImperativeHandle(ref, () => ({
    insert(token: string) {
      const el = root.current;
      if (!el) return;
      el.focus();
      const selection = document.getSelection();
      let range: Range | null =
        selection?.rangeCount && el.contains(selection.anchorNode)
          ? selection.getRangeAt(0)
          : saved.current && el.contains(saved.current.startContainer)
            ? saved.current
            : null;
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        if (el.lastChild?.nodeName === "BR") range.setStartBefore(el.lastChild);
      }
      range.deleteContents();
      const path = token.replace(/^\{\{\s*|\s*\}\}$/g, "");
      const pill = makePill(token, path, labelFor);
      range.insertNode(pill);
      // a space after, so the caret has somewhere to stand that is not
      // the edge of the pill
      const next = pill.nextSibling;
      let caret: Node = pill;
      if (!(next instanceof Text && /^\s/.test(next.data))) {
        caret = document.createTextNode(" ");
        pill.after(caret);
      } else caret = next;
      const after = document.createRange();
      after.setStart(caret, 1);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      emit();
    },
  }));

  return (
    <div
      className={cn("relative flex cursor-text flex-col", className)}
      // the padding is part of the field: a press there lands the caret
      // at the end, the way a textarea would
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget || !root.current) return;
        e.preventDefault();
        root.current.focus();
        const range = document.createRange();
        range.selectNodeContents(root.current);
        range.collapse(false);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }}
    >
      {!value && placeholder && (
        <span aria-hidden className="pointer-events-none absolute inset-0 truncate text-muted-foreground" style={{ padding: "inherit" }}>
          {placeholder}
        </span>
      )}
      <div
        ref={root}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline={multiline}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={emit}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (multiline) document.execCommand("insertLineBreak");
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, multiline ? text : text.replace(/\s*\n\s*/g, " "));
        }}
        onDrop={(e) => e.preventDefault()}
        // the wrapper's border says where the focus is, so the field
        // does not draw the app's ring inside it as well
        className={cn(
          "relative min-h-[1.5em] flex-1 whitespace-pre-wrap break-words text-foreground outline-none focus-visible:shadow-none",
          !multiline && "overflow-hidden",
        )}
      />
    </div>
  );
});
