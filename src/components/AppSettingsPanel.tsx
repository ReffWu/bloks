// App-level settings, as a page of its own beside the sidebar: how Bloks
// looks and behaves, and everything shared by all agents. Per-agent
// settings live in SettingsPanel; contextual Box-token entry also stays in
// ComputerPanel.
//
// A page rather than a window because it outgrew one: a dozen areas in a
// 720px box meant scrolling inside a scroll. Pages are grouped the way
// people look for them (you, your agents, what they connect to, what they
// leave behind), and search finds the page a word lives on.
import { useEffect, useRef, useState } from "react";
import { Check } from "@/components/icons";
import { Monitor } from "@/components/icons";
import { Moon } from "@/components/icons";
import { Sun } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { DEFAULT_TURN_LIMIT, MAX_TURN_LIMIT, MIN_TURN_LIMIT } from "@/lib/turn-limit";
import { useTheme, type Theme } from "@/lib/theme";
import type { UpdateState } from "@/types/bridge";
import { drainingLine } from "./UpdateCard";
import { RecordPanel } from "./RecordPanel";
import { BackupsSection } from "./BackupsSection";
import { RulesPanel } from "./RulesPanel";
import { ApiKeyRow } from "./ApiKeys";
import { PluginSettings } from "./PluginSettings";
import { Puzzle } from "@/components/icons";
import { EnginesPanel } from "./EnginesPanel";
import { CloudSection } from "./CloudSection";
import { DevicesSection } from "./DevicesSection";
import { TelegramSection } from "./TelegramSection";
import { ChatSection } from "./ChatSection";
import { RemoteSection } from "./RemoteSection";
import { LocalVmSection } from "./LocalVmSection";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { thisComputer } from "@/lib/thisComputer";
import { UseFromOtherApps } from "./UseFromOtherApps";
import { SecurityCheckup } from "./SecurityCheckup";
import { riskyCount, useSecurityCheckup } from "@/lib/securityCheckup";
import { BringYourSetupPage } from "./BringYourSetup";
import { BoxSleep } from "./BoxSleep";
import { AgentDefaults } from "./AgentDefaults";
import { SettingRow, SettingsGroup, SettingsPageHeader } from "./SettingsLayout";
import { Segmented } from "@/components/ui/segmented";
import { DELIVERY_MODES, modeWords, type DeliveryMode } from "@/lib/deliveryModes";
import { Slider, numberStops } from "@/components/ui/slider";
import { useConversationsView } from "@/lib/conversationsView";
import { useTranscriptWidth } from "@/lib/useTranscriptWidth";
import { Archive } from "@/components/icons";
import { Cloud as CloudIcon } from "@/components/icons";
import { Cpu } from "@/components/icons";
import { History } from "@/components/icons";
import { Info } from "@/components/icons";
import { LayoutGrid } from "@/components/icons";
import { MessageCircle } from "@/components/icons";
import { Mic } from "@/components/icons";
import { Search as SearchIcon } from "@/components/icons";
import { ShieldAlert } from "@/components/icons";
import { ShieldCheck } from "@/components/icons";
import { SlidersHorizontal } from "@/components/icons";
import { Smartphone } from "@/components/icons";
import { User as UserIcon } from "@/components/icons";
import { UserPlus } from "@/components/icons";
import { Luggage } from "@/components/icons";
import { useEscape } from "@/lib/useEscape";
import { APPROVAL_MODES, ApprovalsChooser, confirmWidening, useWorkspaceApprovals, type ApprovalMode } from "./ApprovalsChooser";
import { AccentPicker } from "./AccentPicker";

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
  { value: "system", label: "System", icon: <Monitor size={14} /> },
];

/**
 * How a long conversation is kept inside the model's window.
 *
 * The switch is off, and it says what it trades rather than only what it
 * gives. Both settings work; one pays in a pause and the other pays in
 * cache misses, and which is cheaper depends on the provider, so the
 * honest thing is to describe both and let the person choose.
 */
function Compaction() {
  const { state, dispatch } = useStore();
  const on = state.config?.compaction?.micro ?? false;
  const [saving, setSaving] = useState(false);

  const set = (micro: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ compaction: { micro } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Summarise as you go"
      info="Long chats get summarised to keep fitting. Off: all at once when full, with a short pause. On: a little after each reply, so no pause, but the provider can't reuse its cache, which costs more on some. Your own messages are never summarised."
      description="Summarise a little after each reply, not all at once."
      control={<Switch aria-label="Summarise as you go" checked={on} disabled={saving} onCheckedChange={set} />}
    />
  );
}

