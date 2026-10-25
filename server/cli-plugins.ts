// Local CLI plugins: tools on this computer that agents use from their
// shell, beside the remote MCP servers and the apps connected through
// Composio (GitHub 387). GitHub is the first: git and gh.
//
// An app connection gives agents tools that call a service for them. It
// does not make `git clone` of a private repository work, or `git push`,
// or `gh pr create`, because those run in the agent's own shell and sign
// in however this computer's git and gh are set up. So this plugin is
// about this computer: whether git and gh are here, whether gh is signed
// in and to whom, and whether git asks gh for its GitHub credentials. When
// something is missing it says what the next step is, and the app can run
// that step (an install through Homebrew, gh's own sign-in in Terminal,
// `gh auth setup-git`).
//
// Bloks keeps no copy of gh's sign-in. gh keeps it where it always does,
// in the system keychain or in its own hosts file, and every check here
// reads gh's status, never the token: nothing here runs `gh auth token`
// or asks status to show it. That also means Bloks cannot keep the
// sign-in from an agent. An agent runs as the person, so anything it runs
// can ask gh for the token. Settings says so in as many words.
//
// The checks run in this server's own environment, which is the one every
// agent's turn starts from: the same PATH (server/path.ts widens it the
// same way for both) and the same home folder, so "ready" here is ready
// for them.
import { execFile } from "node:child_process";
import { homedir } from "node:os";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type Runner = (command: string, args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>;

/** Runs a command the way the checks need: no shell, a time limit, and
 * gh told never to prompt or offer an update, since nobody is there. */
export const execRunner: Runner = (command, args, opts) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: opts?.timeoutMs ?? 10_000, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" } },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : null) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });

export interface ToolStatus {
  found: boolean;
  path?: string;
  version?: string;
  /** Why it is not usable, when it is there but is not. */
  problem?: string;
}

export interface GitHubAccount {
  host: string;
  login: string;
  active: boolean;
  /** gh's word that the sign-in works. */
  ok: boolean;
  /** Where gh keeps the token: the system keychain, a file, or the
   * environment. Never the token. */
  storage: "keychain" | "file" | "environment" | "unknown";
  /** The file or variable, when it is one. */
  where?: string;
  scopes: string | null;
  gitProtocol?: string;
}

export type NextStep =
  | { kind: "git"; says: string; command: string }
  | { kind: "install"; says: string; command: string | null; url: string }
  | { kind: "sign-in"; says: string; command: string }
  | { kind: "setup-git"; says: string; command: string };

export interface GitHubCliStatus {
  checkedAt: number;
  git: ToolStatus;
  gh: ToolStatus;
  /** Every github.com account gh knows. */
  accounts: GitHubAccount[];
  /** The one gh uses for github.com, or null. */
  account: GitHubAccount | null;
  /** Whether git asks gh for github.com credentials. Null when it could
   * not be asked (no git, or no gh to point it at). */
  gitUsesGh: boolean | null;
  /** Whether Homebrew is here to install gh with. */
  brew: boolean;
  ready: boolean;
  next: NextStep | null;
}

export const GH_SIGN_IN = "gh auth login --hostname github.com --git-protocol https --web";
export const GH_SETUP_GIT = "gh auth setup-git --hostname github.com";
export const GH_INSTALL_URL = "https://cli.github.com";

export interface CheckDeps {
  run: Runner;
  /** The file spawn would run for a command, or null. */
  resolve: (command: string) => string | null;
  /** Whether a file is there. */
  exists: (path: string) => boolean;
  platform: NodeJS.Platform;
  home?: string;
}

/** Where the developer tools put a real git on a Mac. Without either,
 * /usr/bin/git is a stub that opens an installer dialog when run, so it is
 * never run to ask its version (server/checkpoints.ts has the same rule). */
const MAC_TOOLS_GIT = ["/Library/Developer/CommandLineTools/usr/bin/git", "/Applications/Xcode.app/Contents/Developer/usr/bin/git"];

function tilde(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

function versionOf(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.[1];
}

function storageOf(source: unknown, home: string): Pick<GitHubAccount, "storage" | "where"> {
  if (source === "keyring") return { storage: "keychain" };
  if (typeof source !== "string" || !source) return { storage: "unknown" };
  if (/^[A-Z][A-Z0-9_]*$/.test(source)) return { storage: "environment", where: source };
  if (source.includes("/") || source.includes("\\")) return { storage: "file", where: tilde(source, home) };
  return { storage: "unknown" };
}

/** gh's account list from `gh auth status --json hosts` (gh 2.71 and on). */
export function parseStatusJson(text: string, home = ""): GitHubAccount[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const hosts = (parsed as { hosts?: unknown })?.hosts;
  if (!hosts || typeof hosts !== "object") return null;
  const out: GitHubAccount[] = [];
  for (const [host, list] of Object.entries(hosts as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const one = raw as Record<string, unknown>;
      if (typeof one?.login !== "string" || !one.login) continue;
      out.push({
        host,
        login: one.login,
        active: one.active === true,
        ok: one.state === "success",
        ...storageOf(one.tokenSource, home),
        scopes: typeof one.scopes === "string" && one.scopes ? one.scopes : null,
        ...(typeof one.gitProtocol === "string" && one.gitProtocol ? { gitProtocol: one.gitProtocol } : {}),
      });
    }
  }
  return out;
}

/** The same from the words an older gh prints. Only the lines about who
 * is signed in and how; the token line is masked by gh and read by nobody. */
export function parseStatusText(text: string, home = ""): GitHubAccount[] {
  const out: GitHubAccount[] = [];
  let host = "";
  let current: GitHubAccount | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(line)) {
      host = line;
      current = null;
      continue;
    }
    const signed = /^(✓|X|✗)?\s*Logged in to (\S+) (?:account|as) (\S+) \(([^)]*)\)/.exec(line);
    if (signed) {
      current = {
        host: signed[2] || host,
        login: signed[3],
        active: true,
        ok: signed[1] !== "X" && signed[1] !== "✗",
        ...storageOf(signed[4], home),
        scopes: null,
      };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const active = /^- Active account: (true|false)/.exec(line);
    if (active) current.active = active[1] === "true";
    const scopes = /^- Token scopes: (.*)$/.exec(line);
    if (scopes) current.scopes = scopes[1].replace(/'/g, "").trim() || null;
    const protocol = /^- Git operations protocol: (\S+)/.exec(line);
    if (protocol) current.gitProtocol = protocol[1];
  }
  return out;
}

/** Whether git's global config sends github.com credentials to gh. */
export function gitAsksGh(config: string): boolean {
  return config
    .split("\n")
    .some((line) => /^credential\.(https:\/\/github\.com\.)?helper\s/.test(line) && /\bgh(\.exe)?["']?\s+auth\s+git-credential\b/.test(line));
}

/** Looks at git and gh on this computer and says what, if anything, is
 * left to do. Runs nothing that changes anything. */
export async function checkGitHubCli(deps: CheckDeps): Promise<GitHubCliStatus> {
  const home = deps.home ?? homedir();
  const git: ToolStatus = { found: false };
  const gitPath = deps.resolve("git");
  if (gitPath) {
    git.path = tilde(gitPath, home);
    if (deps.platform === "darwin" && gitPath === "/usr/bin/git" && !MAC_TOOLS_GIT.some((p) => deps.exists(p))) {
      git.problem = "needs the Command Line Tools";
    } else {
      const ran = await deps.run(gitPath, ["--version"], { timeoutMs: 8_000 });
      if (ran.code === 0) {
        git.found = true;
        git.version = versionOf(ran.stdout, /git version (\S+)/);
      } else git.problem = "did not run";
    }
  }

  const gh: ToolStatus = { found: false };
  const ghPath = deps.resolve("gh");
  let accounts: GitHubAccount[] = [];
  if (ghPath) {
    gh.path = tilde(ghPath, home);
    const ran = await deps.run(ghPath, ["--version"], { timeoutMs: 8_000 });
    if (ran.code === 0) {
      gh.found = true;
      gh.version = versionOf(ran.stdout, /gh version (\S+)/);
      // status asks GitHub whether each sign-in still works, so it can
      // take a moment; never with --show-token
      const json = await deps.run(ghPath, ["auth", "status", "--hostname", "github.com", "--json", "hosts"], { timeoutMs: 20_000 });
      const parsed = json.code === 0 ? parseStatusJson(json.stdout, home) : null;
      if (parsed) accounts = parsed;
      else {
        const words = await deps.run(ghPath, ["auth", "status", "--hostname", "github.com"], { timeoutMs: 20_000 });
        accounts = parseStatusText(`${words.stdout}\n${words.stderr}`, home);
      }
    } else gh.problem = "did not run";
  }
  accounts = accounts.filter((a) => a.host === "github.com");
  const account = accounts.find((a) => a.active) ?? null;

  let gitUsesGh: boolean | null = null;
  if (git.found && gitPath) {
    const config = await deps.run(gitPath, ["config", "--global", "--get-regexp", "^credential\\..*helper$"], { timeoutMs: 8_000 });
    // exit 1 is "no such key", which is a plain no
    gitUsesGh = config.code === 0 ? gitAsksGh(config.stdout) : config.code === 1 ? false : null;
  }
  const brew = deps.platform === "darwin" && Boolean(deps.resolve("brew"));

  let next: NextStep | null = null;
  if (!git.found) {
    next =
      deps.platform === "darwin"
        ? { kind: "git", says: "git comes with Apple's Command Line Tools, which are not installed yet.", command: "xcode-select --install" }
        : { kind: "git", says: "git is not installed on this computer.", command: "sudo apt install git" };
  } else if (!gh.found) {
    next = {
      kind: "install",
      says: gh.problem ? "gh is here but did not run." : "The GitHub CLI, gh, is not installed yet.",
      command: brew ? "brew install gh" : null,
      url: GH_INSTALL_URL,
    };
  } else if (!account || !account.ok) {
    next = {
      kind: "sign-in",
      says: account ? `gh's sign-in as @${account.login} no longer works.` : "gh is not signed in to github.com yet.",
      command: GH_SIGN_IN,
    };
  } else if (gitUsesGh === false) {
    next = { kind: "setup-git", says: "git does not ask gh for its GitHub sign-in yet, so cloning private repositories and pushing may ask for a password.", command: GH_SETUP_GIT };
  }
  return { checkedAt: Date.now(), git, gh, accounts, account, gitUsesGh, brew, ready: next === null, next };
}

/** What an agent is told while the plugin is on, in terms of what is
 * actually ready. */
export function ghHint(status: GitHubCliStatus | null): string {
  if (!status) return "GitHub: the gh plugin is on. Use git and gh as usual for GitHub work; if gh says it is not signed in, tell the owner, who sets it up in Settings, Plugins.";
  if (!status.ready || !status.account) {
    const why = status.next?.says ?? "gh is not ready on this computer.";
    return `GitHub: the gh plugin is on, but it is not ready: ${why} If a task needs GitHub, say so; the owner sets it up in Settings, Plugins.`;
  }
  return [
    `GitHub: git and gh on this computer are signed in to github.com as @${status.account.login}.`,
    "Use them as usual: gh repo clone OWNER/REPO, git switch -c BRANCH, git push -u origin BRANCH, gh pr create --fill.",
    "You act as that account, so its repository permissions and branch protection apply.",
    "Never print, copy or save its token (gh auth token, gh auth status --show-token).",
  ].join(" ");
}
