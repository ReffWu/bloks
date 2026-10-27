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
import { inEnglish, t } from "@/lib/i18n";

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
      label={t("behaviourPage.summariseAsYouGo")}
      info={t("behaviourPage.longChatsGetSummarisedTo")}
      description={t("behaviourPage.summariseALittleAfterEach")}
      control={<Switch aria-label={t("behaviourPage.summariseAsYouGo")} checked={on} disabled={saving} onCheckedChange={set} />}
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
      label={t("behaviourPage.compactWhileIdle")}
      info={t("behaviourPage.claudeCodeKeepsAChat")}
      description={t("behaviourPage.compactLongClaudeCodeChats")}
      control={<Switch aria-label={t("behaviourPage.compactWhileIdle")} checked={on} disabled={saving} onCheckedChange={set} />}
    />
  );
}

// smallest to largest, with Never as the far end of "later": a slider
// reads left to right as sooner to never
const beforeTurnCeilings = () => [
  { value: "100000", label: "100k" },
  { value: "200000", label: "200k" },
  { value: "400000", label: "400k" },
  { value: "0", label: t("behaviourPage.never") },
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
      label={t("behaviourPage.showOtherChangedFiles")}
      description={t("behaviourPage.alsoShowFilesThatChanged")}
      control={<Switch aria-label={t("behaviourPage.showOtherChangedFiles")} checked={on} disabled={saving} onCheckedChange={set} />}
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
  const ceilings = beforeTurnCeilings();

  const set = (next: string) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ compaction: { beforeTurn: Number(next) } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label={t("behaviourPage.compactLongChats")}
      info={t("behaviourPage.claudeCodeCodexAndPi")}
      description={t("behaviourPage.forClaudeCodeCodexAnd")}
    >
      <div className="mt-3">
        <Slider
          aria-label={t("behaviourPage.compactLongChats")}
          className="max-w-[420px]"
          stops={ceilings}
          value={ceilings.some((o) => o.value === ceiling) ? ceiling : "200000"}
          onCommit={(next) => !saving && set(next)}
        />
      </div>
    </SettingRow>
  );
}