/**
 * Whether a quiet Claude Code conversation is compacted before its cache
 * expires (GitHub 162). Off by default: it saves on the first message
 * after a long pause, and pays for that with detail the summary drops.
 */
function IdleCompaction() {
  const { state, dispatch } = useStore();
  const on = state.config?.compaction?.idle ?? false;
  const [saving, setSaving] = useState(false);

  const set = (idle: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ compaction: { idle } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Compact while idle"
      info="Claude Code keeps a chat cached for an hour. The first message after that re-sends the whole chat, which costs the most. With this on, a Claude Code chat over 100k tokens that has been quiet for 55 minutes is compacted while still cached. Some detail is lost, and the chat marks where."
      description="Compact long Claude Code chats before their cache expires."
      control={<Switch aria-label="Compact while idle" checked={on} disabled={saving} onCheckedChange={set} />}
    />
  );
}

// smallest to largest, with Never as the far end of "later": a slider
// reads left to right as sooner to never
const BEFORE_TURN_CEILINGS = [
  { value: "100000", label: "100k" },
  { value: "200000", label: "200k" },
  { value: "400000", label: "400k" },
  { value: "0", label: "Never" },
];

function SharedChanges() {
  const { state, dispatch } = useStore();
  const on = state.config?.changes?.showShared ?? true;
  const [saving, setSaving] = useState(false);

  const set = (showShared: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ changes: { showShared } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Show other changed files"
      description="Also show files that changed while an agent was working, not only its own."
      control={<Switch aria-label="Show other changed files" checked={on} disabled={saving} onCheckedChange={set} />}
    />
  );
}

/**
 * How big a Claude Code, Codex or Pi conversation may get before its
 * next message compacts it first (GitHub 222, 223). On by default, unlike
 * the two above: every tool call of a turn sends the whole conversation
 * again, so a long one can spend a five-hour limit in minutes, and that
 * costs far more than the detail a compaction drops.
 */
function BeforeTurnCompaction() {
  const { state, dispatch } = useStore();
  const ceiling = String(state.config?.compaction?.beforeTurn ?? 200_000);
  const [saving, setSaving] = useState(false);

  const set = (next: string) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ compaction: { beforeTurn: Number(next) } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Compact long chats"
      info="Claude Code, Codex and Pi re-send the whole chat with every tool call, so one reply in a long chat can use millions of tokens. Past this size, or 60% of the model's limit, the chat is compacted before your next message. The chat marks where."
      description="For Claude Code, Codex and Pi. Compact before the next message once a chat reaches this size."
    >
      <div className="mt-3">
        <Slider
          aria-label="Compact long chats"
          className="max-w-[420px]"
          stops={BEFORE_TURN_CEILINGS}
          value={BEFORE_TURN_CEILINGS.some((o) => o.value === ceiling) ? ceiling : "200000"}
          onCommit={(next) => !saving && set(next)}
        />
      </div>
    </SettingRow>
  );
}

const SILENT_CALL_LIMITS = [
  { value: "5", label: "5 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "0", label: "Never" },
];

/**
 * How long one tool call may sit without a word from the engine before
 * its turn is stopped (GitHub 146). The model thinking, or a command that
 * keeps reporting, is never cut short; only a call that has gone silent,
 * and never while an approval card is waiting on you.
 */
function SilentCallLimit() {
  const { state, dispatch } = useStore();
  const minutes = String(state.config?.turns?.stallMinutes ?? 15);
  const [saving, setSaving] = useState(false);

  const set = (next: string) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ turns: { stallMinutes: Number(next) } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Stop stuck tool calls"
      info="Sometimes a command waits on something that never answers. After this long with no progress, Bloks stops the reply and tells you and the agent which call it was. Thinking, writing and commands that keep reporting are never cut short. Time waiting on your approval doesn't count."
      description="Stop when one call makes no progress for this long."
    >
      <div className="mt-3">
        <Slider
          aria-label="Stop stuck tool calls"
          className="max-w-[420px]"
          stops={SILENT_CALL_LIMITS}
          value={SILENT_CALL_LIMITS.some((o) => o.value === minutes) ? minutes : "15"}
          onCommit={(next) => !saving && set(next)}
        />
      </div>
    </SettingRow>
  );
}

