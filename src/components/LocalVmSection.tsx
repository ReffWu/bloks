// Setting up the Local VM, as a checklist that checks itself.
//
// Four steps stand between a bare Mac and an agent with its own Linux
// desktop: a container runtime, that runtime running, the Cua desktop
// image prepared, and the VM created. The server reports which are done,
// and a slow poll keeps the card honest while things install.
//
// Only the next step is drawn as a step. The ones behind it fold into a
// single quiet line saying what is already in place, because a column of
// struck-through ticks is the loudest thing on the page and the least
// useful. The commands behind the buttons sit one disclosure away, and the
// specs and the workspace path one more, for people who want the wires.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "@/components/icons";
import { ChevronRight } from "@/components/icons";
import { ExternalLink } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { confirm, type ConfirmOptions } from "@/components/ui/confirm";
import { cn } from "@/lib/cn";
import { thisComputer } from "@/lib/thisComputer";
import { usePageVisible } from "@/lib/pageVisible";
import { HealthLine, type Health } from "./ConnectionKit";
import { SettingsGroup } from "./SettingsLayout";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

interface VmStatus {
  runtime: string | null;
  daemonUp: boolean;
  imageReady: boolean;
  container: "running" | "stopped" | "missing";
  desktopReady: boolean;
  ready: boolean;
  problem: string | null;
  viewerUrl: string | null;
  workspace: string;
  imageRef: string;
  baseRef: string;
  driverVersion: string;
  inUseBy: string | null;
  commands: { pull: string; run: string };
}

function CommandReveal({ label, command }: { label: string; command: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded text-small text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight size={11} className={cn("transition-transform", open && "rotate-90")} />
        {label}
      </button>
      {open && (
        <code className="mt-1.5 block overflow-x-auto whitespace-nowrap rounded-lg bg-foreground/[0.05] px-3 py-2 font-mono text-caption text-foreground">
          {command}
        </code>
      )}
    </div>
  );
}

/** Small print under the next step: the how, in a sentence. */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-pretty text-body text-muted-foreground">{children}</p>;
}

/** What the steps already behind you add up to, said once. Indexed by
 * the step that is next. */
const BEHIND = [
  null,
  "The container runtime is installed.",
  "The container runtime is installed and running.",
  "The runtime and desktop are installed.",
] as const;