const silentCallLimits = () => [
  { value: "5", label: t("behaviourPage.minutesShort", { count: 5 }) },
  { value: "15", label: t("behaviourPage.minutesShort", { count: 15 }) },
  { value: "30", label: t("behaviourPage.minutesShort", { count: 30 }) },
  { value: "60", label: t("behaviourPage.hours", { count: 1 }) },
  { value: "0", label: t("behaviourPage.never") },
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
  const limits = silentCallLimits();

  const set = (next: string) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ turns: { stallMinutes: Number(next) } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <SettingRow
      label={t("behaviourPage.stopStuckToolCalls")}
      info={t("behaviourPage.sometimesACommandWaitsOn")}
      description={t("behaviourPage.stopWhenOneCallMakes")}
    >
      <div className="mt-3">
        <Slider
          aria-label={t("behaviourPage.stopStuckToolCalls")}
          className="max-w-[420px]"
          stops={limits}
          value={limits.some((o) => o.value === minutes) ? minutes : "15"}
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
  const learn: SkillLearning = state.config?.skills?.learn ?? (state.config?.skills?.propose ? "suggest" : "off");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (next: SkillLearning) => {
    setSaving(true);
    setError("");
    api("/api/config", { method: "PUT", body: JSON.stringify({ skills: { learn: next } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("behaviourPage.couldntSaveThat")))
      .finally(() => setSaving(false));
  };
  const options = skillLearning();

  return (
    <SettingRow
      label={t("behaviourPage.suggestSkills")}
      info={t("behaviourPage.nothingChangesOnItsOwn")}
      description={options.find((o) => o.value === learn)?.says}
      error={error}
    >
      <div className="mt-3 max-w-[460px]">
        <Segmented<SkillLearning>
          aria-label={t("behaviourPage.suggestSkills")}
          size="sm"
          value={learn}
          onChange={(next) => !saving && next !== learn && set(next)}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
        />
      </div>
    </SettingRow>
  );
}

type SkillLearning = "off" | "suggest" | "more";

/** The three settings, and what each costs. The ceilings are the
 * server's DAILY_REVIEWS (server/proposals.ts). */
const skillLearning = (): Array<{ value: SkillLearning; label: string; says: string }> => [
  { value: "off", label: t("common.off"), says: t("behaviourPage.learn.offSays") },
  { value: "suggest", label: t("behaviourPage.learn.suggest"), says: t("behaviourPage.learn.suggestSays", { count: 20 }) },
  { value: "more", label: t("behaviourPage.learn.more"), says: t("behaviourPage.learn.moreSays", { count: 60 }) },
];

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
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("behaviourPage.couldntSaveLimit")))
      .finally(() => setSaving(false));
  };
  return (
    <SettingRow
      label={t("behaviourPage.agentToAgentLimit")}
      description={t("behaviourPage.agentsStopAfterThisMany")}
      error={error}
    >
      <div className="mt-3">
        <Slider
          aria-label={t("behaviourPage.mostAgentRepliesInA")}
          className="max-w-[460px]"
          stops={turnLimitStops()}
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
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("behaviourPage.couldntSaveBudget")))
      .finally(() => setSaving(false));
  };
  // only numbers past the limit mean anything, and the one chosen stays
  // listed even after the limit is raised past it
  const choices = [...new Set([...TASK_BUDGET_CHOICES.filter((n) => n > limit), ...(stored !== null ? [stored] : [])])].sort((a, b) => a - b);
  const description =
    stored === null
      ? t("behaviourPage.budget.off")
      : stored <= limit
        ? t("behaviourPage.budget.noHigher")
        : t("behaviourPage.budget.each", { count: limit, total: stored });
  return (
    <SettingRow
      label={t("behaviourPage.separateTasks")}
      info={t("behaviourPage.agentsCanNameTheTask")}
      description={description}
      error={error}
      control={
        <SettingsSelect
          aria-label={t("behaviourPage.mostAgentRepliesInARow")}
          value={stored === null ? "off" : String(stored)}
          disabled={saving}
          onChange={(e) => save(e.target.value === "off" ? null : Number(e.target.value))}
          className="w-[220px]"
        >
          <option value="off">{t("common.off")}</option>
          {choices.map((n) => (
            <option key={n} value={n}>
              {t("behaviourPage.repliesInTotal", { count: n })}
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
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("behaviourPage.couldntSaveThat")))
      .finally(() => setSaving(false));
  };

  return (
    <>
      <SettingRow
        label={t("behaviourPage.incidentDesk")}
        info={t("behaviourPage.whenAReplyFailsA")}
        description={t("behaviourPage.handFailuresToALead")}
        control={<Switch aria-label={t("behaviourPage.incidentDesk")} checked={desk.enabled} disabled={saving} onCheckedChange={(enabled) => save({ enabled })} />}
        error={error}
      />
      {desk.enabled && (
        <SettingRow
          label={t("behaviourPage.whoLeadsIncidents")}
          description={t("behaviourPage.inARoomTheRooms")}
          control={
            <SettingsSelect
              aria-label={t("behaviourPage.whoLeadsIncidents")}
              value={desk.lead}
              disabled={saving}
              onChange={(e) => save({ lead: e.target.value })}
              className="w-[220px]"
            >
              <option value="auto">{t("behaviourPage.theMostSeniorAgent")}</option>
              <option value="person">{t("behaviourPage.alwaysMe")}</option>
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
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("behaviourPage.couldntSaveThat")))
      .finally(() => setSaving(false));
  };
  return (
    <SettingRow
      label={t("behaviourPage.messagesWhileAnAgentWorks")}
      info={t("behaviourPage.aStopStopsTheAgent")}
      description={modeWords(mode).says}
      error={error}
    >
      <div className="mt-3 max-w-[460px]">
        <Segmented<DeliveryMode>
          aria-label={t("behaviourPage.messagesWhileAnAgentWorks")}
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
          <span className="text-body text-muted-foreground">{t("behaviourPage.whenUnsureAskTheAgents")}</span>
          <Switch
            aria-label={t("behaviourPage.whenUnsureAskTheAgents")}
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
  if (!choice) return t("behaviourPage.router.room");
  const model = choice.model ?? t("behaviourPage.router.itsModel");
  if (choice.allowance) return t("behaviourPage.router.allowance", { name: choice.name });
  if (choice.kind === "claudeAgent") return t("behaviourPage.router.claude", { model });
  if (choice.small) return t("behaviourPage.router.small", { model, name: choice.name });
  return t("behaviourPage.router.large", { model, name: choice.name });
}

/** A choice as its option says it: the engine, and its model when it has one. */
const routerName = (c: RouterChoice) => (c.model ? t("behaviourPage.router.engineModel", { name: c.name, model: c.model }) : c.name);

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
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("behaviourPage.couldntSaveThat")))
      .finally(() => setSaving(false));
  };
  const picked = chosen ? (choices?.find((c) => c.id === chosen) ?? null) : null;
  // an engine chosen and since removed still shows, so the row says why
  // every Auto room is on its lead
  const gone = Boolean(chosen && choices && !picked);
  return (
    <SettingRow
      label={t("behaviourPage.autoPicksWith")}
      info={t("behaviourPage.inARoomSetTo")}
      description={gone ? t("behaviourPage.thatEngineIsNoLonger") : routerCost(picked)}
      error={error}
      control={
        <SettingsSelect
          aria-label={t("behaviourPage.autoPicksWith")}
          value={chosen ?? "room"}
          disabled={saving || choices === null}
          onChange={(e) => save(e.target.value === "room" ? null : e.target.value)}
          className="w-[220px]"
        >
          <option value="room">{t("behaviourPage.theRoomsOwnEngines")}</option>
          {gone && chosen && <option value={chosen}>{t("behaviourPage.anEngineSinceRemoved")}</option>}
          {(choices ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.ready ? routerName(c) : t("behaviourPage.notSignedIn", { choice: routerName(c) })}
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
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("behaviourPage.couldntSaveThat")))
      .finally(() => setSaving(false));
  };
  return (
    <SettingsGroup
      title={t("behaviourPage.backgroundWorkAnAgentStarts")}
      footnote={
        <>
          {t("behaviourPage.backgroundFootnote")}
          {error && <span className="mt-1 block text-destructive">{error}</span>}
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label={t("behaviourPage.backgroundWorkAnAgentStarts")}
        data-setting-row={rowKey(inEnglish("behaviourPage.backgroundWorkAnAgentStarts"))}
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
                <span className="text-ui font-medium text-foreground">{t(choice.label)}</span>
                <span className="text-pretty text-body text-muted-foreground">{t(choice.says)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </SettingsGroup>
  );
}

const turnLimitStops = () => numberStops(MIN_TURN_LIMIT, MAX_TURN_LIMIT, (n) => t("behaviourPage.replies", { count: n }));
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
      label={t("behaviourPage.bringUpOtherConversations")}
      info={t("behaviourPage.bloksSearchesTheAgentsOther")}
      description={t("behaviourPage.remindAnAgentWhatIt")}
      control={<Switch aria-label={t("behaviourPage.bringUpOtherConversations")} checked={on} disabled={saving} onCheckedChange={set} />}
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
      label={t("behaviourPage.tidyMemoryEveryNight")}
      info={t("behaviourPage.between1And5In")}
      description={t("behaviourPage.keepEachAgentsNotesShort")}
      control={<Switch aria-label={t("behaviourPage.tidyMemoryEveryNight")} checked={on} disabled={saving} onCheckedChange={set} />}
    />
  );
}

export function BehaviourPage() {
  return (
    <>
      <SettingsGroup title={t("behaviourPage.memoryAndLearning")}>
        <RecallBeforeTurn />
        <MemoryTidy />
        <ProposeSkills />
      </SettingsGroup>
      <SettingsGroup title={t("behaviourPage.whileAnAgentWorks")}>
        <MidTurnMessages />
        <AgentTurnLimit />
        <TaskBudget />
        <SilentCallLimit />
        <SharedChanges />
      </SettingsGroup>
      <BackgroundWork />
      <SettingsGroup title={t("behaviourPage.rooms")} footnote={t("behaviourPage.eachRoomChoosesWhoAnswers")}>
        <RoomRouter />
      </SettingsGroup>
      <SettingsGroup title={t("behaviourPage.whenSomethingFails")}>
        <IncidentDesk />
      </SettingsGroup>
      <SettingsGroup
        title={t("behaviourPage.longConversations")}
        footnote={t("behaviourPage.yourOwnMessagesAreNever")}
      >
        <BeforeTurnCompaction />
        <Compaction />
        <IdleCompaction />
      </SettingsGroup>
    </>
  );
}
