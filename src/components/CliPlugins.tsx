// Settings, Plugins, CLIs: tools on this computer that agents use from
// their shell, beside the apps and the MCP servers. GitHub is the first,
// and its page holds two things that are easy to confuse and must not be:
//
//   gh on this computer (GitHub 387). Bloks checks git and gh, says what
//   is left to do and does it on a press, and tells agents gh is ready.
//   It keeps no copy of gh's sign-in, and says plainly that it cannot
//   keep it from an agent either.
//
//   A protected connection (GitHub 386). A token Bloks keeps and adds to
//   an agent's requests itself, for the agents granted it, so the agent
//   never holds it. Each use is a line in Recent use, and taking a grant
//   back stops it at the next request.
//
// Both are the person's alone: the server refuses an agent and a member,
// and the CLI half answers only on the computer Bloks runs on.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "@/components/icons";
import { Check } from "@/components/icons";
import { ExternalLink } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Lock } from "@/components/icons";
import { Plus } from "@/components/icons";
import { RefreshCw } from "@/components/icons";
import { SquareTerminal } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { stamp } from "@/lib/when";
import { cn } from "@/lib/cn";
import { AgentAvatar } from "./Avatar";
import { BackLink } from "./McpServers";
import { GitHubMark } from "./ProviderIcons";
import { t } from "@/lib/i18n";

// ── what the server says (server/cli-plugins.ts, server/connections.ts) ──

interface ToolStatus {
  found: boolean;
  path?: string;
  version?: string;
  problem?: string;
}

interface GitHubAccount {
  login: string;
  ok: boolean;
  storage: "keychain" | "file" | "environment" | "unknown";
  where?: string;
  scopes: string | null;
}

type NextStep =
  | { kind: "git"; says: string; command: string }
  | { kind: "install"; says: string; command: string | null; url: string }
  | { kind: "sign-in"; says: string; command: string }
  | { kind: "setup-git"; says: string; command: string };

interface GitHubCliStatus {
  checkedAt: number;
  git: ToolStatus;
  gh: ToolStatus;
  account: GitHubAccount | null;
  gitUsesGh: boolean | null;
  brew: boolean;
  ready: boolean;
  next: NextStep | null;
}

export interface CliPluginView {
  id: string;
  name: string;
  enabled: boolean;
  status: GitHubCliStatus | null;
  signIn: string;
  setupGit: string;
}

type Access = "read" | "write";

interface ConnectionView {
  id: string;
  service: string;
  name: string;
  account: string | null;
  scopes: string | null;
  addedAt: number;
  checkedAt: number | null;
  hosts: string[];
  grants: Record<string, Access>;
}

interface AuditLine {
  at: number;
  agent?: string;
  what: string;
  host: string;
  status: number;
  outcome: "sent" | "refused";
  reason?: string;
}

/** The CLI plugins, as this computer has them. Null while asking; an
 * error when this is not the computer Bloks runs on. */
export function useCliPlugins() {
  const [plugins, setPlugins] = useState<CliPluginView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api("/api/cli-plugins")
      .then((r) => {
        setPlugins(Array.isArray(r.plugins) ? r.plugins : []);
        setError(null);
      })
      .catch((e: Error & { status?: number }) => {
        setPlugins([]);
        setError(e.status === 403 ? "CLI plugins are set up on the computer Bloks runs on." : e.message);
      });
  }, []);
  useEffect(reload, [reload]);
  return { plugins, error, reload, setPlugins };
}

function useConnections() {
  const { state } = useStore();
  const [connections, setConnections] = useState<ConnectionView[] | null>(null);
  const [tokenUrl, setTokenUrl] = useState("https://github.com/settings/personal-access-tokens/new");
  const reload = useCallback(() => {
    api("/api/connections")
      .then((r) => {
        setConnections(Array.isArray(r.connections) ? r.connections : []);
        const github = (r.services ?? []).find((s: { id: string }) => s.id === "github");
        if (github?.tokenUrl) setTokenUrl(github.tokenUrl);
      })
      .catch(() => setConnections([]));
  }, []);
  // again whenever one changes anywhere
  useEffect(reload, [reload, state.ticks.connections]);
  return { connections, reload, tokenUrl };
}

