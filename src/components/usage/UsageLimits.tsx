// The Usage page's Limits: what each thing an agent runs on has left.
//
// Three kinds, each in its own words. A Claude or ChatGPT plan's windows,
// as the engine last said them (server/plan-usage.ts). Bloks AI's month
// and day, as shares of the allowance and never as an amount, with the
// way to top it up. And a spending limit the person sets on an engine
// that runs on a key of their own (server/spend-limits.ts), the one
// limit here that is theirs to move, so it is edited in place.
import { useEffect, useState } from "react";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ProviderMark } from "@/components/ProviderIcons";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { planName, planRows, type PlanUsage } from "@/lib/contextCard";
import { TOP_UP_WORDS, percentText, renewsLine, type BloksAiStatus } from "@/lib/credits";
import { resetLine } from "@/lib/usageNotice";
import { money, topsUpLine, type SpendLimitRow } from "@/lib/usagePage";

/** A share as a bar. Warning colour near the end, where it matters. */
function Bar({ fill, tone = "brand", label }: { fill: number; tone?: "brand" | "warning" | "destructive"; label: string }) {
  const share = Math.max(0, Math.min(1, fill));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          "h-full origin-left rounded-full",
          tone === "destructive" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-brand-ink",
        )}
        style={{ transform: `scaleX(${share})` }}
      />
    </div>
  );
}

/** One line of a limit: what it is, the bar, and the words under it. */
function LimitLine({ label, fill, tone, used, note }: { label: string; fill: number; tone?: "brand" | "warning" | "destructive"; used: string; note?: string | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5">
      <span className="truncate text-body text-foreground">{label}</span>
      <span className="text-small tabular-nums text-muted-foreground">{used}</span>
      <div className="col-span-2">
        <Bar fill={fill} tone={tone} label={label} />
      </div>
      {note && <span className="col-span-2 text-small tabular-nums text-muted-foreground">{note}</span>}
    </div>
  );
}

