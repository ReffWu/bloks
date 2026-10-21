// Settings, Plan: the membership on the one key this computer keeps, what
// it includes and how much of it is in use, the key itself, and where the
// plan can go next.
//
// Everything about the membership is bloks.dev's to say, asked by this
// computer's server with the key (server/plan-account.ts) and shown as it
// came: the plan, its status, its dates, the offers and their prices. The
// page never holds the key. It sees it masked; Copy and the offers' links
// go through the desktop app, which adds the key only in the fragment of
// a bloks.dev link (electron/plan-link.mjs).
//
// Going to bloks.dev arms a look on return (src/lib/planClient.ts): back
// in the window, the plan is asked fresh, every gate follows it, and a
// plan that went up gets its small moment here.
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Cloud,
  Copy,
  Loader2,
  Lock,
  Monitor,
  RefreshCw,
  Server,
  Smartphone,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { Skeleton, SkeletonLines } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { appPlanOf, currentWorkspace, useWorkspaces } from "@/lib/workspaces";
import {
  hostingWords,
  intervalWords,
  ladderFor,
  monthYear,
  planKey,
  planName,
  shortDate,
  statusOf,
  type Offer,
  type PlanSnapshot,
} from "@/lib/plan";
import { clearPlanNews, loadPlan, openOffer, openSite, usePlan } from "@/lib/planClient";
import { HealthLine, SecretField, type Health } from "../ConnectionKit";
import { BloksAiRow, BloksAiSettings, useBloksAi } from "../CreditsSection";
import { BlockBurst } from "../members/BlockBurst";
import { SettingRow, SettingsEmpty, SettingsGroup } from "../SettingsLayout";
import { YourName } from "./YourName";
import { goToWorkspace } from "../WorkspaceSwitcher";

const CLOUD_KEY = /^blok_live_[0-9a-f]{32}$/;
const easeOut = [0.23, 1, 0.32, 1] as const;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({}));
  // the service's own words: a refused card says why better than we can
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

interface RelayPlan {
  plan: string | null;
  spaces: { online: number; limit: number | null } | null;
  licence: boolean;
}

/** How many workspaces are online, in the relay's own words. */
function useRelayPlan(refreshKey: unknown) {
  const [plan, setPlan] = useState<RelayPlan | null>(null);
  useEffect(() => {
    let alive = true;
    call<RelayPlan>("/api/relay/plan")
      .then((p) => alive && setPlan(p))
      .catch(() => alive && setPlan(null));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return plan;
}

/** The glyph a plan wears on its card. */
function PlanGlyph({ planKeyOf, className }: { planKeyOf: string; className?: string }) {
  const Icon =
    planKeyOf === "team" || planKeyOf === "team-hosted" ? Users
    : planKeyOf === "hosted" ? Server
    : planKeyOf === "cloud" ? Cloud
    : planKeyOf === "free" ? Monitor
    : Sparkles;
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl",
        planKeyOf === "free" ? "bg-muted text-muted-foreground" : "bg-brand-soft text-brand-ink",
        className,
      )}
    >
      <Icon size={20} />
    </span>
  );
}

/** A small meter, for "x of y" in what a plan includes. */
function Meter({ value, of, label }: { value: number; of: number; label: string }) {
  const share = of > 0 ? Math.max(0, Math.min(1, value / of)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={of}
      aria-valuenow={value}
      className="mt-3 h-1.5 max-w-[360px] overflow-hidden rounded-full bg-muted"
    >
      <div className={cn("h-full origin-left", share >= 1 ? "bg-warning" : "bg-brand-ink")} style={{ transform: `scaleX(${share})` }} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-ui font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// ── the moment ─────────────────────────────────────────────────────────

/** A plan that just went up: said once, with the blocks the app spends on
 * good news. Rare by nature, so it may take a moment of delight. */
function PlanMoment({ words, at }: { words: string; at: number }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const t = setTimeout(clearPlanNews, 7000);
    return () => clearTimeout(t);
  }, [at]);
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: reduce ? 0.15 : 0.26, ease: easeOut }}
      className="mb-6 flex items-center gap-4 rounded-2xl bg-brand-soft px-5 py-4"
    >
      <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-ink text-brand-foreground">
        <Check size={20} strokeWidth={2.5} />
        <BlockBurst key={at} color="var(--brand-ink)" count={16} spread={64} />
      </span>
      <span className="min-w-0">
        <span className="block text-lead font-semibold text-foreground">{words}</span>
        <span className="block text-pretty text-body text-muted-foreground">Everything it includes is on now, in every workspace on this computer.</span>
      </span>
    </motion.div>
  );
}