/**
 * Whether a finished session gets read back for something worth keeping.
 *
 * Off, like everything here that spends money nobody asked for. What it
 * finds is always staged rather than installed, and the card says so,
 * because "it writes its own instructions" is a sentence that should come
 * with the word "suggests" attached.
 */
function ProposeSkills() {
  const { state, dispatch } = useStore();
  const on = state.config?.skills?.propose ?? false;
  const [saving, setSaving] = useState(false);

  const set = (propose: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ skills: { propose } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Suggest skills"
      info="Nothing installs on its own. Suggestions wait in Skills, ready to keep with one press. Each check costs one small call on your own key, so this starts off."
      description="After a chat that worked something out, suggest it as a skill."
      control={<Switch aria-label="Suggest skills" checked={on} disabled={saving} onCheckedChange={set} />}
    />
  );
}

/**
 * How many turns in a row agents may start in one another before the
 * person has a say. A number within the server's bounds, never Off: the
 * whole-chain count is what keeps a loop from spending the usage.
 */
function AgentTurnLimit() {
  const { state, dispatch } = useStore();
  const stored = state.config?.agents?.turnLimit ?? DEFAULT_TURN_LIMIT;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = (value: number) => {
    setSaving(true);
    setError("");
    api("/api/config", { method: "PUT", body: JSON.stringify({ agents: { turnLimit: value } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't save the limit."))
      .finally(() => setSaving(false));
  };
  return (
    <SettingRow
      label="Agent-to-agent limit"
      description="Agents stop after this many replies to each other, so they don't use up your usage without you. Your next message resets the count."
    >
      <div className="mt-3">
        <Slider
          aria-label="Most agent replies in a row"
          className="max-w-[460px]"
          stops={TURN_LIMIT_STOPS}
          value={stored}
          onCommit={(value) => !saving && save(value)}
        />
      </div>
      {error && <p role="alert" className="mt-2 text-small text-destructive">{error}</p>}
    </SettingRow>
  );
}

/**
 * What happens to what you send while an agent is in the middle of
 * something, for every agent that has not chosen for itself
 * (server/delivery.ts). Automatic unless changed.
 */
function MidTurnMessages() {
  const { state, dispatch } = useStore();
  const mode = state.config?.delivery?.mode ?? "auto";
  const askModel = state.config?.delivery?.askModel === true;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = (next: { mode?: DeliveryMode; askModel?: boolean }) => {
    setSaving(true);
    setError("");
    api("/api/config", { method: "PUT", body: JSON.stringify({ delivery: next }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't save that."))
      .finally(() => setSaving(false));
  };
  return (
    <SettingRow
      label="Messages while an agent works"
      info="A stop stops the agent. A correction or an answer goes into what it is doing, or restarts it if its engine can't take words midway. Each agent can choose for itself in its own settings."
      description={modeWords(mode).says}
    >
      <div className="mt-3 max-w-[460px]">
        <Segmented<DeliveryMode>
          aria-label="Messages while an agent works"
          size="sm"
          value={mode}
          onChange={(next) => !saving && next !== mode && save({ mode: next })}
          options={DELIVERY_MODES.map((m) => ({ value: m.value, label: m.label }))}
        />
      </div>
      {mode === "auto" && (
        // Only for words the rules cannot read, and only on an agent whose
        // own engine has a small model; each ask is one small call.
        <label className="mt-3 flex max-w-[460px] items-center justify-between gap-3">
          <span className="text-body text-muted-foreground">When unsure, ask the agent's small model</span>
          <Switch
            aria-label="When unsure, ask the agent's small model"
            checked={askModel}
            disabled={saving}
            onCheckedChange={(on: boolean) => save({ askModel: on })}
          />
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-small text-destructive">{error}</p>}
    </SettingRow>
  );
}

const TURN_LIMIT_STOPS = numberStops(MIN_TURN_LIMIT, MAX_TURN_LIMIT, (n) => `${n} ${n === 1 ? "reply" : "replies"}`);

/**
 * Whether agents are reminded of their other conversations before your
 * turn. On, unlike the switches above that spend money: it costs no call,
 * only a few hundred words in a turn when something matches closely, and
 * each agent can still turn it off for itself.
 */
function RecallBeforeTurn() {
  const { state, dispatch } = useStore();
  const on = state.config?.recall?.beforeTurn ?? true;
  const [saving, setSaving] = useState(false);

  const set = (beforeTurn: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ recall: { beforeTurn } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Bring up other conversations"
      info="Bloks searches the agent's other chats and notes for close matches to your message. Up to three short notes go with that message only, each saying where it came from, and your message shows what was added. Rooms and email from people you haven't listed never get them."
      description="Remind an agent what it said elsewhere that matches your message."
      control={<Switch aria-label="Bring up other conversations" checked={on} disabled={saving} onCheckedChange={set} />}
    />
  );
}

/** Shared context every agent receives. Optional, never asked for up
 * front: it lives here for whenever you feel like writing it. */
/**
 * What version this is, and the way to the next one.
 *
 * The updater already runs on its own at launch; this card exists so a
 * person can ask instead of waiting, watch the download when there is
 * one, and restart into it the moment it is ready. In a plain browser
 * tab there is no updater and the card says only what it knows.
 */
function AboutCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ state: "idle" });

  useEffect(() => {
    void window.bloks?.appVersion?.().then(setVersion);
    void window.bloks?.updateState?.().then(setUpdate);
    return window.bloks?.onUpdateState?.(setUpdate);
  }, []);

  const line =
    update.state === "checking"
      ? "Checking…"
      : update.state === "downloading"
        ? `Downloading ${update.version ?? "the update"}${update.percent ? ` (${update.percent}%)` : ""}…`
        : update.state === "current"
          ? "You are on the latest version."
          : update.state === "ready"
            ? update.draining
              ? drainingLine(update.draining)
              : `${update.version ?? "An update"} is downloaded and ready.`
            : update.state === "error"
              ? update.reason === "install"
                ? "The update downloaded but didn't install. Quit and reopen Bloks to try again."
                : update.reason === "server"
                  ? "Couldn't get the update. Try again in a few minutes."
                  : "Couldn't reach the update server. Bloks will try again in a few hours."
              : update.state === "dev"
                ? "Updates apply to the installed app, not a dev build."
                : null;
  // a restart into an update that came back on the same version says so
  // before whatever the updater is doing now
  const description = update.notInstalled
    ? `The update did not install. ${line ?? "You can get the installer from bloks.dev."}`
    : (line ?? "Updates download on their own and install when you restart.");

  return (
    <SettingsGroup title="Version">
      <SettingRow
        label={`Bloks ${version ?? ""}`}
        description={description}
        control={
          update.state === "ready" ? (
            <Button size="sm" disabled={Boolean(update.draining)} onClick={() => void window.bloks?.updateInstall?.()}>
              Restart to update
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={!window.bloks || update.state === "checking" || update.state === "downloading"}
              onClick={() => void window.bloks?.updateCheck?.().then(setUpdate)}
            >
              Check for updates
            </Button>
          )
        }
      />
      <SettingRow
        label="Something broken, or missing?"
        description="Opens a GitHub issue."
        control={
          <Button size="sm" variant="secondary" asChild>
            <a
              href={`https://github.com/hamedgitty/bloks/issues/new?body=${encodeURIComponent(`\n\n---\nBloks ${version ?? ""} on ${navigator.platform}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Send feedback
            </a>
          </Button>
        }
      />
      <Diagnostics />
    </SettingsGroup>
  );
}

/**
 * One button between "it doesn't work" and a useful bug report. The
 * server assembles the facts (versions, engine states, which
 * credentials exist as booleans, never values) and this copies them,
 * ready to paste into a GitHub issue.
 */
function Diagnostics() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      const report = await fetch("/api/diagnostics").then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      });
      await navigator.clipboard.writeText(report);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  };
  return (
    <SettingRow
      label="Diagnostics"
      info="Versions, connection states, which keys are set (yes or no) and agent counts. Never the keys, and anything that looks like one is removed."
      description={
        failed ? (
          <span className="text-destructive">Couldn't build the report. Is the server running?</span>
        ) : (
          "A short report to paste into a bug report."
        )
      }
      control={
        <Button size="sm" variant="secondary" onClick={() => void copy()} className="min-w-[128px]">
          {copied ? (
            <>
              <Check size={14} /> Copied
            </>
          ) : (
            "Copy diagnostics"
          )}
        </Button>
      }
    />
  );
}

function AboutYou() {
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
        control={
          <span
            className={cn(
              "flex items-center gap-1 text-small text-success transition-opacity duration-200",
              justSaved ? "opacity-100" : "opacity-0",
            )}
            aria-live="polite"
          >
            <Check size={12} /> Saved
          </span>
        }
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
          onClick={() => dispatch({ type: "openMemory", target: "you" })}
          className="mt-2.5 text-body text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
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
      <div className="-mt-1 rounded-xl border border-warning/40 bg-warning/10 p-3">
        <div className="text-body font-medium text-foreground">
          Found an OpenAI API key from {sourceName(speech.openaiAvailable)}
        </div>
        <div className="mt-0.5 text-small leading-relaxed text-muted-foreground">
          Bloks can use it for voices, billed to that key per character. Nothing is used
          until you say so.
        </div>
        <Button size="sm" className="mt-2" onClick={() => setConsent(true)}>
          Use that key for voices
        </Button>
      </div>
    );
  }
  if (speech?.openaiSource) {
    return (
      <div className="-mt-2 flex items-center gap-2 text-small text-success">
        Using the API key from {sourceName(speech.openaiSource)} for voices.
        <button className="text-muted-foreground underline hover:text-foreground" onClick={() => setConsent(false)}>
          Stop using it
        </button>
      </div>
    );
  }
  return null;
}



/**
 * The system-wide hotkey, and the honest reporting around it.
 *
 * Off until somebody sets one: a global shortcut that arrives uninvited
 * will sooner or later collide with something they already use. And
 * because another app may already own the keys, registration answers
 * with what actually took rather than assuming it worked.
 */
function QuickAskShortcut() {
  const [accelerator, setAccelerator] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setAccelerator(c.shortcuts?.quickAsk ?? null))
      .catch(() => {});
  }, []);

  const save = async (next: string | null) => {
    setProblem(null);
    const took = (await window.bloks?.shortcutApply(next)) ?? null;
    if (next && !took) {
      setProblem("Another app uses those keys. Try another combination.");
      return;
    }
    setAccelerator(took);
    await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcuts: { quickAsk: took } }),
    }).catch(() => {});
  };

  // Reading a chord off a keypress, in Electron's own spelling.
  const capture = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key;
    if (key === "Escape") return setCapturing(false);
    // a modifier on its own is not a shortcut, it is half of one
    if (["Shift", "Control", "Alt", "Meta"].includes(key)) return;
    const parts: string[] = [];
    if (e.metaKey) parts.push("Command");
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (parts.length === 0) {
      setProblem("Include a modifier key, like Command or Control.");
      return;
    }
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    setCapturing(false);
    void save(parts.join("+"));
  };

  if (!window.bloks) return null;

  return (
    <SettingRow
      label="Quick ask shortcut"
      info="Tab picks a different agent, Enter sends, Escape closes."
      description={
        problem ? (
          <span className="text-destructive">{problem}</span>
        ) : (
          `Ask any agent from anywhere on ${thisComputer()}.`
        )
      }
      control={
        <div className="flex items-center gap-1.5">
          {accelerator && !capturing && (
            <button
              onClick={() => void save(null)}
              className="rounded-lg px-2 py-1 text-body text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => {
              setProblem(null);
              setCapturing(true);
            }}
            onKeyDown={capturing ? capture : undefined}
            onBlur={() => setCapturing(false)}
            className={cn(
              "min-w-[132px] rounded-lg border px-3 py-1.5 text-body font-medium tabular-nums transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.96]",
              capturing
                ? "border-brand bg-brand-soft text-foreground"
                : "border-input text-foreground hover:border-foreground/25",
            )}
          >
            {capturing ? "Press the keys…" : (accelerator ?? "Not set")}
          </button>
        </div>
      }
    />
  );
}

