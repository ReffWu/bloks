// The workspace's own pages in Settings: everything that belongs to the
// workspace you are in rather than to you (its name and mark, its
// members, whether it is online, when it may interrupt you).
//
// They are pages of Settings like any other (state.settingsPage
// "workspace:<page>"), in a group of the list titled with the workspace's
// name and mark, so moving between them and your own pages is one list,
// one search, one Back. Settings draws the shell (AppSettingsPanel.tsx);
// this file draws the pages. Members is the members work's page
// (MembersPage.tsx). The workspace's Engines and keys and Usage were only
// ever links to pages Settings already has, so their old addresses lead
// there now (src/lib/settingsPages.ts).
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BellOff, Loader2, Trash2, Upload } from "@/components/icons";
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
import { cn } from "@/lib/cn";
import { MUTE_CHOICES, act, currentWorkspace, muteLabel, useWorkspaces } from "@/lib/workspaces";
import type { WorkspaceInfo, WorkspaceNotify } from "@/types/bridge";
import { SettingRow, SettingsEmpty, SettingsGroup } from "./SettingsLayout";
import { ConnectionError, HealthLine, type Health } from "./ConnectionKit";
import { MembersPage } from "./MembersPage";
import { ensureYourName } from "./YourNameDialog";
import { WorkspaceMark } from "./WorkspaceMark";
import { MarkPicker } from "./MarkPicker";

export const WORKSPACE_PAGES = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "online", label: "Reachable online" },
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
              : ws.kind === "hosted"
                ? "Your workspace on a machine run for you. It keeps working when this computer is off."
                : "A workspace with a name and a mark of its own."
        }
        control={
          ws.kind === "personal" || ws.kind === "joined" || ws.kind === "hosted" || (ws.kind === "custom" && businessElsewhere) ? (
            // one option is not a choice, so it is said rather than offered
            <span className="text-body text-muted-foreground">
              {ws.kind === "personal" ? "Personal" : ws.kind === "joined" ? "Joined" : ws.kind === "hosted" ? "Hosted" : "Its own name"}
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
      {ws.kind !== "joined" && ws.kind !== "hosted" && (
        <SettingRow
          label="Who uses it"
          description={
            ws.team
              ? "You and the people you invite. Each has their own conversations with its agents."
              : ws.kind === "personal"
                ? "Only you. For a team, make a Business workspace or one with a name of its own."
                : "Only you."
          }
          control={
            ws.kind === "personal" && !ws.team ? (
              // Personal is yours alone, so there is nothing to choose
              <span className="text-body text-muted-foreground">Just you</span>
            ) : (
            <Segmented<"solo" | "team">
              aria-label="Who uses it"
              value={ws.team ? "team" : "solo"}
              onChange={async (next) => {
                // people are invited from here on, and they see your name
                if (next === "team" && !(await ensureYourName({ why: `Everyone you invite to ${ws.name} sees it.` }))) return;
                void run(window.bloks?.workspaceUpdate?.(ws.id, { team: next === "team" }));
              }}
              options={[
                { value: "solo", label: "Just me" },
                { value: "team", label: "Team" },
              ]}
            />
            )
          }
        />
      )}
    </>
  );
}

/** What the mark row says under its name: who sees the mark, and where
 * else it can be changed. */
export function markWords(ws: Pick<WorkspaceInfo, "kind" | "logo">): string {
  if (ws.logo) return "Your logo, shown wherever this workspace is named.";
  if (ws.kind === "joined") return "Only you see this mark. Everyone else sees the one its owner chose.";
  if (ws.kind === "hosted") return "Change it any time. No other workspace here wears it.";
  return "Change it any time, here or on your phone. No other workspace here wears it.";
}

