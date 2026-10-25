// Settings, About: the workspace server, when it is not the one inside
// this app (server/server-update.ts; GitHub 396).
//
// The desktop app can be a window onto a bloks-server on another
// computer, and updating the app never updated that server, while the
// page said only one version and so read as though it had. So the two are
// said apart: this app's version beside its own updater, and the
// server's, on the computer it runs on, beside its own. The owner checks
// GitHub for a newer server, reads what changed, and installs it from
// here when the server can update itself, or reads the steps to do it by
// hand when it cannot. The server inside the app is the app's to update,
// so it gets no row of its own.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "@/components/icons";
import { ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { SettingRow } from "../SettingsLayout";

type Phase = "downloading" | "unpacking" | "draining" | "restarting" | "failed" | "cancelled";

export interface ServerUpdateStatus {
  version: string;
  computer: string;
  install: { kind: string; canInstall: boolean; why: string; manager?: string };
  check: {
    at: number;
    latest?: { version: string; notes: string; page: string; publishedAt?: string; checksum: boolean };
    newer: boolean;
    error?: string;
  } | null;
  job: { phase: Phase; version: string; from: string; percent?: number; running?: number; deadline?: number; error?: string } | null;
  last: { from: string; to: string; at: number; pending?: boolean; ok: boolean; rolledBack?: boolean; running?: string; error?: string; log: string } | null;
  steps: string[];
}

/** What the page knows about the workspace server: its status, or that it
 * is older than this and only says its version, or nothing to show. */
export type ServerView =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "older"; version: string }
  | { kind: "status"; status: ServerUpdateStatus };

/** A check older than this is asked again when the page opens. */
const STALE_MS = 6 * 60 * 60_000;
/** How long a restart is waited for before the page says it is taking long. */
const RESTART_PATIENCE_MS = 4 * 60_000;
const ACTIVE: Phase[] = ["downloading", "unpacking", "draining", "restarting"];

/** The workspace server's update status, kept fresh while an update runs
 * and through the restart that ends it. */