interface SettingsPage {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
  /** Words people search for that the label does not say. */
  keywords: string;
}

/** Every page, grouped the way people look for them. Opened by id from
 * anywhere in the app: `toggleAppSettings` with a `page`. */
export const SETTINGS_PAGES: Array<{ group: string; pages: SettingsPage[] }> = [
  {
    group: "You",
    pages: [
      {
        id: "general",
        label: "General",
        icon: SlidersHorizontal,
        description: `How Bloks looks and behaves on ${thisComputer()}.`,
        keywords: "width transcript narrow medium wide column theme dark light appearance sidebar conversations threads shortcut quick ask hotkey summarise compaction compact idle cache long turn tokens quota skills suggest recall remember memory other conversations files changes cards shared folder agents turn limit consecutive chain reply replies stuck silent tool call interrupt queue messages while working steer correction",
      },
      {
        id: "about-you",
        label: "About you",
        icon: UserIcon,
        description: "Context every agent gets, so you don't repeat yourself.",
        keywords: "profile context personal instructions",
      },
      {
        id: "bring-setup",
        label: "Bring your setup",
        icon: Luggage,
        description: "Import instructions, skills and MCP servers from tools you already use. Keys stay behind.",
        keywords: "import migrate claude code codex openclaw hermes claude.md agents.md skills mcp memory rules move switch",
      },
    ],
  },
  {
    group: "Agents",
    pages: [
      {
        id: "engines",
        label: "Engines",
        icon: Cpu,
        description: "The AI tools and API keys your agents think with.",
        keywords: "models providers claude codex gemini grok openai api key cli sign in",
      },
      {
        id: "new-agents",
        label: "New agents",
        icon: UserPlus,
        description: "Defaults for every new agent.",
        keywords: "defaults folder hire approvals model effort",
      },
      {
        id: "rules",
        label: "Rules and approvals",
        icon: ShieldCheck,
        description: "When agents ask first, and what they never do.",
        keywords: "deny allow permissions safety approval gate full access auto ask conservative suggestions always allow habit",
      },
      {
        id: "security",
        label: "Security checkup",
        icon: ShieldAlert,
        description: "What can reach your keys, accounts and computer.",
        keywords: "security checkup audit risk full access pairing devices email webhooks secrets browser computer file permissions signed out",
      },
      {
        id: "voices",
        label: "Voices",
        icon: Mic,
        description: "Give agents a voice and take calls with them.",
        keywords: "speech elevenlabs openai tts call audio",
      },
    ],
  },
  {
    group: "Integrations",
    pages: [
      {
        id: "plugins",
        label: "Plugins",
        icon: Puzzle,
        description: "Manage apps, MCP servers and skills.",
        keywords: "apps connectors composio mcp servers skills agents tools integrations gmail slack github",
      },
      {
        id: "apps",
        label: "Apps and keys",
        icon: LayoutGrid,
        description: `Accounts and tools shared by every agent. Keys stay on ${thisComputer()}.`,
        keywords: "composio connect key api key box boat claude desktop",
      },
    ],
  },
  {
    group: "Connections",
    pages: [
      {
        id: "devices",
        label: "Phone and devices",
        icon: Smartphone,
        description: `Reach ${thisComputer()} from your phone and other devices.`,
        keywords: "iphone pairing remote relay qr",
      },
      {
        id: "chat",
        label: "Chat and email",
        icon: MessageCircle,
        description: "Talk to your agents from Telegram, Slack, Discord or email.",
        keywords: "telegram slack discord email mail",
      },
      {
        id: "cloud",
        label: "Bloks Cloud",
        icon: CloudIcon,
        description: "Your agents on the go, and the relay that carries them.",
        keywords: "subscription licence relay cloud",
      },
      {
        id: "computers",
        label: "Computers",
        icon: Monitor,
        description: `A private computer for agents, on ${thisComputer()} or in the cloud.`,
        keywords: "vm virtual machine local box sandbox desktop",
      },
    ],
  },
  {
    group: "Data",
    pages: [
      {
        id: "record",
        label: "Record",
        icon: History,
        description: "Everything that happened, signed and in order.",
        keywords: "ledger audit history log",
      },
      {
        id: "backups",
        label: "Backups",
        icon: Archive,
        description: "Copies of your workspace, daily or when you ask.",
        keywords: "backup restore archive copy export move new computer undo history passphrase encrypt seal daily automatic",
      },
      {
        id: "about",
        label: "About and updates",
        icon: Info,
        description: "Version, updates and feedback.",
        keywords: "version update feedback diagnostics bug",
      },
    ],
  },
];

