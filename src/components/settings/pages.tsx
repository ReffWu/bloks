// The smaller Settings pages, each a group or two: what agents know about
// you, their voices, when they ask, the keys every agent shares, and the
// computer they work on. The bigger ones have files of their own beside
// this one.
import { useEffect, useRef, useState } from "react";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { thisComputer } from "@/lib/thisComputer";
import { ApiKeyRow } from "../ApiKeys";
import { APPROVAL_MODES, ApprovalsChooser, confirmWidening, useWorkspaceApprovals, type ApprovalMode } from "../ApprovalsChooser";
import { BoxSleep } from "../BoxSleep";
import { LocalVmSection } from "../LocalVmSection";
import { RulesPanel } from "../RulesPanel";
import { SavedSecrets } from "../SavedSecrets";
import { UseFromOtherApps } from "../UseFromOtherApps";
import { SavedMark, SettingRow, SettingsGroup } from "../SettingsLayout";

export function AboutYouPage() {
  const { state, dispatch } = useStore();
  const saved = state.config?.profile?.about ?? "";
  const [value, setValue] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  // adopt the server value once it arrives, without stomping an edit
  useEffect(() => {
    if (hydrated.current || !state.config) return;
    hydrated.current = true;
    setValue(saved);
  }, [state.config, saved]);

  const save = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ profile: { about: next } }),
      })
        .then((status) => {
          dispatch({ type: "configStatus", config: status });
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 1600);
        })
        .catch(() => {});
    }, 600);
  };

  return (
    <SettingsGroup>
      <SettingRow
        label="What every agent knows about you"
        htmlFor="about-you"
        description={`Optional. Stays on ${thisComputer()} and is never shown to people in your rooms.`}
        control={<SavedMark on={justSaved} />}
      >
        <Textarea
          id="about-you"
          value={value}
          onChange={(e) => save(e.target.value)}
          placeholder="I'm a founder building a local-first agent app. Keep replies short and skip the preamble."
          className="mt-3 min-h-[120px] resize-y text-body"
        />
        {/* the same field Memory's About you edits, beside the notes your
            agents suggested; one value, either place */}
        <button
          type="button"
          onClick={() => dispatch({ type: "openMemory", target: "you" })}
          className="mt-2.5 rounded text-body text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          See what agents have learned in Memory
        </button>
      </SettingRow>
    </SettingsGroup>
  );
}

/** A key found elsewhere on this machine is an OFFER, never a default:
 * using it bills an account the user set up for something else. This
 * card asks plainly and remembers the answer either way. */
function OpenAIKeyHint() {
  const { state, dispatch } = useStore();
  const speech = state.config?.speech;
  const sourceName = (s: "env" | "codex") =>
    s === "codex" ? "your Codex sign-in" : "your environment";

  const setConsent = (on: boolean) =>
    api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ speech: { useDiscoveredOpenAI: on } }),
    })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {});

  if (speech?.openaiAvailable) {
    return (
      <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
        <div className="text-body font-medium text-foreground">
          Found an OpenAI API key from {sourceName(speech.openaiAvailable)}
        </div>
        <div className="mt-0.5 text-small leading-relaxed text-muted-foreground">
          Bloks can use it for voices, billed to that key per character. Nothing is used
          until you say so.
        </div>
        <Button size="sm" variant="brand" className="mt-2" onClick={() => setConsent(true)}>
          Use that key for voices
        </Button>
      </div>
    );
  }
  if (speech?.openaiSource) {
    return (
      <div className="mt-2 flex items-center gap-2 text-small text-success">
        Using the API key from {sourceName(speech.openaiSource)} for voices.
        <button type="button" className="rounded text-muted-foreground underline hover:text-foreground" onClick={() => setConsent(false)}>
          Stop using it
        </button>
      </div>
    );
  }
  return null;
}

/**
 * The one approvals choice for the workspace. Picking a mode makes it
 * where every new agent starts, at once; agents already working keep
 * theirs until you move them, because a mode changing under an agent
 * mid-task is not something to do by accident.
 */
