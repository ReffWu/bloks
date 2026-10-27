// Home Assistant, both ways: agents that can see the home and change it
// with the owner's leave, and the home starting an agent.
//
// The order is the order of trust. First the connection, which proves an
// address and a token work and keeps the token on this computer. Then the
// list, because nothing is visible to an agent until it is on it. Then
// which agents may use it at all. Last, the other direction, which needs
// nothing from the list: Home Assistant posts to an agent's webhook.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Check, Copy, ExternalLink, House, Loader2, Search as SearchIcon } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { Checklist, ConnectionError, ConnectionHeader, ConnectionNote, HealthLine, PairedMoment, SecretField, StepNote, useJustHappened, type Step } from "./ConnectionKit";
import { SettingRow, SettingsCard, SettingsGroup, SettingsSelect, SettingsSkeleton } from "./SettingsLayout";
import { formatLocale, t, type MessageKey } from "@/lib/i18n";

interface Status {
  configured: boolean;
  enabled: boolean;
  url: string | null;
  name: string | null;
  version: string | null;
  entities: string[];
  domains: string[];
  auto: string[];
  agents: string[];
  mcp: boolean;
  hooks?: Record<string, boolean>;
}

interface Entity {
  entity_id: string;
  domain: string;
  name: string;
  state: string;
  area?: string;
  alwaysAsks: boolean;
}

/** The server's own check: a long-lived token is a JWT. */
const TOKEN = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

/** Domains worth offering whole, in the words people use for them. */
const DOMAIN_NAMES: Record<string, MessageKey> = {
  light: "homeAssistantPage.domain.light",
  switch: "homeAssistantPage.domain.switch",
  sensor: "homeAssistantPage.domain.sensor",
  binary_sensor: "homeAssistantPage.domain.binarySensor",
  climate: "homeAssistantPage.domain.climate",
  cover: "homeAssistantPage.domain.cover",
  lock: "homeAssistantPage.domain.lock",
  alarm_control_panel: "homeAssistantPage.domain.alarmControlPanel",
  media_player: "homeAssistantPage.domain.mediaPlayer",
  fan: "homeAssistantPage.domain.fan",
  scene: "homeAssistantPage.domain.scene",
  script: "homeAssistantPage.domain.script",
  vacuum: "homeAssistantPage.domain.vacuum",
  weather: "homeAssistantPage.domain.weather",
  person: "homeAssistantPage.domain.person",
  camera: "homeAssistantPage.domain.camera",
};

/** A domain in the people's words, or its own id for one not named here. */
function domainName(domain: string): string {
  return DOMAIN_NAMES[domain] ? t(DOMAIN_NAMES[domain]) : domain;
}