// ── the plan card ──────────────────────────────────────────────────────

function staleWords(snapshot: PlanSnapshot): string | null {
  if (snapshot.accountState === "cached" && snapshot.accountAt) {
    const at = new Date(snapshot.accountAt);
    return `Offline. Showing what bloks.dev said on ${shortDate(snapshot.accountAt)} at ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }
  if (snapshot.accountState === "unavailable") return "Couldn't reach bloks.dev, so the details are missing for now.";
  return null;
}

function PlanCard({ snapshot, onManage, managing, manageError }: { snapshot: PlanSnapshot; onManage: () => void; managing: boolean; manageError: string | null }) {
  const key = planKey(snapshot, appPlanOf(useWorkspaces()));
  const account = snapshot.account;
  const status = account ? statusOf(account) : null;
  const stale = staleWords(snapshot);
  const refused = snapshot.accountState === "refused";
  const pill: { tone: Health; label: string } | null = refused ? { tone: "issue", label: "Key not recognised" } : status ? { tone: status.tone, label: status.label } : null;
  const renewal = account?.cancelsAt
    ? { label: account.cancelsAt > Date.now() ? "Cancels" : "Ended", value: shortDate(account.cancelsAt) }
    : account?.renewsAt
      ? { label: account.renewsAt < Date.now() ? "Was due" : "Renews", value: shortDate(account.renewsAt) }
      : null;
  return (
    <section aria-label="Your plan" className="mb-9 overflow-hidden rounded-2xl border bg-card">
      <div className="p-6 max-sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-center gap-4">
            <PlanGlyph planKeyOf={key} />
            <div className="min-w-0">
              <div className="text-small font-medium text-muted-foreground">Your plan</div>
              <h2 className="truncate text-heading font-semibold text-foreground">{planName(key)}</h2>
            </div>
          </div>
          {pill && <HealthLine tone={pill.tone} label={pill.label} />}
        </div>
        <p className="mt-3 text-pretty text-body text-muted-foreground">
          {account?.email ? (
            <>
              <span className="font-medium text-foreground">{account.email}</span>
              <span> · one key for every workspace on this computer</span>
            </>
          ) : (
            "One key for every workspace on this computer."
          )}
        </p>
        {(account || refused) && (
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-3">
            <Fact label="Billing" value={intervalWords(account?.interval ?? null) ?? "Not said"} />
            <Fact label={renewal?.label ?? "Renews"} value={renewal?.value ?? "Not said"} />
            <Fact label="Member since" value={account?.since ? monthYear(account.since) : "Not said"} />
          </dl>
        )}
        {status?.needsCard && (
          <div role="status" className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
            <TriangleAlert size={16} className="shrink-0 text-warning" />
            <span className="min-w-0 flex-1 basis-[220px] text-pretty text-body text-foreground">{status.line}</span>
            <Button size="sm" variant="brand" disabled={managing} onClick={onManage}>
              {managing ? <Loader2 size={13} className="animate-spin" /> : "Update your card"}
            </Button>
          </div>
        )}
        {status && !status.needsCard && status.line && <p className="mt-4 text-pretty text-small text-muted-foreground">{status.line}</p>}
        {refused && snapshot.problem && <p className="mt-4 text-pretty text-small text-destructive">{snapshot.problem}</p>}
      </div>
      <footer data-setting-row="manage-billing" className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-6 py-3 transition-colors duration-700 max-sm:px-5">
        <span className="min-w-0 flex-1 basis-[240px] text-pretty text-small text-muted-foreground">
          {manageError ? <span className="text-destructive">{manageError}</span> : (stale ?? "Billing is handled on bloks.dev, in your browser.")}
          {stale && (
            <button
              type="button"
              onClick={() => void loadPlan(true)}
              className="ml-1.5 inline-flex items-center gap-1 rounded font-medium text-foreground underline-offset-2 hover:underline"
            >
              <RefreshCw size={11} /> Try again
            </button>
          )}
        </span>
        <Button size="sm" variant="secondary" disabled={managing || refused} onClick={onManage} className="gap-1.5">
          {managing ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpRight size={13} />}
          Manage billing
        </Button>
      </footer>
    </section>
  );
}

/** No key: Bloks runs on this computer with the person's own engines and
 * keys, and a key already bought goes in here. Called Self-hosted rather
 * than Free: it is a way of running Bloks, not a lesser tier of it. */
const SELF_HOSTED_POINTS = [
  "All your agents, rooms and automations",
  "On the engines and API keys you already have",
  "Everything stays on this computer",
];

function FreeCard({ onActivated }: { onActivated: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Your plan" className="mb-9 overflow-hidden rounded-2xl border bg-card">
      <div className="p-6 max-sm:p-5">
        <div className="flex items-center gap-4">
          <PlanGlyph planKeyOf="free" />
          <div className="min-w-0">
            <div className="text-small font-medium text-muted-foreground">Your plan</div>
            <h2 className="text-heading font-semibold text-foreground">Self-hosted</h2>
          </div>
        </div>
        <p className="mt-3 max-w-[56ch] text-pretty text-body text-muted-foreground">
          Bloks runs right here, on your own engines and keys. Add a plan when you want your workspaces online, people in them, or Bloks AI.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3 sm:gap-3">
          {SELF_HOSTED_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2 text-pretty text-small text-foreground">
              <Check size={14} strokeWidth={2.25} className="mt-[2px] shrink-0 text-brand-ink" />
              <span className="min-w-0">{point}</span>
            </li>
          ))}
        </ul>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="key"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.2, ease: easeOut }}
              className="mt-5 border-t pt-5"
            >
              <KeyField action="Activate" hint="It's in your confirmation email." onDone={onActivated} autoFocus />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {!open && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-6 py-3 max-sm:px-5">
          <span className="text-small text-muted-foreground">Have a Bloks key from bloks.dev?</span>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Enter your key
          </Button>
        </footer>
      )}
    </section>
  );
}

/** A key typed in: activated the way Bloks Cloud always was, which puts
 * this workspace online with it (POST /api/relay/activate). */
function KeyField({ action, hint, onDone, autoFocus }: { action: string; hint: string; onDone: () => void; autoFocus?: boolean }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ws = currentWorkspace(useWorkspaces());
  const looksRight = CLOUD_KEY.test(key.trim());
  const activate = () => {
    const trimmed = key.trim();
    if (busy || !trimmed) return;
    if (!CLOUD_KEY.test(trimmed)) return setError("That's not a Bloks key. They start with blok_live_.");
    setBusy(true);
    setError(null);
    call("/api/relay/activate", { method: "POST", body: JSON.stringify({ key: trimmed }) })
      .then(() => {
        setKey("");
        onDone();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (autoFocus) document.getElementById("plan-key")?.focus();
  }, [autoFocus]);
  return (
    <div>
      <div className="flex items-start gap-2">
        <SecretField
          id="plan-key"
          label="Bloks key"
          value={key}
          onChange={(value) => {
            setKey(value);
            setError(null);
          }}
          shape={CLOUD_KEY}
          hint={`Starts with blok_live_. ${hint}`}
          placeholder="blok_live_..."
          onEnter={activate}
          className="min-w-0 flex-1"
        />
        <Button size="sm" variant="brand" className="mt-[22px] h-8" disabled={busy || !looksRight} onClick={activate}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : action}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-pretty text-small text-destructive">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-pretty text-small text-muted-foreground">{ws ? `${ws.name} goes online with it.` : "This workspace goes online with it."}</p>
      )}
    </div>
  );
}

// ── what the plan includes ─────────────────────────────────────────────

/** Whether Bloks AI is part of what this person has: the service reads a
 * balance for them, or the account says it is on. A licence without it
 * gets the offer below instead of an empty meter. */
function bloksAiShown(ai: ReturnType<typeof useBloksAi>, account: PlanSnapshot["account"]): boolean {
  const status = ai.status;
  if (!status?.offered) return false;
  if (status.connected || status.fromEnvironment) return true;
  if (account) return Boolean(account.bloksAi?.active) || status.needsKey;
  return true;
}

function WhatYouHave({ snapshot, relay, ai }: { snapshot: PlanSnapshot; relay: RelayPlan | null; ai: ReturnType<typeof useBloksAi> }) {
  const { dispatch } = useStore();
  const go = (page: string) => dispatch({ type: "toggleAppSettings", open: true, page });
  const account = snapshot.account;
  const team = snapshot.ownerPlan === "team" || account?.plan === "team";
  const spaces = relay?.spaces ?? null;
  const members = snapshot.members;
  const aiShown = bloksAiShown(ai, account);
  const hosting = hostingWords(account?.hosting ?? null);
  return (
    <SettingsGroup title="What you have">
      <SettingRow
        label="Workspaces online"
        description={
          !spaces
            ? "Put a workspace online from its Reachable online page."
            : spaces.limit === null
              ? "Every workspace can be online at once."
              : `Your plan keeps ${spaces.limit} online at once. Turning one off frees its place.`
        }
        control={
          spaces ? (
            <span className="text-ui font-medium tabular-nums text-foreground">{spaces.limit === null ? `${spaces.online} online` : `${spaces.online} of ${spaces.limit}`}</span>
          ) : (
            <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => go("workspace:online")}>
              Reachable online
              <ArrowRight size={13} />
            </Button>
          )
        }
      >
        {spaces && spaces.limit !== null && <Meter value={spaces.online} of={spaces.limit} label="Workspaces online" />}
      </SettingRow>
      {team ? (
        <SettingRow
          label="Members"
          description={members.limit > 0 ? `People besides you in this workspace. Bloks Team has room for ${members.limit}.` : "People besides you in this workspace."}
          control={<span className="text-ui font-medium tabular-nums text-foreground">{members.limit > 0 ? `${members.count} of ${members.limit}` : members.count}</span>}
        >
          {members.limit > 0 && <Meter value={members.count} of={members.limit} label="Members" />}
        </SettingRow>
      ) : (
        <SettingRow
          label="Members"
          description="People you let into a whole workspace come with Bloks Team."
          control={
            <span className="inline-flex items-center gap-1 text-small text-muted-foreground">
              <Lock size={12} aria-hidden /> Bloks Team
            </span>
          }
        />
      )}
      {account?.sharedRoom === true && account.plan === "cloud" && (
        <SettingRow label="Shared room" description="One room shared with guests of its own, kept from when Bloks Cloud included it." control={<HealthLine tone="on" label="Included" />} />
      )}
      {aiShown ? (
        <BloksAiRow ai={ai} />
      ) : (
        account?.bloksAi?.active && (
          <SettingRow
            label="Bloks AI"
            description={account.bloksAi.renewsAt ? `Renews ${shortDate(account.bloksAi.renewsAt)}.` : "Agents can run on it with no sign-in of their own."}
            control={<HealthLine tone="on" label="Active" />}
          />
        )
      )}
      {hosting && <HostingRow hosting={hosting} state={account?.hosting?.state ?? null} />}
    </SettingsGroup>
  );
}

// ── the way into a hosted workspace ────────────────────────────────────

/** How long a sleeping hosted workspace may take to wake before asking
 * again stops: most wakes are seconds, one that has to rebuild about two
 * minutes. */
const WAKE_PATIENCE_MS = 3 * 60_000;

/**
 * A pairing link to the hosted workspace, asked of bloks.dev by this
 * computer's server with the key and sealed for it alone
 * (server/plan-account.ts). A workspace that is waking up is asked again
 * every few seconds, with `onWaking` told so the row can say what is
 * happening, rather than failing on the first try.
 */
async function hostedLink(onWaking: () => void): Promise<{ link: string; expiresAt: number }> {
  const until = Date.now() + WAKE_PATIENCE_MS;
  for (;;) {
    const res = await fetch("/api/plan/hosting/link", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await res.json().catch(() => ({}));
    if (res.ok && typeof body.link === "string") return { link: body.link, expiresAt: Number(body.expiresAt) || Date.now() + 15 * 60_000 };
    if (body.waking === true && Date.now() < until) {
      onWaking();
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
}

/** Minutes and seconds left, as the pairing screens count them. */
function countdown(until: number, now: number): string {
  const left = Math.max(0, Math.round((until - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/**
 * Hosting's row: the tier, the machine's state, and once it is running,
 * the way in. "Open" pairs this computer with the hosted workspace as one
 * of your own devices and lists it beside your other workspaces; "Pair
 * your iPhone" shows the same pairing link and code the app uses
 * everywhere else, for the phone to scan. Nothing here needs a terminal
 * on the machine, which nobody has.
 */
function HostingRow({ hosting, state }: { hosting: NonNullable<ReturnType<typeof hostingWords>>; state: string | null }) {
  const workspaces = useWorkspaces();
  const listed = workspaces.available ? workspaces.workspaces.find((w) => w.kind === "hosted") : undefined;
  const canList = Boolean(window.bloks?.workspaceHosted);
  const running = state === "active" || state === "grace";
  const [busy, setBusy] = useState<"open" | "phone" | null>(null);
  const [waking, setWaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState<{ link: string; qr: string | null; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!phone) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phone]);
  useEffect(() => {
    if (phone && now >= phone.expiresAt) setPhone(null);
  }, [phone, now]);

  const work = async (what: "open" | "phone", job: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setWaking(false);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setWaking(false);
    }
  };

  const pairHere = () =>
    work("open", async () => {
      const { link } = await hostedLink(() => setWaking(true));
      const said = await window.bloks?.workspaceHosted?.({ link, open: true });
      if (said?.error) throw new Error(said.error);
    });

  const pairPhone = () =>
    work("phone", async () => {
      const { link, expiresAt } = await hostedLink(() => setWaking(true));
      // the QR always sits on white; a themed QR is an unscannable QR
      const qr = await QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 168, color: { dark: "#111111", light: "#ffffff" } }).catch(
        () => null,
      );
      setNow(Date.now());
      setPhone({ link, qr, expiresAt });
    });

  const copy = async () => {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy the link just now.");
    }
  };

  return (
    <SettingRow label={hosting.name} description={hosting.line} control={<HealthLine tone={hosting.tone} label={hosting.label} />}>
      {running && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {listed ? (
              <Button size="sm" className="gap-1.5" onClick={() => void goToWorkspace(listed.id)}>
                <Server size={14} />
                Open your hosted workspace
              </Button>
            ) : (
              canList && (
                <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => void pairHere()}>
                  {busy === "open" ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
                  Open your hosted workspace
                </Button>
              )
            )}
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={busy !== null} onClick={() => void pairPhone()}>
              {busy === "phone" ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
              Pair your iPhone
            </Button>
            {/* a pairing revoked on the machine, or a new Mac: pair this
                one again in place, keeping the workspace's place here */}
            {listed && canList && (
              <button
                type="button"
                className="text-small text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => void pairHere()}
              >
                Pair this computer again
              </button>
            )}
          </div>
          {waking && busy && (
            <p role="status" className="text-pretty text-small text-muted-foreground">
              Your hosted workspace is waking up. This takes a few seconds, sometimes a minute or two.
            </p>
          )}
          {error && (
            <p role="alert" className="text-pretty text-small text-destructive">
              {error}
            </p>
          )}
          {phone && (
            <div className="flex flex-wrap items-start gap-4 rounded-xl bg-muted/60 p-3">
              <div className="shrink-0 rounded-xl bg-white p-2 shadow-sm ring-1 ring-black/5" aria-label="Pairing QR code">
                {phone.qr ? (
                  <img src={phone.qr} alt="Scan with the Bloks app on your iPhone" className="size-[152px]" />
                ) : (
                  <div className="flex size-[152px] items-center justify-center text-caption text-neutral-500">QR unavailable</div>
                )}
              </div>
              <div className="min-w-[180px] flex-1 text-small leading-relaxed text-muted-foreground">
                <p className="text-pretty text-foreground">Scan this with your iPhone's camera, or open the link in the Bloks app.</p>
                <p className="mt-1 text-pretty">Anyone who opens it in time becomes one of your devices, so keep it to yourself.</p>
                <p className="mt-1 tabular-nums">Works once. Expires in {countdown(phone.expiresAt, now)}.</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => void copy()}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy the link"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPhone(null)}>
                    Done
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </SettingRow>
  );
}

// ── the key ────────────────────────────────────────────────────────────

function YourKey({ snapshot, onChanged }: { snapshot: PlanSnapshot; onChanged: () => void }) {
  const [replacing, setReplacing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ws = currentWorkspace(useWorkspaces());
  const canCopy = Boolean(window.bloks?.licenceCopy) && snapshot.licence.kept;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    const ok = await window.bloks?.licenceCopy?.().catch(() => false);
    if (ok) setCopied(true);
    else setError("Couldn't copy the key just now.");
  };

  const remove = async () => {
    const yes = await confirm({
      title: "Remove your key from this computer?",
      body:
        `Bloks forgets the key here, and ${ws?.name ?? "this workspace"} goes offline. Other workspaces that are online stay online until you turn them off.` +
        "\n\nYour membership is not cancelled. To cancel, use Manage billing. To use the key again, enter it here.",
      confirmLabel: "Remove key",
      destructive: true,
    });
    if (!yes) return;
    setRemoving(true);
    setError(null);
    try {
      await call("/api/plan/licence", { method: "DELETE" });
      toast("Your key is removed from this computer", { id: "plan-key" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <SettingsGroup title="Your key" footnote="Keep it to yourself: it is what bloks.dev knows you by. It never leaves this computer except to bloks.dev.">
        <SettingRow
          label="Bloks key"
          description="One key for every workspace on this computer."
          error={error}
          control={
            <>
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-small text-foreground">{snapshot.licence.masked ?? "blok_live_••••"}</code>
              {canCopy && (
                <Button size="sm" variant="secondary" className="min-w-[78px] gap-1.5" onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy your key"}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </>
          }
        />
        <SettingRow
          label="Replace key"
          description="Paste a different key to move your plan here."
          control={
            !replacing && (
              <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>
                Replace
              </Button>
            )
          }
        >
          {replacing && (
            <div className="mt-3">
              <KeyField
                action="Use this key"
                hint="The computer it was on stops reaching your phone."
                autoFocus
                onDone={() => {
                  setReplacing(false);
                  toast.success("Key replaced", { id: "plan-key" });
                  onChanged();
                }}
              />
            </div>
          )}
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Danger zone" tone="danger">
        <SettingRow
          label="Remove key from this computer"
          description="Bloks forgets it here and this workspace goes offline. Your membership stays as it is."
          control={
            <Button size="sm" variant="destructive" className="gap-1.5" disabled={removing} onClick={() => void remove()}>
              {removing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Remove
            </Button>
          }
        />
      </SettingsGroup>
    </>
  );
}

// ── where it can go next ───────────────────────────────────────────────

function OfferCard({ offer, lead }: { offer: Offer; lead: boolean }) {
  const points = offer.points.slice(0, 3);
  return (
    <article className={cn("flex min-w-0 flex-col rounded-2xl border bg-card p-5", lead && offer.onSale && "border-brand-ink/40")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lead font-semibold text-foreground">{offer.name}</h3>
        {!offer.onSale && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-small font-medium text-muted-foreground">Coming soon</span>}
      </div>
      {offer.tagline && <p className="mt-1 text-pretty text-body text-muted-foreground">{offer.tagline}</p>}
      {offer.price && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-heading font-semibold tabular-nums text-foreground">{offer.price.amount}</span>
            {offer.price.per && <span className="text-body text-muted-foreground">{/^(a|an|per|\/)\b/i.test(offer.price.per) ? offer.price.per : `/ ${offer.price.per}`}</span>}
            {offer.price.note && <span className="ml-1 rounded-full bg-brand-soft px-2 py-0.5 text-small font-medium text-brand-ink">{offer.price.note}</span>}
          </div>
          {offer.price.yearly && (
            <div className="mt-0.5 text-small tabular-nums text-muted-foreground">
              or {offer.price.yearly.amount} / {offer.price.yearly.per}
              {offer.price.yearly.note && <span className="ml-1.5 font-medium text-success">{offer.price.yearly.note}</span>}
            </div>
          )}
        </div>
      )}
      {points.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-pretty text-body text-foreground">
              <Check size={14} strokeWidth={2.25} className="mt-[3px] shrink-0 text-brand-ink" />
              <span className="min-w-0">{point}</span>
            </li>
          ))}
        </ul>
      )}
      {offer.onSale && offer.cta && (
        <div className="mt-auto pt-5">
          <Button variant={lead ? "brand" : "secondary"} className="w-full gap-1.5" onClick={() => void openOffer(offer.cta!.url)}>
            {offer.cta.label}
            <ArrowUpRight size={13} />
          </Button>
        </div>
      )}
    </article>
  );
}

function YourOptions({ snapshot }: { snapshot: PlanSnapshot }) {
  const key = planKey(snapshot, appPlanOf(useWorkspaces()));
  const ladder = ladderFor(key, snapshot.offers, snapshot.account);
  if (!snapshot.offers) {
    // the site could not be asked and nothing was kept: one quiet way there
    return (
      <SettingsGroup title={key === "free" ? "When you want more" : "Your options"}>
        <SettingRow
          label="Plans and add-ons"
          description="They come from bloks.dev, which could not be reached just now."
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void loadPlan(true)}>
                <RefreshCw size={13} />
                Try again
              </Button>
              <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => openSite(`${snapshot.site}/pricing`)}>
                See plans
                <ArrowUpRight size={13} />
              </Button>
            </div>
          }
        />
      </SettingsGroup>
    );
  }
  if (!ladder.length) return null;
  return (
    <section aria-label="Your options" className="mb-9 last:mb-0">
      <div className="mb-2.5 flex min-h-[24px] items-center justify-between gap-3 px-1">
        <h2 className="text-body font-medium text-muted-foreground">{key === "free" ? "When you want more" : "Your options"}</h2>
        {snapshot.offersState === "cached" && <span className="text-small text-muted-foreground">As of {shortDate(snapshot.offersAt ?? Date.now())}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {ladder.map((offer) => (
          <OfferCard key={offer.id} offer={offer} lead={offer.id === ladder.find((o) => o.onSale && o.cta)?.id} />
        ))}
      </div>
      <p className="mt-2.5 px-1 text-pretty text-small text-muted-foreground">
        Each opens bloks.dev in your browser{snapshot.licence.present && window.bloks ? ", with your key, so there is nothing to type" : ""}. Come back here when you are done.
      </p>
    </section>
  );
}

// ── the page ───────────────────────────────────────────────────────────

function PlanSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your plan">
      <div className="mb-9 rounded-2xl border bg-card p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-11 rounded-xl" />
          <div className="flex-1">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="mt-2.5 h-5 w-40 rounded-full" />
          </div>
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>
        <SkeletonLines lines={1} className="mt-4 max-w-[360px]" />
        <div className="mt-5 grid grid-cols-3 gap-6 border-t pt-5">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Skeleton className="h-2.5 w-16 rounded-full" />
              <Skeleton className="mt-2 h-3.5 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PlanPage() {
  const { snapshot, problem, news } = usePlan();
  const ai = useBloksAi();
  const [managing, setManaging] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const relay = useRelayPlan(snapshot?.accountAt ?? snapshot?.ownerPlan ?? null);

  useEffect(() => {
    void loadPlan();
  }, []);

  const changed = useCallback(() => {
    void loadPlan(true);
    ai.load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A portal link lasts minutes, so it is asked for only now, and opened
  // straight away. Link (which took some payments) has its own sign-in,
  // and the person is told that before they land there.
  const manage = async () => {
    setManaging(true);
    setManageError(null);
    try {
      const said = await call<{ url: string; manageAt: "portal" | "link" }>("/api/plan/manage", { method: "POST" });
      if (said.manageAt === "link") {
        const go = await confirm({
          title: "Manage billing with Link",
          body: "Link handled the payment for this plan, so billing is managed there. You'll sign in to Link with the email you paid with.",
          confirmLabel: "Open Link",
        });
        if (!go) return;
      }
      openSite(said.url);
    } catch (e) {
      setManageError(e instanceof Error ? e.message : String(e));
    } finally {
      setManaging(false);
    }
  };

  if (!snapshot) {
    if (problem) {
      return (
        <SettingsGroup>
          <SettingsEmpty
            icon={<Lock size={18} />}
            title="Your plan isn't here"
            body={problem}
            action={
              <Button size="sm" variant="secondary" onClick={() => void loadPlan(true)}>
                Try again
              </Button>
            }
          />
        </SettingsGroup>
      );
    }
    return <PlanSkeleton />;
  }

  const free = !snapshot.licence.present;
  return (
    <>
      <AnimatePresence>{news?.up && <PlanMoment key={news.at} words={news.words} at={news.at} />}</AnimatePresence>
      {free ? <FreeCard onActivated={changed} /> : <PlanCard snapshot={snapshot} onManage={() => void manage()} managing={managing} manageError={manageError} />}
      {/* what everyone you let in sees you as, beside the account it is on */}
      <SettingsGroup title="You">
        <YourName />
      </SettingsGroup>
      {!free && <WhatYouHave snapshot={snapshot} relay={relay} ai={ai} />}
      <YourOptions snapshot={snapshot} />
      {!free && bloksAiShown(ai, snapshot.account) && <BloksAiSettings ai={ai} />}
      {!free && <YourKey snapshot={snapshot} onChanged={changed} />}
    </>
  );
}