function MarkRow({ ws, all }: { ws: WorkspaceInfo; all: WorkspaceInfo[] }) {
  const [busy, setBusy] = useState<"mark" | "logo" | null>(null);
  const taken = all.filter((w) => w.id !== ws.id && w.mark).map((w) => w.mark!);
  const doing = async (what: "mark" | "logo", work: Promise<{ error?: string } | undefined> | undefined) => {
    setBusy(what);
    await run(work);
    setBusy(null);
  };
  return (
    <SettingRow
      label="Mark"
      description={markWords(ws)}
      control={
        <div className="flex items-center gap-3">
          <span key={ws.logo ?? (ws.mark ? `${ws.mark.color}${ws.mark.pattern}` : "none")} className="flex animate-pop-in">
            <WorkspaceMark mark={ws.mark} logo={ws.logo} size={44} label={`${ws.name}'s mark`} />
          </span>
          <div className="flex flex-col gap-1.5">
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
    >
      {/* a logo stands in for the mark, so there is nothing to choose
          until it is removed */}
      {!ws.logo && (
        <MarkPicker
          className="mt-4"
          value={ws.mark}
          taken={taken}
          defaultMark={ws.markDefault ?? null}
          disabled={busy !== null}
          onChange={(mark) => void doing("mark", window.bloks?.workspaceUpdate?.(ws.id, { mark }))}
          onShuffle={() => void doing("mark", window.bloks?.workspaceReroll?.(ws.id))}
        />
      )}
    </SettingRow>
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
        <MarkRow ws={ws} all={all} />
      </SettingsGroup>
      <SettingsGroup title="Notifications">
        <SettingRow
          label={LEVELS.find((l) => l.value === ws.notify)?.label ?? "All activity"}
          description={muted ? `Muted. ${muted}.` : "Not muted."}
          control={
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => go("notifications")}>
              Change
              <ArrowRight size={13} />
            </Button>
          }
        />
      </SettingsGroup>
      {/* what cannot be undone sits apart, at the end, in its own colour */}
      <SettingsGroup title="Danger zone" tone={ws.kind === "personal" ? "default" : "danger"}>
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
  const { dispatch } = useStore();
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [plan, setPlan] = useState<RelayPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const toPlan = () => dispatch({ type: "toggleAppSettings", open: true, page: "plan" });

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
      // no key on this computer yet: it goes in on Plan, the one place
      // the key lives, and activating there puts this workspace online
      setNeedsKey(true);
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

  const phonesOn = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("/api/pair", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
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
      <SettingsGroup
        footnote={
          <>
            Bloks Cloud keeps 3 workspaces online at once, just for you. Bloks Team keeps every workspace online and lets you bring people in, up to 10 in each. Workspaces on this computer are always free.{" "}
            <button type="button" onClick={toPlan} className="rounded font-medium text-foreground underline-offset-2 hover:underline">
              See your plan
            </button>
          </>
        }
      >
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
            <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-soft px-3.5 py-2.5">
              <span className="text-pretty text-body text-foreground">Going online needs Bloks Cloud. Add your key on Plan, and {ws.name} goes online.</span>
              <Button size="sm" variant="brand" onClick={toPlan}>
                Open Plan
              </Button>
            </div>
          )}
        </SettingRow>
        <SettingRow label="Status" control={health ? <HealthLine tone={health.tone} label={health.label} /> : <Loader2 size={14} className="animate-spin text-muted-foreground" />}>
          {/* Phone access is the master switch, Cloud included: turning it
              off is how somebody cuts every phone loose at once, so a
              workspace can be online and still reach nobody */}
          {on && status?.pairing === false ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <span className="text-pretty text-small text-muted-foreground">Phone access is off on this computer, so nothing reaches {ws.name} from outside.</span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void phonesOn()}>
                Turn on phone access
              </Button>
            </div>
          ) : (
            status?.problem && on && !working && <div className="mt-1 text-pretty text-small text-muted-foreground">{status.problem}</div>
          )}
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
    </>
  );
}

// ── the page ───────────────────────────────────────────────────────────

/** One of the workspace's pages, for the workspace this window shows. */
export function WorkspacePageBody({ page }: { page: string }) {
  const { dispatch } = useStore();
  const s = useWorkspaces();
  const ws = currentWorkspace(s);
  const id = pageOf(page);
  const go = (next: WorkspacePage) => dispatch({ type: "toggleAppSettings", open: true, page: `workspace:${next}` });
  if (!s.available || !ws) {
    return (
      <SettingsGroup>
        <SettingsEmpty title="Workspaces live in the Bloks desktop app" body="Open Bloks on your computer to change this workspace's name, members and notifications." />
      </SettingsGroup>
    );
  }
  if (id === "general") return <GeneralPage ws={ws} all={s.workspaces} go={go} />;
  if (id === "members") return <MembersPage workspace={ws} />;
  if (id === "online") return <ReachableOnline ws={ws} />;
  return <NotificationsPage ws={ws} />;
}
