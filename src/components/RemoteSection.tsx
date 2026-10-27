// Where this app's Bloks lives: on this computer, or on another one that
// never sleeps (bloks-server), reached through Bloks Cloud.
//
// Desktop only. In a browser or on a phone there is no "this app" to move.
//
// The card says where it runs in a line and keeps the how behind a
// disclosure: most people read it once, and the field is all they need
// after that. Switching restarts the app, so it asks before it does.
import { useEffect, useState } from "react";
import { ChevronRight } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Server } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { thisComputer } from "@/lib/thisComputer";
import { ConnectionHeader, HealthLine } from "./ConnectionKit";
import { t, tr } from "@/lib/i18n";

type Status = { mode: "local" } | { mode: "remote"; host: string; connected: boolean; revoked?: boolean };

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-muted px-1 font-mono text-caption text-foreground">{children}</code>
);

export function RemoteSection() {
  const bridge = typeof window !== "undefined" ? window.bloks : undefined;
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge?.remoteStatus) return;
    void bridge.remoteStatus().then(setStatus);
    return bridge.onRemoteState?.((state) => setStatus({ mode: "remote", ...state }));
  }, [bridge]);

  if (!bridge?.remoteStatus || !status) return null;

  const pasted = link.trim();

  const connect = async () => {
    if (busy || !pasted) return;
    const yes = await confirm({
      title: t("remoteSection.useThatBloksTitle"),
      body: t("remoteSection.useThatBloksBody", { computer: thisComputer() }),
      confirmLabel: t("remoteSection.switch"),
    });
    if (!yes) return;
    setBusy(true);
    setError(null);
    const result = await bridge.remoteConnect!(pasted);
    // on success the app restarts, so only a failure lands here
    if (result?.error) setError(result.error);
    setBusy(false);
  };

  const leave = async () => {
    const yes = await confirm({
      title: t("remoteSection.useThisInsteadTitle", { computer: thisComputer() }),
      body: t("remoteSection.useThisInsteadBody"),
      confirmLabel: t("remoteSection.switch"),
    });
    if (yes) bridge.remoteDisconnect?.();
  };

  const icon = <Server size={14} className="shrink-0 text-muted-foreground" />;

  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0" data-setting-row="where-your-bloks-runs">
      {status.mode === "remote" ? (
        <>
          <ConnectionHeader
            icon={icon}
            title={t("remoteSection.whereYourBloksRuns")}
            says={
              status.revoked
                ? t("remoteSection.onHostRevoked", { host: status.host })
                : t("remoteSection.onHost", { host: status.host, computer: thisComputer() })
            }
            health={
              <HealthLine
                tone={status.connected && !status.revoked ? "on" : "issue"}
                label={status.revoked ? t("remoteSection.pairAgain") : status.connected ? t("common.connected") : t("remoteSection.cantReachIt")}
              />
            }
          />
          <Button size="sm" variant="secondary" className="mt-3" disabled={busy} onClick={() => void leave()}>
            {t("remoteSection.useThisInstead", { computer: thisComputer() })}
          </Button>
        </>
      ) : (
        <>
          <ConnectionHeader icon={icon} title={t("remoteSection.whereYourBloksRuns")} says={t("remoteSection.onThisComputer", { computer: thisComputer() })} />
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <Input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setError(null);
              }}
              aria-label={t("remoteSection.linkFromBloksServer")}
              placeholder={t("remoteSection.pasteALinkFromBloks")}
              autoComplete="off"
              spellCheck={false}
              className={cn("h-8 min-w-0 flex-1 text-body", link && "font-mono")}
            />
            {/* grey until there is a link to use, then plainly the thing to press */}
            <Button type="submit" variant={pasted ? "brand" : "secondary"} disabled={busy || !pasted}>
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t("remoteSection.useThatBloks")}
            </Button>
          </form>
          <details className="group mt-2.5">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-small text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight size={12} className="transition-transform duration-150 group-open:rotate-90" />
              {t("remoteSection.how")}
            </summary>
            <p className="mt-1.5 max-w-[60ch] pl-4 text-pretty text-small leading-relaxed text-muted-foreground">
              {tr("remoteSection.howSteps", {
                server: <Code>bloks-server</Code>,
                command: <Code>bloks-server pair</Code>,
                computer: thisComputer(),
              })}
            </p>
          </details>
        </>
      )}
      {error && (
        <div role="alert" className="mt-2 text-small text-warning">
          {error}
        </div>
      )}
    </div>
  );
}
