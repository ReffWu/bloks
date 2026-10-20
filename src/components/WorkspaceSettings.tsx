// Workspace settings (design: Main): everything that belongs to the
// workspace you are in, beside its mark and name.
//
// It opens in Settings' place (state.settingsPage "workspace:<page>"),
// so leaving it, Back and Escape work as they do there. General, Reachable
// online and Notifications are drawn here; Members is the members work's
// page (MembersPage.tsx); Engines and keys and Usage are pages Settings
// already has for this workspace, so they lead there instead of being
// drawn twice.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BellOff, Loader2, RefreshCw, Trash2, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStore } from "@/state/store";
import { useWaitingCount } from "@/lib/members";
import { cn } from "@/lib/cn";
import { useEscape } from "@/lib/useEscape";
import { MUTE_CHOICES, act, currentWorkspace, kindLabel, muteLabel, useWorkspaces } from "@/lib/workspaces";
import type { WorkspaceInfo, WorkspaceNotify } from "@/types/bridge";
import { SettingRow, SettingsGroup, SettingsPageHeader } from "./SettingsLayout";
import { CloudSection } from "./CloudSection";
import { ConnectionError, HealthLine, type Health } from "./ConnectionKit";
import { MembersPage } from "./MembersPage";
import { WorkspaceMark } from "./WorkspaceMark";

export const WORKSPACE_PAGES = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "online", label: "Reachable online" },
  { id: "engines", label: "Engines and keys" },
  { id: "usage", label: "Usage" },
  { id: "notifications", label: "Notifications" },
] as const;

export type WorkspacePage = (typeof WORKSPACE_PAGES)[number]["id"];

/** Whether a Settings page id is one of these. */
export const isWorkspacePage = (page: string | null | undefined) => Boolean(page?.startsWith("workspace:"));

const pageOf = (settingsPage: string): WorkspacePage => {
  const id = settingsPage.slice("workspace:".length);
  return (WORKSPACE_PAGES.find((p) => p.id === id)?.id ?? "general") as WorkspacePage;
};

/** Says a workspace action's error where it happened, or nothing. */
async function run(work: Promise<{ error?: string } | undefined> | undefined) {
  const error = await act(work);
  if (error) toast.error(error);
  return !error;
}

// ── General ────────────────────────────────────────────────────────────

function NameRow({ ws }: { ws: WorkspaceInfo }) {
  const [name, setName] = useState(ws.name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(ws.name);
  }, [ws.name]);
  const save = async () => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean === ws.name) return setName(ws.name);
    const said = await act(window.bloks?.workspaceUpdate?.(ws.id, { name: clean }));
    setError(said);
    if (said) setName(ws.name);
  };
  return (
    <SettingRow
      label="Name"
      htmlFor="workspace-name"
      description="How it is called in the switcher, in banners and in invites."
      control={
        <Input
          id="workspace-name"
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape" && name !== ws.name) {
              e.stopPropagation();
              setName(ws.name);
            }
          }}
          className="w-[240px]"
        />
      }
    >
      {error && <div className="mt-2 text-small text-destructive">{error}</div>}
    </SettingRow>
  );
}

function KindRows({ ws, all }: { ws: WorkspaceInfo; all: WorkspaceInfo[] }) {
  const businessElsewhere = all.some((w) => w.kind === "business" && w.id !== ws.id);
  return (
    <>
      <SettingRow
        label="Kind"
        description={
          ws.kind === "personal"
            ? "Personal is the workspace Bloks has always had. It keeps its kind and its mark."
            : ws.kind === "business"
              ? "Business wears the same mark on every computer."
              : "A workspace with a name and a mark of its own."
        }
        control={
          ws.kind === "personal" || ws.kind === "joined" || (ws.kind === "custom" && businessElsewhere) ? (
            // one option is not a choice, so it is said rather than offered
            <span className="text-body text-muted-foreground">
              {ws.kind === "personal" ? "Personal" : ws.kind === "joined" ? "Joined" : "Its own name"}
            </span>
          ) : (
            <Segmented<"business" | "custom">
              aria-label="Kind"
              value={ws.kind}
              onChange={(kind) => void run(window.bloks?.workspaceUpdate?.(ws.id, { kind }))}
              options={[
                ...(businessElsewhere ? [] : [{ value: "business" as const, label: "Business" }]),
                { value: "custom", label: "Its own name" },
              ]}
            />
          )
        }
      />
      {ws.kind !== "joined" && (
        <SettingRow
          label="Who uses it"
          description={ws.team ? "You and the people you invite. Each has their own conversations with its agents." : "Only you."}
          control={
            <Segmented<"solo" | "team">
              aria-label="Who uses it"
              value={ws.team ? "team" : "solo"}
              onChange={(next) => void run(window.bloks?.workspaceUpdate?.(ws.id, { team: next === "team" }))}
              options={[
                { value: "solo", label: "Just me" },
                { value: "team", label: "Team" },
              ]}
            />
          }
        />
      )}
    </>
  );
}