/** One line for the list: where gh stands. */
export function cliPluginLine(plugin: CliPluginView): string {
  const status = plugin.status;
  if (!status) return "git and gh on this computer";
  if (status.ready && status.account) return `Signed in as @${status.account.login}`;
  return status.next?.says ?? "Not set up yet";
}

// ── the page ─────────────────────────────────────────────────────────

const pill =
  "flex h-9 items-center rounded-full outline-none transition-[background-color,color,scale,opacity] duration-150 ease-out active:scale-[0.97]";

function Section({ title, says, aside, children }: { title: string; says?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lead font-semibold text-foreground">{title}</h3>
          {says && <p className="mt-1 text-pretty text-body text-muted-foreground">{says}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Dot({ on }: { on: boolean | null }) {
  return <span className={cn("size-2 shrink-0 rounded-full", on === null ? "bg-muted-foreground/40" : on ? "bg-success" : "bg-warning")} />;
}

/** A command the person can run themselves, with a way to copy it. */
function Command({ text }: { text: string }) {
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-body text-foreground">{text}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => toast("Copied"));
        }}
        className="shrink-0 text-body text-muted-foreground transition-colors hover:text-foreground"
      >
        {t("common.copy")}
      </button>
    </div>
  );
}

const STORAGE: Record<GitHubAccount["storage"], string> = {
  keychain: "in the system keychain",
  file: "in a file",
  environment: "in an environment variable",
  unknown: "where gh keeps it",
};

