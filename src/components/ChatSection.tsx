// Slack, Discord and WhatsApp, for carrying shared rooms into a team's
// channels and groups.
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

type Status = Record<Platform, PlatformStatus> & { whatsapp: WhatsAppStatus };

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
  if (!status.configured) return { tone: "off", label: "Not set up" };
  if (!status.enabled) return { tone: "off", label: "Off" };
  if (status.state === "connected") return { tone: "on", label: "Connected" };
  if (status.state === "error") return { tone: "issue", label: "Not connected" };
  return { tone: "wait", label: "Connecting" };
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
    title: `Connect ${name}`,
    state: saved ? (status.state === "connected" ? "done" : "wait") : busy ? "wait" : ready ? "now" : "later",
    body: saved ? (
      <StepNote>Tokens saved. Waiting for {name} to answer.</StepNote>
    ) : (
      <Button size="sm" disabled={busy || !ready} onClick={connect}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : null}
        {busy ? "Checking with " + name : `Connect ${name}`}
      </Button>
    ),
  };

  const steps: Step[] =
    platform === "slack"
      ? [
          {
            key: "app",
            title: "Create a Slack app",
            ...fieldStep(saved, botOk, "Done"),
            body: (
              <>
                <StepNote>
                  Turn on Socket Mode. Give the bot these scopes, subscribe it to the{" "}
                  <span className="font-mono">message.channels</span> and <span className="font-mono">message.groups</span>{" "}
                  events, and install it.
                </StepNote>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {SLACK_SCOPES.map((scope) => (
                    <code key={scope} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-caption text-foreground">
                      {scope}
                    </code>
                  ))}
                </div>
                <OutLink href="https://api.slack.com/apps">Open Slack apps</OutLink>
              </>
            ),
          },
          {
            key: "bot",
            title: "Paste the bot token",
            ...fieldStep(saved, botOk, "Saved"),
            body: (
              <SecretField
                id="slack-bot-token"
                label="Bot token"
                value={botToken}
                onChange={setBotToken}
                shape={SHAPE.slackBot}
                hint="Starts with xoxb-. Under OAuth and permissions."
                placeholder="xoxb-..."
                quietLabel
                className="max-w-[420px]"
              />
            ),
          },
          {
            key: "apptoken",
            title: "Paste an app-level token",
            ...fieldStep(saved, appOk, "Saved"),
            body: (
              <SecretField
                id="slack-app-token"
                label="App-level token"
                value={appToken}
                onChange={setAppToken}
                shape={SHAPE.slackApp}
                hint="Starts with xapp-. Make one with connections:write."
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
            title: "Create a Discord bot",
            ...fieldStep(saved, discordOk, "Done"),
            body: (
              <>
                <StepNote>
                  In the developer portal, make an application and add a bot. Under Bot, turn on Message Content
                  Intent. Invite it to your server with permission to read and send messages.
                </StepNote>
                <OutLink href="https://discord.com/developers/applications">Open the developer portal</OutLink>
              </>
            ),
          },
          {
            key: "token",
            title: "Paste its token",
            ...fieldStep(saved, discordOk, "Saved"),
            body: (
              <SecretField
                id="discord-token"
                label="Bot token"
                value={token}
                onChange={setToken}
                shape={SHAPE.discord}
                hint="A long string from the Bot page."
                placeholder="Paste the token"
                quietLabel
                onEnter={connect}
                className="max-w-[420px]"
              />
            ),
          },
          connectStep,
        ];

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <ConnectionHeader
        icon={<MessagesSquare size={14} className="shrink-0 text-muted-foreground" />}
        title={name}
        says={`Bring a shared room into a ${name} channel. People you let in name an agent to talk to it. Nothing new is opened on your network.`}
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
            title={`${name} is connected`}
            detail="Pick a channel for a room in that room's Share panel."
          />
        )}
      </AnimatePresence>

      {!status.configured && !settingUp ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setSettingUp(true)}>
          Set up {name}
        </Button>
      ) : !status.configured ? (
        <>
          <Checklist label={`Set up ${name}`} steps={steps} />
          <button
            onClick={() => {
              setSettingUp(false);
              setBotToken("");
              setAppToken("");
              setToken("");
            }}
            className="mt-3 text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
          >
            Not now
          </button>
        </>
      ) : finishing ? (
        <Checklist label={`Set up ${name}`} steps={steps} />
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3">
          <span className="min-w-0 text-small text-muted-foreground">
            {!status.enabled
              ? "Switched off."
              : status.state === "error"
                ? status.detail || "Not connected."
                : status.state === "connected"
                  ? "Pick a channel for a room in its Share panel."
                  : "Connecting."}
          </span>
          <button
            onClick={() => post({ forget: true })}
            className="text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline"
          >
            Forget {name}
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
      title: "Add WhatsApp to a Meta app",
      state: idOk ? "done" : "now",
      keep: true,
      body: (
        <>
          <StepNote>In Meta for Developers, add WhatsApp to a business app, with a phone number.</StepNote>
          <OutLink href="https://developers.facebook.com/apps">Open Meta for Developers</OutLink>
        </>
      ),
    },
    {
      key: "values",
      title: "Paste three values",
      state: ready ? "done" : "now",
      keep: true,
      body: (
        <div className="flex max-w-[420px] flex-col gap-2">
          <SecretField
            id="wa-number-id"
            label="Phone number ID"
            value={phoneNumberId}
            onChange={setPhoneNumberId}
            shape={SHAPE.waNumberId}
            hint="The long number under your number, not the number itself."
            secret={false}
          />
          <SecretField
            id="wa-token"
            label="Access token"
            value={token}
            onChange={setToken}
            shape={SHAPE.waToken}
            hint="A permanent token from a system user."
          />
          <SecretField
            id="wa-secret"
            label="App secret"
            value={appSecret}
            onChange={setAppSecret}
            shape={SHAPE.waSecret}
            hint="32 letters and numbers, in App settings, Basic."
            onEnter={connect}
          />
        </div>
      ),
    },
    {
      key: "connect",
      title: "Connect WhatsApp",
      state: busy ? "wait" : ready ? "now" : "later",
      body: (
        <Button size="sm" disabled={busy || !ready} onClick={connect}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {busy ? "Checking with Meta" : "Connect WhatsApp"}
        </Button>
      ),
    },
    {
      key: "webhook",
      title: "Point Meta's webhook here",
      state: "later",
    },
  ];

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <ConnectionHeader
        icon={<MessagesSquare size={14} className="shrink-0 text-muted-foreground" />}
        title="WhatsApp"
        says="Bring a shared room into a WhatsApp group with a WhatsApp Business number. People you let in mention the number or name an agent."
        health={<HealthLine tone={h.tone} label={h.label} />}
        control={
          status.configured && (
            <Switch aria-label="WhatsApp" checked={status.enabled} disabled={busy} onCheckedChange={(on) => post({ enabled: on })} />
          )
        }
      />

      {(status.configured || settingUp) && (
        <ConnectionNote>
          Needs Bloks Cloud. Messages pass through it without end-to-end encryption, because Meta sends them that way.
          Nothing is kept.
        </ConnectionNote>
      )}

      <AnimatePresence initial={false}>
        {moment.just && (
          <PairedMoment
            key="up"
            icon={<MessagesSquare size={18} />}
            title={status.number ? `Connected as ${status.number}` : "WhatsApp is connected"}
            detail="One last step in Meta, below."
          />
        )}
      </AnimatePresence>

      {!status.configured && !settingUp ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setSettingUp(true)}>
          Set up WhatsApp
        </Button>
      ) : !status.configured ? (
        <>
          <Checklist label="Set up WhatsApp" steps={steps} />
          <button
            onClick={() => {
              setSettingUp(false);
              setPhoneNumberId("");
              setToken("");
              setAppSecret("");
            }}
            className="mt-3 text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
          >
            Not now
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
                Last step, in your app's WhatsApp settings: under Webhooks, paste these two, then subscribe to{" "}
                <span className="font-mono">messages</span>.
              </div>
              <CopyRow label="Callback URL" value={status.webhookUrl} />
              <CopyRow label="Verify token" value={status.verifyToken} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3">
            <span className="min-w-0 text-small text-muted-foreground">
              {status.number ? `As ${status.number}` : "Your business number"}
              {status.enabled && status.state === "error" && status.detail ? `. ${status.detail}` : ""}
            </span>
            <button
              onClick={() => post({ forget: true })}
              className="text-small text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline"
            >
              Forget WhatsApp
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
    ? { tone: "on", label: "On" }
    : !status.cloud
      ? { tone: "off", label: "Needs Cloud" }
      : { tone: "off", label: "Off" };
  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <ConnectionHeader
        icon={<Send size={14} className="shrink-0 text-muted-foreground" />}
        title="Email"
        says="Give every agent an email address. Forward it anything and it replies by email."
        health={<HealthLine tone={h.tone} label={h.label} />}
        control={
          <Switch
            checked={status.enabled}
            disabled={busy || (!status.cloud && !status.enabled)}
            onCheckedChange={(on) => patch({ enabled: on })}
            aria-label="Email"
          />
        }
      />
      {!status.cloud && !status.enabled && <ConnectionNote>Needs Bloks Cloud. Turn it on under Bloks Cloud.</ConnectionNote>}
      {status.enabled && (
        <>
          <div className="mt-3 space-y-2">
            {status.addresses.map((a) =>
              a.address ? <CopyRow key={a.botId} label={a.name} value={a.address} /> : null,
            )}
          </div>
          <div className="mt-3 border-t pt-3">
            <label htmlFor="email-allow" className="text-small text-muted-foreground">
              Who can write: addresses or @domains. Left empty, anyone can, and agents reply in text only, with no
              tools, apps, secrets, notes or past conversations (Claude Code or API models only).
            </label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="email-allow"
                value={allow}
                onChange={(e) => setAllow(e.target.value)}
                placeholder="you@example.com, @yourcompany.com"
                className="h-8 text-body"
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-8"
                disabled={busy}
                onClick={() => patch({ allowFrom: allow.split(/[\s,]+/).filter(Boolean) })}
              >
                Save
              </Button>
            </div>
          </div>
          <ConnectionNote>
            Mail passes through Bloks Cloud without end-to-end encryption. Nothing is kept. Agents only reply to
            people who wrote to them.
          </ConnectionNote>
        </>
      )}
      <ConnectionError>{error}</ConnectionError>
    </div>
  );
}
