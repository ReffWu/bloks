// Watchers (server/watchers.ts): a folder, a page, a feed, a check or a
// place, and what an agent should do when it changes.
//
// A check runs a command unattended, so one an agent filed shows the
// command and waits for an Approve here before it ever runs.
//
// The list on the left, the one you are looking at on the right: what is
// watched, what the agent is told, how often it looks, and the last few
// times it fired. A new one is a kind, an address, who acts and what they
// do, and how often to look, read back as one plain sentence before it is
// filed.
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Eye } from "@/components/icons";
import { FlaskConical } from "@/components/icons";
import { Folder } from "@/components/icons";
import { Globe } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { MapPin } from "@/components/icons";
import { Rss } from "@/components/icons";
import { ShieldCheck } from "@/components/icons";
import { SquareTerminal } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider, type SliderStop } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { intervalLabel, intervalPhrase } from "@/lib/checkIns";
import { AUTOMATIONS_LIST, AUTOMATIONS_LIST_SIZE, useColumnFolded } from "@/lib/sideColumn";
import { ShowColumn, SideColumn } from "./SideColumn";

type Kind = "folder" | "page" | "feed" | "check" | "place";

interface WatcherRow {
  id: string;
  botId: string;
  name: string;
  kind: Kind;
  target: string;
  instruction: string;
  mentions?: string;
  mode: "act" | "rehearse";
  every: number;
  enabled: boolean;
  lastCheck?: number;
  lastError?: string;
  laneId?: string;
  /** the conversation its turns go to, by title; absent is a lane of its own */
  thread?: string;
  fires: Array<{ at: number; summary: string }>;
  approvedBy?: "person" | "mode";
  /** On, but its agent is archived, so it does not look until restored. */
  suspended?: "archived";
  /** Looks that failed in a row. */
  failures?: number;
  /** Stopped looking on its own after failing again and again. Any
   * change, or a look by hand that works, starts it again. */
  failing?: { at: number; error: string };
  /** Places: arriving or leaving, how near a point counts, act once, and
   * when to stop. */
  when?: "arrive" | "leave";
  radius?: number;
  once?: boolean;
  until?: number;
  /** Finished on its own: acted once, or its time ran out. */
  done?: { at: number; why: "once" | "until" };
}

const KIND: Record<
  Kind,
  { icon: typeof Folder; label: string; example: string; field: string; placeholder: string; instruction: string }
> = {
  folder: {
    icon: Folder,
    label: "Folder",
    example: "New files land in it",
    field: "Which folder",
    placeholder: "/Users/you/Invoices",
    instruction: "When a new invoice arrives, rename it by date and vendor and add it to the expenses sheet.",
  },
  page: {
    icon: Globe,
    label: "Page",
    example: "A price or a page changes",
    field: "Which page",
    placeholder: "https://example.com/pricing",
    instruction: "If the price drops below $400, tell me.",
  },
  feed: {
    icon: Rss,
    label: "Feed",
    example: "A blog posts something new",
    field: "Which feed",
    placeholder: "https://example.com/blog/rss.xml",
    instruction: "Summarise each new post in two lines and tell me if it mentions us.",
  },
  check: {
    icon: SquareTerminal,
    label: "Check",
    example: "A script says it is time",
    field: "Command to run",
    placeholder: "python3 scripts/supplier_replied.py",
    instruction: "A supplier replied: read it and decide the next step.",
  },
  place: {
    icon: MapPin,
    label: "Place",
    example: "You arrive or leave",
    field: "Which place",
    placeholder: "Toronto, or 43.6777,-79.6248",
    instruction: "When I land, send me the hotel address and the check-in time.",
  },
};

/** How often a page, a feed or a check is looked at: the steps the
 * server's bounds allow (server/watchers.ts, 5 minutes to a day). */
const LOOK_EVERY = [5, 15, 30, 60, 180, 720, 1440];

/** The stops for a watcher already looking at `every`, which an agent may
 * have filed off the usual steps; it gets a stop of its own rather than
 * the slider pretending it is at the first one. */
function lookStops(every: number): SliderStop<number>[] {
  const values = LOOK_EVERY.includes(every) ? LOOK_EVERY : [...LOOK_EVERY, every].sort((a, b) => a - b);
  return values.map((m) => ({ value: m, label: intervalLabel(m) }));
}

/** What is being watched, in as few words as a sentence can carry: a
 * folder's last name, a page without its scheme. */
