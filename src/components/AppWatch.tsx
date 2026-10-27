// App watchers (server/app-watch.ts): an agent acts when something happens
// in a connected app. Three places show one.
//
//   The new-watcher form, under App: pick the app, the event, fill in what
//   the event asks for, which account, an optional filter in plain words.
//   The rest (who acts, what they do, where) is the form every watcher has.
//
//   A watcher's page: what it watches, whether Bloks can hear it right now,
//   and every event it heard with what became of it, a turn to open, one
//   filtered out, one held back by its limits, or a stretch Bloks was not
//   listening, said as missed rather than left looking quiet.
//
//   The card an agent's proposal puts in the chat: the app, the event, the
//   filter, who acts and where, and Start watching or Not now. Nothing
//   listens until the person presses the first.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "@/components/icons";
import { Check } from "@/components/icons";
import { Eye } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { Zap } from "@/components/icons";
import { api, useStore, type AppWatchPlan } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { ServiceIcon } from "./Customize";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { useConnectors } from "@/lib/useConnectors";

export interface AppRun {
  at: number;
  outcome: "started" | "queued" | "filtered" | "held" | "failed" | "missed";
  eventId?: string;
  summary: string;
  laneId?: string;
  messageId?: string;
  from?: number;
  to?: number;
}

/** An app watcher's app, as GET /api/watchers sends it. */
export interface AppView {
  toolkit: string;
  toolkitName?: string;
  trigger: string;
  triggerName?: string;
  config: Record<string, string | number | boolean>;
  filter?: string[];
  accountId?: string;
  triggerId?: string;
  perHour: number;
  perDay: number;
  proposal?: { botId: string; name: string; laneId: string; messageId: string; at: number };
  madeBy?: { personId: string; name: string };
  paused?: { at: number; why: string; note: string };
  runs: AppRun[];
  turnsToday: number;
}

/** Whether app watchers can hear at all, from the same answer. */
export interface AppsStatus {
  connectorKey: boolean;
  projectKey: boolean;
  listening: "connecting" | "live" | "down" | "refused";
  error?: string;
  catchesUp: boolean;
}

interface ConfigField {
  key: string;
  title: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  options?: string[];
  default?: string | number | boolean;
}

interface TriggerType {
  slug: string;
  name: string;
  description: string;
  delivery: "webhook" | "poll";
  fields: ConfigField[];
}

interface Account {
  id: string;
  label: string;
}

export const ago = (at?: number) => {
  if (!at) return "never";
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(at).toLocaleDateString();
};

const ease = [0.23, 1, 0.32, 1] as const;

/** When it acts, in words, the way the server's card says it. */
export function appWhen(app: { toolkit: string; toolkitName?: string; trigger: string; triggerName?: string; filter?: string[] }): string {
  const event = (app.triggerName || app.trigger).replace(/\.$/, "");
  const filter = app.filter?.length ? `, only when it mentions ${app.filter.map((f) => `“${f}”`).join(" or ")}` : "";
  return `${app.toolkitName || app.toolkit} says “${event}”${filter}`;
}

/** A list row's second line. */
export function appRowStatus(w: { enabled: boolean; app?: AppView }): string | null {
  const app = w.app;
  if (!app) return null;
  if (app.proposal) return "Waiting for your yes";
  if (app.paused) return "Paused: disconnected";
  if (!w.enabled) return null;
  const heard = app.runs.find((r) => r.outcome !== "missed");
  return heard ? `Heard ${ago(heard.at)}` : "Listening";
}

const OUTCOME: Record<AppRun["outcome"], string> = {
  started: "Started",
  queued: "Waiting",
  filtered: "Filtered out",
  held: "Held back",
  failed: "Did not start",
  missed: "Missed",
};

// ── the form ───────────────────────────────────────────────────────────

/** What the form under App fills in, beside who acts and what they do. */
export interface AppDraftValue {
  toolkit: string;
  trigger: string;
  triggerName?: string;
  toolkitName?: string;
  config: Record<string, string | number | boolean>;
  accountId?: string;
  filter: string;
  ready: boolean;
  /** What is missing, in a few words, for the line by the button. */
  missing?: string;
}

