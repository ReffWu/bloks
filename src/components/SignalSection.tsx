// Each agent can answer on a Signal account of its own. Only the owner
// sees this panel.
//
// Signal has no bots, so the account is a real one: signal-cli, running
// on this computer, is linked to it the way Signal Desktop is, and keeps
// its keys in its own folder. Bloks never holds them. Setting it up is
// four things, so the panel is those steps in order, and each ticks when
// the server says it happened: signal-cli answering, then running, then
// an account linked, then the owner's pairing word arriving.
import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import QRCode from "qrcode";
import { ExternalLink, Loader2, MessageDots } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { confirm } from "@/components/ui/confirm";
import { cn } from "@/lib/cn";
import { usePageVisible } from "@/lib/pageVisible";
import {
  Checklist,
  ConnectionError,
  ConnectionHeader,
  ConnectionNote,
  CopyRow,
  HealthLine,
  PairedMoment,
  StepNote,
  useJustHappened,
  type Health,
  type Step,
} from "./ConnectionKit";
import { t } from "@/lib/i18n";

interface Person {
  id: string;
  name: string;
  state: "pending" | "allowed" | "declined" | "removed";
  number?: string;
  first?: string;
  full?: boolean;
  sameName?: boolean;
}

interface Connection {
  state: "off" | "connecting" | "connected" | "error";
  detail?: string;
}

interface AgentStatus {
  configured: boolean;
  enabled: boolean;
  account: string | null;
  ownerPaired: boolean;
  ownerSelf: boolean;
  ownerName: string | null;
  pairing: string | null;
  people: Person[];
  admissionFull: boolean;
  daemon: string;
  command: string;
  connection: Connection;
  link: { uri: string; state: "waiting" | "failed"; error?: string } | null;
  voiceVendor: "elevenlabs" | "openai" | null;
  engineReady: boolean;
}

interface Daemon {
  daemon: string;
  command: string;
  reachable: boolean;
  connection: Connection;
  bots?: Array<{ botId: string; account: string | null; enabled: boolean; ownerPaired: boolean }>;
}

const PERSON_STATE: Record<Person["state"], string> = {
  allowed: "Let in",
  pending: "Waiting",
  declined: "Not now",
  removed: "Taken out",
};

const INSTALL = "brew install signal-cli";

function health(status: AgentStatus | null, daemon: Daemon | null): { tone: Health; label: string } | null {
  if (!status) return null;
  if (!status.configured) return { tone: "off", label: "Not set up" };
  if (!status.enabled) return { tone: "off", label: "Off" };
  if (status.connection.state === "error" || daemon?.reachable === false) return { tone: "issue", label: "signal-cli not running" };
  if (!status.ownerPaired) return { tone: "wait", label: "Needs pairing" };
  if (status.connection.state === "connected") return { tone: "on", label: "Connected" };
  return { tone: "wait", label: "Connecting" };
}

/** The address field and the commands, shared by both views. */
function DaemonFields({ daemon, onSaved }: { daemon: Daemon; onSaved: (next: Daemon) => void }) {
  const [url, setUrl] = useState(daemon.daemon);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setUrl(daemon.daemon), [daemon.daemon]);
  const save = () => {
    setBusy(true);
    setError(null);
    api("/api/signal", { method: "POST", body: JSON.stringify({ url: url.trim() }) })
      .then(onSaved)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="mt-2 max-w-[460px]">
        <CopyRow value={daemon.command} />
      </div>
      <div className="mt-2 flex max-w-[460px] items-center gap-1.5">
        <label htmlFor="signal-daemon" className="sr-only">{t("signalSection.signalCliAddress")}</label>
        <Input id="signal-daemon" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className="h-8 min-w-0 flex-1 font-mono text-small" spellCheck={false} />
        <Button size="sm" variant="secondary" className="h-8" disabled={busy || !url.trim()} onClick={save}>
          {busy ? t("signalSection.checking") : t("signalSection.check")}
        </Button>
      </div>
      <ConnectionError>{error}</ConnectionError>
    </>
  );
}