const ALL_PAGES = SETTINGS_PAGES.flatMap((g) => g.pages);

function GeneralPage() {
  const { theme, setTheme } = useTheme();
  const [width, setWidth] = useTranscriptWidth();
  const [conversations, setConversations] = useConversationsView();
  return (
    <>
      <SettingsGroup title="Appearance">
        <SettingRow
          label="Theme"
          control={
            <Segmented
              aria-label="Theme"
              value={theme}
              onChange={setTheme}
              options={THEME_OPTIONS.map((o) => ({ value: o.value, label: <>{o.icon}{o.label}</> }))}
            />
          }
        />
        <SettingRow
          label="Accent"
          description="Your messages, the main buttons and selected things. From the Bloks logo."
          control={<AccentPicker />}
        />
        <SettingRow
          label="Transcript width"
          description="How wide chats get on this device."
          control={
            <Segmented
              aria-label="Transcript width"
              value={width}
              onChange={setWidth}
              options={[
                { value: "narrow", label: "Narrow" },
                { value: "medium", label: "Medium" },
                { value: "wide", label: "Wide" },
              ]}
            />
          }
        />
        <SettingRow
          label="Show conversations in the sidebar"
          description="List each agent's conversations under it."
          control={
            <Switch
              aria-label="Show conversations in the sidebar"
              checked={conversations}
              onCheckedChange={setConversations}
            />
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Working with agents">
        <QuickAskShortcut />
        <ProposeSkills />
        <RecallBeforeTurn />
        <AgentTurnLimit />
        <MidTurnMessages />
        <SharedChanges />
        <Compaction />
        <IdleCompaction />
        <BeforeTurnCompaction />
        <SilentCallLimit />
      </SettingsGroup>
    </>
  );
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
    <SettingsGroup title="How much agents ask">
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
        <div className="mt-2 text-small text-muted-foreground">
          Each agent can change this in its own settings. Shared rooms always ask.
        </div>
      </div>
    </SettingsGroup>
  );
}