export function LocalVmSection() {
  const [status, setStatus] = useState<VmStatus | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  const load = useCallback(() => {
    if (inflight.current) return;
    inflight.current = true;
    api("/api/local-vm")
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        inflight.current = false;
      });
  }, []);

  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load, visible]);

  const act = async (verb: "prepare" | "create" | "remove", ask?: ConfirmOptions) => {
    if (ask && !(await confirm(ask))) return;
    setActing(verb);
    setError(null);
    api(`/api/local-vm/${verb}`, { method: "POST" })
      .then((s) => setStatus((cur) => ({ ...cur, ...s }) as VmStatus))
      .catch((e: Error) => setError(e.message))
      .finally(() => setActing(null));
  };

  const s = status;
  const staleOrStopped = s?.container === "stopped" || (s?.container === "running" && !s.desktopReady && s.imageReady && Boolean(s.problem?.includes("older")));

  const steps: Array<{ done: boolean; title: string | null; body: React.ReactNode }> = s
    ? [
        {
          done: s.runtime !== null,
          title: "Install a container runtime",
          body: <Hint>Apple's container CLI or Docker Desktop.</Hint>,
        },
        {
          done: s.daemonUp,
          title: "Start the container runtime",
          body:
            s.runtime === "container" ? (
              <Hint>
                Run <code className="rounded bg-muted px-1 font-mono text-small text-foreground">container system start</code> in a terminal.
              </Hint>
            ) : s.runtime ? (
              <Hint>Open Docker and wait for it to start.</Hint>
            ) : null,
        },
        {
          done: s.imageReady,
          title: "Prepare the Cua desktop",
          body: (
            <>
              <Hint>A one-time download.</Hint>
              {s.daemonUp && (
                <Button variant="brand" size="sm" className="mt-3" disabled={acting !== null} onClick={() => act("prepare")}>
                  {acting === "prepare" && <Loader2 size={12} className="animate-spin" />}
                  {acting === "prepare" ? "Preparing, takes a few minutes" : "Prepare Cua desktop"}
                </Button>
              )}
              <CommandReveal label="Show download command" command={s.commands.pull} />
            </>
          ),
        },
        {
          done: s.container === "running" && s.desktopReady,
          // the line above already says it is ready to create, so the
          // button needs no heading of its own to repeat it
          title: staleOrStopped ? "Create the Local VM again" : s.container === "missing" ? null : "Starting the Local VM",
          body: (
            <>
              {s.imageReady &&
                (staleOrStopped ? (
                  <>
                    <Hint>Files in its workspace are kept. Everything else resets.</Hint>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="mt-3"
                      disabled={acting !== null}
                      onClick={() =>
                        void act("remove", {
                          title: "Recreate the Local VM?",
                          body: "Files in its workspace are kept. Everything else resets.",
                          confirmLabel: "Remove",
                          destructive: true,
                        })
                      }
                    >
                      {acting === "remove" && <Loader2 size={12} className="animate-spin" />}
                      Remove, then create again
                    </Button>
                  </>
                ) : s.container === "missing" ? (
                  <Button variant="brand" size="sm" disabled={acting !== null} onClick={() => act("create")}>
                    {acting === "create" && <Loader2 size={12} className="animate-spin" />}
                    Create Local VM
                  </Button>
                ) : (
                  <div className="mt-1 flex items-center gap-1.5 text-body text-muted-foreground">
                    <Loader2 size={12} className="animate-spin" />
                    {s.problem ?? "Waiting for the desktop…"}
                  </div>
                ))}
              <CommandReveal label="Show command" command={s.commands.run} />
            </>
          ),
        },
      ]
    : [];
  const next = steps.findIndex((step) => !step.done);
  const step = next >= 0 ? steps[next] : null;
  const behind =
    next === 3 && s?.container === "missing" ? "Ready to create: the runtime and desktop are installed." : next > 0 ? BEHIND[next] : null;

  const health: { tone: Health; label: string } | null = !s
    ? null
    : s.ready
      ? { tone: "on", label: s.inUseBy ? "In use" : "Ready" }
      : staleOrStopped && s.imageReady
        ? { tone: "wait", label: s.container === "stopped" ? "Stopped" : "Out of date" }
        : s.container !== "missing" && s.imageReady
        ? { tone: "wait", label: "Starting" }
        : { tone: "off", label: "Not set up" };

  return (
    <SettingsGroup
      title="Local VM"
      description={`A free Linux desktop on ${thisComputer()}, kept apart from yours.`}
      action={
        <>
          {health && <HealthLine tone={health.tone} label={health.label} />}
          <Button variant="ghost" size="icon-sm" onClick={load} aria-label="Check again" title="Check again">
            <RefreshCw size={13} />
          </Button>
        </>
      }
    >
      <div data-setting-row="local-vm" className="p-5 transition-colors duration-700">
        {error && <div className="mb-3 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-small text-destructive">{error}</div>}

        {s === null ? (
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
        ) : s.ready ? (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 text-body text-foreground">
              {s.inUseBy ? `${s.inUseBy} is using it.` : "Ready for any agent that needs a computer."}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {s.viewerUrl && (
                <Button variant="secondary" size="sm" asChild>
                  <a href={s.viewerUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} />
                    Watch its screen
                  </a>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="hover:bg-destructive/10 hover:text-destructive"
                disabled={acting !== null}
                onClick={() =>
                  void act("remove", {
                    title: "Remove the Local VM?",
                    body: "Files in its workspace are kept.",
                    confirmLabel: "Remove",
                    destructive: true,
                  })
                }
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <>
            {behind && (
              <div className="mb-4 flex items-start gap-2 text-body text-muted-foreground">
                <Check size={14} strokeWidth={2.5} className="mt-[3px] shrink-0 text-success" />
                <span className="min-w-0 text-pretty">{behind}</span>
              </div>
            )}
            {step && (
              <div aria-current="step">
                {step.title && <div className="text-ui font-medium text-foreground">{step.title}</div>}
                {step.body}
              </div>
            )}
          </>
        )}
      </div>

      {s && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-5 py-2.5 text-small text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight size={12} className="transition-transform duration-150 group-open:rotate-90" />
            Details
          </summary>
          <div className="px-5 pb-4 pl-[37px] text-small leading-relaxed text-muted-foreground">
            <p className="text-pretty">
              4 GB memory and 2 CPUs. It resets after 8 idle hours; files and browser sign-ins in its workspace stay. Its
              screen opens only on {thisComputer()}.
            </p>
            <p className="mt-1.5 break-all">
              Workspace <span className="font-mono text-caption text-foreground/80">{s.workspace}</span>
            </p>
            <p className="mt-0.5">Driver {s.driverVersion}</p>
          </div>
        </details>
      )}
    </SettingsGroup>
  );
}
