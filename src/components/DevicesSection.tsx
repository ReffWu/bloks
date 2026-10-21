// Pairing phones, without typing.
//
// Turning pairing on opens the server to the local network; a pairing
// window mints a six digit code and a QR that carries a high-entropy
// token. The QR replaces typing, never consent: the phone still shows
// what it scanned and waits for a tap. Codes last minutes, work once,
// and a handful of wrong guesses closes the window (server/pairing.ts).
//
// While phone access is on and this page is in front of someone, a code
// is simply there: the QR, the six digits and the address, ready for a
// phone, with nothing to press first. That is only as safe as the page
// keeps it, so the page is strict about it. A code is asked for only
// while the page is open and visible, and closed on the server the moment
// it is not. One that runs out is replaced quietly just before it does.
// One the server closed early, which is what five wrong guesses do, is
// not: that waits for a person to ask for another, so nobody can keep a
// guesser supplied with fresh codes by leaving Settings open.
//
// A phone arriving gets a moment of its own before it joins the list, and
// then the next code takes its place.
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
import { ConnectionError, ConnectionHeader, ConnectionNote, HealthLine, PairedMoment, type Health } from "./ConnectionKit";

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

/** The code on screen: what the server minted, drawn. */
interface PairCode {
  code: string;
  qr: string | null;
  expiresAt: number;
  /** Where the phone should dial, for somebody typing the code by hand. */
  address: string | null;
  /** When it arrived here, so a status read that left before it did is
   * not taken as news about it. */
  mintedAt: number;
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

/** How far ahead of its expiry a code is replaced, so the new one is on
 * screen before the old one stops working. */
const RENEW_EARLY_MS = 1500;

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
    <div className="mt-5 border-t pt-3">
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
  const [code, setCode] = useState<PairCode | null>(null);
  /** No code on screen, and none asked for until somebody says so: the
   * server closed the last one early, or could not make one. */
  const [stopped, setStopped] = useState<"closed" | "failed" | null>(null);
  const [browserLink, setBrowserLink] = useState<{ web: string; pair: string; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState<"web" | "pair" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  /** The phone that just paired, holding the stage for a moment. */
  const [arrived, setArrived] = useState<Device | null>(null);
  /** And its row in the list, lit for a little longer after that. */
  const [fresh, setFresh] = useState<string | null>(null);
  const inflight = useRef(false);
  // Every device seen so far, so a new one can be told from an old one.
  // Unset until the first answer: the phones already paired when the
  // screen opens are not arrivals.
  const known = useRef<Set<string> | null>(null);
  // The code as the async paths see it, without waiting for a render.
  const held = useRef<PairCode | null>(null);
  const minting = useRef(false);
  /** Whether a code belongs on screen right now. A code that arrives
   * after this went false is closed at once rather than shown. */
  const wanted = useRef(false);

  const hold = useCallback((next: PairCode | null) => {
    held.current = next;
    setCode(next);
  }, []);

  const load = useCallback(() => {
    if (inflight.current) return;
    inflight.current = true;
    const asked = Date.now();
    api("/api/pair")
      .then((s: PairStatus) => {
        setStatus(s);
        setError(null);
        const ids = new Set(s.devices.map((d) => d.id));
        const newcomer = known.current ? s.devices.find((d) => !known.current!.has(d.id)) : undefined;
        known.current = ids;
        if (newcomer) {
          setArrived(newcomer);
          setFresh(newcomer.id);
        }
        // The window closed on the server while ours still had time on
        // it: used by the phone that just arrived, or closed by wrong
        // guesses, a restart, or another window asking for its own.
        const mine = held.current;
        if (!s.pending && mine && asked > mine.mintedAt && Date.now() < mine.expiresAt - RENEW_EARLY_MS) {
          hold(null);
          if (!newcomer) setStopped("closed");
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        inflight.current = false;
      });
  }, [hold]);

  const mint = useCallback(() => {
    if (minting.current) return;
    minting.current = true;
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
              width: 288,
              color: { dark: "#111111", light: "#ffffff" },
            }).catch(() => null)
          : null;
        if (!wanted.current) {
          // the page went away while this was on its way: the door
          // closes with it rather than staying open for nobody
          void api("/api/pair/cancel", { method: "POST" }).catch(() => {});
          return;
        }
        // A bracketed IPv6 literal stays readable as host:port; IPv4 needs nothing.
        const hostPort = address ? `${address.includes(":") ? `[${address}]` : address}:${started.port}` : null;
        hold({ code: started.code, qr, expiresAt: started.expiresAt, address: hostPort, mintedAt: Date.now() });
        setStopped(null);
      })
      .catch((e: Error) => {
        setError(e.message);
        setStopped("failed");
      })
      .finally(() => {
        minting.current = false;
      });
  }, [hold]);

  const visible = usePageVisible();
  // While a code is out, somebody may be standing there with a phone, so
  // the answer is looked for twice as often.
  const waiting = Boolean(code);
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

  const listening = Boolean(status?.enabled && !status.restartRequired);
  const want = listening && visible && !arrived;

  // The code lives exactly as long as this: phone access on, the page open
  // and in view, and no phone mid-arrival. When any of that stops, the
  // window on the server is closed too.
  useEffect(() => {
    wanted.current = want;
    if (!want) return;
    return () => {
      wanted.current = false;
      if (held.current) {
        void api("/api/pair/cancel", { method: "POST" }).catch(() => {});
        hold(null);
      }
      setStopped(null);
    };
  }, [want, hold]);

  // Ask for one when there is none and nothing says to wait, and for the
  // next one just before this one runs out.
  const msLeft = code ? code.expiresAt - now : 0;
  useEffect(() => {
    if (!want || stopped) return;
    if (!code || msLeft <= RENEW_EARLY_MS) mint();
  }, [want, stopped, code, msLeft, mint]);

  const setEnabled = (enabled: boolean) => {
    api("/api/pair", { method: "PUT", body: JSON.stringify({ enabled }) })
      .then(load)
      .catch((e: Error) => setError(e.message));
  };

  const again = () => {
    setError(null);
    setStopped(null);
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

  const devices = status?.devices ?? [];

  const health: { tone: Health; label: string } | null = !status
    ? null
    : status.restartRequired
      ? { tone: "wait", label: "Restart needed" }
      : !status.enabled
        ? { tone: "off", label: "Off" }
        : devices.length > 0
          ? { tone: "on", label: `${devices.length} paired` }
          : { tone: "on", label: "On" };

  const restart = (words: string) => (
    <ConnectionNote className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-0 flex-1">{words}</span>
      {window.bloks?.relaunch ? (
        <Button size="sm" variant="secondary" onClick={() => void window.bloks?.relaunch?.()}>
          <RotateCw size={13} />
          Restart now
        </Button>
      ) : (
        <span>Quit Bloks and open it again.</span>
      )}
    </ConnectionNote>
  );

  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0" data-setting-row="phones-and-devices">
      <ConnectionHeader
        icon={<Smartphone size={14} className="shrink-0 text-muted-foreground" />}
        title="Phones and devices"
        says={
          status && !status.enabled
            ? `Turn on to pair the Bloks app on your phone with ${thisComputer()} over your network.`
            : `Lets the Bloks app on your phone reach ${thisComputer()} over your network.`
        }
        health={health && <HealthLine tone={health.tone} label={health.label} />}
        control={<Switch aria-label="Phones and devices" checked={status?.enabled ?? false} onCheckedChange={setEnabled} />}
      />

      <ConnectionError>{error}</ConnectionError>

      {/* The switch alone does not open the door: the server decides what
          it listens on when it starts. Without saying so, somebody turns
          this on and watches their phone fail to connect for no reason
          they can see, so the code waits for the restart. */}
      {status?.restartRequired && restart(status.enabled ? "Restart Bloks to finish turning this on." : "Restart Bloks to stop listening on your network.")}

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

      {listening && !arrived && (
        <PairingCode code={code} msLeft={msLeft} stopped={stopped} onAgain={again} onLink={makeBrowserLink} />
      )}

      {/* straight under the code, whose button asked for it */}
      {listening && browserLink && browserSecondsLeft > 0 && (
        <div className="mt-3 rounded-xl border bg-muted/30 p-4" data-browser-link>
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

      {status === null && <Loader2 size={14} className="mt-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** The code, always ready: the QR, the same thing as six digits for a
 * camera that will not focus, where to dial, and one line on what to do.
 * Its time is a thin bar rather than a ticking clock, because the code
 * renews itself and the seconds are not something to watch. */
function PairingCode({
  code,
  msLeft,
  stopped,
  onAgain,
  onLink,
}: {
  code: PairCode | null;
  msLeft: number;
  stopped: "closed" | "failed" | null;
  onAgain: () => void;
  onLink: () => void;
}) {
  const life = code ? Math.max(1, code.expiresAt - code.mintedAt) : 1;
  const minutes = code ? Math.max(1, Math.round(life / 60_000)) : 5;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border bg-muted/30 p-4">
      {stopped ? (
        // the same footprint, empty, so nothing jumps when a code returns
        <div aria-hidden className="flex size-[148px] shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground/60">
          <Smartphone size={20} />
        </div>
      ) : (
        // the QR always sits on white; a themed QR is an unscannable QR
        <div className="flex size-[148px] shrink-0 items-center justify-center rounded-lg bg-white p-2 shadow-sm ring-1 ring-black/5">
          {code?.qr ? (
            <img src={code.qr} alt="Pairing code to scan with the Bloks app" className="size-[132px]" />
          ) : code ? (
            <span className="px-2 text-center text-caption text-neutral-500">Type the code instead</span>
          ) : (
            <Loader2 size={16} className="animate-spin text-neutral-400" />
          )}
        </div>
      )}

      <div className="min-w-[220px] flex-1">
        {stopped ? (
          <>
            <p className="text-body font-medium text-foreground">
              {stopped === "closed" ? "That code stopped working early." : "No code right now."}
            </p>
            <p className="mt-0.5 text-pretty text-small text-muted-foreground">
              {stopped === "closed" ? "Codes close after a few wrong tries. Get a new one when you're ready." : "Try again in a moment."}
            </p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={onAgain}>
              New code
            </Button>
          </>
        ) : (
          <>
            <p className="text-pretty text-body font-medium text-foreground">Open Bloks on your iPhone, tap Pair, and scan.</p>
            <div className="mt-3 text-small text-muted-foreground">Or type this code</div>
            {/* not announced as it changes: a new code every few minutes
                read aloud would be noise, and the page says how it works */}
            <div
              className={cn(
                "mt-0.5 font-mono text-heading font-semibold tabular-nums tracking-[0.2em] text-foreground transition-opacity duration-200",
                !code && "opacity-30",
              )}
            >
              {code ? (
                code.code
              ) : (
                <>
                  <span aria-hidden>000000</span>
                  <span className="sr-only">Making a code</span>
                </>
              )}
            </div>
            <div aria-hidden className="mt-1.5 h-0.5 w-[9.5rem] overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-foreground/30 transition-[width] duration-1000 ease-linear"
                style={{ width: `${code ? Math.max(0, Math.min(100, (msLeft / life) * 100)) : 0}%` }}
              />
            </div>
            {/* The QR carries the address; a code typed by hand does
                not, and the phone asks for it. Without this line the
                by-hand route had no way to find where to dial. */}
            {code?.address && (
              <div className="mt-2.5 text-small text-muted-foreground">
                Address <span className="ml-1 font-mono text-foreground">{code.address}</span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-small text-muted-foreground">Works once. A new one comes every {minutes} minutes.</span>
              {/* a camera that will not focus, a phone on another network,
                  or a browser: all of them want a link instead */}
              <Button size="sm" variant="ghost" className="-ml-2 sm:ml-auto" onClick={onLink}>
                <Globe size={13} />
                Pair with a link
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