function MarkRow({ ws }: { ws: WorkspaceInfo }) {
  const [busy, setBusy] = useState<"reroll" | "logo" | null>(null);
  const fixed = ws.kind === "personal" || ws.kind === "business";
  const doing = async (what: "reroll" | "logo", work: Promise<{ error?: string } | undefined> | undefined) => {
    setBusy(what);
    await run(work);
    setBusy(null);
  };
  return (
    <SettingRow
      label="Mark"
      description={
        ws.logo
          ? "Your logo, shown wherever this workspace is named."
          : fixed
            ? `${ws.kind === "personal" ? "Personal" : "Business"}'s mark is fixed, so it is never mistaken for another. A logo can take its place.`
            : "Drawn for this workspace when it was made. No other workspace here wears it."
      }
      control={
        <div className="flex items-center gap-3">
          <span key={ws.logo ?? (ws.mark ? `${ws.mark.color}${ws.mark.pattern}` : "none")} className="flex animate-pop-in">
            <WorkspaceMark mark={ws.mark} logo={ws.logo} size={44} label={`${ws.name}'s mark`} />
          </span>
          <div className="flex flex-col gap-1.5">
            {!fixed && !ws.logo && ws.kind !== "joined" && (
              <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => void doing("reroll", window.bloks?.workspaceReroll?.(ws.id))}>
                {busy === "reroll" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                New mark
              </Button>
            )}
            {ws.logo ? (
              <Button variant="ghost" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => void doing("logo", window.bloks?.workspaceLogoClear?.(ws.id))}>
                <Trash2 size={13} />
                Remove logo
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => void doing("logo", window.bloks?.workspaceLogoPick?.(ws.id))}>
                {busy === "logo" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Upload logo
              </Button>
            )}
          </div>
        </div>
      }
    />
  );
}

/** "Its 3 agents, 2 rooms…": what a delete takes, counted from what this
 * window has loaded, which is this workspace. */
function deleteWords(ws: WorkspaceInfo, agents: number, rooms: number) {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [n(agents, "agent", "agents"), n(rooms, "room", "rooms")];
  return (
    `Its ${parts.join(" and ")}, every conversation, routine and watcher, its memory, keys and settings, and its backups ` +
    `go to the Trash, from ${ws.dataDir ?? "its folder"}. Its server stops, and it leaves the switcher.` +
    "\n\nPersonal and your other workspaces are not touched."
  );
}