function WorkspaceApprovals() {
  const { state, save } = useWorkspaceApprovals();
  const [note, setNote] = useState<string | null>(null);
  if (!state) return null;
  const mode = state.mode;
  const total = Object.values(state.agents).reduce((a, b) => a + b, 0);
  const elsewhere = total - (state.agents[mode] ?? 0);
  const label = APPROVAL_MODES.find((m) => m.id === mode)?.label ?? mode;

  const choose = async (next: ApprovalMode) => {
    setNote(null);
    if (next === mode) return;
    if (!(await confirmWidening(mode, next, "new agents"))) {
      setNote("Nothing changed.");
      return;
    }
    await save(next, false);
  };
  const applyToAll = async () => {
    setNote(null);
    if (!(await confirmWidening("ask", mode, "every agent"))) {
      setNote("Nothing changed.");
      return;
    }
    await save(mode, true);
    setNote(`Every agent is on ${label} now.`);
  };

  return (
    <SettingsGroup title="How much agents ask" footnote="Each agent can change this in its own settings. Shared rooms always ask.">
      <div className="p-4">
        <ApprovalsChooser value={mode} onChange={(next) => void choose(next)} />
        <div className="mt-3 flex items-center gap-3 text-body text-muted-foreground">
          <span className="min-w-0 flex-1 text-pretty">
            {note ??
              (elsewhere > 0
                ? `New agents start on ${label}. ${elsewhere} of your ${total} agent${total === 1 ? " is" : "s are"} on something else.`
                : `All your agents are on ${label}.`)}
          </span>
          {elsewhere > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void applyToAll()}>
              Move all to {label}
            </Button>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}

/** Voices, with the Mac's own named only where there is a Mac. */
export function VoicesPage() {
  const { state } = useStore();
  const mac = state.config?.speech?.system !== false && !state.config?.hosted?.on;
  return (
    <SettingsGroup
      title="Keys"
      footnote={mac ? "Either key works. The Mac's own voices need none." : "Either key works. Mac voices need Bloks running on a Mac."}
    >
      <ApiKeyRow section="elevenlabs" label="ElevenLabs API key" placeholder="sk_…" />
      <ApiKeyRow section="openaiSpeech" label="OpenAI API key" description="Used for speech only." placeholder="sk-…">
        <OpenAIKeyHint />
      </ApiKeyRow>
    </SettingsGroup>
  );
}

export function RulesPage() {
  return (
    <>
      <WorkspaceApprovals />
      <RulesPanel />
    </>
  );
}

/** The keys every agent shares, and the way in from other AI apps. A
 * cloud computer's key lives with Computers, beside the computer itself. */
export function AppsPage() {
  return (
    <>
      <SettingsGroup title="Composio" footnote="Keys stay on this computer.">
        <ApiKeyRow
          section="composio"
          label="Composio Connect key"
          description="Links accounts like Slack and Gmail."
          placeholder="ck_…"
          info={{
            text: "The Connect key starts with ck_. It's checked when you save it.",
            linkLabel: "Get a Connect key at composio.dev",
            linkHref: "https://composio.dev",
          }}
        />
        <ApiKeyRow
          section="composioApi"
          label="Composio API key"
          description="Optional. Lets you browse the full app catalog."
          placeholder="ak_…"
          info={{
            text: "A project API key, starting with ak_. Connections work without it.",
          }}
        />
      </SettingsGroup>
      <SavedSecrets />
      {/* MCP servers are managed in Plugins now, beside apps and skills */}
      <UseFromOtherApps />
    </>
  );
}

/** Computers: the Local VM and a cloud computer on a Mac; on a hosted
 * workspace, what the agents' computer is instead, since the machine
 * itself is it. */
export function ComputersPage() {
  const { state } = useStore();
  if (state.config?.hosted?.on) {
    return (
      <SettingsGroup title="This machine">
        <SettingRow
          label="Browser and virtual desktop"
          description={
            state.config.hosted.desktop
              ? "Agents work in this machine's browser and on its virtual desktop. Watch the desktop from an agent's Computer panel."
              : "Agents work in this machine's browser. No virtual desktop is set up to watch."
          }
        />
        <SettingRow label="Cloud computer and Local VM" description="Not offered here: this machine is the agents' computer already." />
      </SettingsGroup>
    );
  }
  return (
    <>
      <LocalVmSection />
      <SettingsGroup title="Cloud computer" footnote="Boat is paid after its trial.">
        <ApiKeyRow
          section="box"
          label="Boat API key"
          description="A private Linux computer in the cloud."
          placeholder="Paste your Boat API key"
          info={{
            text: "With a desktop and a terminal, for agents that need a computer of their own. Boat was called Box before.",
            linkLabel: "Open the Boat API key guide",
            linkHref: "https://docs.boat.dev/api-keys",
          }}
        />
        <BoxSleep />
      </SettingsGroup>
    </>
  );
}
