// Settings, About and updates: which Bloks this is, the way to the next
// one, and the two ways to tell us something is wrong.
import { useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useStore } from "@/state/store";
import type { UpdateState } from "@/types/bridge";
import { drainingLine } from "../UpdateCard";
import { SettingRow, SettingsGroup } from "../SettingsLayout";

/** The small mark a hosted workspace wears in Settings, so nobody wonders
 * why the Mac's own options are not there. */
export function HostedMark() {
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-caption font-medium text-muted-foreground">
      Hosted
    </span>
  );
}

/**
 * What version this is, and the way to the next one.
 *
 * The updater already runs on its own at launch; this card exists so a
 * person can ask instead of waiting, watch the download when there is
 * one, and restart into it the moment it is ready. In a plain browser
 * tab there is no updater and the card says only what it knows.
 */
export function AboutPage() {
  const { state } = useStore();
  const hosted = Boolean(state.config?.hosted?.on);
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ state: "idle" });

  useEffect(() => {
    // A window without the desktop app (a hosted workspace in a browser)
    // has no app to ask, so the server says which build it runs.
    if (!window.bloks?.appVersion) {
      void fetch("/api/health")
        .then((r) => r.json())
        .then((health: { version?: string }) => setVersion(health.version || null))
        .catch(() => {});
    }
    void window.bloks?.appVersion?.().then(setVersion);
    void window.bloks?.updateState?.().then(setUpdate);
    return window.bloks?.onUpdateState?.(setUpdate);
  }, []);

  const line =
    update.state === "checking"
      ? "Checking…"
      : update.state === "downloading"
        ? `Downloading ${update.version ?? "the update"}${update.percent ? ` (${update.percent}%)` : ""}…`
        : update.state === "current"
          ? "You are on the latest version."
          : update.state === "ready"
            ? update.draining
              ? drainingLine(update.draining)
              : `${update.version ?? "An update"} is downloaded and ready.`
            : update.state === "error"
              ? update.reason === "install"
                ? "The update downloaded but didn't install. Quit and reopen Bloks to try again."
                : update.reason === "server"
                  ? "Couldn't get the update. Try again in a few minutes."
                  : "Couldn't reach the update server. Bloks will try again in a few hours."
              : update.state === "dev"
                ? "Updates apply to the installed app, not a dev build."
                : null;
  // a restart into an update that came back on the same version says so
  // before whatever the updater is doing now
  const description = update.notInstalled
    ? `The update did not install. ${line ?? "You can get the installer from bloks.dev."}`
    : (line ?? "Updates download on their own and install when you restart.");

  return (
    <>
    <SettingsGroup title="Version">
      {hosted && (
        <SettingRow
          label={
            <>
              This workspace <HostedMark />
            </>
          }
          description="It runs on a machine hosted for you, not on your Mac. Its browser and its virtual desktop are your agents' computer."
        />
      )}
      <SettingRow
        label={`Bloks ${version ?? ""}`}
        description={description}
        control={
          update.state === "ready" ? (
            <Button size="sm" disabled={Boolean(update.draining)} onClick={() => void window.bloks?.updateInstall?.()}>
              Restart to update
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={!window.bloks || update.state === "checking" || update.state === "downloading"}
              onClick={() => void window.bloks?.updateCheck?.().then(setUpdate)}
            >
              Check for updates
            </Button>
          )
        }
      />
    </SettingsGroup>
    <SettingsGroup title="Help">
      <SettingRow
        label="Something broken, or missing?"
        description="Opens a GitHub issue."
        control={
          <Button size="sm" variant="secondary" asChild>
            <a
              href={`https://github.com/hamedgitty/bloks/issues/new?body=${encodeURIComponent(`\n\n---\nBloks ${version ?? ""} on ${navigator.platform}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Send feedback
            </a>
          </Button>
        }
      />
      <Diagnostics />
    </SettingsGroup>
    </>
  );
}

/**
 * One button between "it doesn't work" and a useful bug report. The
 * server assembles the facts (versions, engine states, which
 * credentials exist as booleans, never values) and this copies them,
 * ready to paste into a GitHub issue.
 */
function Diagnostics() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      const report = await fetch("/api/diagnostics").then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      });
      await navigator.clipboard.writeText(report);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  };
  return (
    <SettingRow
      label="Diagnostics"
      info="Versions, connection states, which keys are set (yes or no) and agent counts. Never the keys, and anything that looks like one is removed."
      description="A short report to paste into a bug report."
      error={failed ? "Couldn't build the report. Is the server running?" : null}
      control={
        <Button size="sm" variant="secondary" onClick={() => void copy()} className="min-w-[128px]">
          {copied ? (
            <>
              <Check size={14} /> Copied
            </>
          ) : (
            "Copy diagnostics"
          )}
        </Button>
      }
    />
  );
}