function DeleteRow({ ws }: { ws: WorkspaceInfo }) {
  const { state } = useStore();
  const [busy, setBusy] = useState(false);
  if (ws.kind === "personal") {
    return (
      <SettingRow
        label="Delete workspace"
        description="Personal cannot be deleted. It is the folder Bloks has always used, and the one the others are made beside."
      />
    );
  }
  const agents = state.bots.filter((b) => !b.hidden).length;
  const rooms = state.bloks.length;
  return (
    <SettingRow
      label="Delete workspace"
      description={`${ws.name} and everything in it go to the Trash.`}
      control={
        <Button
          variant="destructive"
          disabled={busy}
          className="gap-1.5"
          onClick={async () => {
            const yes = await confirm({
              title: `Delete ${ws.name}?`,
              body: deleteWords(ws, agents, rooms),
              confirmLabel: "Delete workspace",
              destructive: true,
            });
            if (!yes) return;
            setBusy(true);
            // on success the window is already on its way to Personal
            if (!(await run(window.bloks?.workspaceDelete?.(ws.id)))) setBusy(false);
          }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Delete
        </Button>
      }
    />
  );
}

function GeneralPage({ ws, all, go }: { ws: WorkspaceInfo; all: WorkspaceInfo[]; go: (page: WorkspacePage) => void }) {
  const muted = muteLabel(ws.mute);
  return (
    <>
      <SettingsGroup title="Workspace">
        <NameRow ws={ws} />
        <KindRows ws={ws} all={all} />
        <MarkRow ws={ws} />
      </SettingsGroup>
      <SettingsGroup title="Notifications">
        <SettingRow
          label={LEVELS.find((l) => l.value === ws.notify)?.label ?? "All activity"}
          description={muted ? `Muted. ${muted}.` : "Not muted."}
          control={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => go("notifications")}>
              Change
              <ArrowRight size={13} />
            </Button>
          }
        />
      </SettingsGroup>
      <SettingsGroup>
        <DeleteRow ws={ws} />
      </SettingsGroup>
    </>
  );
}

// ── Notifications ──────────────────────────────────────────────────────

const LEVELS: Array<{ value: WorkspaceNotify; label: string; says: string }> = [
  { value: "all", label: "All activity", says: "Replies, finished goals and anything that needs you." },
  { value: "needs-me", label: "Only when it needs me", says: "Approvals and questions: work that is stopped until you answer." },
  { value: "nothing", label: "Nothing", says: "No banners and nothing on the Dock icon. It keeps working." },
];

