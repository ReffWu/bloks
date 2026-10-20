// Bloks credits, on the Cloud page.
//
// A prepaid balance on the licence that pays for model use, so an agent
// can run with no sign-in and no API key of its own. This card shows the
// balance the service reports, sends the person to the checkout page in
// their browser when they want more (never a purchase in here), and holds
// the one choice that is theirs to make: whether work nobody asked for
// this minute may spend it.
//
// The numbers are the service's. Nothing here prices or converts them.
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "@/components/icons";
import { Wallet } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, useStore } from "@/state/store";
import { balanceNote, balanceText } from "@/lib/credits";
import { ConnectionError, ConnectionHeader, HealthLine, SecretField } from "./ConnectionKit";
import { SettingRow, SettingsGroup } from "./SettingsLayout";

const CLOUD_KEY = /^blok_live_[0-9a-f]{32}$/;

/** GET /api/credits, as the server says it. */
export interface CreditsStatus {
  offered: boolean;
  background: boolean;
  refused: { at: number; message: string } | null;
  checkoutUrl: string;
  fromEnvironment: boolean;
  needsKey: boolean;
  connected: boolean;
  balance: number | null;
  currency: string | null;
  lowAt: number | null;
  low: boolean;
  autoReload: boolean;
  readAt: number | null;
  problem: string | null;
}

export function CreditsSection() {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<CreditsStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the stream says when a run was refused or more was added
  const refusedAt = state.config?.credits?.refused?.at ?? null;

  const load = useCallback((fresh = false) => {
    api(`/api/credits${fresh ? "?fresh=1" : ""}`)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    load();
  }, [load, refusedAt]);

  // Back from the checkout page in the browser: look again rather than
  // make anybody press a refresh they would have to know about.
  useEffect(() => {
    const look = () => load(true);
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, [load]);

  if (!status || !status.offered) return null;

  const connect = () => {
    const trimmed = key.trim();
    if (busy || !CLOUD_KEY.test(trimmed)) return;
    setBusy(true);
    setError(null);
    api("/api/credits/connect", { method: "POST", body: JSON.stringify({ key: trimmed }) })
      .then((next) => {
        setKey("");
        setStatus(next);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const setBackground = (background: boolean) => {
    setBusy(true);
    api("/api/credits", { method: "PATCH", body: JSON.stringify({ background }) })
      .then((next: CreditsStatus) => {
        setStatus(next);
        if (state.config) {
          dispatch({
            type: "credits",
            credits: { offered: next.offered, background: next.background, refused: next.refused, checkoutUrl: next.checkoutUrl },
          });
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const empty = status.balance !== null && status.balance <= 0;
  const health = status.needsKey
    ? { tone: "off" as const, label: "Not connected" }
    : !status.connected
      ? { tone: "issue" as const, label: "Can't read it" }
      : empty || status.refused
        ? { tone: "issue" as const, label: "Empty" }
        : status.low
          ? { tone: "wait" as const, label: "Running low" }
          : { tone: "on" as const, label: "Ready" };
  const note = status.connected ? balanceNote(status) : null;

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <ConnectionHeader
        icon={<Wallet size={14} className="shrink-0 text-brand-ink" />}
        title="Bloks credits"
        says="Agents can run on credits instead of a sign-in or a key of their own: pick Bloks as an agent's engine, or let a Claude Code agent use credits."
        health={<HealthLine tone={health.tone} label={health.label} />}
      />

      <ConnectionError>{error}</ConnectionError>

      {status.needsKey ? (
        <div className="mt-3 flex items-start gap-2">
          <SecretField
            id="credits-key"
            label="Bloks Cloud key"
            value={key}
            onChange={(value) => {
              setKey(value);
              setError(null);
            }}
            shape={CLOUD_KEY}
            hint="The same key you activated Cloud with. It's in your confirmation email."
            placeholder="blok_live_..."
            onEnter={connect}
            className="min-w-0 flex-1"
          />
          <Button size="sm" variant="brand" className="mt-[22px] h-8" disabled={busy || !CLOUD_KEY.test(key.trim())} onClick={connect}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : "Use for credits"}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {status.connected && status.balance !== null ? (
              <>
                <div className="text-heading font-semibold tabular-nums text-foreground">
                  {balanceText(status.balance, status.currency)}
                </div>
                {note && <div className="mt-0.5 text-small text-muted-foreground">{note}</div>}
              </>
            ) : (
              <div className="text-body text-muted-foreground">{status.problem ?? "The balance could not be read just now."}</div>
            )}
            {status.refused && (
              <div className="mt-1 max-w-[60ch] text-pretty text-small leading-relaxed text-warning">{status.refused.message}</div>
            )}
          </div>
          <a
            href={status.checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center rounded-md bg-brand-ink px-3 text-body font-medium text-brand-foreground transition-[filter] hover:brightness-95"
          >
            Add credits
          </a>
        </div>
      )}

      {status.fromEnvironment && (
        <div className="mt-3 text-small text-muted-foreground">This machine came with its own credits token.</div>
      )}

      <SettingsGroup className="mb-0 mt-4">
        <SettingRow
          label="Let background work use credits"
          info="The nightly memory tidy, skill suggestions and quiet compaction of idle conversations run without anybody asking at that moment. Off, they skip agents on credits."
          description="Off unless you turn it on. Work you ask for always can."
          control={
            <Switch
              aria-label="Let background work use credits"
              checked={status.background}
              disabled={busy}
              onCheckedChange={setBackground}
            />
          }
        />
      </SettingsGroup>
    </div>
  );
}