export function HomeAssistantPage() {
  const { state } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api("/api/home").then(setStatus).catch((e) => setError(e.message));
  }, []);

  const justConnected = useJustHappened(status ? status.configured : undefined);

  const post = (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    return api("/api/home", { method: "POST", body: JSON.stringify(body) })
      .then((next: Status) => {
        setStatus((before) => ({ ...next, hooks: before?.hooks }));
        setToken("");
        setEditing(false);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (!status) return error ? <ConnectionError>{error}</ConnectionError> : <SettingsSkeleton rows={2} />;

  const connect = () => {
    if (busy || !url.trim() || !TOKEN.test(token.trim())) return;
    void post({ url: url.trim(), token: token.trim() });
  };
  const tokenOk = TOKEN.test(token.trim());
  const fields = (
    <div className="flex max-w-[460px] flex-col gap-2">
      <div>
        <label htmlFor="home-url" className="mb-1 block text-small text-muted-foreground">{t("common.address")}</label>
        <Input id="home-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" spellCheck={false} className="h-8 font-mono text-small" />
      </div>
      <SecretField id="home-token" label={t("homeAssistantPage.longLivedAccessToken")} value={token} onChange={setToken} shape={TOKEN} hint={t("homeAssistantPage.aLongStringInThree")} placeholder={t("common.pasteTheToken")} onEnter={connect} />
      <div>
        <Button variant="brand" size="sm" disabled={busy || !url.trim() || !tokenOk} onClick={connect}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {busy ? t("homeAssistantPage.checkingWithHomeAssistant") : t("common.connect")}
        </Button>
      </div>
    </div>
  );

  const steps: Step[] = [
    {
      key: "token",
      title: t("homeAssistantPage.makeAToken"),
      state: tokenOk ? "done" : "now",
      keep: true,
      body: (
        <StepNote>
          {t("homeAssistantPage.inHomeAssistantOpenYour")}
        </StepNote>
      ),
    },
    { key: "paste", title: t("homeAssistantPage.pasteAddressAndToken"), state: busy ? "wait" : "now", body: fields },
  ];

  return (
    <>
      <SettingsCard>
        <ConnectionHeader
          icon={<House size={14} className="shrink-0 text-muted-foreground" />}
          title="Home Assistant"
          says={
            status.configured
              ? status.version
                ? t("homeAssistantPage.connectedToVersion", { home: status.name ?? t("homeAssistantPage.yourHome"), version: status.version })
                : t("homeAssistantPage.connectedToSentence", { home: status.name ?? t("homeAssistantPage.yourHome") })
              : t("homeAssistantPage.letAgentsSeeAndControl")
          }
          info={t("homeAssistantPage.theTokenStaysOnThis")}
          health={<HealthLine tone={!status.configured ? "off" : status.enabled ? "on" : "off"} label={!status.configured ? t("homeAssistantPage.notSetUp") : status.enabled ? t("common.connected") : t("common.off")} />}
          control={status.configured && <Switch aria-label="Home Assistant" checked={status.enabled} disabled={busy} onCheckedChange={(enabled) => void post({ enabled })} />}
        />
        <AnimatePresence initial={false}>
          {justConnected && <PairedMoment key="up" icon={<House size={18} />} title={t("homeAssistantPage.connectedTo", { home: status.name ?? t("homeAssistantPage.yourHome") })} detail={t("homeAssistantPage.chooseWhatAgentsCanSee")} />}
        </AnimatePresence>
        {!status.configured ? (
          <Checklist label={t("homeAssistantPage.connectHomeAssistant")} steps={steps} />
        ) : editing ? (
          <div className="mt-3">{fields}</div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3">
            <span className="min-w-0 truncate font-mono text-small text-muted-foreground">{status.url}</span>
            <span className="flex gap-x-4 text-small text-muted-foreground">
              <button onClick={() => { setUrl(status.url ?? ""); setEditing(true); }} className="underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline">{t("homeAssistantPage.changeToken")}</button>
              <button onClick={() => void post({ forget: true })} className="underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline">{t("common.disconnect")}</button>
            </span>
          </div>
        )}
        <ConnectionError>{error}</ConnectionError>
      </SettingsCard>

      {status.configured && <EntityList status={status} busy={busy} onSave={post} />}

      {status.configured && (
        <SettingsGroup
          title={t("homeAssistantPage.agentsThatCanUseIt")}
          footnote={t("homeAssistantPage.onlyInYourOwnConversations")}
        >
          {state.bots.filter((b) => !b.hidden && !b.archivedAt).map((bot) => {
            const on = status.agents.includes(bot.id);
            return (
              <SettingRow
                key={bot.id}
                rowId={`home-agent-${bot.id}`}
                label={bot.name}
                description={on ? t("homeAssistantPage.canReadWhatIsListed") : t("homeAssistantPage.cannotSeeTheHome")}
                control={<Switch aria-label={t("homeAssistantPage.agentCanUseHome", { agent: bot.name })} checked={on} disabled={busy} onCheckedChange={(next) => void post({ agents: next ? [...status.agents, bot.id] : status.agents.filter((id) => id !== bot.id) })} />}
              />
            );
          })}
          <SettingRow
            label={t("homeAssistantPage.otherAiApps")}
            description={t("homeAssistantPage.throughBloksInClaudeDesktop")}
            control={<Switch aria-label={t("homeAssistantPage.otherAiAppsCanUse")} checked={status.mcp} disabled={busy} onCheckedChange={(mcp) => void post({ mcp })} />}
          />
        </SettingsGroup>
      )}

      <StartAnAgent />
    </>
  );
}

/** What an agent may see, and what it may change without asking. */
function EntityList({ status, busy, onSave }: { status: Status; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [catalog, setCatalog] = useState<Entity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyListed, setOnlyListed] = useState(false);

  useEffect(() => {
    api("/api/home/catalog").then(({ entities }) => setCatalog(entities)).catch((e) => setError(e.message));
  }, [status.url]);

  const listed = (e: Entity) => status.entities.includes(e.entity_id) || status.domains.includes(e.domain);
  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of catalog ?? []) counts.set(e.domain, (counts.get(e.domain) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [catalog]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (catalog ?? [])
      .filter((e) => !onlyListed || listed(e))
      .filter((e) => words.every((w) => `${e.name} ${e.entity_id} ${e.area ?? ""}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.area ?? "~").localeCompare(b.area ?? "~") || a.name.localeCompare(b.name))
      .slice(0, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, query, onlyListed, status.entities, status.domains]);

  const toggleEntity = (e: Entity, on: boolean) => void onSave({
    entities: on ? [...status.entities, e.entity_id] : status.entities.filter((id) => id !== e.entity_id),
    auto: on ? status.auto : status.auto.filter((id) => id !== e.entity_id),
  });
  const toggleDomain = (domain: string, on: boolean) => void onSave({ domains: on ? [...status.domains, domain] : status.domains.filter((d) => d !== domain) });
  const toggleAuto = (e: Entity, on: boolean) => void onSave({ auto: on ? [...status.auto, e.entity_id] : status.auto.filter((id) => id !== e.entity_id) });

  return (
    <SettingsGroup
      title={t("homeAssistantPage.whatAgentsCanSee")}
      description={t("homeAssistantPage.nothingUntilYouListIt")}
      footnote={t("homeAssistantPage.namesAndStatesComeFrom")}
    >
      {error ? (
        <div className="px-5 py-4"><ConnectionError>{error}</ConnectionError></div>
      ) : !catalog ? (
        <div className="px-5 py-4"><Loader2 size={14} className="animate-spin text-muted-foreground" aria-label={t("homeAssistantPage.loadingEntities")} /></div>
      ) : (
        <>
          <div className="px-5 py-4">
            <div className="text-ui font-medium text-foreground">{t("homeAssistantPage.wholeKinds")}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {domains.map(([domain, count]) => {
                const on = status.domains.includes(domain);
                return (
                  <button
                    key={domain}
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => toggleDomain(domain, !on)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-small transition-colors duration-150",
                      on ? "border-foreground/30 bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {domainName(domain)} <span className="text-muted-foreground">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 basis-[220px]">
                <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input aria-label={t("homeAssistantPage.findAnEntity")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("homeAssistantPage.findByNameRoomOr")} className="h-8 pl-8 text-small" />
              </div>
              <label className="flex items-center gap-2 text-small text-muted-foreground">
                <Switch aria-label={t("homeAssistantPage.onlyWhatIsListed")} checked={onlyListed} onCheckedChange={setOnlyListed} />
                {t("homeAssistantPage.onlyListed")}
              </label>
            </div>
          </div>
          {shown.length === 0 ? (
            <div className="px-5 py-6 text-center text-body text-muted-foreground">{catalog.length ? t("homeAssistantPage.nothingMatches") : t("homeAssistantPage.homeAssistantHasNoEntities")}</div>
          ) : (
            shown.map((e) => {
              const on = listed(e);
              const byDomain = status.domains.includes(e.domain) && !status.entities.includes(e.entity_id);
              const auto = status.auto.includes(e.entity_id);
              return (
                <div key={e.entity_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
                  <label className="flex min-w-0 flex-1 basis-[240px] cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy || byDomain}
                      onChange={(ev) => toggleEntity(e, ev.target.checked)}
                      className="mt-1 size-4 shrink-0 accent-foreground"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-body text-foreground">{e.name}</span>
                      <span className="block truncate text-caption text-muted-foreground">
                        {byDomain
                          ? t("homeAssistantPage.listedWithAll", {
                              meta: [e.area, e.entity_id, e.state].filter(Boolean).join(" · "),
                              kind: DOMAIN_NAMES[e.domain] ? t(DOMAIN_NAMES[e.domain]).toLocaleLowerCase(formatLocale()) : e.domain,
                            })
                          : [e.area, e.entity_id, e.state].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </label>
                  {on && (e.alwaysAsks ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">{t("homeAssistantPage.alwaysAsks")}</span>
                  ) : (
                    <label className="flex shrink-0 items-center gap-2 text-small text-muted-foreground">
                      <Switch aria-label={t("homeAssistantPage.changeWithoutAsking", { entity: e.name })} checked={auto} disabled={busy} onCheckedChange={(next) => toggleAuto(e, next)} />
                      {t("homeAssistantPage.withoutAsking")}
                    </label>
                  ))}
                </div>
              );
            })
          )}
        </>
      )}
    </SettingsGroup>
  );
}

/** Home Assistant starting an agent: a webhook of the agent's own, and
 * the YAML that posts to it, ready to paste. */
function StartAnAgent() {
  const { state } = useStore();
  const bots = state.bots.filter((b) => !b.hidden && !b.archivedAt);
  const [botId, setBotId] = useState("");
  const [entity, setEntity] = useState("");
  const [made, setMade] = useState<{ command: string; state: string; voice: string; network: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = () => {
    if (!botId) return;
    setBusy(true);
    setError(null);
    api("/api/home/automation", { method: "POST", body: JSON.stringify({ botId, ...(entity.trim() ? { entity: entity.trim() } : {}) }) })
      .then(setMade)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <SettingsGroup
      title={t("homeAssistantPage.startAnAgentFromHome")}
      description={t("homeAssistantPage.aHomeAssistantAutomationCan")}
      footnote={
        <>
          {t("homeAssistantPage.webhookIsPassword")}{" "}
          <a href="https://www.home-assistant.io/integrations/rest_command/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
            {t("homeAssistantPage.aboutRestCommand")} <ExternalLink size={11} />
          </a>
        </>
      }
    >
      <SettingRow
        label={t("common.agent")}
        htmlFor="home-hook-agent"
        control={
          <SettingsSelect id="home-hook-agent" value={botId} onChange={(e) => { setBotId(e.target.value); setMade(null); }} className="w-[200px]">
            <option value="">{t("homeAssistantPage.chooseAnAgent")}</option>
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </SettingsSelect>
        }
      />
      <SettingRow
        label={t("homeAssistantPage.entityToWatch")}
        description={t("homeAssistantPage.optionalTheAutomationRunsWhen")}
        htmlFor="home-hook-entity"
        control={<Input id="home-hook-entity" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="binary_sensor.front_door" spellCheck={false} className="h-8 w-[220px] font-mono text-small" />}
      />
      <div className="px-5 py-4">
        <Button size="sm" variant="secondary" disabled={!botId || busy} onClick={make}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {made ? t("homeAssistantPage.makeItAgain") : t("homeAssistantPage.makeTheYaml")}
        </Button>
        <ConnectionError>{error}</ConnectionError>
        {made && (
          <div className="mt-4 flex flex-col gap-4">
            {!made.network && (
              <ConnectionNote>
                {t("homeAssistantPage.thisAddressWorksOnlyFor")}
              </ConnectionNote>
            )}
            <Snippet title={t("homeAssistantPage.n1AddToConfigurationYaml")} text={made.command} />
            <Snippet title={t("homeAssistantPage.n2AnAutomationForWhen")} text={made.state} />
            <Snippet title={t("homeAssistantPage.n3OrOneForYour")} text={made.voice} />
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}

function Snippet({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-small font-medium text-foreground">{title}</span>
        <Button size="sm" variant="secondary" aria-label={copied ? t("common.copied") : t("homeAssistantPage.copySnippet", { title })} onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
      <pre className="max-h-[260px] overflow-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-caption leading-relaxed text-foreground">{text}</pre>
    </div>
  );
}