function shortTarget(kind: Kind, target: string): string {
  const t = target.trim();
  if (!t) return "";
  if (kind === "folder") return t.split(/[\\/]/).filter(Boolean).pop() ?? t;
  if (kind === "check" || kind === "place") return t.length > 40 ? `${t.slice(0, 39)}…` : t;
  const bare = t.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return bare.length > 40 ? `${bare.slice(0, 39)}…` : bare;
}

/** Whether a check may run now: approved here, or filed by an agent that
 * still runs commands without asking. Mirrors checkAllowed on the server. */
const mayRun = (w: WatcherRow, approvals?: string) =>
  w.kind !== "check" || w.approvedBy === "person" || (w.approvedBy === "mode" && (approvals === "auto" || approvals === "full"));

const ago = (at?: number) => {
  if (!at) return "never";
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(at).toLocaleDateString();
};

function Draft({ onMade }: { onMade: (id: string) => void }) {
  const { state } = useStore();
  const bots = state.bots.filter((b) => !b.hidden && !b.archivedAt);
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("page");
  const [when, setWhen] = useState<"arrive" | "leave">("arrive");
  const [target, setTarget] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async () => {
    const path = await window.bloks?.pickFolder?.();
    if (path) setTarget(path);
  };
  const [every, setEvery] = useState(30);
  const bot = bots.find((b) => b.id === botId);
  const ready = Boolean(botId && target.trim() && instruction.trim());
  const make = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    // a folder is watched as it changes, so how often means nothing to it
    const body = { botId, kind, target, instruction, ...(kind === "folder" || kind === "place" ? {} : { every }), ...(kind === "place" ? { when } : {}) };
    api("/api/watchers", { method: "POST", body: JSON.stringify(body) })
      .then((r) => onMade(r.watcher.id))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  // the watcher read back as one plain sentence, as it is filled in
  const who = bot?.name ?? "The agent";
  const what = shortTarget(kind, target);
  const often = intervalPhrase(every);
  const readback =
    kind === "folder"
      ? `${who} will watch ${what || "the folder"} and act within seconds of a change.`
      : kind === "page"
        ? `${who} will look at ${what || "the page"} ${often} and act when it changes.`
        : kind === "feed"
          ? `${who} will read ${what || "the feed"} ${often} and act on each new post.`
          : kind === "place"
            ? `${who} will act when your iPhone says you ${when === "leave" ? "left" : "arrived in"} ${what || "the place"}.`
            : `${who} will run ${what ? `“${what}”` : "the command"} ${often} and act when it exits 0.`;

  return (
    <div
      className="mx-auto flex w-full max-w-[640px] flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          make();
        }
      }}
    >
      <h2 className="text-heading font-semibold text-foreground">New watcher</h2>
      <p className="mt-1 text-body text-muted-foreground">An agent keeps an eye on something and acts when it changes.</p>

      <div role="radiogroup" aria-label="What to watch" className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(Object.keys(KIND) as Kind[]).map((k, i) => {
          const Icon = KIND[k].icon;
          const on = kind === k;
          return (
            <motion.button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              onClick={() => setKind(k)}
              className={cn(
                "flex min-w-0 flex-col items-start gap-2 rounded-xl border p-3 text-left outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.985]",
                on ? "border-brand bg-brand-soft" : "bg-card hover:border-foreground/20 hover:bg-accent/40",
              )}
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg transition-colors duration-150",
                  on ? "bg-brand-ink text-brand-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-body font-medium text-foreground">{KIND[k].label}</span>
                <span className="block text-small leading-snug text-muted-foreground">{KIND[k].example}</span>
              </span>
            </motion.button>
          );
        })}
      </div>

      <label className="mt-6 mb-2 text-body font-medium text-foreground" htmlFor="watch-target">
        {KIND[kind].field}
      </label>
      <div className="flex gap-2">
        <Input
          id="watch-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={KIND[kind].placeholder}
          spellCheck={false}
          className="rounded-xl font-mono text-body"
        />
        {kind === "folder" && window.bloks?.pickFolder && (
          <Button variant="secondary" onClick={pick} className="h-9 rounded-xl">
            Choose
          </Button>
        )}
      </div>
      {/* a check runs a command with nobody watching; say so where the
          command is written, not after it is filed */}
      <AnimatePresence initial={false}>
        {kind === "check" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="mt-2 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-small leading-relaxed text-foreground"
          >
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-warning" />
            <span>
              A check is a command, and it runs on its own {often} without asking. Exit 0 means act on its output,
              exit 1 means nothing to do.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 mb-2 text-body font-medium text-foreground">Who acts on it</div>
      <div role="radiogroup" aria-label="Who acts on it" className="flex flex-wrap gap-1.5">
        {bots.map((b) => {
          const on = b.id === botId;
          return (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setBotId(b.id)}
              className={cn(
                "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-body outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.97]",
                on ? "border-brand bg-brand-soft font-medium text-foreground" : "bg-card text-foreground/90 hover:border-foreground/20",
              )}
            >
              <AgentAvatar bot={b} size={22} />
              {b.name}
            </button>
          );
        })}
        {bots.length === 0 && <span className="text-body text-muted-foreground">No agents yet. Make one first.</span>}
      </div>

      <label className="mt-6 mb-2 text-body font-medium text-foreground" htmlFor="watch-instruction">
        What {bot?.name ?? "the agent"} does when it changes
      </label>
      <Textarea
        id="watch-instruction"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={KIND[kind].instruction}
        className="min-h-[90px] rounded-xl text-body"
      />

      {kind === "place" ? (
        <>
          <div className="mt-6 mb-2 text-body font-medium text-foreground">When</div>
          <div role="radiogroup" aria-label="When" className="flex flex-wrap gap-1.5">
            {(["arrive", "leave"] as const).map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={when === w}
                onClick={() => setWhen(w)}
                className={cn(
                  "rounded-full border px-3 py-1 text-body outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.97]",
                  when === w ? "border-brand bg-brand-soft font-medium text-foreground" : "bg-card text-foreground/90 hover:border-foreground/20",
                )}
              >
                {w === "arrive" ? "When I arrive" : "When I leave"}
              </button>
            ))}
          </div>
          <div className="mt-2 text-small leading-relaxed text-muted-foreground">
            A place as your iPhone names it (a city or a neighbourhood), or latitude,longitude for a spot. It acts when your iPhone next says where
            you are, so Location has to be on in the Bloks app there, and a spot needs Exact position.
          </div>
        </>
      ) : (
        <>
          <div className="mt-6 mb-2 text-body font-medium text-foreground">How often it looks</div>
          {kind === "folder" ? (
            <div className="text-body text-muted-foreground">As it changes. Folders are watched within seconds.</div>
          ) : (
            <Slider aria-label="How often it looks" stops={lookStops(every)} value={every} onChange={setEvery} onCommit={setEvery} />
          )}
        </>
      )}

      <div className="mt-6 flex items-start gap-3 rounded-xl bg-muted/60 px-3.5 py-3">
        {bot ? <AgentAvatar bot={bot} size={26} /> : <Eye size={16} className="mt-1 text-muted-foreground" />}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            // a new kind, agent or pace swaps the sentence; typing the
            // address only rewrites it, so it never flickers per key
            key={`${kind}-${every}-${botId}-${when}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="min-w-0 flex-1 text-pretty break-words text-body leading-relaxed text-foreground"
          >
            {readback}
          </motion.p>
        </AnimatePresence>
      </div>

      {error && <div className="mt-3 text-body text-destructive">{error}</div>}
      <div className="mt-5 flex items-center gap-3">
        <Button size="lg" disabled={busy || !ready} onClick={make}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
          {busy ? "Starting" : "Start watching"}
        </Button>
        {!ready && (
          <span className="text-small text-muted-foreground">
            {!target.trim()
              ? kind === "check"
                ? "Add the command."
                : `Add the ${KIND[kind].label.toLowerCase()}.`
              : !instruction.trim()
                ? "Say what to do when it changes."
                : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function Detail({ w, onChanged }: { w: WatcherRow; onChanged: () => void }) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((b) => b.id === w.botId);
  const [instruction, setInstruction] = useState(w.instruction);
  const [thread, setThread] = useState(w.thread ?? "");
  useEffect(() => setThread(w.thread ?? ""), [w.id, w.thread]);
  // where its turns land: the named conversation, by id or title, or the
  // agent's first
  const laneId = w.thread ? bot?.tasks?.find((t) => t.id === w.thread || t.title === w.thread)?.id : bot?.tasks?.[0]?.id;
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setInstruction(w.instruction), [w.id, w.instruction]);
  const patch = (body: Partial<WatcherRow> & { approved?: boolean }) =>
    api(`/api/watchers/${w.id}`, { method: "PATCH", body: JSON.stringify(body) }).then(onChanged).catch((e: Error) => setNote(e.message));
  const check = () => {
    setChecking(true);
    setNote(null);
    api(`/api/watchers/${w.id}/check`, { method: "POST" })
      .then((r) => setNote(r.note || "Checked"))
      .catch((e: Error) => setNote(e.message))
      .finally(() => setChecking(false));
  };
  const Icon = (KIND[w.kind] ?? KIND.page).icon;
  const waiting = !mayRun(w, bot?.approvals);
  return (
    <div className="flex flex-col gap-4">
      {w.kind === "check" && waiting && (
        <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-body text-foreground">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck size={14} className="text-warning" /> {bot?.name ?? "An agent"} wants to run this command on its own
          </div>
          <code className="block break-all rounded-lg bg-background px-2.5 py-1.5 font-mono text-small">{w.target}</code>
          <div className="text-muted-foreground">
            Runs every {w.every < 60 ? `${w.every} minutes` : `${Math.round(w.every / 60)} hours`} without asking, once you approve it.
          </div>
          <div>
            <Button size="sm" onClick={() => patch({ approved: true })}>
              Approve
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lead font-semibold text-foreground">
            <Icon size={15} className="text-muted-foreground" /> {w.name}
          </div>
          <div className="mt-0.5 break-all font-mono text-small text-muted-foreground">{w.target}</div>
          {w.kind === "check" && !waiting && (
            <div className="mt-1 flex items-center gap-1.5 text-small text-muted-foreground">
              <ShieldCheck size={12} />
              {w.approvedBy === "person" ? "You approved this command." : `${bot?.name ?? "Its agent"} can run commands without asking.`}
              {w.approvedBy === "person" && (
                <button className="underline underline-offset-2" onClick={() => patch({ approved: false })}>
                  Withdraw
                </button>
              )}
            </div>
          )}
        </div>
        <Switch checked={w.enabled} onCheckedChange={(on) => patch({ enabled: on })} aria-label="Watching" />
      </div>
      <label className="flex flex-col gap-1.5 text-body text-muted-foreground">
        What {bot?.name ?? "the agent"} does when it changes
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onBlur={() => instruction.trim() && instruction !== w.instruction && patch({ instruction })}
          className="min-h-[80px] text-body text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-body text-muted-foreground">
        Which chat it replies in
        <Input
          value={thread}
          onChange={(e) => setThread(e.target.value)}
          onBlur={() => thread.trim() !== (w.thread ?? "") && patch({ thread: thread.trim() })}
          placeholder="General"
          className="text-body text-foreground"
        />
        <span className="text-small">
          Leave blank for the main chat. A new name starts a new one.
        </span>
      </label>
      {/* every kind can be asked to act once or stop at a time, so every
          kind says so, and says when it is done */}
      {(w.kind === "place" || w.once || w.until || w.done) && (
        <div className="flex flex-col gap-1 text-body text-muted-foreground">
          {w.kind === "place" ? (
            <span>
              {w.when === "leave" ? "When you leave" : "When you arrive"}
              {w.radius ? `, within ${w.radius >= 1000 ? `${Math.round(w.radius / 100) / 10} km` : `${w.radius} m`}` : ""}
              {w.once ? ", once" : ""}
              {w.until ? `, until ${new Date(w.until).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}.
            </span>
          ) : (
            w.once || w.until ? (
              <span>
                {w.once ? "Acts once" : "Acts on every change"}
                {w.until ? `, until ${new Date(w.until).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}.
              </span>
            ) : null
          )}
          {w.done && (
            <span className="text-foreground">
              Done {ago(w.done.at)}: {w.done.why === "once" ? "it acted once, as asked." : "its time ran out."} Switch it on to watch again.
            </span>
          )}
        </div>
      )}
      {w.kind !== "folder" && w.kind !== "place" && (
        <div className="max-w-[460px]">
          <div className="mb-1.5 text-body text-muted-foreground">How often it looks</div>
          {/* saved where the finger lets go, not at every stop on the way */}
          <Slider aria-label="How often it looks" stops={lookStops(w.every)} value={w.every} onCommit={(every) => patch({ every })} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-body text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <Switch checked={w.mode === "rehearse"} onCheckedChange={(on) => patch({ mode: on ? "rehearse" : "act" })} aria-label="Rehearse first" />
          <FlaskConical size={13} /> Try it on a copy first
        </label>
        <span>Last checked {ago(w.lastCheck)}</span>
      </div>
      {w.enabled && w.suspended === "archived" && (
        <div className="rounded-lg bg-muted px-3 py-2 text-body text-muted-foreground">
          Paused while {bot?.name ?? "its agent"} is archived. Resumes when restored.
        </div>
      )}
      {/* Stopped for failing: said apart from the last error, since it is
          the reason nothing happens on its own any more. Changing it here
          starts it again, and so does Check now when the look works. */}
      {w.failing && (
        <div className="flex flex-col gap-2 rounded-xl border bg-card px-3.5 py-3 text-body">
          <div className="font-medium text-warning">Stopped after failing {w.failures ?? 3} times in a row</div>
          <div className="text-muted-foreground">
            It does not look on its own until you change it, or a look by hand works. The last time: {w.failing.error}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" size="sm" disabled={checking} onClick={check}>
              Look again now
            </Button>
            <Button variant="ghost" size="sm" onClick={() => patch({ enabled: false })}>
              Pause
            </Button>
          </div>
        </div>
      )}
      {w.lastError && !w.failing && <div className="rounded-lg bg-warning/10 px-3 py-2 text-body text-warning">{w.lastError}</div>}
      <div>
        <div className="mb-1.5 text-small font-medium text-muted-foreground">Triggered</div>
        {w.fires.length === 0 ? (
          <div className="text-body text-muted-foreground">
            Not yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {w.fires.map((f) => (
              <li key={f.at} className="flex gap-3 text-body">
                <span className="w-[86px] shrink-0 text-muted-foreground">{ago(f.at)}</span>
                <span className="min-w-0 truncate text-foreground">{f.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={checking} onClick={check}>
          {checking ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Check now
        </Button>
        {laneId && bot && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              dispatch({ type: "select", id: bot.id, lane: laneId });
            }}
          >
            Open chat
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={() => api(`/api/watchers/${w.id}`, { method: "DELETE" }).then(onChanged).catch(() => {})}
        >
          <Trash2 size={13} /> Stop watching
        </Button>
      </div>
      {note && <div className="text-body text-muted-foreground">{note}</div>}
    </div>
  );
}

export function WatchersTab() {
  const { state } = useStore();
  const [rows, setRows] = useState<WatcherRow[] | null>(null);
  // a card about a watcher that stopped for failing opens it here
  const [selected, setSelected] = useState<string | "new" | null>(() => (state.routinesFocus?.kind === "watcher" ? state.routinesFocus.id : null));
  const load = useCallback(() => {
    api("/api/watchers")
      .then((r) => setRows(r.watchers ?? []))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load, state.ticks.watchers]);
  const current = rows?.find((w) => w.id === selected) ?? null;
  const showing = selected === "new" || (!current && rows?.length === 0) ? "new" : (current ?? rows?.[0] ?? null);
  const folded = useColumnFolded(AUTOMATIONS_LIST, AUTOMATIONS_LIST_SIZE);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <SideColumn id={AUTOMATIONS_LIST} size={AUTOMATIONS_LIST_SIZE} label="Watchers" className="max-h-[200px] w-full border-b md:max-h-none md:border-b-0">
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="text-small font-medium text-muted-foreground">Watching</span>
          <button onClick={() => setSelected("new")} className="rounded-lg px-1.5 py-1 text-small text-muted-foreground hover:bg-accent hover:text-foreground">
            + New
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {(rows ?? []).map((w) => {
            const bot = state.bots.find((b) => b.id === w.botId);
            const Icon = (KIND[w.kind] ?? KIND.page).icon;
            const waiting = !mayRun(w, bot?.approvals);
            const active = showing !== "new" && showing?.id === w.id;
            return (
              <button
                key={w.id}
                onClick={() => setSelected(w.id)}
                className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors", active ? "bg-accent" : "hover:bg-accent/60")}
              >
                {bot ? <AgentAvatar bot={bot} size={26} /> : <Icon size={16} />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-body font-medium text-foreground">
                    <Icon size={12} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{w.name}</span>
                  </span>
                  <span className={cn("block truncate text-caption", waiting || w.lastError || w.failing ? "text-warning" : w.enabled ? "text-muted-foreground" : "text-muted-foreground/70")}>
                    {w.done ? "Done" : !w.enabled ? "Paused" : w.suspended === "archived" ? "Paused while archived" : w.failing ? "Stopped for failing" : waiting ? "Needs your approval" : w.lastError ? "Needs a look" : w.fires[0] ? `Triggered ${ago(w.fires[0].at)}` : `Checked ${ago(w.lastCheck)}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SideColumn>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* the list folded away: the way back to it, named for what it lists */}
        {folded && <ShowColumn id={AUTOMATIONS_LIST} text="Watching" label="Show the list" className="-ml-2 -mt-2 mb-3" />}
        {rows === null ? null : showing === "new" ? (
          <Draft
            onMade={(id) => {
              setSelected(id);
              load();
            }}
          />
        ) : showing ? (
          <Detail key={showing.id} w={showing} onChanged={load} />
        ) : null}
      </div>
    </div>
  );
}