function NotificationsPage({ ws }: { ws: WorkspaceInfo }) {
  const muted = muteLabel(ws.mute);
  return (
    <>
      <SettingsGroup title="Tell me about">
        <div role="radiogroup" aria-label="Tell me about" className="flex flex-col divide-y">
          {LEVELS.map((level) => {
            const on = ws.notify === level.value;
            return (
              <button
                key={level.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => !on && void run(window.bloks?.workspaceUpdate?.(ws.id, { notify: level.value }))}
                className="flex items-center gap-4 px-5 py-4 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent/60"
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
                  <span className="text-ui font-medium text-foreground">{level.label}</span>
                  <span className="text-pretty text-body text-muted-foreground">{level.says}</span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>
      <SettingsGroup title="Mute">
        <SettingRow
          label={muted ? "Muted" : "Not muted"}
          description={
            muted
              ? `${muted}. Nothing from ${ws.name} interrupts you meanwhile; it keeps working, and the switcher still shows when something waits.`
              : `Quiet ${ws.name} for a while without changing what it tells you about.`
          }
          control={
            <div className="flex items-center gap-2">
              {muted && (
                <Button variant="outline" size="sm" onClick={() => void run(window.bloks?.workspaceMute?.(ws.id, "off"))}>
                  Turn back on
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={muted ? "ghost" : "outline"} size="sm" className="gap-1.5">
                    <BellOff size={13} />
                    {muted ? "Change" : "Mute"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px]">
                  {MUTE_CHOICES.map((choice) => (
                    <DropdownMenuItem key={choice.id} onSelect={() => void run(window.bloks?.workspaceMute?.(ws.id, choice.id))}>
                      {choice.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />
      </SettingsGroup>
    </>
  );
}

// ── Reachable online ───────────────────────────────────────────────────

interface RelayStatus {
  enabled: boolean;
  connected: boolean;
  delivering?: boolean;
  spaceId: string | null;
  problem?: string | null;
  pairing?: boolean;
}
interface RelayPlan {
  plan: string | null;
  spaces: { online: number; limit: number | null } | null;
  licence: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  // the relay's own words, a plan limit above all: it says what to do
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

function ReachableOnline({ ws }: { ws: WorkspaceInfo }) {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [plan, setPlan] = useState<RelayPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const keyCard = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    call<RelayStatus>("/api/relay/status").then(setStatus).catch(() => setStatus({ enabled: false, connected: false, spaceId: null }));
    call<RelayPlan>("/api/relay/plan").then(setPlan).catch(() => setPlan(null));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const on = status?.enabled ?? false;
  const working = Boolean(status?.connected) && status?.delivering !== false;
  const health: { tone: Health; label: string } | null = !status
    ? null
    : !on
      ? { tone: "off", label: "Offline" }
      : working
        ? { tone: "on", label: "Online" }
        : status.pairing === false
          ? { tone: "issue", label: "Paused" }
          : { tone: "wait", label: "Connecting" };

  const flip = async (next: boolean) => {
    setError(null);
    setNeedsKey(false);
    if (next && !plan?.licence) {
      // never activated here: the key goes in below, and that turns it on
      setNeedsKey(true);
      keyCard.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      keyCard.current?.querySelector("input")?.focus();
      return;
    }
    setBusy(true);
    try {
      if (next) await call("/api/relay/activate", { method: "POST", body: JSON.stringify({ again: true }) });
      else await call("/api/relay/space", { method: "DELETE" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      load();
    }
  };

  const online = plan?.spaces;
  return (
    <>
      <SettingsGroup>
        <SettingRow
          label="Online"
          description={`Your phone, and the people you invite, reach ${ws.name} from anywhere through Bloks Cloud. Off, it works on this computer and your own network.`}
          control={
            <div className="flex items-center gap-3">
              {busy && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
              <Switch aria-label="Online" checked={on} disabled={busy || status === null} onCheckedChange={(next) => void flip(next)} />
            </div>
          }
        >
          <ConnectionError>{error}</ConnectionError>
          {needsKey && (
            <div className="mt-3 text-small text-muted-foreground">Activate Bloks Cloud below with your key. That puts {ws.name} online.</div>
          )}
        </SettingRow>
        <SettingRow label="Status" control={health ? <HealthLine tone={health.tone} label={health.label} /> : <Loader2 size={14} className="animate-spin text-muted-foreground" />}>
          {status?.problem && on && !working && <div className="mt-1 text-pretty text-small text-muted-foreground">{status.problem}</div>}
        </SettingRow>
        {on && status?.spaceId && (
          <SettingRow
            label="Address"
            description="Its own space at Bloks Cloud, which holds nothing it can read."
            control={<span className="font-mono text-small text-muted-foreground">{status.spaceId}</span>}
          />
        )}
        {online && (
          <SettingRow
            label="Workspaces online"
            description={
              online.limit === null
                ? "Your plan keeps every workspace online."
                : `Your plan keeps ${online.limit} online at once. Turn one off here to free its place for another.`
            }
            control={
              <span className="text-body tabular-nums text-foreground">
                {online.limit === null ? online.online : `${online.online} of ${online.limit}`}
              </span>
            }
          />
        )}
      </SettingsGroup>
      <p className="-mt-6 mb-9 px-1 text-pretty text-small text-muted-foreground">
        Bloks Cloud keeps 3 workspaces online at once, with 2 members in each. Bloks Team keeps every workspace online, with 10 members in each. Workspaces on this computer and your own network are always free.
      </p>
      <div ref={keyCard} className={cn("rounded-2xl transition-shadow duration-200", needsKey && "ring-2 ring-brand-ink/40")}>
        <CloudSection />
      </div>
    </>
  );
}

// ── pages that live in Settings already ────────────────────────────────

// A row opens a Settings page by its id, or, with `rail`, a page of its own
// on the rail (Usage has one).
function LinkRows({ rows }: { rows: Array<{ label: string; says: string; page: string; rail?: boolean }> }) {
  const { dispatch } = useStore();
  return (
    <SettingsGroup>
      {rows.map((row) => (
        <SettingRow
          key={row.page}
          label={row.label}
          description={row.says}
          control={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() =>
                row.rail
                  ? (dispatch({ type: "toggleAppSettings", open: false }), dispatch({ type: "openPage", page: "usage" }))
                  : dispatch({ type: "toggleAppSettings", open: true, page: row.page })
              }>
              Open
              <ArrowRight size={13} />
            </Button>
          }
        />
      ))}
    </SettingsGroup>
  );
}

// ── the page ───────────────────────────────────────────────────────────

const HEADINGS: Record<Exclude<WorkspacePage, "members">, (ws: WorkspaceInfo) => { title: string; description: string }> = {
  general: (ws) => ({ title: "General", description: `What ${ws.name} is called, what it looks like, and what it tells you.` }),
  online: () => ({ title: "Reachable online", description: "This workspace's own space at Bloks Cloud, for your phone and the people you invite." }),
  engines: () => ({ title: "Engines and keys", description: "The engines this workspace's agents run on and the keys they use. Every workspace keeps its own." }),
  usage: () => ({ title: "Usage", description: "What this workspace's agents have spent and used, and the limits on it." }),
  notifications: (ws) => ({ title: "Notifications", description: `When ${ws.name} may interrupt you, here and in the Dock.` }),
};

export function WorkspaceSettings() {
  const { state, dispatch } = useStore();
  const s = useWorkspaces();
  const ws = currentWorkspace(s);
  const page = pageOf(state.settingsPage);
  const waiting = useWaitingCount();
  const scroller = useRef<HTMLDivElement>(null);
  const go = (next: WorkspacePage) => dispatch({ type: "toggleAppSettings", open: true, page: `workspace:${next}` });
  useEscape(() => dispatch({ type: "toggleAppSettings", open: false }));
  // braces, not an arrow's value: scrollTo answers a promise now, and an
  // effect that returns one is taken for its cleanup
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [page]);

  if (!s.available || !ws) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background p-8 text-center text-body text-muted-foreground">
        Workspaces live in the Bloks desktop app.
      </main>
    );
  }
  const all = s.workspaces;
  const heading = page === "members" ? null : HEADINGS[page](ws);

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background md:flex-row">
      <nav aria-label="Workspace settings" className="flex shrink-0 flex-col border-b bg-sidebar/60 md:w-[252px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-5 pb-4 pt-6 max-md:pl-16">
          <WorkspaceMark mark={ws.mark} logo={ws.logo} size={34} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-lead font-semibold text-foreground">{ws.name}</span>
            <span className="text-small text-muted-foreground">{kindLabel(ws)}</span>
          </div>
        </div>
        <div className="flex gap-0.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] md:flex-1 md:flex-col md:overflow-y-auto md:pb-4 [&::-webkit-scrollbar]:hidden">
          {WORKSPACE_PAGES.map((p) => {
            const on = p.id === page;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => go(p.id)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-body transition-[background-color,color] duration-150",
                  on
                    ? "bg-background font-medium text-foreground shadow-[0_0_0_0.5px_var(--border)]"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                )}
              >
                {p.label}
                {/* somebody asking to join is said where the eye goes (design: Mac-Approve) */}
                {p.id === "members" && waiting > 0 && <span className="ml-2 text-small font-semibold tabular-nums text-warning">{waiting} waiting</span>}
              </button>
            );
          })}
          <div className="hidden md:mt-auto md:block md:px-2.5 md:pt-4">
            <button
              type="button"
              onClick={() => dispatch({ type: "toggleAppSettings", open: true, page: "general" })}
              className="text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
            >
              App settings
            </button>
          </div>
        </div>
      </nav>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-5 pb-16 pt-8 md:px-10">
          {heading && <SettingsPageHeader title={heading.title} description={heading.description} />}
          {page === "general" && <GeneralPage ws={ws} all={all} go={go} />}
          {page === "members" && <MembersPage workspace={ws} />}
          {page === "online" && <ReachableOnline ws={ws} />}
          {page === "notifications" && <NotificationsPage ws={ws} />}
          {page === "engines" && (
            <LinkRows
              rows={[
                { label: "Engines", says: "Claude Code, Codex and the rest: which are connected here.", page: "engines" },
                { label: "Apps and keys", says: "Accounts and tools every agent here shares.", page: "apps" },
              ]}
            />
          )}
          {page === "usage" && (
            <LinkRows
              rows={[
                { label: "Usage", says: "Spend by agent and engine, plan limits, and spending limits on your keys.", page: "usage", rail: true },
                { label: "Bloks AI", says: "This workspace's allowance, what is left, and members' caps.", page: "cloud" },
              ]}
            />
          )}
        </div>
      </div>
    </main>
  );
}