function PageBody({ id }: { id: string }) {
  switch (id) {
    case "general":
      return <GeneralPage />;
    case "about-you":
      return <AboutYou />;
    case "bring-setup":
      return <BringYourSetupPage />;
    case "engines":
      return <EnginesPanel />;
    case "new-agents":
      return <AgentDefaults />;
    case "rules":
      return (
        <>
          <WorkspaceApprovals />
          <RulesPanel />
        </>
      );
    case "security":
      return <SecurityCheckup />;
    case "voices":
      return (
        <SettingsGroup title="Keys">
          <div className="flex flex-col gap-4 p-4">
            <ApiKeyRow section="elevenlabs" label="ElevenLabs API key" placeholder="sk_…" />
            <ApiKeyRow section="openaiSpeech" label="OpenAI API key (speech)" placeholder="sk-…" />
            <OpenAIKeyHint />
            <div className="text-small text-muted-foreground">Either key works. The Mac's own voices need none.</div>
          </div>
        </SettingsGroup>
      );
    case "plugins":
      return <PluginSettings />;
    case "apps":
      return (
        <>
          <SettingsGroup title="Keys">
            <div className="flex flex-col gap-4 p-4">
              <ApiKeyRow
                section="composio"
                label="Composio Connect key"
                placeholder="ck_…"
                info={{
                  text: "The Connect key starts with ck_ and links accounts like Slack and Gmail. It's checked when you save it.",
                  linkLabel: "Get a Connect key at composio.dev",
                  linkHref: "https://composio.dev",
                }}
              />
              <ApiKeyRow
                section="composioApi"
                label="Composio API key (optional)"
                placeholder="ak_…"
                info={{
                  text: "A project API key, starting with ak_. Only used to browse the full app catalog. Connections work without it.",
                }}
              />
              <ApiKeyRow
                section="box"
                label="Boat API key"
                placeholder="Paste your Boat API key"
                info={{
                  text: "Gives agents a private Linux computer in the cloud, with a desktop and terminal. Boat (formerly Box) is paid after its trial.",
                  linkLabel: "Open the Boat API key guide",
                  linkHref: "https://docs.boat.dev/api-keys",
                }}
              />
              <BoxSleep />
            </div>
          </SettingsGroup>
          {/* MCP servers are managed in Plugins now, beside apps and skills */}
          <UseFromOtherApps />
        </>
      );
    case "devices":
      return (
        <>
          <RemoteSection />
          <DevicesSection />
        </>
      );
    case "chat":
      return (
        <>
          <TelegramSection />
          <ChatSection />
        </>
      );
    case "cloud":
      return <CloudSection />;
    case "computers":
      return <LocalVmSection />;
    case "record":
      return <RecordPanel />;
    case "backups":
      return <BackupsSection />;
    case "about":
      return <AboutCard />;
    default:
      return null;
  }
}