export function GitHubPluginSettings({ onBack }: { onBack: () => void }) {
  const { state } = useStore();
  const { plugins, error, setPlugins } = useCliPlugins();
  const plugin = plugins?.find((p) => p.id === "github") ?? null;
  const { connections, reload: reloadConnections, tokenUrl } = useConnections();
  const connection = connections?.find((c) => c.service === "github") ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const agents = state.bots.filter((b) => !b.hidden && !(b.solo && b.solo.by !== "owner"));

  const put = (next: CliPluginView) => setPlugins((list) => (list ?? []).map((p) => (p.id === next.id ? next : p)));
  const act = async (name: string, path: string, init: RequestInit = { method: "POST" }) => {
    setBusy(name);
    try {
      const r = await api(path, init);
      if (r.plugin) put(r.plugin);
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const status = plugin?.status ?? null;
  const next = status?.next ?? null;

  return (
    <div>
      <BackLink onBack={onBack} />
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-background">
            <GitHubMark size={26} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-display font-semibold text-foreground">GitHub</h2>
            <p className="mt-0.5 text-ui text-muted-foreground">{t("cliPlugins.cliPluginGitAndGh")}</p>
          </div>
        </div>
        {plugin && (
          <button
            onClick={() => void act("check", "/api/cli-plugins/github/check")}
            disabled={busy !== null}
            className={cn(pill, "gap-1.5 border bg-card px-4 text-body font-medium text-foreground hover:bg-accent disabled:opacity-50")}
          >
            {busy === "check" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Check again
          </button>
        )}
      </div>

      <div className="mt-7 flex flex-col gap-4">
        <Section
          title={t("cliPlugins.thisComputer")}
          says={t("cliPlugins.checkedWithTheSamePath")}
        >
          {plugins === null ? (
            <div className="flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> {t("cliPlugins.lookingForGitAndGh")}
            </div>
          ) : !plugin || !status ? (
            <p className="text-body text-muted-foreground">{error ?? t("cliPlugins.notCheckedYet")}</p>
          ) : (
            <>
              <div className="grid grid-cols-[auto_120px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-ui">
                <Dot on={status.git.found} />
                <span className="text-muted-foreground">{t("cliPlugins.git")}</span>
                <span className="truncate text-foreground">
                  {status.git.found ? (
                    <>
                      {status.git.version} <span className="text-muted-foreground">· {status.git.path}</span>
                    </>
                  ) : (
                    (status.git.problem ?? t("cliPlugins.notInstalled"))
                  )}
                </span>
                <Dot on={status.gh.found} />
                <span className="text-muted-foreground">{t("cliPlugins.gh")}</span>
                <span className="truncate text-foreground">
                  {status.gh.found ? (
                    <>
                      {status.gh.version} <span className="text-muted-foreground">· {status.gh.path}</span>
                    </>
                  ) : (
                    (status.gh.problem ?? t("cliPlugins.notInstalled"))
                  )}
                </span>
                <Dot on={status.gh.found ? Boolean(status.account?.ok) : null} />
                <span className="text-muted-foreground">{t("cliPlugins.signedIn")}</span>
                <span className="truncate text-foreground">
                  {status.account ? (
                    <>
                      @{status.account.login} on github.com{" "}
                      <span className="text-muted-foreground">
                        · {STORAGE[status.account.storage]}
                        {status.account.where ? ` (${status.account.where})` : ""}
                      </span>
                    </>
                  ) : status.gh.found ? (
                    t("cliPlugins.notSignedIn")
                  ) : (
                    <span className="text-muted-foreground">{t("cliPlugins.needsGh")}</span>
                  )}
                </span>
                <Dot on={status.gitUsesGh} />
                <span className="text-muted-foreground">{t("cliPlugins.gitSignIn")}</span>
                <span className="truncate text-foreground">
                  {status.gitUsesGh === true ? t("cliPlugins.gitAsksGhForGithub") : status.gitUsesGh === false ? t("cliPlugins.gitDoesNotAskGh") : <span className="text-muted-foreground">{t("cliPlugins.needsGitAndGh")}</span>}
                </span>
              </div>
              {status.account?.scopes && (
                <p className="mt-3 text-pretty text-body text-muted-foreground">
                  The sign-in may use {status.account.scopes}. What an agent can push still depends on each repository's own permissions and branch protection; that is tested on the first push.
                </p>
              )}

              {next && (
                <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3.5">
                  <p className="text-pretty text-ui text-foreground">{next.says}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {next.kind === "install" && next.command && (
                      <Button size="sm" onClick={() => void act("install", "/api/cli-plugins/github/install")} disabled={busy !== null}>
                        {busy === "install" && <Loader2 size={13} className="animate-spin" />}
                        Install with Homebrew
                      </Button>
                    )}
                    {next.kind === "install" && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={next.url} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} />
                          {t("cliPlugins.cliGithubCom")}
                        </a>
                      </Button>
                    )}
                    {next.kind === "sign-in" && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          const r = await act("sign-in", "/api/cli-plugins/github/sign-in");
                          if (r?.opened) toast("Terminal is open", { description: "Finish signing in there, then press Check again." });
                        }}
                        disabled={busy !== null}
                      >
                        <SquareTerminal size={13} />
                        {t("cliPlugins.signInInTerminal")}
                      </Button>
                    )}
                    {next.kind === "setup-git" && (
                      <Button size="sm" onClick={() => void act("setup-git", "/api/cli-plugins/github/setup-git")} disabled={busy !== null}>
                        {busy === "setup-git" && <Loader2 size={13} className="animate-spin" />}
                        Set up git
                      </Button>
                    )}
                  </div>
                  {next.command && <Command text={next.command} />}
                  {next.kind === "sign-in" && (
                    <p className="mt-2 text-pretty text-body text-muted-foreground">
                      {t("cliPlugins.onAComputerYouReach")}
                    </p>
                  )}
                </div>
              )}
              {status.ready && (
                <p className="mt-4 flex items-center gap-2 text-body text-muted-foreground">
                  <Check size={14} className="text-success" />
                  Ready. Checked {stamp(status.checkedAt)}.
                </p>
              )}
            </>
          )}
        </Section>

        <Section
          title={t("cliPlugins.agentsUseGh")}
          says={t("cliPlugins.agentsAreToldGhIs")}
          aside={
            plugin && (
              <Switch
                checked={plugin.enabled}
                disabled={busy !== null}
                aria-label={t("cliPlugins.agentsUseGh")}
                onCheckedChange={(on) =>
                  void act("enable", "/api/cli-plugins/github", { method: "PUT", body: JSON.stringify({ enabled: on }) }).then((r) => {
                    if (r && !on) toast("Agents are no longer told about gh", { description: "gh stays signed in on this computer. Run gh auth logout to sign it out." });
                  })
                }
              />
            )
          }
        >
          <div className="flex gap-3 rounded-xl bg-muted/50 px-4 py-3 text-body text-muted-foreground">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-pretty">
              {t("cliPlugins.bloksKeepsNoCopyOf")}
            </p>
          </div>
        </Section>

        <Section
          title={t("cliPlugins.protectedConnection")}
          says="A token Bloks keeps and adds to an agent's requests itself. Agents you grant it clone, fetch and push over https://github.com and call the GitHub API through an address of their own that lasts one turn. They never see the token."
          aside={
            connection && (
              <button
                onClick={async () => {
                  const yes = await confirm({
                    title: "Disconnect GitHub?",
                    body: "Bloks forgets the token. Agents lose the connection at their next request.\n\nThe token itself still works on GitHub until you delete it there.",
                    confirmLabel: "Disconnect",
                    destructive: true,
                  });
                  if (!yes) return;
                  setBusy("disconnect");
                  api(`/api/connections/${connection.id}`, { method: "DELETE" })
                    .then(() => {
                      reloadConnections();
                      toast("GitHub disconnected");
                    })
                    .catch((e: Error) => toast.error(e.message))
                    .finally(() => setBusy(null));
                }}
                disabled={busy !== null}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-body font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 size={14} />
                {t("common.disconnect")}
              </button>
            )
          }
        >
          {connections === null ? (
            <div className="flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> {t("common.loading2")}
            </div>
          ) : !connection ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-ui text-muted-foreground">
                <Lock size={15} />
                {t("cliPlugins.notConnected")}
              </span>
              <Button onClick={() => setAdding(true)}>
                <Plus size={14} />
                {t("cliPlugins.addAToken")}
              </Button>
            </div>
          ) : (
            <ConnectionBody connection={connection} agents={agents} ghShared={Boolean(plugin?.enabled && status?.account)} onChanged={reloadConnections} />
          )}
        </Section>

        <Section title={t("cliPlugins.whatIsProtected")}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-pretty text-body text-muted-foreground">
            <li>{t("cliPlugins.aProtectedTokenIsNever")}</li>
            <li>{t("cliPlugins.anAgentsAddressWorksFor")}</li>
            <li>{t("cliPlugins.addingKeysDeployKeysCollaborators")}</li>
            <li>{t("cliPlugins.anAgentCanStillMisuse")}</li>
            <li>{t("cliPlugins.theTokenIsKeptIn")}</li>
          </ul>
        </Section>
      </div>

      <AddTokenDialog
        open={adding}
        onOpenChange={setAdding}
        tokenUrl={tokenUrl}
        onAdded={() => {
          setAdding(false);
          reloadConnections();
        }}
      />
    </div>
  );
}