export function useServerUpdate(): {
  view: ServerView;
  check: () => Promise<void>;
  install: (version: string) => Promise<void>;
  cancel: () => Promise<void>;
  busy: boolean;
  problem: string | null;
  /** Restarting into this version, and not heard back from yet. */
  restartingTo: string | null;
  slow: boolean;
} {
  const [view, setView] = useState<ServerView>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [restartingTo, setRestartingTo] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const restartAt = useRef(0);
  const checked = useRef(false);

  const take = useCallback((status: ServerUpdateStatus) => {
    setView(status.install.kind === "desktop" ? { kind: "none" } : { kind: "status", status });
    if (status.job?.phase === "restarting") {
      if (!restartAt.current) restartAt.current = Date.now();
      setRestartingTo(status.job.version);
    } else if (status.last && !status.last.pending && Date.now() - status.last.at < 10 * 60_000) {
      // the helper has said how it went: the restart is over either way
      restartAt.current = 0;
      setRestartingTo(null);
      setSlow(false);
    }
  }, []);

  const load = useCallback(async (): Promise<ServerUpdateStatus | null> => {
    try {
      const status = (await api("/api/server-update")) as ServerUpdateStatus;
      take(status);
      return status;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404) {
        // a server from before 3.0.14, which says only its version
        const health = await api("/api/health").catch(() => null);
        setView(health?.version ? { kind: "older", version: String(health.version) } : { kind: "none" });
      } else if (status === 403) {
        setView({ kind: "none" });
      } else if (restartAt.current) {
        // gone while it restarts, which is expected for a while
        if (Date.now() - restartAt.current > RESTART_PATIENCE_MS) setSlow(true);
      } else {
        setView((current) => (current.kind === "loading" ? { kind: "none" } : current));
      }
      return null;
    }
  }, [take]);

  const check = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      take((await api("/api/server-update/check", { method: "POST" })) as ServerUpdateStatus);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [take]);

  // once on opening: what it is, and a fresh look at GitHub if the last
  // one is old and nothing is under way
  useEffect(() => {
    void load().then((status) => {
      if (!status || checked.current || status.install.kind === "desktop" || status.install.kind === "hosted") return;
      checked.current = true;
      const stale = !status.check || Date.now() - status.check.at > STALE_MS;
      if (stale && !(status.job && ACTIVE.includes(status.job.phase))) void check();
    });
  }, [load, check]);

  // while an update runs, and through its restart, keep asking
  const running = view.kind === "status" && Boolean(view.status.job && ACTIVE.includes(view.status.job.phase));
  const pending = view.kind === "status" && Boolean(view.status.last?.pending);
  useEffect(() => {
    if (!running && !pending && !restartingTo) return;
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [running, pending, restartingTo, load]);

  const install = useCallback(
    async (version: string) => {
      setBusy(true);
      setProblem(null);
      try {
        take((await api("/api/server-update/install", { method: "POST", body: JSON.stringify({ version }) })) as ServerUpdateStatus);
      } catch (e) {
        setProblem((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [take],
  );

  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      take((await api("/api/server-update/install", { method: "DELETE" })) as ServerUpdateStatus);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [take]);

  return { view, check, install, cancel, busy, problem, restartingTo, slow };
}

/** What a running update is doing, in a line. */
function jobLine(job: NonNullable<ServerUpdateStatus["job"]>, now = Date.now()): string {
  switch (job.phase) {
    case "downloading":
      return `Downloading ${job.version}${job.percent ? ` (${job.percent}%)` : ""}…`;
    case "unpacking":
      return `Checked against the release's checksum. Unpacking ${job.version} beside ${job.from}…`;
    case "draining": {
      const n = job.running ?? 0;
      const what = n > 0 ? `${n} running ${n === 1 ? "reply" : "replies"}` : "what's running";
      const minutes = job.deadline ? Math.ceil((job.deadline - now) / 60_000) : null;
      const left = minutes === null ? "" : minutes > 1 ? ` (${minutes} minutes left)` : " (under a minute left)";
      return `Finishing ${what} before the server restarts into ${job.version}…${left}`;
    }
    case "restarting":
      return `Restarting the server into ${job.version}…`;
    case "failed":
      return `The update stopped and nothing changed. ${job.error ?? ""}`.trim();
    case "cancelled":
      return "Called off. Nothing changed.";
  }
}

/**
 * The workspace server's row: its version on its computer, what an
 * update would do or is doing, and the one button that fits. Under it,
 * the new version's notes and, where it does not update itself, the
 * steps to do it by hand.
 */
export function ServerUpdateRow({ state }: { state: ReturnType<typeof useServerUpdate> }) {
  const { view, check, install, cancel, busy, problem, restartingTo, slow } = state;
  if (view.kind === "loading" || view.kind === "none") return null;

  if (view.kind === "older") {
    return (
      <SettingRow
        rowId="workspace-server"
        label={`Workspace server: Bloks ${view.version}`}
        description={
          <>
            This server is older than Bloks 3.0.14, so it can't be checked or updated from here, and updating this app doesn't update it.
            Update it by hand once, on the computer it runs on; after that, new versions can be installed from this page.{" "}
            <a href="https://bloks.dev/docs#server" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              How to update it
            </a>
          </>
        }
      />
    );
  }

  const { status } = view;
  const { install: how, check: looked, job, last } = status;
  const latest = looked?.latest;
  const recent = last && !last.pending && Date.now() - last.at < 24 * 60 * 60_000 ? last : null;
  const active = Boolean(job && ACTIVE.includes(job.phase));
  const fixed = how.kind === "hosted" || how.kind === "disabled";

  const line = restartingTo
    ? slow
      ? `The server hasn't answered since it began restarting into ${restartingTo}. If it went back to the version before, this page will say so once it answers.`
      : `Restarting the server into ${restartingTo}. If it doesn't start, the version before comes back on its own…`
    : job && (active || job.phase === "failed" || job.phase === "cancelled")
      ? jobLine(job)
      : recent && recent.to === status.version && recent.ok
        ? `Updated from ${recent.from} to ${recent.to}. Its output now goes to ${recent.log}.`
        : recent && !recent.ok
          ? `${recent.to} didn't start${recent.rolledBack ? `, so ${recent.from} is running again` : ""}. ${recent.error ?? ""}`.trim()
          : how.kind === "hosted"
            ? how.why
            : looked?.error
              ? looked.error
              : looked?.newer && latest
                ? `Bloks ${latest.version} is out.${how.canInstall ? " Installing it restarts the server once running replies finish; your workspace stays as it is." : ""}`
                : looked
                  ? "The server is on the latest version."
                  : busy
                    ? "Checking…"
                    : "Checks GitHub for a newer bloks-server.";

  const control = fixed ? null : active && job?.phase !== "restarting" ? (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void cancel()}>
      Call off
    </Button>
  ) : restartingTo || job?.phase === "restarting" ? (
    <Button size="sm" variant="secondary" disabled>
      <Loader2 size={14} className="animate-spin" /> Restarting
    </Button>
  ) : looked?.newer && latest && how.canInstall && latest.checksum ? (
    <Button size="sm" disabled={busy} onClick={() => void install(latest.version)}>
      Install {latest.version}
    </Button>
  ) : (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void check()}>
      {busy ? "Checking…" : "Check for updates"}
    </Button>
  );

  return (
    <SettingRow
      rowId="workspace-server"
      label={`Workspace server: Bloks ${status.version}`}
      description={
        <>
          <span className="block">Runs this workspace on {status.computer}. Updating it doesn't update this app, and updating this app doesn't update it.</span>
          <span className={cn("mt-1 block", job?.phase === "failed" || (recent && !recent.ok) ? "text-destructive" : undefined)} aria-live="polite">
            {line}
          </span>
        </>
      }
      error={problem}
      control={control}
    >
      {looked?.newer && latest && !restartingTo && (
        <div className="mt-3 flex flex-col gap-3">
          {latest.notes && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-small text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight size={12} className="transition-transform duration-150 group-open:rotate-90" />
                What's new in {latest.version}
              </summary>
              <div className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-small leading-relaxed text-foreground">
                {latest.notes}
              </div>
              <a href={latest.page} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-small text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Release page
              </a>
            </details>
          )}
          {!how.canInstall && !fixed && (
            <div className="rounded-lg border bg-card p-3">
              <div className="text-small leading-relaxed text-muted-foreground">{how.why}</div>
              {status.steps.length > 0 && (
                <pre className="mt-2 overflow-x-auto whitespace-pre rounded-md bg-muted/60 p-2.5 font-mono text-caption leading-relaxed text-foreground">
                  {status.steps.join("\n")}
                </pre>
              )}
            </div>
          )}
          {how.canInstall && !latest.checksum && (
            <div className="text-small text-muted-foreground">This release publishes no checksum for its server, so it can only be installed by hand.</div>
          )}
        </div>
      )}
    </SettingRow>
  );
}
