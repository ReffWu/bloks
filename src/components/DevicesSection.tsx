// Pairing phones, without typing.
//
// Turning pairing on opens the server to the local network; starting a
// window mints a six digit code and a QR that carries a high-entropy
// token. The QR replaces typing, never consent: the phone still shows
// what it scanned and waits for a tap. Codes last minutes, work once,
// and a handful of wrong guesses closes the window.
//
// The screen walks those same three steps, and a phone arriving is the
// end of them, so it gets a moment of its own before it joins the list.
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Check } from "@/components/icons";
import { Copy } from "@/components/icons";
import { Globe } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { RotateCw } from "@/components/icons";
import { Smartphone } from "@/components/icons";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { deviceLabels } from "@/lib/deviceLabels";
import { usePageVisible } from "@/lib/pageVisible";
import { thisComputer } from "@/lib/thisComputer";
import {
  Checklist,
  ConnectionError,
  ConnectionHeader,
  ConnectionNote,
  HealthLine,
  PairedMoment,
  StepNote,
  type Health,
  type Step,
} from "./ConnectionKit";

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

interface Device {
  id: string;
  name: string;
  pairedAt: number;
  /** When it last made a request, since this computer started. */
  lastSeen?: number;
  /** The app build the device last said it runs, once it has made a
   * request since this Mac started. */
  client?: string;
}

interface PairStatus {
  enabled: boolean;
  pending: boolean;
  /** The switch and what the server is actually listening on disagree,
   * because listening is decided at start. Until a restart, a phone on
   * the network cannot reach this machine whatever the switch says. */
  restartRequired?: boolean;
  addresses: string[];
  devices: Device[];
}

/** The deep link a phone camera understands. Built defensively: any
 * field that fails its shape check kills the link rather than shipping
 * something malformed to a camera. */
function pairLink(address: string, port: number, token: string, code: string, computer?: string): string | null {
  if (!/^\d{6}$/.test(code)) return null;
  if (!/^bloks_pair_[A-Za-z0-9_-]{32}$/.test(token)) return null;
  if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
  // The computer's own name, as the server reads it: the window's address
  // is always this machine's loopback and would have the phone ask to pair
  // with "127.0.0.1". Left out, the phone says "your computer".
  const name = computer?.trim() ? `&name=${encodeURIComponent(computer.trim().slice(0, 60))}` : "";
  return `bloks://pair?address=${encodeURIComponent(`${host}:${port}`)}&token=${token}&code=${code}${name}`;
}

/** A browser rather than a phone, by the name it paired under. */
const isBrowser = (name: string) => /\b(Chrome|Safari|Firefox|Edge|browser)\b/i.test(name);

/** How long a new phone holds the stage before it joins the list. */
const ARRIVAL_MS = 2800;

export function DevicesSection() {
  // Running at bloks.dev/web: this UI is itself a paired device, and the
  // pairing controls belong to the computer, not to it.
  if (window.bloksWeb) return <ThisBrowser />;
  return <PairingControls />;
}

function ThisBrowser() {
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0">
      <ConnectionHeader
        icon={<Globe size={14} className="shrink-0 text-muted-foreground" />}
        title="This browser"
        says={
          <>
            Connected to {window.bloksWeb?.host || "your computer"} through Bloks Cloud, end-to-end encrypted. To fully
            disconnect, also remove this browser on your computer.
          </>
        }
        health={<HealthLine tone="on" label="Connected" />}
      />
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void window.bloksWeb?.forget();
        }}
      >
        {leaving ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
        Disconnect this browser
      </Button>
    </div>
  );
}

