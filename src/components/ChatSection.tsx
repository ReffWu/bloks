// Slack, Discord, WhatsApp and Signal, for carrying shared rooms into a
// team's channels and groups.
//
// Only the connection lives here. Which room goes to which channel is
// chosen in that room's Share panel, next to who is let in, because the
// two decisions are made together.
//
// Each platform's setup is a short numbered list rather than a paragraph,
// and every token is read for its shape as it is pasted. The shapes are
// the server's own (server/slack.ts, discord.ts, whatsapp.ts), so a paste
// the server would refuse is caught here, calmly, before the round trip.
import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ExternalLink } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { MessagesSquare } from "@/components/icons";
import { Send } from "@/components/icons";
import { api } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePageVisible } from "@/lib/pageVisible";
import {
  Checklist,
  ConnectionError,
  ConnectionHeader,
  ConnectionNote,
  CopyRow,
  HealthLine,
  PairedMoment,
  SecretField,
  StepNote,
  type Health,
  type Step,
} from "./ConnectionKit";
import { t, tr } from "@/lib/i18n";

type Platform = "slack" | "discord";

interface PlatformStatus {
  configured: boolean;
  enabled: boolean;
  state: "off" | "connecting" | "connected" | "error";
  detail?: string;
}

interface WhatsAppStatus extends PlatformStatus {
  number: string | null;
  webhookUrl: string | null;
  verifyToken: string | null;
}

interface SignalStatus extends PlatformStatus {
  account: string | null;
  daemon: string;
}

type Status = Record<Platform, PlatformStatus> & { whatsapp: WhatsAppStatus; signal: SignalStatus };

// The server's own checks, word for word, so nothing it would refuse
// gets as far as asking it.
const SHAPE = {
  slackBot: /^xoxb-[A-Za-z0-9-]{20,}$/,
  slackApp: /^xapp-[A-Za-z0-9-]{20,}$/,
  discord: /^[A-Za-z0-9_.-]{50,100}$/,
  waNumberId: /^\d{6,20}$/,
  waToken: /^[A-Za-z0-9_-]{40,600}$/,
  waSecret: /^[a-f0-9]{32}$/i,
};

const SLACK_SCOPES = ["channels:history", "groups:history", "channels:read", "groups:read", "chat:write", "users:read"];

/** One reading of a platform's state, the same words on every card. */
function health(status: PlatformStatus): { tone: Health; label: string } {
  if (!status.configured) return { tone: "off", label: t("chatSection.health.notSetUp") };
  if (!status.enabled) return { tone: "off", label: t("common.off") };
  if (status.state === "connected") return { tone: "on", label: t("common.connected") };
  if (status.state === "error") return { tone: "issue", label: t("chatSection.health.notConnected") };
  return { tone: "wait", label: t("chatSection.health.connecting") };
}

export function ChatSection() {
  const [status, setStatus] = useState<Status | null>(null);

  const load = () =>
    api("/api/chat")
      .then(setStatus)
      .catch(() => setStatus(null));

  // the connection settles a moment after it is saved, so this looks
  // again, but only while somebody can see the answer
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!status) return null;
  return (
    <>
      <PlatformCard platform="slack" status={status.slack} onChange={setStatus} />
      <PlatformCard platform="discord" status={status.discord} onChange={setStatus} />
      <WhatsAppCard status={status.whatsapp} onChange={setStatus} />
      {status.signal && <SignalRoomsCard status={status.signal} onChange={setStatus} />}
      <EmailCard />
    </>
  );
}

/** Opens a platform's own console in the browser. */
function OutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild size="sm" variant="secondary" className="mt-2">
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ExternalLink size={12} />
      </a>
    </Button>
  );
}

/**
 * Celebrates the line coming up, but only after this card saved the
 * tokens: switching an old connection back on is not an occasion. Armed
 * by the save, spent by the first "connected" after it, which can be the
 * save's own answer (WhatsApp is ready the moment it is set up).
 */
function useConnectedMoment(status: PlatformStatus) {
  const [armed, setArmed] = useState(false);
  const [just, setJust] = useState(false);
  const up = status.enabled && status.state === "connected";
  useEffect(() => {
    if (!armed || !up) return;
    setArmed(false);
    setJust(true);
  }, [armed, up]);
  useEffect(() => {
    if (!just) return;
    const timer = setTimeout(() => setJust(false), 2600);
    return () => clearTimeout(timer);
  }, [just]);
  return { arm: () => setArmed(true), armed, just };
}

/** A step ticked by a field's shape stays open while it is typed into,
 * and folds to a line once the server has what was typed. */
