// Bloks Cloud, from the buyer's side.
//
// Pairing above this makes the phone work on your own wifi. This is what
// makes it work anywhere, and it is the one paid thing in the product, so
// the screen has exactly two jobs: take the key somebody just bought, and
// then never lie about whether it is working.
//
// Three facts, kept apart on purpose. A key that was accepted is not a
// line that is up, and a line that is up is not a space the relay has
// acknowledged. Collapsing them into one green light is how somebody sits
// looking at "connected" while their phone gets nothing. The pill in the
// corner is the same one every connection card wears, and only goes green
// on the last of the three.
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Cloud } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { thisComputer } from "@/lib/thisComputer";
import {
  ConnectionError,
  ConnectionHeader,
  ConnectionNote,
  HealthLine,
  PairedMoment,
  SecretField,
  type Health,
} from "./ConnectionKit";

const CLOUD_KEY = /^blok_live_[0-9a-f]{32}$/;

interface RelayStatus {
  enabled: boolean;
  connected: boolean;
  /** Missing from an older server, which could not tell. */
  delivering?: boolean;
  spaceId: string | null;
  /** Why the line is down, in the link's words. Never a secret. */
  problem?: string | null;
  /** Whether phone access is on. Cloud only dials while it is. Missing
   * from an older server. */
  pairing?: boolean;
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  // The relay's own words, not ours. It is the thing that knows whether a
  // card failed, and rewriting that into "something went wrong" is how a
  // billing problem arrives as a bug report.
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

export function CloudSection() {
  const [status, setStatus] = useState<RelayStatus | null>(null);
  /** How many phones are paired. A pitch that names what somebody
   * already has beats one that describes a product they do not. */
  const [phones, setPhones] = useState(0);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set by an activation on this screen and spent by the first green after
  // it: the moment belongs to the purchase, not to every reconnect.
  const [armed, setArmed] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const load = useCallback(() => {
    api("/api/relay/status")
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, connected: false, spaceId: null }));
    api("/api/pair")
      .then((s) => setPhones(Array.isArray(s?.devices) ? s.devices.length : 0))
      .catch(() => setPhones(0));
  }, []);

  useEffect(() => {
    load();
    // The line comes up a moment after the key is accepted, so the screen
    // has to look again rather than take the activation at its word.
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const keyLooksRight = CLOUD_KEY.test(key.trim());
  const activate = () => {
    const trimmed = key.trim();
    if (busy || !trimmed) return;
    if (!CLOUD_KEY.test(trimmed)) {
      setError("That's not a Bloks Cloud key. They start with blok_live_.");
      return;
    }
    setBusy(true);
    setError(null);
    api("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: trimmed }) })
      .then(() => {
        setKey("");
        setArmed(true);
        load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  // Phone access is the master switch, Cloud included: turning it off is
  // how somebody cuts every phone loose at once. So a key can be accepted
  // while nothing dials, and the screen has to say which switch is off.
  const turnOnPhones = () => {
    setBusy(true);
    setError(null);
    api("/api/pair", { method: "PATCH", body: JSON.stringify({ enabled: true }) })
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const on = status?.enabled ?? false;
  const phonesOff = on && status?.pairing === false;
  // green only when the answers land too, not just when the line is open
  const working = Boolean(status?.connected) && status?.delivering !== false;

  useEffect(() => {
    if (!armed || !on || !working) return;
    setArmed(false);
    setCelebrating(true);
  }, [armed, on, working]);
  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => setCelebrating(false), 2800);
    return () => clearTimeout(timer);
  }, [celebrating]);

  const health: { tone: Health; label: string } | null = !status
    ? null
    : !on
      ? { tone: "off", label: "Not active" }
      : working
        ? { tone: "on", label: "Connected" }
        : phonesOff
          ? { tone: "issue", label: "Paused" }
          : status.connected
            ? { tone: "issue", label: "Replies failing" }
            : { tone: "wait", label: "Reconnecting" };

  const keyField = (action: string, variant: "brand" | "outline") => (
    <div className="flex items-start gap-2">
      <SecretField
        id="cloud-key"
        label="Bloks Cloud key"
        value={key}
        onChange={(value) => {
          setKey(value);
          setError(null);
        }}
        shape={CLOUD_KEY}
        hint="Starts with blok_live_. It's in your confirmation email."
        placeholder="blok_live_..."
        onEnter={activate}
        className="min-w-0 flex-1"
      />
      <Button size="sm" variant={variant} className="mt-[22px] h-8" disabled={busy || !keyLooksRight} onClick={activate}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : action}
      </Button>
    </div>
  );

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <ConnectionHeader
        icon={<Cloud size={14} className="shrink-0 text-brand-ink" />}
        title="Your plan"
        says={`Reach ${thisComputer()} from your phone anywhere, and get notified when an agent needs you. Your agents and keys stay here.`}
        health={health && <HealthLine tone={health.tone} label={health.label} />}
      />

      <ConnectionError>{error}</ConnectionError>

      <AnimatePresence initial={false}>
        {celebrating && (
          <PairedMoment
            key="cloud"
            icon={<Cloud size={18} />}
            title="Bloks Cloud is on"
            detail={`Paired phones reach ${thisComputer()} from anywhere now.`}
          />
        )}
      </AnimatePresence>

      {status === null ? (
        <Loader2 size={14} className="mt-3 animate-spin text-muted-foreground" />
      ) : on ? (
        <>
          <div className="mt-3 text-small leading-relaxed text-muted-foreground">
            {phonesOff ? (
              <>
                Activated, but phone access is off on {thisComputer()}. Cloud only works while it is on.
                <div className="mt-2">
                  <Button size="sm" variant="brand" disabled={busy} onClick={turnOnPhones}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : "Turn on phone access"}
                  </Button>
                </div>
              </>
            ) : status.connected && status.delivering === false ? (
              <>
                Replies from {thisComputer()} aren't getting through, usually because of the network here. Bloks
                keeps retrying.
              </>
            ) : status.spaceId ? (
              <>
                Active. Paired phones reach {thisComputer()} from anywhere.
                <span className="ml-1 font-mono text-small text-muted-foreground/70">{status.spaceId}</span>
              </>
            ) : status.problem ? (
              <>
                Activated, but {thisComputer()} can't reach Bloks Cloud yet. Bloks keeps trying.
                <span className="mt-1 block text-small text-muted-foreground/80">{status.problem}</span>
              </>
            ) : (
              "Activated. Connecting to Bloks Cloud."
            )}
          </div>
          <div className="mt-4 border-t pt-3">
            <div className="mb-2 text-small leading-relaxed text-muted-foreground">
              Paste a different key to move Cloud. The computer it was on stops reaching your phone.
            </div>
            {keyField("Replace", "outline")}
          </div>
        </>
      ) : (
        <div className="mt-3">
          {keyField("Activate", "brand")}
          <ConnectionNote>
            {phones > 0 ? (
              <>
                {phones === 1 ? "Your phone works" : `Your ${phones} phones work`} on this network. Cloud lets{" "}
                {phones === 1 ? "it" : "them"} reach {thisComputer()} from anywhere, with a notification when an agent
                needs you.
              </>
            ) : (
              <>A paired phone reaches {thisComputer()} on this network. Cloud makes it work anywhere.</>
            )}
          </ConnectionNote>
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <a
              href="https://bloks.dev/cloud"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-md bg-brand-ink px-3 text-body font-medium text-brand-foreground transition hover:brightness-95"
            >
              Get Bloks Cloud
            </a>
            <span className="text-small text-muted-foreground">$5 a month or $45 a year</span>
          </div>
        </div>
      )}
    </div>
  );
}
