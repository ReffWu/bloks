// Bloks AI, on the Cloud page.
//
// A monthly allowance on the licence, with top-ups, that pays for model
// use, so an agent can run with no sign-in and no API key of its own.
// This card shows what is left the way the service says it, as a share
// of the month, sends the person to bloks.dev in their browser when they
// want another month's worth (never a purchase in here), and holds the
// choices that are theirs: whether work nobody asked for this minute may
// use it, and on a team, how much of it each teammate may use in a day.
//
// The shares are the service's. Nothing here prices them, converts them,
// or names a model: Bloks AI is the only name it has.
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "@/components/icons";
import { Wallet } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { api, useStore } from "@/state/store";
import { TOP_UP_WORDS, allowanceNote, meterLine, meterShare, memberRows, parseCap, type BloksAiStatus, type MemberRow } from "@/lib/credits";
import { ConnectionError, ConnectionHeader, HealthLine, SecretField } from "./ConnectionKit";
import { SettingRow, SettingsGroup } from "./SettingsLayout";
import { TeamSignInNotice } from "./TeamSignInNotice";

const CLOUD_KEY = /^blok_live_[0-9a-f]{32}$/;

/** GET /api/credits, as the server says it. */
export type CreditsStatus = BloksAiStatus;

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

  // Back from bloks.dev in the browser: look again rather than make
  // anybody press a refresh they would have to know about.
  useEffect(() => {
    const look = () => load(true);
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, [load]);

  if (!status || !status.offered) return <TeamSignInNotice className="mt-4" />;

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
            credits: { offered: next.offered, background: next.background, refused: next.refused, checkoutUrl: next.checkoutUrl, team: next.team },
          });
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const setCap = (member: string, cap: number | null) =>
    api("/api/credits", { method: "PATCH", body: JSON.stringify({ memberCaps: { [member]: cap } }) }).then((next: CreditsStatus) => {
      setStatus(next);
      toast.success(cap === null ? "Daily cap removed" : "Daily cap saved");
    });

  const empty = status.leftPercent !== null && status.leftPercent <= 0;
  const health = status.needsKey
    ? { tone: "off" as const, label: "Not connected" }
    : !status.connected
      ? { tone: "issue" as const, label: "Can't read it" }
      : empty || status.refused
        ? { tone: "issue" as const, label: "Used up" }
        : status.low
          ? { tone: "wait" as const, label: "Running low" }
          : { tone: "on" as const, label: "Ready" };
  const share = meterShare(status);
  const note = status.connected ? allowanceNote(status) : null;
  const rows = status.team !== false ? memberRows(status.members) : [];

  return (
    // the id is where a usage notice's "View usage" lands
    <div id="bloks-ai" className="mt-4 scroll-mt-4 rounded-2xl border bg-card p-4">
      <ConnectionHeader
        icon={<Wallet size={14} className="shrink-0 text-brand-ink" />}
        title="Bloks AI"
        says="Agents can run on Bloks AI instead of a sign-in or a key of their own: pick Bloks AI as an agent's engine, or let a Claude Code agent use it."
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
            {busy ? <Loader2 size={13} className="animate-spin" /> : "Use for Bloks AI"}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            {status.connected && status.leftPercent !== null ? (
              <>
                <div className="text-heading font-semibold tabular-nums text-foreground">{meterLine(status)}</div>
                <div
                  role="meter"
                  aria-label="This month left"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(share)}
                  className="mt-2 h-1.5 max-w-[320px] overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={empty || status.low ? "h-full origin-left bg-warning" : "h-full origin-left bg-brand-ink"}
                    style={{ transform: `scaleX(${share / 100})` }}
                  />
                </div>
                {note && <div className="mt-1.5 text-small text-muted-foreground">{note}</div>}
              </>
            ) : (
              <div className="text-body text-muted-foreground">{status.problem ?? "What is left could not be read just now."}</div>
            )}
            {status.refused && (
              <div className="mt-1 max-w-[60ch] text-pretty text-small leading-relaxed text-warning">{status.refused.message}</div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <a
              href={status.checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-md bg-brand-ink px-3 text-body font-medium text-brand-foreground transition-[filter] hover:brightness-95"
            >
              Top up
            </a>
            <div className="text-caption text-muted-foreground">{TOP_UP_WORDS}</div>
          </div>
        </div>
      )}

      {status.fromEnvironment && (
        <div className="mt-3 text-small text-muted-foreground">This machine came with its own Bloks AI token.</div>
      )}

      {status.teamSignInWarning && <TeamSignInNotice className="mt-3" />}

      {rows.length > 0 && (
        <SettingsGroup title="Your team this month" className="mb-0 mt-4">
          {rows.map((row) => (
            <MemberCapRow key={row.member} row={row} onSave={setCap} />
          ))}
        </SettingsGroup>
      )}

      <SettingsGroup className="mb-0 mt-4">
        <SettingRow
          label="Let background work use Bloks AI"
          info="The nightly memory tidy, skill suggestions and quiet compaction of idle conversations run without anybody asking at that moment. Off, they skip agents on Bloks AI."
          description="Off unless you turn it on. Work you ask for always can."
          control={
            <Switch
              aria-label="Let background work use Bloks AI"
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

/** One teammate: what they used this month, and a daily cap the owner
 * can set as a share of the monthly allowance. Empty is no cap. */
function MemberCapRow({ row, onSave }: { row: MemberRow; onSave: (member: string, cap: number | null) => Promise<void> }) {
  const [text, setText] = useState(row.capPercent === null ? "" : String(row.capPercent));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setText(row.capPercent === null ? "" : String(row.capPercent)), [row.capPercent]);
  const cap = parseCap(text);
  const changed = cap !== undefined && cap !== row.capPercent;

  const save = () => {
    if (!changed || saving) return;
    setSaving(true);
    setProblem(null);
    onSave(row.member, cap)
      .catch((e: Error) => setProblem(e.message))
      .finally(() => setSaving(false));
  };

  const id = `cap-${row.member}`;
  return (
    <SettingRow
      label={row.name}
      description={`${row.used}. ${row.cap}.`}
      htmlFor={id}
      control={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Input
              id={id}
              inputMode="decimal"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setProblem(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="No cap"
              aria-label={`Daily cap for ${row.name}, as a percent of the month`}
              aria-invalid={cap === undefined}
              className="h-8 w-24 pr-7 tabular-nums"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-small text-muted-foreground">%</span>
          </div>
          <Button size="sm" variant="outline" className="h-8" disabled={!changed || saving} onClick={save}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </Button>
        </div>
      }
    >
      {cap === undefined && <div className="mt-1.5 text-small text-warning">A cap is a percent above 0 and at most 100.</div>}
      {problem && <div className="mt-1.5 text-small text-warning">{problem}</div>}
    </SettingRow>
  );
}
