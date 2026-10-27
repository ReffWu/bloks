// Settings, Behaviour: how agents remember, take turns and recover, for
// every agent in this workspace that has not chosen for itself.
//
// These lived under General once, a dozen switches deep beneath the
// theme. They are about the agents, not about how Bloks looks, so they
// have a page of their own in the Agents group, in short groups that say
// what each is for: what agents carry between conversations, how a turn
// behaves while it runs and what it leaves running after, who handles a
// failure, and what happens to a conversation that grows long.
import { useEffect, useState } from "react";
import { api, useStore } from "@/state/store";
import { DEFAULT_TURN_LIMIT, MAX_TASK_BUDGET, MAX_TURN_LIMIT, MIN_TURN_LIMIT } from "@/lib/turn-limit";
import { DELIVERY_MODES, modeWords, type DeliveryMode } from "@/lib/deliveryModes";
import { BACKGROUND_WORK, type BackgroundWork as BackgroundChoice } from "@/lib/backgroundWork";
import { cn } from "@/lib/cn";
import { rowKey } from "@/lib/settingsPages";
import { Segmented } from "@/components/ui/segmented";
import { Slider, numberStops } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsGroup, SettingsSelect } from "../SettingsLayout";

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
      description="Agents stop after this many replies to each other, so they can't use up your plan on their own. Your next message resets the count."
      error={error}
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
    </SettingRow>
  );
}

/**
 * The turns in a row the person allows across separate tasks (GitHub
 * 326). Off until they choose a number. Then each task an agent names
 * when it hands work on gets the limit above to itself, and all of them
 * together stop here, however the work is named. Only the person sets
 * it; an agent is refused the settings route.
 */
