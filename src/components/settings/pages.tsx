// The smaller Settings pages, each a group or two: what agents know about
// you, their voices, when they ask, the keys every agent shares, and the
// computer they work on. The bigger ones have files of their own beside
// this one.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { t } from "@/lib/i18n";

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
        label={t("pages.whatEveryAgentKnowsAbout")}
        htmlFor="about-you"
        description={`Optional. Stays on ${thisComputer()} and is never shown to people in your rooms.`}
        control={<SavedMark on={justSaved} />}
      >
        <Textarea
          id="about-you"
          value={value}
          onChange={(e) => save(e.target.value)}
          placeholder={t("pages.imAFounderBuildingA")}
          className="mt-3 min-h-[120px] resize-y text-body"
        />
        {/* the same field Memory's About you edits, beside the notes your
            agents suggested; one value, either place */}
        <button
          type="button"
          onClick={() => dispatch({ type: "openMemory", target: "you" })}
          className="mt-2.5 rounded text-body text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("pages.seeWhatAgentsHaveLearned")}
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
          {t("pages.bloksCanUseItFor")}
        </div>
        <Button size="sm" variant="brand" className="mt-2" onClick={() => setConsent(true)}>
          {t("pages.useThatKeyForVoices")}
        </Button>
      </div>
    );
  }
  if (speech?.openaiSource) {
    return (
      <div className="mt-2 flex items-center gap-2 text-small text-success">
        Using the API key from {sourceName(speech.openaiSource)} for voices.
        <button type="button" className="rounded text-muted-foreground underline hover:text-foreground" onClick={() => setConsent(false)}>
          {t("pages.stopUsingIt")}
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
    <SettingsGroup title={t("pages.howMuchAgentsAsk")} footnote={t("pages.eachAgentCanChangeThis")}>
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
  const grok = state.config?.speech?.xaiSource === "grok";
  return (
    <>
      <SettingsGroup
        title={t("pages.keys")}
        footnote={mac ? t("pages.anyOneKeyWorksThe") : t("pages.anyOneKeyWorksMac")}
      >
        <ApiKeyRow section="elevenlabs" label={t("pages.elevenlabsApiKey")} placeholder={t("pages.sk")} />
        <ApiKeyRow section="openaiSpeech" label={t("pages.openaiApiKey")} description={t("pages.usedForSpeechOnly")} placeholder={t("pages.skEllipsis")}>
          <OpenAIKeyHint />
        </ApiKeyRow>
        <ApiKeyRow
          section="fishSpeech"
          label={t("pages.fishAudioApiKey")}
          description={t("pages.yourOwnClonedVoicesAnd")}
          placeholder={t("pages.pasteYourKey")}
          info={{
            text: "Make a key in your Fish Audio account's API section. Voices you made there show first in each agent's voice list.",
            linkLabel: "Get a key at fish.audio",
            linkHref: "https://fish.audio",
          }}
        />
        <ApiKeyRow
          section="xaiSpeech"
          label={t("pages.xaiApiKey")}
          description={grok ? t("pages.optionalVoicesUseYourGrok") : t("pages.groksVoicesAGrokKey")}
          placeholder={t("pages.xai")}
        />
      </SettingsGroup>
      <SettingsGroup title={t("pages.onYourOwnMachine")} footnote={t("pages.repliesReadAloudGoOnly")}>
        <ChatterboxRow />
      </SettingsGroup>
    </>
  );
}

/**
 * Where a Chatterbox server listens, on this computer or the local
 * network. Not a key, so it is shown back once saved; the server checks
 * the address is local before keeping it, and says why when it is not.
 */
function ChatterboxRow() {
  const { state, dispatch } = useStore();
  const saved = state.config?.speech?.chatterboxUrl ?? "";
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = Boolean(state.config) && (!saved || editing);

  const put = (url: string) => {
    setBusy(true);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ speech: { chatterboxUrl: url } }) })
      .then((status) => {
        dispatch({ type: "configStatus", config: status });
        setEditing(false);
        setValue("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div data-setting-row="chatterbox-server" className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-[220px]">
          <label htmlFor="chatterbox-url" className="text-ui font-medium text-foreground">
            {t("pages.chatterboxServer")}
          </label>
          <div className="mt-0.5 text-pretty text-body text-muted-foreground">
            {saved ? (
              <code className="font-mono text-small text-foreground">{saved}</code>
            ) : (
              t("pages.aChatterboxServerYouRun")
            )}
          </div>
        </div>
        {saved && (
          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            <span aria-live="polite" className="mr-2 inline-flex items-center gap-1.5 text-small font-medium text-success">
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              Saved
            </span>
            {!editing && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setValue(saved); setEditing(true); }}>
                {t("common.change")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => put("")}
              aria-label={t("pages.removeTheChatterboxServer")}
              className="hover:bg-destructive/10 hover:text-destructive"
            >
              {t("common.remove")}
            </Button>
          </div>
        )}
      </div>
      {open && (
        <div className="mt-3 flex gap-2">
          <Input
            id="chatterbox-url"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) put(value.trim());
              if (e.key === "Escape" && editing) {
                e.preventDefault();
                setEditing(false);
              }
            }}
            placeholder="http://localhost:4123"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            className="h-8 min-w-0 flex-1 font-mono text-body"
          />
          <Button variant={value.trim() ? "brand" : "secondary"} onClick={() => put(value.trim())} disabled={busy || !value.trim()}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : t("common.save")}
          </Button>
          {editing && (
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-small text-destructive">
          {error}
        </p>
      )}
    </div>
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
      <SettingsGroup title="Composio" footnote={t("pages.keysStayOnThisComputer")}>
        <ApiKeyRow
          section="composio"
          label={t("pages.composioConnectKey")}
          description={t("pages.linksAccountsLikeSlackAnd")}
          placeholder={t("pages.ck")}
          info={{
            text: "The Connect key starts with ck_. It's checked when you save it.",
            linkLabel: "Get a Connect key at composio.dev",
            linkHref: "https://composio.dev",
          }}
        />
        <ApiKeyRow
          section="composioApi"
          label={t("pages.composioApiKey")}
          description={t("pages.optionalLetsYouBrowseThe")}
          placeholder={t("pages.ak")}
          info={{
            text: "A project API key, starting with ak_. Connections work without it. App watchers need it, and watch the accounts connected in that project.",
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
      <SettingsGroup title={t("pages.thisMachine")}>
        <SettingRow
          label={t("pages.browserAndVirtualDesktop")}
          description={
            state.config.hosted.desktop
              ? t("pages.agentsWorkInThisMachines")
              : t("pages.agentsWorkInThisMachinesBrowser")
          }
        />
        <SettingRow label={t("pages.cloudComputerAndLocalVm")} description={t("pages.notOfferedHereThisMachine")} />
      </SettingsGroup>
    );
  }
  return (
    <>
      <LocalVmSection />
      <SettingsGroup title={t("pages.cloudComputer")} footnote={t("pages.boatIsPaidAfterIts")}>
        <ApiKeyRow
          section="box"
          label={t("pages.boatApiKey")}
          description={t("pages.aPrivateLinuxComputerIn")}
          placeholder={t("pages.pasteYourBoatApiKey")}
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