const ACCESS_OPTIONS: Array<{ value: "none" | Access; label: string }> = [
  { value: "none", label: "No access" },
  { value: "read", label: "Read" },
  { value: "write", label: "Read and write" },
];

function ConnectionBody({
  connection,
  agents,
  ghShared,
  onChanged,
}: {
  connection: ConnectionView;
  agents: ReturnType<typeof useStore>["state"]["bots"];
  ghShared: boolean;
  onChanged: () => void;
}) {
  const [grants, setGrants] = useState(connection.grants);
  const [lines, setLines] = useState<AuditLine[] | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => setGrants(connection.grants), [connection.grants]);
  const loadLines = useCallback(() => {
    api(`/api/connections/${connection.id}/audit`)
      .then((r) => setLines(Array.isArray(r.lines) ? r.lines : []))
      .catch(() => setLines([]));
  }, [connection.id]);
  useEffect(loadLines, [loadLines]);

  const grant = (botId: string, access: "none" | Access) => {
    const before = grants;
    const next = { ...grants };
    if (access === "none") delete next[botId];
    else next[botId] = access;
    setGrants(next);
    api(`/api/connections/${connection.id}`, { method: "PATCH", body: JSON.stringify({ grants: { [botId]: access === "none" ? null : access } }) })
      .then(onChanged)
      .catch((e: Error) => {
        setGrants(before);
        toast.error(e.message);
      });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-ui text-foreground">
          <Dot on />
          <span className="truncate">
            {connection.account ? `@${connection.account}` : t("common.connected")}
            <span className="text-muted-foreground">
              {" "}
              · added {stamp(connection.addedAt)}
              {connection.scopes ? ` · ${connection.scopes}` : ""}
            </span>
          </span>
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            api(`/api/connections/${connection.id}/check`, { method: "POST" })
              .then((r) => {
                if (r.ok) toast.success("GitHub accepts the token");
                else toast.error(r.error ?? "GitHub did not accept the token");
                onChanged();
              })
              .catch((e: Error) => toast.error(e.message))
              .finally(() => setChecking(false));
          }}
        >
          {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Check token
        </Button>
      </div>

      {ghShared && Object.keys(grants).length > 0 && (
        <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-body text-foreground">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-pretty">
            {t("cliPlugins.ghIsAlsoSignedIn")}
          </p>
        </div>
      )}

      <div>
        <h4 className="text-ui font-semibold text-foreground">{t("common.agents")}</h4>
        {agents.length === 0 ? (
          <p className="mt-2 text-body text-muted-foreground">{t("cliPlugins.noAgentsYet")}</p>
        ) : (
          <div className="mt-2 flex flex-col divide-y">
            {agents.map((bot) => (
              <div key={bot.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <AgentAvatar bot={bot} size={26} />
                <span className="min-w-0 flex-1 truncate text-ui text-foreground">{bot.name}</span>
                <Segmented
                  size="sm"
                  aria-label={`${bot.name}'s GitHub access`}
                  value={grants[bot.id] ?? "none"}
                  options={ACCESS_OPTIONS}
                  onChange={(value) => grant(bot.id, value)}
                  className="w-full sm:w-auto"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-ui font-semibold text-foreground">{t("cliPlugins.recentUse")}</h4>
          <button onClick={loadLines} className="text-body text-muted-foreground transition-colors hover:text-foreground">
            {t("cliPlugins.refresh")}
          </button>
        </div>
        {lines === null ? (
          <p className="mt-2 text-body text-muted-foreground">{t("common.loading2")}</p>
        ) : lines.length === 0 ? (
          <p className="mt-2 text-body text-muted-foreground">{t("cliPlugins.nothingYetEachRequestAn")}</p>
        ) : (
          <ul className="mt-2 flex max-h-[280px] flex-col divide-y overflow-y-auto rounded-xl border">
            {lines.map((line, i) => (
              <li key={`${line.at}-${i}`} className="flex items-baseline gap-3 px-3.5 py-2 text-body">
                <span className="w-[72px] shrink-0 tabular-nums text-muted-foreground">{stamp(line.at)}</span>
                <span className="w-[88px] shrink-0 truncate text-foreground">{line.agent ?? t("common.anAgent")}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-small text-foreground" title={line.reason ?? line.what}>
                  {line.what}
                  {line.reason && <span className="font-sans text-muted-foreground"> · {line.reason}</span>}
                </span>
                <span className={cn("shrink-0 tabular-nums", line.outcome === "refused" ? "text-destructive" : "text-muted-foreground")}>
                  {line.outcome === "refused" ? t("cliPlugins.refused") : line.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Adding the token: typed, sent, and gone from the screen. Bloks asks
 * GitHub whose it is before keeping it. */
function AddTokenDialog({
  open,
  onOpenChange,
  tokenUrl,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenUrl: string;
  onAdded: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) return;
    setToken("");
    setError(null);
  }, [open]);
  const add = () => {
    setBusy(true);
    setError(null);
    api("/api/connections", { method: "POST", body: JSON.stringify({ service: "github", token: token.trim() }) })
      .then((r) => {
        setToken("");
        onAdded();
        toast.success(`Connected as @${r.connection.account}`, { description: "Choose which agents may use it." });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-32px)] max-w-[480px] p-6 sm:p-7">
        <span className="flex size-11 items-center justify-center rounded-2xl border bg-card">
          <GitHubMark size={22} />
        </span>
        <DialogTitle className="mt-4">{t("cliPlugins.addAGithubToken")}</DialogTitle>
        <DialogDescription>
          {t("cliPlugins.bloksKeepsItOnThis")}
        </DialogDescription>
        <ol className="mt-5 flex list-decimal flex-col gap-1.5 pl-5 text-pretty text-body text-muted-foreground">
          <li>
            Make a fine-grained token on{" "}
            <a href={tokenUrl} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
              GitHub
            </a>
            , for only the repositories agents should work on.
          </li>
          <li>{t("cliPlugins.giveItContentsReadAnd")}</li>
          <li>{t("cliPlugins.pasteItHere")}</li>
        </ol>
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && token.trim() && !busy) add();
          }}
          placeholder={t("cliPlugins.githubPat")}
          aria-label={t("cliPlugins.githubToken")}
          className="mt-5 h-10 rounded-xl font-mono text-body"
        />
        {error && (
          <p role="alert" className="mt-2 text-pretty text-body text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={add} disabled={!token.trim() || busy}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            Connect
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