function PairLinkRow({
  label,
  link,
  copied,
  onCopy,
}: {
  label: string;
  link: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-2.5">
      <div className="text-small text-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1.5 font-mono text-small text-muted-foreground">
          {link}
        </code>
        <Button size="sm" variant="secondary" onClick={onCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** The phones and browsers that can reach this computer, each with what
 * tells it apart, and a quiet Remove that asks first: a removed phone has
 * to pair again from scratch. */
function PairedList({
  devices,
  now,
  fresh,
  onRemove,
}: {
  devices: Device[];
  now: number;
  fresh: string | null;
  onRemove: (device: Device) => void;
}) {
  const labels = deviceLabels(devices, now);
  return (
    <div className="mt-4 border-t pt-3">
      <div className="mb-1 text-small font-medium text-muted-foreground">Paired</div>
      <ul className="flex flex-col">
        {devices.map((device) => {
          const label = labels.get(device.id) ?? { name: device.name, detail: "" };
          return (
            <li
              key={device.id}
              className={cn(
                "-mx-1.5 flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors duration-700",
                fresh === device.id && "bg-brand-soft",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {isBrowser(device.name) ? <Globe size={15} /> : <Smartphone size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-foreground">{label.name}</div>
                {label.detail && <div className="truncate text-small tabular-nums text-muted-foreground">{label.detail}</div>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${label.name}`}
                className="hover:bg-destructive/10 hover:text-destructive"
                onClick={async () => {
                  const yes = await confirm({
                    title: `Remove ${label.name}?`,
                    body: `It can't reach ${thisComputer()} until you pair it again.`,
                    confirmLabel: "Remove",
                    destructive: true,
                  });
                  if (yes) onRemove(device);
                }}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PairingControls() {
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [window_, setWindow] = useState<{
    code: string;
    qr: string | null;
    expiresAt: number;
    /** Where the phone should dial, for somebody typing the code by hand. */
    address: string | null;
  } | null>(null);
  const [browserLink, setBrowserLink] = useState<{ web: string; pair: string; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState<"web" | "pair" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** The phone that just paired, holding the stage for a moment. */
  const [arrived, setArrived] = useState<Device | null>(null);
  /** And its row in the list, lit for a little longer after that. */
  const [fresh, setFresh] = useState<string | null>(null);
  const inflight = useRef(false);
  // Every device seen so far, so a new one can be told from an old one.
  // Unset until the first answer: the phones already paired when the
  // screen opens are not arrivals.
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(() => {
    if (inflight.current) return;
    inflight.current = true;
    api("/api/pair")
      .then((s: PairStatus) => {
        setStatus(s);
        setError(null);
        // the window closed on the server (used, expired, exhausted)
        if (!s.pending) setWindow(null);
        const ids = new Set(s.devices.map((d) => d.id));
        if (known.current) {
          const newcomer = s.devices.find((d) => !known.current!.has(d.id));
          if (newcomer) {
            setArrived(newcomer);
            setFresh(newcomer.id);
          }
        }
        known.current = ids;
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        inflight.current = false;
      });
  }, []);

  const visible = usePageVisible();
  // While a code is out, somebody is standing there with a phone, so the
  // answer is looked for twice as often.
  const waiting = Boolean(window_);
  useEffect(() => {
    if (!visible) return;
    load();
    const poll = setInterval(load, waiting ? 2_000 : 4_000);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load, visible, waiting]);

  useEffect(() => {
    if (!arrived) return;
    const timer = setTimeout(() => setArrived(null), ARRIVAL_MS);
    return () => clearTimeout(timer);
  }, [arrived]);
  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => setFresh(null), ARRIVAL_MS + 1_600);
    return () => clearTimeout(timer);
  }, [fresh]);

  const setEnabled = (enabled: boolean) => {
    api("/api/pair", { method: "PUT", body: JSON.stringify({ enabled }) })
      .then(load)
      .catch((e: Error) => setError(e.message));
  };

  const start = () => {
    setError(null);
    setStarting(true);
    api("/api/pair/start", { method: "POST" })
      .then(async (started) => {
        const address =
          (started.addresses as string[] | undefined)?.find((a: string) => a !== "127.0.0.1") ??
          started.addresses?.[0];
        const link = address
          ? pairLink(address, started.port, started.token, started.code, typeof started.name === "string" ? started.name : undefined)
          : null;
        const qr = link
          ? await QRCode.toDataURL(link, {
              errorCorrectionLevel: "M",
              margin: 1,
              width: 168,
              color: { dark: "#111111", light: "#ffffff" },
            }).catch(() => null)
          : null;
        // A bracketed IPv6 literal stays readable as host:port; IPv4 needs nothing.
        const hostPort = address
          ? `${address.includes(":") ? `[${address}]` : address}:${started.port}`
          : null;
        setWindow({ code: started.code, qr, expiresAt: started.expiresAt, address: hostPort });
        load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setStarting(false));
  };

  // A link for Bloks in a browser: one use, fifteen minutes, through
  // Bloks Cloud. Shown here only, because the link is the whole key.
  // The server hands back the same pairing twice, once for a browser and
  // once for the Bloks app or another computer. Both are shown: keeping
  // only the browser one left people building the other by hand.
  const makeBrowserLink = () => {
    setError(null);
    setCopied(null);
    api("/api/pair/link", { method: "POST" })
      .then((made) => setBrowserLink({ web: made.webLink ?? made.link, pair: made.link, expiresAt: made.expiresAt }))
      .catch((e: Error) => setError(e.message));
  };
  const browserSecondsLeft = browserLink ? Math.max(0, Math.round((browserLink.expiresAt - now) / 1000)) : 0;

  const cancel = () => {
    api("/api/pair/cancel", { method: "POST" })
      .then(() => {
        setWindow(null);
        load();
      })
      .catch(() => setWindow(null));
  };

  const secondsLeft = window_ ? Math.max(0, Math.round((window_.expiresAt - now) / 1000)) : 0;
  const live = Boolean(window_ && secondsLeft > 0);
  const listening = Boolean(status?.enabled && !status.restartRequired);
  const devices = status?.devices ?? [];

  const health: { tone: Health; label: string } | null = !status
    ? null
    : status.restartRequired
      ? { tone: "wait", label: "Restart needed" }
      : !status.enabled
        ? { tone: "off", label: "Off" }
        : live
          ? { tone: "wait", label: "Waiting" }
          : devices.length > 0
            ? { tone: "on", label: `${devices.length} paired` }
            : { tone: "on", label: "On" };

  // The steps are the way in, so they show until something has paired,
  // and again whenever a code is out. Once a phone is in, the list is
  // the screen.
  const showSteps = Boolean(status) && !arrived && (!listening || live || devices.length === 0);

  const restart = window.bloks?.relaunch ? (
    <Button size="sm" variant="secondary" className="mt-2" onClick={() => void window.bloks?.relaunch?.()}>
      <RotateCw size={13} />
      Restart now
    </Button>
  ) : (
    <StepNote className="mt-1">Quit Bloks and open it again.</StepNote>
  );

  const startButtons = (label: string, quiet = false) => (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={quiet ? "secondary" : "default"} onClick={start} disabled={starting}>
        {starting ? <Loader2 size={13} className="animate-spin" /> : <Smartphone size={13} />}
        {label}
      </Button>
      <Button variant="secondary" size="sm" onClick={makeBrowserLink}>
        <Globe size={13} />
        Use in a browser
      </Button>
    </div>
  );

  const steps: Step[] = status
    ? [
        {
          key: "on",
          title: "Turn on phone access",
          state: listening ? "done" : status.enabled ? "wait" : "now",
          summary: "On, over your network",
          body: status.enabled ? (
            // The switch alone does not open the door: the server decides
            // what it listens on when it starts. Without saying so,
            // somebody turns this on, starts a code, and watches their
            // phone fail to connect for no reason they can see. So the
            // code waits for the restart.
            <>
              <StepNote>Restart Bloks to finish turning this on.</StepNote>
              {restart}
            </>
          ) : (
            <>
              <StepNote>Bloks starts listening on your local network. Only devices you pair get in.</StepNote>
              <Button variant="brand" size="sm" className="mt-2" onClick={() => setEnabled(true)}>
                Turn on
              </Button>
            </>
          ),
        },
        {
          key: "scan",
          title: "Scan the code with the Bloks app",
          state: !listening ? "later" : "now",
          body: live && window_ ? (
            <PairingCode
              window_={window_}
              secondsLeft={secondsLeft}
              onCancel={cancel}
              onLink={browserLink ? undefined : makeBrowserLink}
            />
          ) : (
            <>
              {window_ && <StepNote className="mb-2">That code ran out. Codes last a few minutes.</StepNote>}
              {startButtons(window_ ? "Show a new code" : "Show a code")}
            </>
          ),
        },
        {
          key: "tap",
          title: "Tap Pair on your phone",
          state: live ? "wait" : "later",
          body: <StepNote>Your phone shows {thisComputer()} and waits for you. This ticks when it pairs.</StepNote>,
        },
      ]
    : [];

  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0" data-setting-row="phones-and-devices">
      <ConnectionHeader
        icon={<Smartphone size={14} className="shrink-0 text-muted-foreground" />}
        title="Phones and devices"
        says={`Lets the Bloks app on your phone reach ${thisComputer()} over your network.`}
        health={health && <HealthLine tone={health.tone} label={health.label} />}
        control={<Switch aria-label="Phones and devices" checked={status?.enabled ?? false} onCheckedChange={setEnabled} />}
      />

      <ConnectionError>{error}</ConnectionError>

      {/* turning it off waits for a restart too, and is not a step */}
      {status?.restartRequired && !status.enabled && (
        <ConnectionNote className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 flex-1">Restart Bloks to stop listening on your network.</span>
          {window.bloks?.relaunch ? (
            <Button size="sm" variant="secondary" onClick={() => void window.bloks?.relaunch?.()}>
              Restart now
            </Button>
          ) : (
            <span>Quit Bloks and open it again.</span>
          )}
        </ConnectionNote>
      )}

      <AnimatePresence initial={false}>
        {arrived && (
          <PairedMoment
            key={arrived.id}
            icon={isBrowser(arrived.name) ? <Globe size={18} /> : <Smartphone size={18} />}
            title={`${arrived.name} is paired`}
            detail={`It can reach ${thisComputer()} now. Remove it here any time.`}
          />
        )}
      </AnimatePresence>

      {showSteps && !(status?.restartRequired && !status.enabled) && <Checklist label="Pair a phone" steps={steps} />}

      {status?.enabled && devices.length > 0 && (
        <PairedList
          devices={devices}
          now={now}
          fresh={fresh}
          onRemove={(device) =>
            api(`/api/pair/devices/${device.id}`, { method: "DELETE" })
              .then(load)
              .catch((e: Error) => setError(e.message))
          }
        />
      )}

      {listening && !showSteps && !arrived && !live && <div className="mt-3">{startButtons("Pair another phone", true)}</div>}

      {/* last, so it opens under whichever button asked for it */}
      {listening && browserLink && browserSecondsLeft > 0 && (
        <div className="mt-3 rounded-xl border bg-muted/40 p-3" data-browser-link>
          <div className="text-body font-medium text-foreground">Pair with a link</div>
          <div className="mt-0.5 text-small leading-relaxed text-muted-foreground">
            Works once, for {Math.ceil(browserSecondsLeft / 60)} more minute{browserSecondsLeft > 60 ? "s" : ""}.
            Anyone who opens a link gets access, so keep it private.
          </div>
          <PairLinkRow
            label="Open in a browser"
            link={browserLink.web}
            copied={copied === "web"}
            onCopy={() => void navigator.clipboard.writeText(browserLink.web).then(() => setCopied("web"))}
          />
          <PairLinkRow
            label="Paste into the Bloks app or another computer"
            link={browserLink.pair}
            copied={copied === "pair"}
            onCopy={() => void navigator.clipboard.writeText(browserLink.pair).then(() => setCopied("pair"))}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setBrowserLink(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {status === null && <Loader2 size={14} className="mt-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** The open window: the QR, the same thing as six digits for a camera
 * that will not focus, where to dial, and how long it has left. */
function PairingCode({
  window_,
  secondsLeft,
  onCancel,
  onLink,
}: {
  window_: { code: string; qr: string | null; address: string | null };
  secondsLeft: number;
  onCancel: () => void;
  onLink?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      {/* the QR always sits on white; a themed QR is an unscannable QR */}
      <div className="shrink-0 rounded-xl bg-white p-2 shadow-sm ring-1 ring-black/5" aria-label="Pairing QR code">
        {window_.qr ? (
          <img src={window_.qr} alt="Scan with the Bloks app" className="size-[152px]" />
        ) : (
          <div className="flex size-[152px] items-center justify-center text-caption text-neutral-500">
            QR unavailable
          </div>
        )}
      </div>
      <div className="min-w-[180px] flex-1">
        <div className="text-small text-muted-foreground">Or enter this code by hand</div>
        <div className="mt-1 font-mono text-heading font-semibold tabular-nums tracking-[0.2em] text-foreground">
          {window_.code}
        </div>
        {/* The QR carries the address; a code typed by hand does
            not, and the phone asks for it. Without this line the
            by-hand route had no way to find where to dial. */}
        {window_.address && (
          <div className="mt-1.5 text-small text-muted-foreground">
            Address on the phone: <span className="font-mono text-foreground">{window_.address}</span>
          </div>
        )}
        <div className="mt-1 text-small tabular-nums text-muted-foreground">
          Works once. Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}.
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {/* a camera that will not focus, or a phone on another
              network, is a dead end without a way round the QR */}
          {onLink && (
            <span className="text-small text-muted-foreground">
              Won't scan?{" "}
              <button type="button" className="underline underline-offset-2 transition-colors duration-150 hover:text-foreground" onClick={onLink}>
                Use a link
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
