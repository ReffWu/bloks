// Settings, Plugins, CLIs: tools on this computer that agents use from
// their shell, beside the apps and the MCP servers. GitHub is the first
// (GitHub 387): Bloks checks git and gh, says what is left to do and does
// it on a press, and tells agents gh is ready. It keeps no copy of gh's
// sign-in, and says plainly that it cannot keep it from an agent either.
// The person's alone: the server answers only on the computer Bloks runs
// on, and never an agent or a member.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "@/components/icons";
import { Check } from "@/components/icons";
import { ExternalLink } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { RefreshCw } from "@/components/icons";
import { SquareTerminal } from "@/components/icons";
import { api } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { stamp } from "@/lib/when";
import { cn } from "@/lib/cn";
import { BackLink } from "./McpServers";
import { GitHubMark } from "./ProviderIcons";

// ── what the server says (server/cli-plugins.ts) ──

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
        Copy
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
  const { plugins, error, setPlugins } = useCliPlugins();
  const plugin = plugins?.find((p) => p.id === "github") ?? null;
  const [busy, setBusy] = useState<string | null>(null);

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
            <p className="mt-0.5 text-ui text-muted-foreground">CLI plugin: git and gh on this computer</p>
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
          title="This computer"
          says="Checked with the same PATH and home folder agents run with, so ready here is ready for them."
        >
          {plugins === null ? (
            <div className="flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Looking for git and gh
            </div>
          ) : !plugin || !status ? (
            <p className="text-body text-muted-foreground">{error ?? "Not checked yet."}</p>
          ) : (
            <>
              <div className="grid grid-cols-[auto_120px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-ui">
                <Dot on={status.git.found} />
                <span className="text-muted-foreground">git</span>
                <span className="truncate text-foreground">
                  {status.git.found ? (
                    <>
                      {status.git.version} <span className="text-muted-foreground">· {status.git.path}</span>
                    </>
                  ) : (
                    (status.git.problem ?? "Not installed")
                  )}
                </span>
                <Dot on={status.gh.found} />
                <span className="text-muted-foreground">gh</span>
                <span className="truncate text-foreground">
                  {status.gh.found ? (
                    <>
                      {status.gh.version} <span className="text-muted-foreground">· {status.gh.path}</span>
                    </>
                  ) : (
                    (status.gh.problem ?? "Not installed")
                  )}
                </span>
                <Dot on={status.gh.found ? Boolean(status.account?.ok) : null} />
                <span className="text-muted-foreground">Signed in</span>
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
                    "Not signed in"
                  ) : (
                    <span className="text-muted-foreground">Needs gh</span>
                  )}
                </span>
                <Dot on={status.gitUsesGh} />
                <span className="text-muted-foreground">Git sign-in</span>
                <span className="truncate text-foreground">
                  {status.gitUsesGh === true ? "git asks gh for github.com" : status.gitUsesGh === false ? "git does not ask gh yet" : <span className="text-muted-foreground">Needs git and gh</span>}
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
                          cli.github.com
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
                        Sign in in Terminal
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
                      On a computer you reach over SSH, run it there and pick the device code: gh shows a code to type at github.com/login/device from any browser.
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
          title="Agents use gh"
          says="Agents are told gh is signed in and to use git and gh as usual: clone, branch, push, and gh pr create. They act as this account, with its repository permissions and branch protection."
          aside={
            plugin && (
              <Switch
                checked={plugin.enabled}
                disabled={busy !== null}
                aria-label="Agents use gh"
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
              Bloks keeps no copy of gh's sign-in, and it cannot keep it from an agent either: anything an agent runs, runs as you, and gh hands its token to whoever asks with gh auth token.
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