/** A card per thing, its mark and name across the top. */
function LimitCard({
  driverKind,
  title,
  aside,
  badge,
  children,
}: {
  driverKind: string;
  title: string;
  aside?: React.ReactNode;
  badge?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5 rounded-xl border bg-card p-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
          <ProviderMark driverKind={driverKind} size={15} />
        </span>
        <span className="min-w-0 truncate text-ui font-medium text-foreground">{title}</span>
        {badge && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">{badge}</span>}
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </div>
  );
}

function Group({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-ui font-medium text-foreground">{title}</h3>
        <p className="mt-0.5 text-pretty text-small text-muted-foreground">{note}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

// ── plans ──────────────────────────────────────────────────────────────

function PlanCards({ badgeFor }: { badgeFor: (instanceId: string) => string | null }) {
  const { state } = useStore();
  const [plans, setPlans] = useState<Record<string, PlanUsage> | null>(null);
  useEffect(() => {
    let current = true;
    api("/api/plan-usage")
      .then((body) => current && setPlans(body?.usage ?? {}))
      .catch(() => current && setPlans({}));
    return () => {
      current = false;
    };
  }, []);
  const engines = state.instances.filter((i) => i.driverKind === "claudeAgent" || i.driverKind === "codex");
  if (!engines.length) return null;
  const now = Date.now();
  return (
    <Group title="Plans" note="What a Claude or ChatGPT plan has left, as the engine said on its last turn.">
      {engines.map((engine) => {
        const plan = plans?.[engine.instanceId] ?? null;
        const rows = planRows(plan, now);
        const name = planName(plan?.plan);
        return (
          <LimitCard
            key={engine.instanceId}
            driverKind={engine.driverKind}
            title={name ? `${engine.displayName} ${name}` : engine.displayName}
            badge={badgeFor(engine.instanceId)}
          >
            {rows.length ? (
              rows.map((row) => (
                <LimitLine
                  key={row.id}
                  label={row.label}
                  fill={row.fill}
                  tone={row.note === "Limit reached" ? "destructive" : row.near || row.fill >= 0.8 ? "warning" : "brand"}
                  used={row.used}
                  note={[row.note, row.reset].filter(Boolean).join(" · ")}
                />
              ))
            ) : (
              <p className="text-pretty text-small text-muted-foreground">
                {plans === null ? "Reading..." : `Nothing heard yet. ${engine.displayName} says what its plan has left as it answers.`}
              </p>
            )}
          </LimitCard>
        );
      })}
    </Group>
  );
}

// ── Bloks AI ───────────────────────────────────────────────────────────

function BloksAiCard({ badge }: { badge: string | null }) {
  const [status, setStatus] = useState<BloksAiStatus | null>(null);
  useEffect(() => {
    let current = true;
    api("/api/credits")
      .then((body: BloksAiStatus) => current && setStatus(body))
      .catch(() => current && setStatus(null));
    return () => {
      current = false;
    };
  }, []);
  if (!status?.offered || status.needsKey) return null;
  const now = Date.now();
  const used = status.usedPercent ?? (status.monthlyLeftPercent !== null ? 100 - status.monthlyLeftPercent : null);
  const today = status.usedTodayPercent ?? null;
  const daily = status.dailyLimitPercent ?? null;
  const renews = renewsLine(status.renewsAt);
  return (
    <Group title="Bloks AI" note="Your Bloks AI allowance, as shares of the month and of a day.">
      <LimitCard
        driverKind="bloks"
        title="Bloks AI"
        badge={badge}
        aside={
          <a
            href={status.checkoutUrl}
            target="_blank"
            rel="noreferrer"
            title={TOP_UP_WORDS}
            className="inline-flex h-7 shrink-0 items-center rounded-md border px-2.5 text-body font-medium text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97]"
          >
            Top up
          </a>
        }
      >
        {status.connected && used !== null ? (
          <>
            <LimitLine
              label="This month"
              fill={used / 100}
              tone={status.low || used >= 100 ? "warning" : "brand"}
              used={`${percentText(used)} used`}
              note={renews ? renews[0].toUpperCase() + renews.slice(1) : null}
            />
            {today !== null && daily !== null && (
              <LimitLine
                label="Today"
                fill={today / daily}
                tone={today >= daily ? "destructive" : today / daily >= 0.8 ? "warning" : "brand"}
                used={`${percentText((today / daily) * 100)} of today's limit`}
                note={resetLine(status.dailyResetsAt ?? null, now)}
              />
            )}
          </>
        ) : (
          <p className="text-small text-muted-foreground">{status.problem ?? "What is left could not be read just now."}</p>
        )}
        <p className="text-caption text-muted-foreground">{TOP_UP_WORDS}</p>
      </LimitCard>
    </Group>
  );
}

// ── spending limits on the person's own keys ───────────────────────────

function SpendCard({ row, badge, onSaved }: { row: SpendLimitRow; badge: string | null; onSaved: (rows: SpendLimitRow[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (usd: number | string | null) => {
    setBusy(true);
    setError(null);
    api(`/api/spend-limits/${encodeURIComponent(row.instanceId)}`, { method: "PUT", body: JSON.stringify({ usd }) })
      .then((body: { limits: SpendLimitRow[] }) => {
        onSaved(body.limits);
        setEditing(false);
        toast.success(usd === null ? `Limit removed from ${row.name}` : `Limit saved for ${row.name}`);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const open = () => {
    setText(row.limit === null ? "" : String(row.limit));
    setError(null);
    setEditing(true);
  };

  const tone = row.reached ? "destructive" : row.level === "warn" ? "warning" : "brand";
  return (
    <LimitCard
      driverKind={row.driverKind}
      title={row.name}
      badge={badge}
      aside={
        !editing && (
          <Button size="sm" variant={row.reached ? "default" : "outline"} onClick={open} className="h-7">
            {row.limit === null ? "Set limit" : row.reached ? "Raise limit" : "Edit"}
          </Button>
        )
      }
    >
      {row.limit !== null ? (
        <LimitLine
          label="This month"
          fill={row.spent / row.limit}
          tone={tone}
          used={`${money(row.spent)} of ${money(row.limit)}`}
          note={`${row.usedPercent ?? 0}% used · ${topsUpLine(row.resetsAt)}`}
        />
      ) : (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-body text-foreground">This month</span>
          <span className="text-small tabular-nums text-muted-foreground">{row.priced ? money(row.spent) : "Nothing priced yet"}</span>
        </div>
      )}
      {row.reached && !editing && (
        <p className="text-pretty text-small text-destructive">New turns on {row.name} are paused until you raise the limit or the month turns.</p>
      )}
      {!row.reportsPrice && (
        <p className="text-pretty text-small text-muted-foreground">
          {row.name} has not reported a price here yet. A limit counts only what the provider prices, so it has nothing to count until it does.
        </p>
      )}
      {row.limit === null && row.reportsPrice && !editing && (
        <p className="text-small text-muted-foreground">No limit. It runs until the provider stops it.</p>
      )}
      {editing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) save(text);
          }}
        >
          <label htmlFor={`limit-${row.instanceId}`} className="text-small text-muted-foreground">
            Monthly limit in US dollars
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-32">
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui text-muted-foreground">
                $
              </span>
              <Input
                id={`limit-${row.instanceId}`}
                autoFocus
                inputMode="decimal"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="20"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `limit-error-${row.instanceId}` : undefined}
                className="h-8 pl-6 tabular-nums"
              />
            </div>
            <Button type="submit" size="sm" className="h-8" disabled={busy || !text.trim()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {row.limit !== null && (
              <Button type="button" size="sm" variant="ghost" className="ml-auto h-8 hover:text-destructive" disabled={busy} onClick={() => save(null)}>
                Remove limit
              </Button>
            )}
          </div>
          {error && (
            <p id={`limit-error-${row.instanceId}`} className="text-small text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </LimitCard>
  );
}

function SpendCards({ badgeFor }: { badgeFor: (instanceId: string) => string | null }) {
  const { dispatch } = useStore();
  const [rows, setRows] = useState<SpendLimitRow[] | null>(null);
  useEffect(() => {
    let current = true;
    api("/api/spend-limits")
      .then((body: { limits: SpendLimitRow[] }) => current && setRows(body.limits))
      // an older server has no limits to set
      .catch(() => current && setRows([]));
    return () => {
      current = false;
    };
  }, []);
  if (rows === null) return null;
  return (
    <Group
      title="Spending limits"
      note="A monthly limit on an engine that runs on your own API key. At the limit, new turns on it pause until you raise it or the month turns. A turn already running finishes."
    >
      {rows.length ? (
        rows.map((row) => <SpendCard key={row.instanceId} row={row} badge={badgeFor(row.instanceId)} onSaved={setRows} />)
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-4 md:col-span-2">
          <p className="text-pretty text-small text-muted-foreground">
            No engine here runs on a key of your own. Connect one with an API key to give it a monthly limit.
          </p>
          <Button size="sm" variant="outline" onClick={() => dispatch({ type: "toggleAppSettings", open: true, page: "engines" })}>
            Open engines
          </Button>
        </div>
      )}
    </Group>
  );
}

/**
 * Every limit, in three groups. `focus` is the agent the page is about,
 * when it is about one: the cards for the engine that agent runs on say
 * so, since that is the limit a person following a notice came to see.
 */
export function UsageLimits({ focusBot }: { focusBot: string | null }) {
  const { state } = useStore();
  const bot = focusBot ? state.bots.find((b) => b.id === focusBot) : undefined;
  const runsOn = bot?.modelSelection.instanceId ?? null;
  const onCredits = bot && (runsOn === "bloks" || bot.engineAccess === "credits");
  const badgeFor = (instanceId: string) => (bot && !onCredits && runsOn === instanceId ? `${bot.name}'s engine` : null);
  return (
    <div className="flex flex-col gap-8">
      <PlanCards badgeFor={badgeFor} />
      <BloksAiCard badge={bot && onCredits ? `${bot.name}'s engine` : null} />
      <SpendCards badgeFor={badgeFor} />
    </div>
  );
}