/**
 * The app half of a new watcher: which app, which event, what the event
 * asks for, which account, and an optional filter. Without the project key
 * there is nothing to pick from, and it says how to add one.
 */
export function AppDraftFields({ apps, onChange }: { apps: AppsStatus | null; onChange: (value: AppDraftValue) => void }) {
  const { dispatch } = useStore();
  const connectors = useConnectors();
  const [toolkit, setToolkit] = useState("");
  const [other, setOther] = useState("");
  const [types, setTypes] = useState<TriggerType[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState("");
  const [config, setConfig] = useState<Record<string, string | number | boolean>>({});
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState("");

  const keyed = apps?.projectKey !== false;
  const type = types?.find((t) => t.slug === trigger);
  const appLabel = connectors.cards?.find((c) => c.slug === toolkit)?.label ?? toolkit;

  // an app picked: its events and its accounts, both from Composio
  useEffect(() => {
    setTypes(null);
    setTypesError(null);
    setTrigger("");
    setAccounts(null);
    setAccountId(undefined);
    if (!toolkit || !keyed) return;
    let alive = true;
    api(`/api/app-triggers/${encodeURIComponent(toolkit)}`)
      .then((r) => alive && setTypes(r.types ?? []))
      .catch((e: Error) => alive && setTypesError(e.message));
    api(`/api/app-triggers/${encodeURIComponent(toolkit)}/accounts`)
      .then((r) => {
        if (!alive) return;
        setAccounts(r.accounts ?? []);
        setAccountId(r.accounts?.[0]?.id);
      })
      .catch(() => alive && setAccounts([]));
    return () => {
      alive = false;
    };
  }, [toolkit, keyed]);

  // a new event starts from what it says its fields default to
  useEffect(() => {
    const next: Record<string, string | number | boolean> = {};
    for (const f of type?.fields ?? []) if (f.default !== undefined) next[f.key] = f.default;
    setConfig(next);
  }, [type]);

  const missingField = type?.fields.find((f) => f.required && (config[f.key] === undefined || config[f.key] === ""));
  const missing = !toolkit
    ? "Pick an app."
    : !trigger
      ? "Pick an event."
      : missingField
        ? `Add ${missingField.title}.`
        : accounts && !accounts.length
          ? `Connect a ${appLabel} account first.`
          : undefined;
  useEffect(() => {
    onChange({
      toolkit,
      trigger,
      triggerName: type?.name,
      toolkitName: appLabel,
      config,
      accountId,
      filter,
      ready: keyed && !missing && accounts !== null,
      missing,
    });
    // onChange is the form's setter, the same every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolkit, trigger, type, config, accountId, filter, keyed, missing, accounts, appLabel]);

  if (!keyed) {
    return (
      <div className="mt-6 flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-body text-foreground">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle size={14} className="text-warning" /> App watchers need your Composio project key
        </div>
        <div className="text-muted-foreground">
          The key that starts ak_, as well as the Connect key. Composio sends events from the accounts connected in that project.
        </div>
        <div>
          <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "toggleAppSettings", open: true, page: "apps" })}>
            Open Apps and keys
          </Button>
        </div>
      </div>
    );
  }

  const field = (f: ConfigField) => {
    const id = `app-config-${f.key}`;
    const value = config[f.key];
    const set = (v: string | number | boolean | undefined) =>
      setConfig((c) => {
        const next = { ...c };
        if (v === undefined || v === "") delete next[f.key];
        else next[f.key] = v;
        return next;
      });
    return (
      <div key={f.key} className="flex flex-col gap-1">
        <label htmlFor={id} className="text-body text-foreground">
          {f.title}
          {f.required && <span className="text-muted-foreground"> (needed)</span>}
        </label>
        {f.type === "boolean" ? (
          <Switch id={id} checked={value === true} onCheckedChange={(on) => set(on)} aria-label={f.title} />
        ) : f.options ? (
          <select
            id={id}
            value={String(value ?? "")}
            onChange={(e) => set(e.target.value)}
            className="h-9 rounded-xl border border-input bg-background px-2.5 text-body text-foreground outline-none focus:border-ring/60"
          >
            <option value="">Choose</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={id}
            inputMode={f.type === "number" ? "numeric" : undefined}
            value={value === undefined ? "" : String(value)}
            onChange={(e) => set(f.type === "number" && e.target.value.trim() && Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : e.target.value)}
            className="rounded-xl text-body"
          />
        )}
        {f.description && <span className="text-small leading-snug text-muted-foreground">{f.description}</span>}
      </div>
    );
  };

  const chip = (on: boolean) =>
    cn(
      "flex items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-body outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.97]",
      on ? "border-brand bg-brand-soft font-medium text-foreground" : "bg-card text-foreground/90 hover:border-foreground/20",
    );

  return (
    <>
      <div className="mt-6 mb-2 text-body font-medium text-foreground">Which app</div>
      <div role="radiogroup" aria-label="Which app" className="flex flex-wrap gap-1.5">
        {connectors.installed.map((card) => (
          <button key={card.slug} type="button" role="radio" aria-checked={toolkit === card.slug} onClick={() => setToolkit(card.slug)} className={chip(toolkit === card.slug)}>
            <ServiceIcon card={card} size={18} />
            {card.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <Input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && other.trim()) {
                e.preventDefault();
                setToolkit(other.trim().toLowerCase());
              }
            }}
            onBlur={() => other.trim() && setToolkit(other.trim().toLowerCase())}
            placeholder="Another app"
            aria-label="Another app, by its Composio name"
            title="Another app, by its Composio name, such as asana"
            spellCheck={false}
            className="h-8 w-[150px] rounded-full text-small"
          />
        </div>
      </div>
      {connectors.installed.length === 0 && (
        <div className="mt-2 text-small text-muted-foreground">No apps connected in Bloks yet. Connect one in Plugins, or name one that is connected in your Composio project.</div>
      )}

      {toolkit && (
        <>
          <div className="mt-6 mb-2 text-body font-medium text-foreground">When {appLabel} says</div>
          {typesError ? (
            <div className="rounded-lg bg-warning/10 px-3 py-2 text-body text-warning">{typesError}</div>
          ) : types === null ? (
            <div className="flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Asking Composio what {appLabel} can say
            </div>
          ) : types.length === 0 ? (
            <div className="text-body text-muted-foreground">{appLabel} has no events Composio can send. Pick another app.</div>
          ) : (
            <div role="radiogroup" aria-label="Which event" className="flex max-h-[260px] flex-col gap-1 overflow-y-auto rounded-xl border p-1">
              {types.map((t) => {
                const on = trigger === t.slug;
                return (
                  <button
                    key={t.slug}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTrigger(t.slug)}
                    className={cn("flex flex-col items-start rounded-lg px-3 py-2 text-left transition-colors duration-150", on ? "bg-brand-soft" : "hover:bg-accent/60")}
                  >
                    <span className="text-body font-medium text-foreground">{t.name}</span>
                    {t.description && <span className="text-small leading-snug text-muted-foreground">{t.description}</span>}
                    <span className="text-caption text-muted-foreground/80">
                      {t.delivery === "poll" ? "Arrives when Composio next looks, up to about 15 minutes" : "Arrives within seconds"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <AnimatePresence initial={false}>
        {type && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease } }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            {type.fields.length > 0 && (
              <>
                <div className="mt-6 mb-2 text-body font-medium text-foreground">What it watches</div>
                <div className="grid gap-3 sm:grid-cols-2">{type.fields.map(field)}</div>
              </>
            )}
            <div className="mt-6 mb-2 text-body font-medium text-foreground">Which account</div>
            {accounts === null ? (
              <div className="flex items-center gap-2 text-body text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Looking for {appLabel} accounts
              </div>
            ) : accounts.length === 0 ? (
              <div className="rounded-lg bg-warning/10 px-3 py-2 text-body text-warning">
                No {appLabel} account is connected in your Composio project yet. Connect one there, then pick this again.
              </div>
            ) : (
              <div role="radiogroup" aria-label="Which account" className="flex flex-wrap gap-1.5">
                {accounts.map((a) => (
                  <button key={a.id} type="button" role="radio" aria-checked={accountId === a.id} onClick={() => setAccountId(a.id)} className={chip(accountId === a.id)}>
                    {accountId === a.id ? <Check size={13} /> : <span className="size-[13px]" />}
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            <label className="mt-6 mb-2 block text-body font-medium text-foreground" htmlFor="app-filter">
              Only when it mentions <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input id="app-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Acme, invoice" className="rounded-xl text-body" />
            <div className="mt-1.5 text-small text-muted-foreground">Whole words, any one of them, checked before any agent is woken.</div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── a watcher's page ───────────────────────────────────────────────────

/** Whether it can hear right now, in one line, and how worried to be. */
function hearing(w: { enabled: boolean; app: AppView }, apps: AppsStatus | null): { text: string; tone: "ok" | "wait" | "warn" } {
  const name = w.app.toolkitName || w.app.toolkit;
  if (w.app.proposal) return { text: "Nothing listens until you say yes.", tone: "wait" };
  if (!w.enabled) return { text: w.app.paused?.note ?? "Paused. Switch it on to listen.", tone: w.app.paused ? "warn" : "wait" };
  if (apps && !apps.projectKey) return { text: "Not listening: the Composio project key is gone. Add it in Settings, Apps and keys.", tone: "warn" };
  if (apps?.listening === "live") return { text: `Listening. Events from ${name} arrive as they happen.`, tone: "ok" };
  if (apps?.listening === "refused") return { text: `Not listening: ${apps.error ?? "Composio refused to send events here."}`, tone: "warn" };
  return { text: `Connecting to Composio to hear ${name}.`, tone: "wait" };
}

export function AppWatchDetail({
  w,
  apps,
  onChanged,
}: {
  w: { id: string; botId: string; name: string; instruction: string; enabled: boolean; thread?: string; lastError?: string; lastCheck?: number; app: AppView };
  apps: AppsStatus | null;
  onChanged: () => void;
}) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((b) => b.id === w.botId);
  const app = w.app;
  const [instruction, setInstruction] = useState(w.instruction);
  const [thread, setThread] = useState(w.thread ?? "");
  const [filter, setFilter] = useState((app.filter ?? []).join(", "));
  const [perHour, setPerHour] = useState(String(app.perHour));
  const [perDay, setPerDay] = useState(String(app.perDay));
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setInstruction(w.instruction), [w.id, w.instruction]);
  useEffect(() => setThread(w.thread ?? ""), [w.id, w.thread]);
  useEffect(() => setFilter((app.filter ?? []).join(", ")), [w.id, app.filter]);
  useEffect(() => {
    setPerHour(String(app.perHour));
    setPerDay(String(app.perDay));
  }, [w.id, app.perHour, app.perDay]);

  const call = (what: string, path: string, init: RequestInit = {}) => {
    setBusy(what);
    setNote(null);
    return api(path, init)
      .then((r) => {
        if (r?.note) setNote(r.note);
        onChanged();
      })
      .catch((e: Error) => setNote(e.message))
      .finally(() => setBusy(null));
  };
  const patch = (body: Record<string, unknown>) => call("patch", `/api/watchers/${w.id}`, { method: "PATCH", body: JSON.stringify(body) });
  const status = hearing(w, apps);
  const open = (laneId?: string) => bot && laneId && dispatch({ type: "select", id: bot.id, lane: laneId });

  return (
    <div className="flex flex-col gap-4">
      {app.proposal && (
        <div className="flex flex-col gap-2 rounded-xl border border-brand/30 bg-brand-soft px-3.5 py-3 text-body text-foreground">
          <div className="font-medium">{app.proposal.name} proposed this watcher</div>
          <div className="text-muted-foreground">Nothing listens, and nothing is set up at Composio, until you say yes.</div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => call("confirm", `/api/watchers/${w.id}/confirm`, { method: "POST", body: "{}" })}>
              {busy === "confirm" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Start watching
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => call("decline", `/api/watchers/${w.id}/decline`, { method: "POST", body: "{}" })}>
              Not now
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lead font-semibold text-foreground">
            <Zap size={15} className="text-muted-foreground" /> {w.name}
          </div>
          <div className="mt-0.5 text-body text-muted-foreground">When {appWhen(app)}.</div>
          {app.madeBy && (
            <div className="mt-1 text-small text-muted-foreground">
              Set up by {app.madeBy.name}, an admin. Its turns go to {bot?.name ?? "the agent"}'s team conversation, as theirs.
            </div>
          )}
        </div>
        <Switch checked={w.enabled} disabled={Boolean(app.proposal) || busy !== null} onCheckedChange={(on) => patch({ enabled: on })} aria-label="Listening" />
      </div>

      <div
        role="status"
        className={cn(
          "rounded-lg px-3 py-2 text-body",
          status.tone === "ok" ? "bg-muted text-muted-foreground" : status.tone === "warn" ? "bg-warning/10 text-warning" : "bg-muted text-foreground",
        )}
      >
        {status.text}
        {w.enabled && !app.proposal && apps?.listening === "live" && !apps.catchesUp && (
          <span className="text-muted-foreground"> While Bloks is closed nothing is heard, and that time shows below as missed.</span>
        )}
      </div>

      {Object.keys(app.config).length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-body text-muted-foreground">What it watches</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-body">
            {Object.entries(app.config).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-all font-mono text-small text-foreground">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <label className="flex flex-col gap-1.5 text-body text-muted-foreground">
        Only when it mentions
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onBlur={() => filter.trim() !== (app.filter ?? []).join(", ") && patch({ filter: filter.trim() })}
          placeholder="Every event"
          className="text-body text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-body text-muted-foreground">
        What {bot?.name ?? "the agent"} does when it happens
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onBlur={() => instruction.trim() && instruction !== w.instruction && patch({ instruction })}
          className="min-h-[80px] text-body text-foreground"
        />
      </label>
      {!app.madeBy && (
        <label className="flex flex-col gap-1.5 text-body text-muted-foreground">
          Which chat it replies in
          <Input
            value={thread}
            onChange={(e) => setThread(e.target.value)}
            onBlur={() => thread.trim() !== (w.thread ?? "") && patch({ thread: thread.trim() })}
            placeholder="General"
            className="text-body text-foreground"
          />
          <span className="text-small">Leave blank for the main chat. A new name starts a new one.</span>
        </label>
      )}
      <div className="flex flex-wrap items-end gap-3 text-body text-muted-foreground">
        <label className="flex flex-col gap-1.5">
          At most an hour
          <Input
            inputMode="numeric"
            value={perHour}
            onChange={(e) => setPerHour(e.target.value)}
            onBlur={() => Number(perHour) !== app.perHour && patch({ perHour: Number(perHour) })}
            className="w-[96px] text-body text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          At most a day
          <Input
            inputMode="numeric"
            value={perDay}
            onChange={(e) => setPerDay(e.target.value)}
            onBlur={() => Number(perDay) !== app.perDay && patch({ perDay: Number(perDay) })}
            className="w-[96px] text-body text-foreground"
          />
        </label>
        <span className="pb-2">{app.turnsToday} today</span>
      </div>

      {w.lastError && !app.paused && <div className="rounded-lg bg-warning/10 px-3 py-2 text-body text-warning">{w.lastError}</div>}

      <div>
        <div className="mb-1.5 text-small font-medium text-muted-foreground">What it heard</div>
        {app.runs.length === 0 ? (
          <div className="text-body text-muted-foreground">Nothing yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {app.runs.map((r) => (
              <li key={`${r.at}-${r.eventId ?? r.outcome}`} className="flex items-baseline gap-3 text-body">
                <span className="w-[86px] shrink-0 text-muted-foreground">{ago(r.at)}</span>
                <span
                  className={cn(
                    "w-[92px] shrink-0 text-small font-medium",
                    r.outcome === "started" || r.outcome === "queued" ? "text-foreground" : r.outcome === "missed" || r.outcome === "failed" ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {OUTCOME[r.outcome]}
                </span>
                <span className={cn("min-w-0 flex-1 text-foreground", r.outcome === "missed" ? "text-pretty" : "truncate")}>{r.summary}</span>
                {r.laneId && bot && (
                  <button className="shrink-0 text-small text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => open(r.laneId)}>
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => call("check", `/api/watchers/${w.id}/check`, { method: "POST" })}>
          {busy === "check" ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Check now
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive hover:text-destructive"
          disabled={busy !== null}
          onClick={() => call("delete", `/api/watchers/${w.id}`, { method: "DELETE" })}
        >
          <Trash2 size={13} /> Stop watching
        </Button>
      </div>
      {note && <div className="text-body text-muted-foreground">{note}</div>}
    </div>
  );
}

// ── the card in the chat ───────────────────────────────────────────────

/** An agent's proposal, where the person reads it: everything the watcher
 * would do, and the one press that starts it. */
export function AppWatchCard({ plan, answered }: { plan: AppWatchPlan; answered?: string }) {
  const { state } = useStore();
  const bot = state.bots.find((b) => b.id === plan.botId);
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = answered === "Start watching";
  const answer = (yes: boolean) => {
    setBusy(yes ? "yes" : "no");
    setError(null);
    api(`/api/watchers/${plan.watcherId}/${yes ? "confirm" : "decline"}`, { method: "POST", body: "{}" })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const config = Object.entries(plan.config);
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 px-4 py-2">
      <span className="w-[112px] shrink-0 text-body text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-body text-foreground">{value}</span>
    </div>
  );
  return (
    <div className="w-full max-w-[560px] animate-rise-in overflow-hidden rounded-2xl border bg-card shadow-[0_1px_3px_var(--shadow-color)]">
      <div className="px-4 pt-4">
        <div className="text-caption font-semibold uppercase tracking-[0.1em] text-brand-ink">{started ? "Watching" : answered ? "Not watching" : "Proposed watcher"}</div>
        <div className="mt-1 text-lead font-semibold text-foreground">
          {plan.agentName} wants to act on {plan.appName}
        </div>
      </div>
      <div className="mt-3 flex flex-col divide-y border-t">
        {row("When", `${plan.appName} says “${plan.eventName}”`)}
        {row("Only if it says", plan.filter.length ? plan.filter.map((f) => `“${f}”`).join(" or ") : "Any event")}
        {config.length > 0 &&
          row(
            "Watching",
            <span className="font-mono text-small">
              {config.map(([k, v]) => `${k}: ${String(v)}`).join(", ")}
            </span>,
          )}
        {row(
          "Who acts",
          <span className="flex items-center gap-2">
            {bot && <AgentAvatar bot={bot} size={20} />}
            {plan.agentName}, in {plan.conversation}
          </span>,
        )}
        {row("What it does", <span className="whitespace-pre-wrap">{plan.instruction}</span>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
        {started ? (
          <span className="flex items-center gap-1.5 text-body text-muted-foreground">
            <Check size={14} /> Watching. Change or stop it in Automations, Watchers.
          </span>
        ) : answered ? (
          <span className="text-body text-muted-foreground">{answered === "Withdrawn" ? `${plan.agentName} withdrew it.` : "Not watching."}</span>
        ) : (
          <>
            <button
              onClick={() => answer(true)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-xl bg-brand-ink px-3.5 py-2 text-ui font-medium text-brand-foreground transition-[transform,filter] duration-150 hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
            >
              {busy === "yes" && <Loader2 size={14} className="animate-spin" />}
              Start watching
            </button>
            <button
              onClick={() => answer(false)}
              disabled={busy !== null}
              className="rounded-xl px-3 py-2 text-ui text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-60"
            >
              Not now
            </button>
            <span className="text-small text-muted-foreground">What {plan.appName} sends reaches {plan.agentName} as data, never as instructions.</span>
          </>
        )}
        {error && <div className="w-full text-body text-destructive">{error}</div>}
      </div>
    </div>
  );
}