function TaskBudget() {
  const { state, dispatch } = useStore();
  const limit = state.config?.agents?.turnLimit ?? DEFAULT_TURN_LIMIT;
  const stored = state.config?.agents?.taskBudget ?? null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = (taskBudget: number | null) => {
    setSaving(true);
    setError("");
    api("/api/config", { method: "PUT", body: JSON.stringify({ agents: { taskBudget } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't save the budget."))
      .finally(() => setSaving(false));
  };
  // only numbers past the limit mean anything, and the one chosen stays
  // listed even after the limit is raised past it
  const choices = [...new Set([...TASK_BUDGET_CHOICES.filter((n) => n > limit), ...(stored !== null ? [stored] : [])])].sort((a, b) => a - b);
  const description =
    stored === null
      ? "Off. The limit above counts every reply in a row, whatever the task."
      : stored <= limit
        ? "No higher than the limit above, so that limit still counts every reply in a row."
        : `Each task agents name gets ${limit} ${limit === 1 ? "reply" : "replies"} in a row, and all of them together stop at ${stored}.`;
  return (
    <SettingRow
      label="Separate tasks"
      info="Agents can name the task when they hand work on. With this set, a reviewer moving from one task to the next isn't stopped as if it were one long exchange. Calling the same work by another name doesn't get past the total, and your next message resets both counts."
      description={description}
      error={error}
      control={
        <SettingsSelect
          aria-label="Most agent replies in a row across separate tasks"
          value={stored === null ? "off" : String(stored)}
          disabled={saving}
          onChange={(e) => save(e.target.value === "off" ? null : Number(e.target.value))}
          className="w-[220px]"
        >
          <option value="off">Off</option>
          {choices.map((n) => (
            <option key={n} value={n}>
              {n} replies in total
            </option>
          ))}
        </SettingsSelect>
      }
    />
  );
}

/**
 * The incident desk (server/incidents.ts): whether a failure is handed to
 * whoever leads, and who that is outside a room. On, since what it saves
 * is the person finding out late; a room's own lead always goes first.
 */
function IncidentDesk() {
  const { state, dispatch } = useStore();
  const desk = state.config?.incidents ?? { enabled: true, lead: "auto" };
  const agents = state.bots.filter((b) => !b.hidden && !b.archivedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = (incidents: { enabled?: boolean; lead?: string }) => {
    setSaving(true);
    setError("");
    api("/api/config", { method: "PUT", body: JSON.stringify({ incidents }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't save that."))
      .finally(() => setSaving(false));
  };

  return (
    <>
      <SettingRow
        label="Incident desk"
        info="When a reply fails, a tool call gets stuck, or a routine, watcher or workflow fails, whoever leads gets a quiet turn to deal with it: try it once more, pass it to a teammate, or ask you. Nothing is tried again more than once, and if many things fail in an hour you get one summary instead of a card each."
        description="Hand failures to a lead, and show you what needs you."
        control={<Switch aria-label="Incident desk" checked={desk.enabled} disabled={saving} onCheckedChange={(enabled) => save({ enabled })} />}
        error={error}
      />
      {desk.enabled && (
        <SettingRow
          label="Who leads incidents"
          description="In a room, the room's lead goes first. Elsewhere, this."
          control={
            <SettingsSelect
              aria-label="Who leads incidents"
              value={desk.lead}
              disabled={saving}
              onChange={(e) => save({ lead: e.target.value })}
              className="w-[220px]"
            >
              <option value="auto">The most senior agent</option>
              <option value="person">Always me</option>
              {agents.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SettingsSelect>
          }
        />
      )}
    </>
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
      error={error}
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
    </SettingRow>
  );
}

/** An engine a room on Auto could ask (GET /api/room-router). */
interface RouterChoice {
  id: string;
  name: string;
  kind: string;
  model: string | null;
  small: boolean;
  ready: boolean;
  /** Bloks AI, which is paid from the plan's allowance. */
  allowance: boolean;
}

/** What one choice costs, said before it is made. */
function routerCost(choice: RouterChoice | null): string {
  if (!choice) {
    return "A small model from an engine the room's agents already use, so its messages go nowhere new. One short call for each message that names nobody.";
  }
  const model = choice.model ?? "its model";
  if (choice.allowance) return `One short call to ${choice.name} for each message that names nobody, from your Bloks AI allowance.`;
  if (choice.kind === "claudeAgent") {
    return `One short call to ${model} for each message that names nobody, on your Claude plan. Each call starts Claude Code, which can take longer than Auto waits; then the lead answers.`;
  }
  if (choice.small) return `One short call to ${model} for each message that names nobody, billed to your ${choice.name} key. A small model: usually a fraction of a cent.`;
  return `One short call to ${model} for each message that names nobody, billed like any other use of ${choice.name}. Not a small model, so it costs more and may be slower.`;
}

/**
 * Which engine a room set to Auto asks to pick who answers
 * (server/room-route.ts). The room's own engines unless changed: the
 * words go nowhere they were not already going, and a person who wants
 * one fast model for every room can name it here.
 */
function RoomRouter() {
  const { state, dispatch } = useStore();
  const chosen = state.config?.rooms?.router ?? null;
  const [choices, setChoices] = useState<RouterChoice[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api("/api/room-router")
      .then((r: { choices?: RouterChoice[] }) => live && setChoices(r.choices ?? []))
      .catch(() => live && setChoices([]));
    return () => {
      live = false;
    };
  }, []);
  const save = (router: string | null) => {
    setSaving(true);
    setError("");
    api("/api/config", { method: "PUT", body: JSON.stringify({ rooms: { router } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't save that."))
      .finally(() => setSaving(false));
  };
  const picked = chosen ? (choices?.find((c) => c.id === chosen) ?? null) : null;
  // an engine chosen and since removed still shows, so the row says why
  // every Auto room is on its lead
  const gone = Boolean(chosen && choices && !picked);
  return (
    <SettingRow
      label="Auto picks with"
      info="In a room set to Auto, a message that names nobody goes first to a small model, which picks who answers from each agent's name, role and brief and the last few messages. It has 2.5 seconds; if it runs out, is unsure or can't be reached, the lead answers. Naming someone with @ never asks it."
      description={gone ? "That engine is no longer here, so Auto rooms are on their lead. Choose another." : routerCost(picked)}
      error={error}
      control={
        <SettingsSelect
          aria-label="Auto picks with"
          value={chosen ?? "room"}
          disabled={saving || choices === null}
          onChange={(e) => save(e.target.value === "room" ? null : e.target.value)}
          className="w-[220px]"
        >
          <option value="room">The room's own engines</option>
          {gone && chosen && <option value={chosen}>An engine since removed</option>}
          {(choices ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.model ? `${c.name}, ${c.model}` : c.name}
              {c.ready ? "" : " (not signed in)"}
            </option>
          ))}
        </SettingsSelect>
      }
    />
  );
}

/**
 * What happens to the subagents and commands an agent starts in the
 * background once its reply is done (server/background-work.ts), for
 * every agent that has not chosen for itself. Let it finish unless
 * changed. A choice with a line under each, as the workspace's own
 * notification levels are, since the two do very different things.
 */
function BackgroundWork() {
  const { state, dispatch } = useStore();
  const chosen = state.config?.turns?.backgroundWork ?? "finish";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = (backgroundWork: BackgroundChoice) => {
    setSaving(true);
    setError("");
    api("/api/config", { method: "PUT", body: JSON.stringify({ turns: { backgroundWork } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't save that."))
      .finally(() => setSaving(false));
  };
  return (
    <SettingsGroup
      title="Background work an agent starts"
      footnote={
        <>
          For agents on Claude Code. While it waits, what you send goes into that turn or waits for it like any other, and a
          background task that makes no progress for the time under Stop stuck tool calls is stopped. Each agent can choose for
          itself in its own settings.
          {error && <span className="mt-1 block text-destructive">{error}</span>}
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label="Background work an agent starts"
        data-setting-row={rowKey("Background work an agent starts")}
        className="flex flex-col divide-y transition-colors duration-700"
      >
        {BACKGROUND_WORK.map((choice) => {
          const on = chosen === choice.value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={saving}
              onClick={() => !on && save(choice.value)}
              className="flex items-center gap-4 px-5 py-4 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/60 disabled:opacity-60"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                  on ? "border-brand-ink bg-brand-ink" : "border-input",
                )}
              >
                {on && <span className="size-1.5 rounded-full bg-brand-foreground" />}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-ui font-medium text-foreground">{choice.label}</span>
                <span className="text-pretty text-body text-muted-foreground">{choice.says}</span>
              </span>
            </button>
          );
        })}
      </div>
    </SettingsGroup>
  );
}

const TURN_LIMIT_STOPS = numberStops(MIN_TURN_LIMIT, MAX_TURN_LIMIT, (n) => `${n} ${n === 1 ? "reply" : "replies"}`);
/** What the budget across separate tasks offers, past whatever the limit is. */
const TASK_BUDGET_CHOICES = [24, 36, 48, 60, 80, MAX_TASK_BUDGET];

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

/**
 * Whether each agent's memory is tidied once a night (server/memory-tidy.ts).
 * On, like recall: notes past their date cost nothing to remove, and the
 * rest is one small model call a night for an agent whose memory moved.
 * What it did is in each agent's Memory page, with Undo.
 */
function MemoryTidy() {
  const { state, dispatch } = useStore();
  const on = state.config?.memory?.tidy ?? true;
  const [saving, setSaving] = useState(false);

  const set = (tidy: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ memory: { tidy } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label="Tidy memory every night"
      info="Between 1 and 5 in the morning, while an agent is idle: notes marked (until a date) go after that date, repeats are merged, and anything contradicted moves to an archive with why. Each night's changes are in that agent's Memory page, with Undo, and the morning brief mentions them."
      description="Keep each agent's notes short and current while you sleep."
      control={<Switch aria-label="Tidy memory every night" checked={on} disabled={saving} onCheckedChange={set} />}
    />
  );
}

export function BehaviourPage() {
  return (
    <>
      <SettingsGroup title="Memory and learning">
        <RecallBeforeTurn />
        <MemoryTidy />
        <ProposeSkills />
      </SettingsGroup>
      <SettingsGroup title="While an agent works">
        <MidTurnMessages />
        <AgentTurnLimit />
        <TaskBudget />
        <SilentCallLimit />
        <SharedChanges />
      </SettingsGroup>
      <BackgroundWork />
      <SettingsGroup title="Rooms" footnote="Each room chooses who answers in its own menu: everyone, only the lead, or Auto.">
        <RoomRouter />
      </SettingsGroup>
      <SettingsGroup title="When something fails">
        <IncidentDesk />
      </SettingsGroup>
      <SettingsGroup
        title="Long conversations"
        footnote="Your own messages are never summarised. Where a conversation was compacted, it says so."
      >
        <BeforeTurnCompaction />
        <Compaction />
        <IdleCompaction />
      </SettingsGroup>
    </>
  );
}