function fieldStep(saved: boolean, ok: boolean, summary: string): Pick<Step, "state" | "keep" | "summary"> {
  return { state: saved || ok ? "done" : "now", keep: !saved, summary };
}

function PlatformCard({
  platform,
  status,
  onChange,
}: {
  platform: Platform;
  status: PlatformStatus;
  onChange: (next: Status) => void;
}) {
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the setup steps are long; they wait until someone decides to set it up
  const [settingUp, setSettingUp] = useState(false);
  const moment = useConnectedMoment(status);

  const post = (body: Record<string, unknown>, setup = false) => {
    setBusy(true);
    setError(null);
    api("/api/chat", { method: "POST", body: JSON.stringify({ platform, ...body }) })
      .then((next: Status) => {
        if (setup) moment.arm();
        onChange(next);
        setBotToken("");
        setAppToken("");
        setToken("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const name = platform === "slack" ? "Slack" : "Discord";
  const h = health(status);
  const botOk = SHAPE.slackBot.test(botToken.trim());
  const appOk = SHAPE.slackApp.test(appToken.trim());
  const discordOk = SHAPE.discord.test(token.trim());
  const ready = platform === "slack" ? botOk && appOk : discordOk;
  const connect = () => {
    if (!ready || busy) return;
    post(platform === "slack" ? { botToken: botToken.trim(), appToken: appToken.trim() } : { token: token.trim() }, true);
  };

  // Saved is not connected: the line comes up a moment later, so the list
  // stays until it does and the last step ticks on the server's word.
  const saved = status.configured;
  const finishing = moment.armed && saved && status.state !== "error";
  const connectStep: Step = {
    key: "connect",
    title: t("chatSection.connectPlatform", { name }),
    state: saved ? (status.state === "connected" ? "done" : "wait") : busy ? "wait" : ready ? "now" : "later",
    body: saved ? (
      <StepNote>{t("chatSection.tokensSaved", { name })}</StepNote>
    ) : (
      <Button variant="brand" size="sm" disabled={busy || !ready} onClick={connect}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : null}
        {busy ? t("chatSection.checkingWith", { name }) : t("chatSection.connectPlatform", { name })}
      </Button>
    ),
  };

  const steps: Step[] =
    platform === "slack"
      ? [
          {
            key: "app",
            title: t("chatSection.slack.createApp"),
            ...fieldStep(saved, botOk, t("common.done")),
            body: (
              <>
                <StepNote>
                  {tr("chatSection.slack.socketMode", {
                    channels: <span className="font-mono">message.channels</span>,
                    groups: <span className="font-mono">message.groups</span>,
                  })}
                </StepNote>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {SLACK_SCOPES.map((scope) => (
                    <code key={scope} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-caption text-foreground">
                      {scope}
                    </code>
                  ))}
                </div>
                <OutLink href="https://api.slack.com/apps">{t("chatSection.openSlackApps")}</OutLink>
              </>
            ),
          },
          {
            key: "bot",
            title: t("chatSection.slack.pasteBotToken"),
            ...fieldStep(saved, botOk, t("common.saved")),
            body: (
              <SecretField
                id="slack-bot-token"
                label={t("chatSection.botToken")}
                value={botToken}
                onChange={setBotToken}
                shape={SHAPE.slackBot}
                hint={t("chatSection.startsWithXoxbUnderOauth")}
                placeholder="xoxb-..."
                quietLabel
                className="max-w-[420px]"
              />
            ),
          },
          {
            key: "apptoken",
            title: t("chatSection.slack.pasteAppToken"),
            ...fieldStep(saved, appOk, t("common.saved")),
            body: (
              <SecretField
                id="slack-app-token"
                label={t("chatSection.appLevelToken")}
                value={appToken}
                onChange={setAppToken}
                shape={SHAPE.slackApp}
                hint={t("chatSection.startsWithXappMakeOne")}
                placeholder="xapp-..."
                quietLabel
                onEnter={connect}
                className="max-w-[420px]"
              />
            ),
          },
          connectStep,
        ]
      : [
          {
            key: "bot",
            title: t("chatSection.discord.createBot"),
            ...fieldStep(saved, discordOk, t("common.done")),
            body: (
              <>
                <StepNote>
                  {t("chatSection.inTheDeveloperPortalMake")}
                </StepNote>
                <OutLink href="https://discord.com/developers/applications">{t("chatSection.openTheDeveloperPortal")}</OutLink>
              </>
            ),
          },
          {
            key: "token",
            title: t("chatSection.discord.pasteToken"),
            ...fieldStep(saved, discordOk, t("common.saved")),
            body: (
              <SecretField
                id="discord-token"
                label={t("chatSection.botToken")}
                value={token}
                onChange={setToken}
                shape={SHAPE.discord}
                hint={t("chatSection.aLongStringFromThe")}
                placeholder={t("common.pasteTheToken")}
                quietLabel
                onEnter={connect}
                className="max-w-[420px]"
              />
            ),
          },
          connectStep,
        ];

  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0">
      <ConnectionHeader
        icon={<MessagesSquare size={14} className="shrink-0 text-muted-foreground" />}
        title={name}
        says={t("chatSection.platformSays", { name })}
        health={<HealthLine tone={h.tone} label={h.label} />}
        control={
          status.configured && (
            <Switch aria-label={name} checked={status.enabled} disabled={busy} onCheckedChange={(on) => post({ enabled: on })} />
          )
        }
      />

      <AnimatePresence initial={false}>
        {moment.just && (
          <PairedMoment
            key="up"
            icon={<MessagesSquare size={18} />}
            title={t("chatSection.platformConnected", { name })}
            detail={t("chatSection.pickAChannelForA")}
          />
        )}
      </AnimatePresence>

      {!status.configured && !settingUp ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setSettingUp(true)}>
          {t("chatSection.setUpPlatform", { name })}
        </Button>
      ) : !status.configured ? (
        <>
          <Checklist label={t("chatSection.setUpPlatform", { name })} steps={steps} />
          <button
            onClick={() => {
              setSettingUp(false);
              setBotToken("");
              setAppToken("");
              setToken("");
            }}
            className="mt-3 text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
          >
            {t("common.notNow")}
          </button>
        </>
      ) : finishing ? (
        <Checklist label={t("chatSection.setUpPlatform", { name })} steps={steps} />
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3">
          <span className="min-w-0 text-small text-muted-foreground">
            {!status.enabled
              ? t("chatSection.switchedOff")
              : status.state === "error"
                ? status.detail || t("chatSection.notConnected")
                : status.state === "connected"
                  ? t("chatSection.pickAChannelForARoom")
                  : t("chatSection.connecting")}
          </span>
          <button
            onClick={() => post({ forget: true })}
            className="text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline"
          >
            {t("chatSection.forgetPlatform", { name })}
          </button>
        </div>
      )}

      <ConnectionError>{error}</ConnectionError>
    </div>
  );
}