export function SignalSection({ botId }: { botId?: string }) {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [daemon, setDaemon] = useState<Daemon | null>(null);
  const [linked, setLinked] = useState<Array<{ account: string; botId: string | null }> | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the steps are long; they wait until someone decides to set it up
  const [opened, setOpened] = useState(false);
  const visible = usePageVisible();

  const endpoint = botId ? `/api/bots/${botId}/signal` : null;
  const load = () => {
    void api("/api/signal").then(setDaemon).catch(() => {});
    if (endpoint) void api(endpoint).then(setStatus).catch((e) => setError(e.message));
  };

  useEffect(() => {
    setStatus(null);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  // A link scanned, a word sent or signal-cli started on the phone or in
  // Terminal changes this screen without a reopen; looked at only while
  // something is waiting and somebody can see it.
  const active = botId ? opened || Boolean(status?.configured) : Boolean(daemon?.bots?.length);
  const waiting = active && (!daemon?.reachable || Boolean(status?.link) || Boolean(status?.pairing) || Boolean(status?.configured && status.connection.state !== "connected"));
  useEffect(() => {
    if (!visible || !waiting) return;
    const timer = setInterval(load, 2_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, waiting, endpoint]);

  // the link as a code to scan, drawn here, never sent anywhere
  useEffect(() => {
    let active = true;
    const uri = status?.link?.state === "waiting" ? status.link.uri : null;
    if (!uri) return setQr(null);
    QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 168, color: { dark: "#111111", light: "#ffffff" } })
      .then((data) => active && setQr(data))
      .catch(() => active && setQr(null));
    return () => { active = false; };
  }, [status?.link?.uri, status?.link?.state]);

  // accounts signal-cli already has, to use one instead of linking again
  useEffect(() => {
    if (!endpoint || status?.configured || !daemon?.reachable) return;
    api("/api/signal/accounts").then(({ accounts }) => setLinked(accounts)).catch(() => setLinked(null));
  }, [endpoint, status?.configured, daemon?.reachable]);

  const justPaired = useJustHappened(status ? status.ownerPaired : undefined);

  const post = (body: Record<string, unknown>) => {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    api(endpoint, { method: "POST", body: JSON.stringify(body) })
      .then(setStatus)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const openAgent = (id: string) => {
    dispatch({ type: "toggleAppSettings", open: false });
    dispatch({ type: "select", id });
    dispatch({ type: "toggleSettings", open: true });
  };

  // Said before it is given, because a separate chat looks more private
  // than it is.
  const giveFullAccess = async (person: Person, agent: string) => {
    const yes = await confirm({
      title: `Give ${person.name} full access to ${agent}?`,
      body: [
        `Their messages run the way yours do: with ${agent}'s own tools, engine and permissions, and what it makes is sent back to them. Anything that still asks comes to you.`,
        `They talk in a conversation of their own, but ${agent} has one memory, and its tools reach your files and accounts.`,
        "You can take it back here at any time. That stops their running work; what is already done stays done.",
      ].join("\n\n"),
      confirmLabel: "Give full access",
      destructive: true,
    });
    if (yes) post({ personId: person.id, action: "full" });
  };

  if (!botId) {
    const bots = daemon?.bots ?? [];
    const tone: Health = !daemon ? "off" : daemon.reachable ? (daemon.connection.state === "connected" ? "on" : bots.length ? "wait" : "on") : bots.length ? "issue" : "off";
    return (
      <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0">
        <ConnectionHeader
          icon={<MessageDots size={14} className="shrink-0 text-muted-foreground" />}
          title="Signal"
          says={t("signalSection.eachAgentAnswersOnA")}
          info={t("signalSection.bloksTalksToSignalCli")}
          health={daemon && <HealthLine tone={tone} label={daemon.reachable ? t("signalSection.signalCliRunning") : t("signalSection.signalCliNotRunning")} />}
        />
        {bots.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            {bots.map((b) => (
              <button
                key={b.botId}
                onClick={() => openAgent(b.botId)}
                className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:bg-accent/60"
              >
                <span className="min-w-0 flex-1 truncate text-body text-foreground">
                  {state.bots.find((bot) => bot.id === b.botId)?.name ?? t("common.agent")}
                  <span className="ml-1.5 text-muted-foreground">{b.account ?? t("signalSection.signalSettings")}</span>
                </span>
                <HealthLine tone={!b.enabled ? "off" : b.ownerPaired ? "on" : "wait"} label={!b.enabled ? t("common.off") : b.ownerPaired ? t("signalSection.paired") : t("signalSection.needsPairing")} />
              </button>
            ))}
          </div>
        )}
        {daemon && (
          <div className="mt-4 border-t pt-3">
            <div className="text-body font-semibold text-foreground">{t("signalSection.signalCliOnThisComputer")}</div>
            <p className="mt-0.5 text-small leading-relaxed text-muted-foreground">
              {daemon.reachable ? `Answering at ${daemon.daemon}.` : `Install it with ${INSTALL}, then keep this running in Terminal:`}
            </p>
            <DaemonFields daemon={daemon} onSaved={(next) => setDaemon({ ...daemon, ...next })} />
          </div>
        )}
      </div>
    );
  }

  const h = health(status, daemon);
  const agentName = state.bots.find((bot) => bot.id === botId)?.name ?? "this agent";
  const reachable = daemon?.reachable === true;
  const settingUp = Boolean(status && (!status.configured || !status.ownerPaired));
  const free = (linked ?? []).filter((a) => !a.botId);

  const steps: Step[] = status && daemon
    ? [
        {
          key: "install",
          title: "Install signal-cli",
          state: reachable ? "done" : "now",
          summary: "Installed",
          body: (
            <>
              <StepNote>{t("signalSection.inTerminalWithHomebrewIt")}</StepNote>
              <div className="mt-2 max-w-[460px]"><CopyRow value={INSTALL} /></div>
              <Button asChild size="sm" variant="secondary" className="mt-2">
                <a href="https://github.com/AsamK/signal-cli" target="_blank" rel="noreferrer">
                  {t("signalSection.aboutSignalCli")}
                  <ExternalLink size={12} />
                </a>
              </Button>
            </>
          ),
        },
        {
          key: "run",
          title: "Keep it running",
          state: reachable ? "done" : "wait",
          summary: `Answering at ${daemon.daemon}`,
          body: (
            <>
              <StepNote>{t("signalSection.runThisAndLeaveIt")}</StepNote>
              <DaemonFields daemon={daemon} onSaved={(next) => setDaemon({ ...daemon, ...next })} />
            </>
          ),
        },
        {
          key: "link",
          title: "Link a Signal account",
          state: status.configured ? "done" : !reachable ? "later" : status.link?.state === "waiting" ? "wait" : "now",
          summary: status.account ? `Linked to ${status.account}` : "Linked",
          body: (
            <>
              <StepNote>
                Best is a number of its own for {agentName}, on a second phone or SIM, so people can message it and not you.
                Your own account works too: then you talk to {agentName} in Note to Self, and nothing else on your account reaches it.
              </StepNote>
              {status.link?.state === "waiting" ? (
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  {/* the code always sits on white; a themed code is one a camera cannot read */}
                  <div className="flex size-[148px] shrink-0 items-center justify-center rounded-lg bg-white p-2 shadow-sm ring-1 ring-black/5">
                    {qr ? <img src={qr} alt={t("signalSection.codeToScanInSignal")} className="size-[132px]" /> : <Loader2 size={16} className="animate-spin text-neutral-400" />}
                  </div>
                  <div className="min-w-[200px] flex-1">
                    <StepNote>{t("signalSection.inSignalOnThatPhone")}</StepNote>
                    <button disabled={busy} onClick={() => post({ cancelLink: true })} className="mt-2 text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline">
                      {t("common.notNow")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="brand" disabled={busy || !reachable} onClick={() => post({ link: true })}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                    Show a code to scan
                  </Button>
                  {free.length > 0 && (
                    <select
                      aria-label={t("signalSection.useAnAccountSignalCli")}
                      value=""
                      onChange={(e) => e.target.value && post({ account: e.target.value })}
                      className="h-8 rounded-lg border bg-background px-2 text-body text-foreground"
                    >
                      <option value="">{t("signalSection.orUseOneAlreadyLinked")}</option>
                      {free.map((a) => <option key={a.account} value={a.account}>{a.account}</option>)}
                    </select>
                  )}
                </div>
              )}
              {status.link?.state === "failed" && <p className="mt-2 text-small text-warning">{status.link.error ?? t("signalSection.thatLinkDidNotFinish")} Try again.</p>}
            </>
          ),
        },
        {
          key: "word",
          title: "Send your pairing word",
          state: !status.configured ? "later" : status.ownerPaired ? "done" : status.pairing ? "wait" : "now",
          summary: status.ownerSelf ? "In your Note to Self" : "You are the owner",
          body: status.pairing ? (
            <>
              <StepNote>
                From your own Signal, send this word to {status.account}. If you linked your own account, send it to yourself in Note to Self.
                Keep it to yourself: whoever sends it first is the owner.
              </StepNote>
              <div className="mt-2 max-w-[280px]"><CopyRow value={status.pairing} big /></div>
              <span className="mt-2 block text-small text-muted-foreground">{t("signalSection.thisTicksWhenItArrives")}</span>
            </>
          ) : (
            <>
              <StepNote>So {agentName} knows which messages are yours.</StepNote>
              <Button className="mt-2" size="sm" variant="secondary" disabled={busy} onClick={() => post({ pair: true })}>{t("signalSection.getAPairingWord")}</Button>
            </>
          ),
        },
      ]
    : [];

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <ConnectionHeader
        icon={<MessageDots size={14} className="shrink-0 text-muted-foreground" />}
        title="Signal"
        says={`Message ${agentName} on Signal.`}
        info={t("signalSection.signalCliOnThisComputerIs")}
        health={h && <HealthLine tone={h.tone} label={h.label} title={status?.connection.detail} />}
        control={status?.configured && <Switch aria-label={t("signalSection.answerOnSignal")} checked={status.enabled} disabled={busy} onCheckedChange={(enabled) => post({ enabled })} />}
      />

      <AnimatePresence initial={false}>
        {justPaired && status && (
          <PairedMoment
            key="paired"
            icon={<MessageDots size={18} />}
            title={status.ownerSelf ? t("signalSection.pairedInYourNoteTo") : `You own ${status.account}`}
            detail={status.ownerSelf ? `Write to ${agentName} there.` : `Messages to it now reach ${agentName}.`}
          />
        )}
      </AnimatePresence>

      {!status && !error && <Loader2 size={14} className="mt-3 animate-spin text-muted-foreground" aria-label={t("common.loading2")} />}
      {status && !status.configured && !opened ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => { setOpened(true); load(); }}>
          {t("signalSection.setUpSignal")}
        </Button>
      ) : (
        settingUp && !justPaired && <Checklist label={t("signalSection.setUpSignal")} steps={steps} />
      )}

      {status?.configured && status.ownerPaired && (
        <p className="mt-3 text-small leading-relaxed text-muted-foreground">
          {status.ownerSelf
            ? `${status.account} is your own account. ${agentName} reads only your Note to Self; your other conversations are dropped before anything reads them.`
            : `${status.account} answers for ${agentName}. Others can message it to ask to be let in.`}
          {status.connection.state === "error" && status.connection.detail ? ` ${status.connection.detail}` : ""}
        </p>
      )}

      {status && !status.ownerSelf && status.people.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <div className="text-body font-semibold text-foreground">{t("signalSection.peopleOnSignal")}</div>
          {!status.engineReady && (
            <p className="mt-0.5 text-small leading-relaxed text-warning">
              {agentName} answers people without full access only on Claude Code or an API model.
            </p>
          )}
          <div className="mt-1.5 flex flex-col">
            {status.people.map((person) => (
              <div key={person.id} className="flex flex-col items-start justify-between gap-2 py-2 sm:flex-row sm:gap-3">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-body text-foreground">{person.name}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-caption",
                        person.state === "allowed" ? "bg-success/10 text-success" : person.state === "pending" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {person.full ? t("signalSection.fullAccess") : PERSON_STATE[person.state]}
                    </span>
                  </span>
                  {/* a profile name is chosen freely; the number is not */}
                  <span className="block text-caption text-muted-foreground">
                    {person.number ?? t("signalSection.numberNotShared")}
                    {person.sameName ? ". Someone else here has the same name" : ""}
                  </span>
                  {person.first && <span className="block break-words text-caption text-muted-foreground">They wrote: {person.first}</span>}
                  {person.state === "allowed" && (
                    <span className="block text-caption text-muted-foreground">
                      {person.full ? `Uses ${agentName} with its own tools, in a conversation of their own.` : `Talks with ${agentName} in a conversation of their own, without its tools or your notes.`}
                    </span>
                  )}
                </span>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {person.state !== "allowed" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => post({ personId: person.id, action: "allow" })}>{t("signalSection.letIn")}</Button>}
                  {person.state === "allowed" && !person.full && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void giveFullAccess(person, agentName)}>{t("signalSection.giveFullAccess")}</Button>}
                  {person.full && <Button size="sm" variant="ghost" disabled={busy} onClick={() => post({ personId: person.id, action: "restricted" })}>{t("signalSection.restrict")}</Button>}
                  {person.state === "pending" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => post({ personId: person.id, action: "decline" })}>{t("common.notNow")}</Button>}
                  {(person.state === "allowed" || person.state === "pending") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => post({ personId: person.id, action: "remove" })}>{t("signalSection.takeOut")}</Button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {status?.admissionFull && <p className="mt-2 text-small text-warning">{t("signalSection.theWaitingListIsFull")}</p>}

      {status?.configured && (
        <div className="mt-4 border-t pt-3">
          <p className="text-small leading-relaxed text-muted-foreground">
            {status.voiceVendor ? `Voice notes are transcribed by ${status.voiceVendor === "openai" ? "OpenAI" : "ElevenLabs"} with your speech key.` : t("signalSection.voiceNotesNeedAnOpenai")}
          </p>
          <ConnectionNote>{t("signalSection.toUnlinkThisComputerFor")}</ConnectionNote>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-small text-muted-foreground">
            {status.ownerPaired && <button disabled={busy} onClick={() => post({ unpair: true })} className="underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline">{t("signalSection.unpairMe")}</button>}
            <button disabled={busy} onClick={() => post({ forget: true })} className="underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline">{t("signalSection.removeAccount")}</button>
          </div>
        </div>
      )}
      <ConnectionError>{error}</ConnectionError>
    </div>
  );
}