export function AppSettingsPanel() {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const pageId = ALL_PAGES.some((p) => p.id === state.settingsPage) ? state.settingsPage : "general";
  const page = ALL_PAGES.find((p) => p.id === pageId)!;
  const close = () => dispatch({ type: "toggleAppSettings", open: false });
  const go = (id: string) => dispatch({ type: "toggleAppSettings", open: true, page: id });

  // a new page starts at its top, not wherever the last one was left
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [pageId]);

  // Escape leaves, unless something opened on top of the page takes it first
  useEscape(close);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (p: SettingsPage) =>
    words.every((w) => `${p.label} ${p.description} ${p.keywords}`.toLowerCase().includes(w));
  const groups = SETTINGS_PAGES.map((g) => ({ ...g, pages: g.pages.filter(matches) })).filter((g) => g.pages.length);
  // only what is risky earns a number in the list; worth a look waits on the page
  const risky = riskyCount(useSecurityCheckup().report);

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background md:flex-row">
      <nav
        aria-label="Settings"
        className="flex shrink-0 flex-col border-b bg-sidebar/60 md:w-[248px] md:border-b-0 md:border-r"
      >
        {/* No back button of its own: the title bar's Back (or Esc) leaves,
            and on a phone the pill's drawer does; the room on the left
            there is the pill's. */}
        <div className="flex h-[52px] items-center px-4 max-md:pl-16">
          <span className="text-lead font-semibold text-foreground">Settings</span>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-xl bg-accent/70 px-3 py-[7px] transition-colors duration-150 focus-within:bg-accent">
            <SearchIcon size={15} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                } else if (e.key === "Enter" && groups[0]) {
                  go(groups[0].pages[0].id);
                  setQuery("");
                }
              }}
              placeholder="Search settings"
              aria-label="Search settings"
              className="w-full bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="flex gap-0.5 overflow-x-auto px-2 pb-2 [scrollbar-width:none] md:flex-1 md:flex-col md:overflow-y-auto md:pb-4 [&::-webkit-scrollbar]:hidden">
          {groups.map((g) => (
            <div key={g.group} className="flex shrink-0 gap-0.5 md:flex-col">
              <div className="hidden px-2.5 pb-1 pt-3 text-small font-medium text-muted-foreground md:block">
                {g.group}
              </div>
              {g.pages.map((p) => {
                const Icon = p.icon;
                const on = p.id === pageId;
                return (
                  <button
                    key={p.id}
                    onClick={() => go(p.id)}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-body transition-[background-color,color] duration-150",
                      on
                        ? "bg-background font-medium text-foreground shadow-[0_0_0_0.5px_var(--border)]"
                        : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                    )}
                  >
                    <Icon size={16} className={on ? "text-foreground" : "text-muted-foreground"} />
                    {p.label}
                    {p.id === "security" && risky > 0 && (
                      <span
                        aria-label={`${risky} risky`}
                        className="ml-auto rounded-md bg-destructive/10 px-1.5 py-0.5 text-caption font-medium tabular-nums text-destructive"
                      >
                        {risky}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && (
            <div className="px-3 py-6 text-body text-muted-foreground">Nothing matches “{query.trim()}”.</div>
          )}
        </div>
      </nav>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {/* Plugins draws its own header, with its tools, and lists that
            want the room of a wider column */}
        <div className={cn("mx-auto w-full px-5 pb-16 pt-8 md:px-10", pageId === "plugins" ? "max-w-[960px]" : "max-w-[760px]")}>
          {pageId !== "plugins" && <SettingsPageHeader title={page.label} description={page.description} />}
          <div className="[&>div:first-child]:mt-0">
            <PageBody id={pageId} />
          </div>
        </div>
      </div>
    </main>
  );
}