/**
 * WhatsApp is the odd one out: Meta will only call an address, so its
 * messages come to this computer through Bloks Cloud, and they arrive
 * readable. That is said before anything is typed, not after.
 */
function WhatsAppCard({ status, onChange }: { status: WhatsAppStatus; onChange: (next: Status) => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const moment = useConnectedMoment(status);

  const post = (body: Record<string, unknown>, setup = false) => {
    setBusy(true);
    setError(null);
    api("/api/chat", { method: "POST", body: JSON.stringify({ platform: "whatsapp", ...body }) })
      .then((next: Status) => {
        if (setup) moment.arm();
        onChange(next);
        setPhoneNumberId("");
        setToken("");
        setAppSecret("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const h = health(status);
  const idOk = SHAPE.waNumberId.test(phoneNumberId.trim());
  const tokenOk = SHAPE.waToken.test(token.trim());
  const secretOk = SHAPE.waSecret.test(appSecret.trim());
  const ready = idOk && tokenOk && secretOk;
  const connect = () => {
    if (!ready || busy) return;
    post({ phoneNumberId: phoneNumberId.trim(), token: token.trim(), appSecret: appSecret.trim() }, true);
  };

  const steps: Step[] = [
    {
      key: "meta",
      title: t("chatSection.whatsapp.addToMetaApp"),
      state: idOk ? "done" : "now",
      keep: true,
      body: (
        <>
          <StepNote>{t("chatSection.inMetaForDevelopersAdd")}</StepNote>
          <OutLink href="https://developers.facebook.com/apps">{t("chatSection.openMetaForDevelopers")}</OutLink>
        </>
      ),
    },
    {
      key: "values",
      title: t("chatSection.whatsapp.pasteThreeValues"),
      state: ready ? "done" : "now",
      keep: true,
      body: (
        <div className="flex max-w-[420px] flex-col gap-2">
          <SecretField
            id="wa-number-id"
            label={t("chatSection.phoneNumberId")}
            value={phoneNumberId}
            onChange={setPhoneNumberId}
            shape={SHAPE.waNumberId}
            hint={t("chatSection.theLongNumberUnderYour")}
            secret={false}
          />
          <SecretField
            id="wa-token"
            label={t("chatSection.accessToken")}
            value={token}
            onChange={setToken}
            shape={SHAPE.waToken}
            hint={t("chatSection.aPermanentTokenFromA")}
          />
          <SecretField
            id="wa-secret"
            label={t("chatSection.appSecret")}
            value={appSecret}
            onChange={setAppSecret}
            shape={SHAPE.waSecret}
            hint={t("chatSection.whatsapp.appSecretHint")}
            onEnter={connect}
          />
        </div>
      ),
    },
    {
      key: "connect",
      title: t("chatSection.connectPlatform", { name: "WhatsApp" }),
      state: busy ? "wait" : ready ? "now" : "later",
      body: (
        <Button variant="brand" size="sm" disabled={busy || !ready} onClick={connect}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {busy ? t("chatSection.checkingWith", { name: "Meta" }) : t("chatSection.connectPlatform", { name: "WhatsApp" })}
        </Button>
      ),
    },
    {
      key: "webhook",
      title: t("chatSection.whatsapp.pointWebhook"),
      state: "later",
    },
  ];

  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0">
      <ConnectionHeader
        icon={<MessagesSquare size={14} className="shrink-0 text-muted-foreground" />}
        title="WhatsApp"
        says={t("chatSection.whatsapp.says")}
        health={<HealthLine tone={h.tone} label={h.label} />}
        control={
          status.configured && (
            <Switch aria-label="WhatsApp" checked={status.enabled} disabled={busy} onCheckedChange={(on) => post({ enabled: on })} />
          )
        }
      />

      {(status.configured || settingUp) && (
        <ConnectionNote>
          {t("chatSection.needsBloksCloudMessagesPass")}
        </ConnectionNote>
      )}

      <AnimatePresence initial={false}>
        {moment.just && (
          <PairedMoment
            key="up"
            icon={<MessagesSquare size={18} />}
            title={status.number ? t("chatSection.whatsapp.connectedAs", { number: status.number }) : t("chatSection.platformConnected", { name: "WhatsApp" })}
            detail={t("chatSection.oneLastStepInMeta")}
          />
        )}
      </AnimatePresence>

      {!status.configured && !settingUp ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setSettingUp(true)}>
          {t("chatSection.setUpPlatform", { name: "WhatsApp" })}
        </Button>
      ) : !status.configured ? (
        <>
          <Checklist label={t("chatSection.setUpPlatform", { name: "WhatsApp" })} steps={steps} />
          <button
            onClick={() => {
              setSettingUp(false);
              setPhoneNumberId("");
              setToken("");
              setAppSecret("");
            }}
            className="mt-3 text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
          >
            {t("common.notNow")}
          </button>
        </>
      ) : (
        <>
          {/* Meta checks these itself when they are saved there, and tells
              nobody here, so this step stays in view rather than ticking
              on a guess. */}
          {status.webhookUrl && status.verifyToken && (
            <div className="mt-3 space-y-2">
              <div className="text-small leading-relaxed text-muted-foreground">
                {tr("chatSection.whatsapp.lastStep", { field: <span className="font-mono">messages</span> })}
              </div>
              <CopyRow label={t("chatSection.callbackUrl")} value={status.webhookUrl} />
              <CopyRow label={t("chatSection.verifyToken")} value={status.verifyToken} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3">
            <span className="min-w-0 text-small text-muted-foreground">
              {status.number ? t("chatSection.whatsapp.asNumber", { number: status.number }) : t("chatSection.yourBusinessNumber")}
              {status.enabled && status.state === "error" && status.detail ? `. ${status.detail}` : ""}
            </span>
            <button
              onClick={() => post({ forget: true })}
              className="text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline"
            >
              {t("chatSection.forgetPlatform", { name: "WhatsApp" })}
            </button>
          </div>
        </>
      )}

      <ConnectionError>{error}</ConnectionError>
    </div>
  );
}

interface EmailStatus {
  enabled: boolean;
  cloud: boolean;
  allowFrom: string[];
  addresses: Array<{ botId: string; name: string; address: string | null }>;
}

/** Each agent's own address, through Bloks Cloud (server "email your
 * agent"). Mail to it becomes a turn; the agent's answer is the reply. */
/**
 * Signal groups, through an account already linked in signal-cli for one
 * of the agents (or another one linked the same way). Nothing to paste:
 * signal-cli holds the account, so this only says which one carries rooms.
 */
function SignalRoomsCard({ status, onChange }: { status: SignalStatus; onChange: (next: Status) => void }) {
  const [accounts, setAccounts] = useState<Array<{ account: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const h = health(status);

  useEffect(() => {
    if (status.configured) return;
    api("/api/signal/accounts").then(({ accounts }) => setAccounts(accounts)).catch(() => setAccounts([]));
  }, [status.configured]);

  const post = (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    api("/api/chat", { method: "POST", body: JSON.stringify({ platform: "signal", ...body }) })
      .then(onChange)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0">
      <ConnectionHeader
        icon={<MessagesSquare size={14} className="shrink-0 text-muted-foreground" />}
        title={t("chatSection.signalGroups")}
        says={t("chatSection.signal.says")}
        info={t("chatSection.throughSignalCliOnThis")}
        health={<HealthLine tone={h.tone} label={h.label} />}
        control={status.configured && <Switch aria-label={t("chatSection.signalGroups")} checked={status.enabled} disabled={busy} onCheckedChange={(on) => post({ enabled: on })} />}
      />
      {status.configured ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3">
          <span className="min-w-0 text-small text-muted-foreground">
            {!status.enabled ? t("chatSection.switchedOff") : status.state === "error" ? status.detail || t("chatSection.notConnected") : t("chatSection.signal.roomsGoThrough", { account: status.account ?? "" })}
          </span>
          <button onClick={() => post({ forget: true })} className="text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline">
            {t("chatSection.forgetSignalGroups")}
          </button>
        </div>
      ) : accounts === null ? (
        <Loader2 size={14} className="mt-3 animate-spin text-muted-foreground" aria-label={t("common.loading2")} />
      ) : accounts.length === 0 ? (
        <ConnectionNote>{t("chatSection.linkASignalAccountUnder")}</ConnectionNote>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label={t("chatSection.signalAccountForRooms")}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && post({ account: e.target.value })}
            className="h-8 rounded-lg border bg-background px-2 text-body text-foreground"
          >
            <option value="">{t("chatSection.chooseAnAccount")}</option>
            {accounts.map((a) => <option key={a.account} value={a.account}>{a.account}</option>)}
          </select>
        </div>
      )}
      <ConnectionError>{error}</ConnectionError>
    </div>
  );
}

function EmailCard() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [allow, setAllow] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api("/api/chat/email")
      .then((r: EmailStatus) => {
        setStatus(r);
        setAllow(r.allowFrom.join(", "));
      })
      .catch(() => setStatus(null));
  }, []);
  if (!status) return null;
  const patch = (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    api("/api/chat/email", { method: "PATCH", body: JSON.stringify(body) })
      .then((r: EmailStatus) => {
        setStatus(r);
        setAllow(r.allowFrom.join(", "));
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const h: { tone: Health; label: string } = status.enabled
    ? { tone: "on", label: t("chatSection.health.on") }
    : !status.cloud
      ? { tone: "off", label: t("chatSection.health.needsCloud") }
      : { tone: "off", label: t("common.off") };
  return (
    <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0">
      <ConnectionHeader
        icon={<Send size={14} className="shrink-0 text-muted-foreground" />}
        title={t("chatSection.email")}
        says={t("chatSection.giveEveryAgentAnEmail")}
        health={<HealthLine tone={h.tone} label={h.label} />}
        control={
          <Switch
            checked={status.enabled}
            disabled={busy || (!status.cloud && !status.enabled)}
            onCheckedChange={(on) => patch({ enabled: on })}
            aria-label={t("chatSection.email")}
          />
        }
      />
      {!status.cloud && !status.enabled && <ConnectionNote>{t("chatSection.needsBloksCloudTurnIt")}</ConnectionNote>}
      {status.enabled && (
        <>
          <div className="mt-3 space-y-2">
            {status.addresses.map((a) =>
              a.address ? <CopyRow key={a.botId} label={a.name} value={a.address} /> : null,
            )}
          </div>
          <div className="mt-3 border-t pt-3">
            <label htmlFor="email-allow" className="text-small text-muted-foreground">
              {t("chatSection.whoCanWriteAddressesOr")}
            </label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="email-allow"
                value={allow}
                onChange={(e) => setAllow(e.target.value)}
                placeholder={t("chatSection.youExampleComYourcompanyCom")}
                className="h-8 text-body"
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-8"
                disabled={busy}
                onClick={() => patch({ allowFrom: allow.split(/[\s,]+/).filter(Boolean) })}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
          <ConnectionNote>
            {t("chatSection.mailPassesThroughBloksCloud")}
          </ConnectionNote>
        </>
      )}
      <ConnectionError>{error}</ConnectionError>
    </div>
  );
}
