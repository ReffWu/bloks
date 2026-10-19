// Memory: what your agents keep between conversations, as a place of its
// own off the main rail. A sidebar of its own lists the shared memory,
// what agents know about you, and every agent; the page beside it is the
// one picked, laid out to read and to correct.
//
// An agent's memory is plain Markdown in its workspace: MEMORY.md, loaded
// into every turn up to a budget, and topic files it reads when a topic
// comes up (server/workspace.ts). The shared memory is one more MEMORY.md
// the person keeps and every agent reads. Agents write theirs on their
// own, so every change lands in a journal with its diff
// (server/memory-journal.ts), and the page follows it live from the
// stream's memory.changed rather than asking every few seconds.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "@/components/icons";
import { Brain } from "@/components/icons";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { Copy } from "@/components/icons";
import { FileText } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Search } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { Undo2 } from "@/components/icons";
import { UserRound } from "@/components/icons";
import { Users } from "@/components/icons";
import { X } from "@/components/icons";
import { api, useStore, type Bot } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { AboutText, KeptNotes, Suggestion, useProfileNotes } from "./AboutYou";
import { DiffLines, type DiffLine } from "./DiffLines";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/plural";

// ── what the server answers ────────────────────────────────────────────

interface Topic {
  name: string;
  bytes: number;
  lines: number;
  changedAt: number;
}

interface Stats {
  lines: number;
  bytes: number;
  maxLines: number;
  maxBytes: number;
  truncated: boolean;
  topics: Topic[];
  lastChangedAt: number | null;
}

interface Entry {
  id: string;
  at: number;
  file: string;
  by: "agent" | "you" | "undo";
  undoes?: string;
  undoneBy?: string;
  big?: boolean;
  added: number;
  removed: number;
  lines: DiffLine[] | null;
  created: boolean;
  deleted: boolean;
}

interface Hit {
  /** An agent's id, or "shared". */
  botId: string;
  file: string;
  text: string;
  at: number;
}

/** Whose memory a piece of the page shows. */
type Owner = { kind: "agent"; bot: Bot } | { kind: "shared" };

/** A file a link or a search result asked the page to open. */
type Focus = { file: string; nonce: number } | null;

const baseOf = (owner: Owner) => (owner.kind === "shared" ? "/api/memory/shared" : `/api/bots/${owner.bot.id}/memory`);
const tickOf = (owner: Owner) => (owner.kind === "shared" ? "memory:_shared" : `memory:${owner.bot.id}`);

/** How many times the stream has said this memory changed. */
function useMemoryTick(owner: Owner): number {
  const { state } = useStore();
  return state.ticks[tickOf(owner)] ?? 0;
}

/** The meter's numbers and the topics, re-read whenever the memory moves. */
function useStats(owner: Owner): Stats | null {
  const tick = useMemoryTick(owner);
  const [stats, setStats] = useState<Stats | null>(null);
  const url = owner.kind === "shared" ? "/api/memory/shared" : `/api/bots/${owner.bot.id}/memory/stats`;
  useEffect(() => {
    let live = true;
    api(url)
      .then((r) => live && setStats(owner.kind === "shared" ? r.stats : r))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);
  return stats;
}

/** The person's search across every memory, a moment after typing stops. */
function useMemorySearch(q: string): { hits: Hit[] | null; loading: boolean } {
  const { state } = useStore();
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const words = q.trim();
  useEffect(() => {
    if (!words) {
      setHits(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let live = true;
    const timer = setTimeout(() => {
      api(`/api/memory/search?q=${encodeURIComponent(words)}`)
        .then((r) => live && setHits(r.hits ?? []))
        .catch(() => live && setHits([]))
        .finally(() => live && setLoading(false));
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [words, state.ticks.memory]);
  return { hits, loading };
}

// ── small words ────────────────────────────────────────────────────────

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
function ago(at: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Sizes the way the budget is said: 24 KB is 24,000 bytes. */
function size(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
}

const lineCount = (text: string) => (text ? (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").length : 0);
const byteCount = (text: string) => new TextEncoder().encode(text).length;
const topicTitle = (name: string) => name.replace(/\.md$/i, "");

// ── the shared pieces of a page ────────────────────────────────────────

const pill =
  "flex h-9 items-center rounded-full outline-none transition-[background-color,color,scale,opacity] duration-150 ease-out active:scale-[0.97]";

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 mt-10 flex items-center justify-between gap-4 border-b pb-3">
      <h2 className="text-lead font-semibold text-foreground">{children}</h2>
      {aside && <div className="flex shrink-0 items-center gap-2 text-body text-muted-foreground">{aside}</div>}
    </div>
  );
}

/** The heading every Memory page shares: a face or a mark, a title, a line. */
function PageHead({
  mark,
  title,
  says,
  children,
}: {
  mark: React.ReactNode;
  title: string;
  says: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
      <div className="flex min-w-0 max-w-[640px] items-start gap-4">
        <span className="mt-0.5 shrink-0">{mark}</span>
        <div className="min-w-0">
          <h1 className="truncate text-balance text-display font-semibold text-foreground">{title}</h1>
          <p className="mt-1.5 text-pretty text-ui leading-relaxed text-muted-foreground">{says}</p>
        </div>
      </div>
      {children && <div className="flex items-center gap-1.5">{children}</div>}
    </header>
  );
}

/** A mark for the two entries that are not an agent. */
function MarkTile({ size: px = 52, children }: { size?: number; children: React.ReactNode }) {
  return (
    <span
      style={{ width: px, height: px }}
      className="flex items-center justify-center rounded-[28%] border bg-card text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      {children}
    </span>
  );
}

/** A search field shaped like Customize's. */
function SearchField({
  value,
  onChange,
  placeholder,
  inputRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-9 items-center gap-2 rounded-full border bg-card px-3.5 transition-colors duration-150 focus-within:border-ring/50",
        className,
      )}
    >
      <Search size={15} className="shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (onChange(""), e.currentTarget.blur())}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Clear the search"
          className="-mr-1 flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground"
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
}

// ── the budget ─────────────────────────────────────────────────────────

/** Near the limit from here on, said before anything is cut. */
const NEAR = 0.85;

function Bar({ share, tone }: { share: number; tone: "ok" | "near" | "cut" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          tone === "cut" ? "bg-destructive" : tone === "near" ? "bg-warning" : "bg-foreground/70",
        )}
        style={{ width: `${Math.min(100, Math.max(share > 0 ? 1.5 : 0, share * 100))}%` }}
      />
    </div>
  );
}

/**
 * What every turn loads, against the two limits that cut it: lines first,
 * then bytes. It says when the file is near either, and when part of it
 * no longer reaches the agent at all.
 */
function BudgetMeter({ stats, who }: { stats: Stats | null; who: string }) {
  if (!stats) {
    return <div className="h-[132px] animate-pulse rounded-2xl border bg-card motion-reduce:animate-none" />;
  }
  const lineShare = stats.lines / stats.maxLines;
  const byteShare = stats.bytes / stats.maxBytes;
  const tone = (share: number): "ok" | "near" | "cut" => (stats.truncated && share >= 1 ? "cut" : share >= NEAR ? "near" : "ok");
  const overall = stats.truncated ? "cut" : Math.max(lineShare, byteShare) >= NEAR ? "near" : "ok";
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-display font-semibold tabular-nums text-foreground">
            {Math.min(100, Math.round(Math.max(lineShare, byteShare) * 100))}%
          </span>
          <span className="text-body text-muted-foreground">of what a turn loads</span>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-small font-medium",
            overall === "cut"
              ? "bg-destructive/10 text-destructive"
              : overall === "near"
                ? "bg-warning/12 text-warning"
                : "bg-success/10 text-success",
          )}
        >
          {overall === "ok" ? <Check size={12} /> : <AlertTriangle size={12} />}
          {overall === "cut" ? "Cut short" : overall === "near" ? "Near the limit" : "Fits"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-body">
            <span className="text-muted-foreground">Lines</span>
            <span className="tabular-nums text-foreground">
              {stats.lines} <span className="text-muted-foreground">of {stats.maxLines}</span>
            </span>
          </div>
          <Bar share={lineShare} tone={tone(lineShare)} />
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-body">
            <span className="text-muted-foreground">Size</span>
            <span className="tabular-nums text-foreground">
              {size(stats.bytes)} <span className="text-muted-foreground">of {size(stats.maxBytes)}</span>
            </span>
          </div>
          <Bar share={byteShare} tone={tone(byteShare)} />
        </div>
      </div>
      {overall !== "ok" && (
        <p className="mt-4 text-pretty text-body leading-relaxed text-muted-foreground">
          {overall === "cut"
            ? `Only the first part of MEMORY.md reaches ${who} each turn; the rest is cut. Trim it, or move detail into a topic file.`
            : `MEMORY.md is close to what a turn loads. Past the limit, the end of it stops reaching ${who}.`}
        </p>
      )}
    </div>
  );
}

// ── MEMORY.md ──────────────────────────────────────────────────────────

/**
 * The file that loads every turn, as an editor: monospaced, room to
 * breathe, and honest about its state. While you edit, a change from the
 * agent is not poured over your words; the editor says one arrived and
 * lets you take it.
 */
function CoreEditor({
  owner,
  focus,
  placeholder,
  label = "MEMORY.md",
}: {
  owner: Owner;
  focus?: Focus;
  placeholder: string;
  label?: string;
}) {
  const url = baseOf(owner);
  const tick = useMemoryTick(owner);
  const [base, setBase] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newer, setNewer] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lit, setLit] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const dirty = base !== null && draft !== base;
  const live = useRef({ dirty, base });
  live.current = { dirty, base };

  useEffect(() => {
    let on = true;
    api(url)
      .then((r) => {
        if (!on) return;
        const text: string = r.text ?? "";
        if (!live.current.dirty) {
          setBase(text);
          setDraft(text);
          setNewer(null);
        } else if (text !== live.current.base) setNewer(text);
      })
      .catch((e: Error) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [url, tick]);

  // a search result or a link that named this file: bring it into view
  useEffect(() => {
    if (!focus || focus.file !== "MEMORY.md") return;
    card.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    field.current?.focus({ preventScroll: true });
    setLit(true);
    const timer = setTimeout(() => setLit(false), 1400);
    return () => clearTimeout(timer);
  }, [focus]);

  const save = () => {
    if (!dirty || saving) return;
    const text = draft;
    setSaving(true);
    setError(null);
    api(url, { method: "PUT", body: JSON.stringify({ text }) })
      .then(() => {
        setBase(text);
        setNewer(null);
        setSavedAt(Date.now());
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };
  const discard = () => {
    const back = newer ?? base ?? "";
    setBase(back);
    setDraft(back);
    setNewer(null);
    setError(null);
  };

  const lines = lineCount(draft);
  const bytes = byteCount(draft);
  return (
    <div
      ref={card}
      className={cn(
        "scroll-mt-6 overflow-hidden rounded-2xl border bg-card transition-[border-color,box-shadow] duration-300",
        lit && "border-brand/60 shadow-[0_0_0_4px] shadow-brand/15",
      )}
    >
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
        <FileText size={15} className="shrink-0 text-muted-foreground" />
        <span className="font-mono text-body text-foreground">{label}</span>
        {base === null ? (
          <Loader2 size={13} className="animate-spin text-muted-foreground" />
        ) : dirty ? (
          <span className="flex items-center gap-1.5 text-small text-warning">
            <span className="size-1.5 rounded-full bg-warning" /> Unsaved changes
          </span>
        ) : savedAt ? (
          <span className="flex items-center gap-1 text-small text-success">
            <Check size={12} /> Saved
          </span>
        ) : null}
        <span className="flex-1" />
        {dirty && (
          <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
            Discard
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save
          <span className="hidden text-caption opacity-60 sm:inline">⌘S</span>
        </Button>
      </div>
      {newer !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-brand-soft/40 px-4 py-2 text-body text-foreground">
          <span>This changed while you were editing.</span>
          <button onClick={discard} className="font-medium text-brand-ink underline-offset-2 hover:underline">
            Load the new version
          </button>
        </div>
      )}
      <textarea
        ref={field}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSavedAt(null);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            save();
          }
        }}
        spellCheck={false}
        disabled={base === null}
        placeholder={placeholder}
        aria-label={label}
        className="block max-h-[68vh] min-h-[300px] w-full resize-none overflow-y-auto bg-transparent px-6 py-5 font-mono text-body leading-[1.75] text-foreground outline-none [field-sizing:content] placeholder:font-sans placeholder:text-muted-foreground"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2 text-small text-muted-foreground">
        <span className="tabular-nums">
          {plural(lines, "line")} · {size(bytes)}
        </span>
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <span>{lines > 200 ? "Lines past 200 are not loaded" : "Markdown. One fact per line reads best."}</span>
        )}
      </div>
    </div>
  );
}

// ── topics ─────────────────────────────────────────────────────────────

function TopicDialog({ bot, name, onClose }: { bot: Bot; name: string | null; onClose: () => void }) {
  const tick = useMemoryTick({ kind: "agent", bot });
  const [base, setBase] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const dirty = base !== null && draft !== base;
  const url = name ? `/api/bots/${bot.id}/memory/topics/${encodeURIComponent(name)}` : null;
  const live = useRef(dirty);
  live.current = dirty;

  useEffect(() => {
    setForgetting(false);
    setSaved(false);
    setError(null);
    if (!url) return;
    setBase(null);
    setDraft("");
  }, [url]);
  useEffect(() => {
    if (!url) return;
    let on = true;
    api(url)
      .then((r) => {
        if (!on || live.current) return;
        setBase(r.text ?? "");
        setDraft(r.text ?? "");
      })
      .catch((e: Error & { status?: number }) => on && setError(e.status === 404 ? "This topic is gone." : e.message));
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);

  const save = () => {
    if (!url || !dirty) return;
    const text = draft;
    setBusy(true);
    setError(null);
    api(url, { method: "PUT", body: JSON.stringify({ text }) })
      .then(() => {
        setBase(text);
        setSaved(true);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const forget = () => {
    if (!url) return;
    setBusy(true);
    api(url, { method: "DELETE" })
      .then(onClose)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[86vh] max-w-[760px] flex-col gap-0 p-0">
        <div className="border-b px-6 pb-4 pt-5 pr-12">
          <DialogTitle className="text-title">{name ? topicTitle(name) : ""}</DialogTitle>
          <DialogDescription className="mt-1 font-mono text-small">memory/{name}</DialogDescription>
        </div>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") (e.preventDefault(), save());
          }}
          spellCheck={false}
          disabled={base === null}
          aria-label={name ?? "Topic"}
          placeholder="Empty topic."
          className="block min-h-[320px] w-full flex-1 resize-none overflow-y-auto bg-transparent px-6 py-5 font-mono text-body leading-[1.75] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
          {forgetting ? (
            <span className="flex items-center gap-2 text-body text-foreground">
              Forget this topic?
              <Button size="sm" variant="destructive" onClick={forget} disabled={busy}>
                Forget
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setForgetting(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => setForgetting(true)} disabled={busy || base === null}>
              <Trash2 size={13} /> Forget
            </Button>
          )}
          <span className="min-w-0 flex-1 truncate text-small">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : saved && !dirty ? (
              <span className="text-success">Saved. Undo it from Recent changes.</span>
            ) : (
              <span className="text-muted-foreground tabular-nums">
                {plural(lineCount(draft), "line")} · {size(byteCount(draft))}
              </span>
            )}
          </span>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(base ?? "")} disabled={busy}>
              Discard
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty || busy}>
            {busy && <Loader2 size={12} className="animate-spin" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewTopicDialog({ bot, open, onClose, onMade }: { bot: Bot; open: boolean; onClose: () => void; onMade: (name: string) => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName("");
    setText("");
    setError(null);
  }, [open]);
  const raw = name.trim().replace(/\.md$/i, "");
  const file = raw ? `${raw.replace(/[^\w .-]+/g, "-").replace(/^[^\w]+/, "").slice(0, 100)}.md` : "";
  const make = () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    api(`/api/bots/${bot.id}/memory/topics/${encodeURIComponent(file)}`, {
      method: "PUT",
      body: JSON.stringify({ text: text.trim() ? text : `# ${raw}\n\n` }),
    })
      .then(() => onMade(file))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>New topic</DialogTitle>
        <DialogDescription>
          A file {bot.name} reads when the topic comes up, rather than every turn. Good for people, projects, vendors.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-3">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && make()}
            placeholder="people, projects, vendors"
            aria-label="Topic name"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="What to remember about it (optional)"
            aria-label="What the topic says"
            className="min-h-[140px] w-full resize-none rounded-lg border bg-transparent px-3 py-2.5 font-mono text-body leading-relaxed text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring/60"
          />
          {error && <p className="text-body text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-mono text-small text-muted-foreground">{file ? `memory/${file}` : ""}</span>
            <Button onClick={make} disabled={!file || busy}>
              {busy && <Loader2 size={13} className="animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Topics({ bot, stats, focus }: { bot: Bot; stats: Stats | null; focus: Focus }) {
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (focus?.file.startsWith("memory/")) setOpen(focus.file.slice(7));
  }, [focus]);
  const topics = stats?.topics ?? [];
  return (
    <>
      {stats === null ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-[104px] animate-pulse rounded-2xl border bg-card motion-reduce:animate-none" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {topics.map((topic) => (
            <button
              key={topic.name}
              onClick={() => setOpen(topic.name)}
              className="group flex min-w-0 flex-col rounded-2xl border bg-card p-4 text-left outline-none transition-[background-color,border-color,scale] duration-150 ease-out hover:border-foreground/15 hover:bg-accent/30 active:scale-[0.99]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-background text-muted-foreground">
                  <FileText size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-ui font-medium text-foreground">{topicTitle(topic.name)}</span>
                  <span className="block truncate font-mono text-small text-muted-foreground">{topic.name}</span>
                </span>
              </span>
              <span className="mt-4 flex items-center justify-between gap-2 text-small text-muted-foreground">
                <span className="tabular-nums">
                  {plural(topic.lines, "line")} · {size(topic.bytes)}
                </span>
                <span>Changed {ago(topic.changedAt)}</span>
              </span>
            </button>
          ))}
          <button
            onClick={() => setCreating(true)}
            className="flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed text-body text-muted-foreground outline-none transition-[background-color,color,border-color] duration-150 hover:border-foreground/25 hover:bg-accent/30 hover:text-foreground"
          >
            <Plus size={17} />
            New topic
          </button>
        </div>
      )}
      {stats !== null && topics.length === 0 && (
        <p className="mt-3 text-body leading-relaxed text-muted-foreground">
          No topics yet. {bot.name} makes them as it learns, for detail that does not need to load every turn.
        </p>
      )}
      <TopicDialog bot={bot} name={open} onClose={() => setOpen(null)} />
      <NewTopicDialog
        bot={bot}
        open={creating}
        onClose={() => setCreating(false)}
        onMade={(name) => {
          setCreating(false);
          setOpen(name);
        }}
      />
    </>
  );
}

// ── the journal ────────────────────────────────────────────────────────

/** How many changes show before the rest fold behind a line. */
const SHOWN = 12;

function Timeline({ owner }: { owner: Owner }) {
  const base = baseOf(owner);
  const tick = useMemoryTick(owner);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    api(`${base}/journal`)
      .then((r) => setEntries(r.entries ?? []))
      .catch((e: Error) => setError(e.message));
  }, [base]);
  // the stream says when this memory moves; nothing is polled
  useEffect(load, [load, tick]);

  const undo = (entry: Entry) => {
    setBusy(entry.id);
    setError(null);
    api(`${base}/journal/${entry.id}/undo`, { method: "POST" })
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  if (entries === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-body text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Reading the journal
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed px-6 py-10 text-center text-body leading-relaxed text-muted-foreground">
        {owner.kind === "agent"
          ? `Nothing yet. When ${owner.bot.name} writes to its memory, or you edit it, each change shows up here with a way back.`
          : "Nothing yet. Each change you make shows up here with a way back."}
      </div>
    );
  }

  const shown = all ? entries : entries.slice(0, SHOWN);
  const day = (at: number) => new Date(at).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  let lastDay = "";
  return (
    <div>
      {error && <div className="mb-3 rounded-xl bg-destructive/10 px-3.5 py-2 text-body text-destructive">{error}</div>}
      <ol className="relative">
        <span aria-hidden className="absolute bottom-3 left-[15px] top-3 w-px bg-border" />
        {shown.map((entry) => {
          const heading = day(entry.at) !== lastDay ? (lastDay = day(entry.at)) : null;
          const who = entry.by === "agent" && owner.kind === "agent" ? owner.bot.name : entry.by === "you" ? "You" : entry.by === "undo" ? "Undo" : "An agent";
          const verb = entry.by === "undo" ? "put back" : entry.created ? "started" : entry.deleted ? "forgot" : "changed";
          const isOpen = expanded === entry.id;
          const canUndo = !entry.undoneBy && entry.by !== "undo" && !entry.big;
          return (
            <li key={entry.id} className="relative">
              {heading && (
                <div className="relative mb-2 ml-11 pt-1 text-small font-medium text-muted-foreground first:pt-0">{heading}</div>
              )}
              <div className="flex gap-3 pb-3">
                <span className="relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full bg-background">
                  {entry.by === "agent" && owner.kind === "agent" ? (
                    <AgentAvatar bot={owner.bot} size={26} />
                  ) : (
                    <span className="flex size-[26px] items-center justify-center rounded-full border bg-card text-muted-foreground">
                      {entry.by === "undo" ? <Undo2 size={12} /> : <UserRound size={13} />}
                    </span>
                  )}
                </span>
                <div className={cn("min-w-0 flex-1 overflow-hidden rounded-xl border bg-card", entry.undoneBy && "opacity-60")}>
                  <div className="flex items-center gap-2 pr-2">
                    <button
                      onClick={() => setExpanded(isOpen ? null : entry.id)}
                      aria-expanded={isOpen}
                      disabled={!entry.lines}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui text-foreground">
                          <span className="font-medium">{who}</span> {verb}{" "}
                          <span className="font-mono text-body">{entry.file}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-small text-muted-foreground">
                          <span>{new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                          {!entry.big && (entry.added > 0 || entry.removed > 0) && (
                            <span className="tabular-nums">
                              <span className="text-success">+{entry.added}</span>{" "}
                              <span className="text-destructive">-{entry.removed}</span>
                            </span>
                          )}
                          {entry.undoneBy && <span>Undone</span>}
                          {entry.big && <span>Too large to keep</span>}
                        </span>
                      </span>
                      {entry.lines && (
                        <ChevronDown
                          size={15}
                          className={cn("shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")}
                        />
                      )}
                    </button>
                    {canUndo && (
                      <Button size="sm" variant="ghost" disabled={busy === entry.id} onClick={() => undo(entry)}>
                        {busy === entry.id ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                        Undo
                      </Button>
                    )}
                  </div>
                  {isOpen && entry.lines && (
                    <div className="max-h-[360px] overflow-auto border-t bg-muted/30 py-2">
                      <DiffLines lines={entry.lines} />
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {!all && entries.length > SHOWN && (
        <button
          onClick={() => setAll(true)}
          className="ml-11 mt-1 text-body text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          Show {plural(entries.length - SHOWN, "earlier change")}
        </button>
      )}
    </div>
  );
}

// ── search results ─────────────────────────────────────────────────────

function HitRow({ hit, owner, onOpen, showOwner }: { hit: Hit; owner?: Bot; onOpen: () => void; showOwner: boolean }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full min-w-0 items-start gap-3 rounded-xl px-2.5 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-accent/60"
    >
      {showOwner && (
        <span className="mt-0.5 shrink-0">
          {hit.botId === "shared" ? (
            <MarkTile size={24}>
              <Users size={13} />
            </MarkTile>
          ) : owner ? (
            <AgentAvatar bot={owner} size={24} />
          ) : null}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          {showOwner && (
            <span className="truncate text-body font-medium text-foreground">
              {hit.botId === "shared" ? "Shared" : (owner?.name ?? "An agent")}
            </span>
          )}
          <span className="truncate font-mono text-small text-muted-foreground">{hit.file}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 text-body leading-relaxed text-muted-foreground">{hit.text}</span>
      </span>
    </button>
  );
}

// ── copying from another agent ─────────────────────────────────────────

function CopyDialog({ bot, open, onClose }: { bot: Bot; open: boolean; onClose: () => void }) {
  const { state } = useStore();
  const others = state.bots.filter((b) => !b.hidden && !b.archivedAt && b.id !== bot.id);
  const [from, setFrom] = useState<Bot | null>(null);
  const [source, setSource] = useState<{ text: string; topics: Array<{ name: string; bytes: number }> } | null>(null);
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ copied: number; skipped: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(null);
    setDone(null);
    setError(null);
  }, [open]);
  useEffect(() => {
    setSource(null);
    setTopics(new Set());
    setLines(new Set());
    if (!from) return;
    let on = true;
    api(`/api/bots/${from.id}/memory`)
      .then((r) => on && setSource({ text: r.text ?? "", topics: r.topics ?? [] }))
      .catch((e: Error) => on && setError(e.message));
    return () => {
      on = false;
    };
  }, [from]);

  const coreLines = (source?.text ?? "").split("\n").map((text, at) => ({ text, at })).filter((line) => line.text.trim());
  const flip = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const copy = () => {
    if (!from) return;
    setBusy(true);
    setError(null);
    api(`/api/bots/${bot.id}/memory/copy`, {
      method: "POST",
      body: JSON.stringify({ from: from.id, topics: [...topics], lines: [...lines] }),
    })
      .then((r) => setDone({ copied: r.copied?.length ?? 0, skipped: (r.skipped ?? []).map((s: { file: string; reason: string }) => `${s.file}: ${s.reason}`) }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const picked = topics.size + lines.size;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[86vh] max-w-[640px] flex-col">
        <DialogTitle>Copy from another agent</DialogTitle>
        <DialogDescription>
          Bring topics, or lines of MEMORY.md, into {bot.name}'s memory. Each file copied is one change you can undo.
        </DialogDescription>
        {done ? (
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <Check size={16} className="mt-0.5 shrink-0 text-success" />
              <div className="text-ui leading-relaxed text-foreground">
                {done.copied ? `Copied ${plural(done.copied, "file")}. Each is in Recent changes, with Undo.` : "Nothing new to copy."}
                {done.skipped.length > 0 && (
                  <ul className="mt-1.5 text-body text-muted-foreground">
                    {done.skipped.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : !from ? (
          <div className="mt-4 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {others.length === 0 && <p className="py-6 text-body text-muted-foreground">There is no other agent to copy from yet.</p>}
            {others.map((other) => (
              <button
                key={other.id}
                onClick={() => setFrom(other)}
                className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors duration-150 hover:bg-accent/60"
              >
                <AgentAvatar bot={other} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium text-foreground">{other.name}</span>
                  {other.title && <span className="block truncate text-body text-muted-foreground">{other.title}</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <button
              onClick={() => setFrom(null)}
              className="mb-3 flex items-center gap-2 self-start rounded-lg px-1.5 py-1 text-body text-muted-foreground outline-none hover:text-foreground"
            >
              <AgentAvatar bot={from} size={20} />
              {from.name}
              <span className="text-small">· change</span>
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border">
              {source === null ? (
                <div className="flex items-center gap-2 px-4 py-6 text-body text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Reading {from.name}'s memory
                </div>
              ) : (
                <>
                  <div className="border-b bg-muted/30 px-4 py-2 text-small font-medium text-muted-foreground">Topics</div>
                  {source.topics.length === 0 ? (
                    <p className="px-4 py-3 text-body text-muted-foreground">No topics.</p>
                  ) : (
                    source.topics.map((topic) => (
                      <label key={topic.name} className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-accent/40">
                        <input
                          type="checkbox"
                          checked={topics.has(topic.name)}
                          onChange={() => setTopics((set) => flip(set, topic.name))}
                          className="size-4 shrink-0 accent-(--brand)"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-body text-foreground">{topic.name}</span>
                        <span className="shrink-0 text-small tabular-nums text-muted-foreground">{size(topic.bytes)}</span>
                      </label>
                    ))
                  )}
                  <div className="flex items-center justify-between border-y bg-muted/30 px-4 py-2 text-small font-medium text-muted-foreground">
                    <span>Lines of MEMORY.md</span>
                    {coreLines.length > 0 && (
                      <button
                        onClick={() => setLines(lines.size === coreLines.length ? new Set() : new Set(coreLines.map((l) => l.at)))}
                        className="font-normal hover:text-foreground"
                      >
                        {lines.size === coreLines.length ? "Clear" : "All"}
                      </button>
                    )}
                  </div>
                  {coreLines.length === 0 ? (
                    <p className="px-4 py-3 text-body text-muted-foreground">MEMORY.md is empty.</p>
                  ) : (
                    coreLines.map((line) => (
                      <label key={line.at} className="flex cursor-pointer items-start gap-3 px-4 py-1.5 hover:bg-accent/40">
                        <input
                          type="checkbox"
                          checked={lines.has(line.at)}
                          onChange={() => setLines((set) => flip(set, line.at))}
                          className="mt-[3px] size-4 shrink-0 accent-(--brand)"
                        />
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-body leading-relaxed text-foreground">
                          {line.text}
                        </span>
                      </label>
                    ))
                  )}
                </>
              )}
            </div>
            {error && <p className="mt-2 text-body text-destructive">{error}</p>}
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-body text-muted-foreground">
                {picked ? `${plural(topics.size, "topic")}, ${plural(lines.size, "line")}` : "Pick what to bring over"}
              </span>
              <Button onClick={copy} disabled={!picked || busy}>
                {busy && <Loader2 size={13} className="animate-spin" />}
                Copy to {bot.name}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── the pages ──────────────────────────────────────────────────────────

function AgentPage({ bot, focus, onFocus }: { bot: Bot; focus: Focus; onFocus: (file: string) => void }) {
  const owner = useMemo<Owner>(() => ({ kind: "agent", bot }), [bot]);
  const stats = useStats(owner);
  const [q, setQ] = useState("");
  const [copying, setCopying] = useState(false);
  const { hits, loading } = useMemorySearch(q);
  const mine = (hits ?? []).filter((hit) => hit.botId === bot.id);
  return (
    <>
      <PageHead
        mark={<AgentAvatar bot={bot} size={52} />}
        title={bot.name}
        says={`What ${bot.name} keeps between conversations, as plain files. Every change is recorded, with a way back.`}
      >
        <SearchField value={q} onChange={setQ} placeholder={`Search ${bot.name}'s memory`} className="w-[220px] lg:w-[260px]" />
        <button
          onClick={() => setCopying(true)}
          className={cn(pill, "gap-1.5 bg-foreground px-4 text-body font-medium text-background hover:opacity-90")}
        >
          <Copy size={14} />
          Copy from
        </button>
      </PageHead>

      {q.trim() && (
        <>
          <SectionTitle aside={loading ? <Loader2 size={13} className="animate-spin" /> : hits && `${mine.length} found`}>Results</SectionTitle>
          {hits && mine.length === 0 && !loading ? (
            <p className="text-ui text-muted-foreground">Nothing in {bot.name}'s memory matches “{q.trim()}”.</p>
          ) : (
            <div className="flex flex-col">
              {mine.map((hit, i) => (
                <HitRow key={`${hit.file}-${i}`} hit={hit} showOwner={false} onOpen={() => onFocus(hit.file)} />
              ))}
            </div>
          )}
        </>
      )}

      <SectionTitle aside="MEMORY.md, up to 200 lines and 24 KB">Loaded every turn</SectionTitle>
      <BudgetMeter stats={stats} who={bot.name} />

      <SectionTitle aside={stats?.lastChangedAt ? `Edited ${ago(stats.lastChangedAt)}` : undefined}>Core memory</SectionTitle>
      <CoreEditor
        owner={owner}
        focus={focus}
        placeholder={`Nothing remembered yet. ${bot.name} adds notes here as it learns how you work, or write them yourself: one fact per line.`}
      />

      <SectionTitle aside={stats ? plural(stats.topics.length, "file") : undefined}>Topics</SectionTitle>
      <Topics bot={bot} stats={stats} focus={focus} />

      <SectionTitle
        aside={
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" /> Live
          </span>
        }
      >
        Recent changes
      </SectionTitle>
      <Timeline owner={owner} />

      <CopyDialog bot={bot} open={copying} onClose={() => setCopying(false)} />
    </>
  );
}

function SharedPage({ focus }: { focus: Focus }) {
  const owner = useMemo<Owner>(() => ({ kind: "shared" }), []);
  const stats = useStats(owner);
  return (
    <>
      <PageHead
        mark={
          <MarkTile>
            <Users size={24} />
          </MarkTile>
        }
        title="Shared memory"
        says="One memory every agent reads, kept by you. Agents can read it but never change it, and it stays out of rooms shared with other people, mail from strangers and Telegram."
      />
      <SectionTitle aside="Up to 200 lines and 24 KB">Loaded every turn</SectionTitle>
      <BudgetMeter stats={stats} who="your agents" />
      <SectionTitle aside={stats?.lastChangedAt ? `Edited ${ago(stats.lastChangedAt)}` : undefined}>For every agent</SectionTitle>
      <CoreEditor
        owner={owner}
        focus={focus}
        placeholder="What every agent should know: the company, the people, how you like things done. One fact per line."
      />
      <SectionTitle>Recent changes</SectionTitle>
      <Timeline owner={owner} />
    </>
  );
}

function AboutYouPage() {
  const { dispatch } = useStore();
  const { notes, reload } = useProfileNotes();
  const suggested = (notes ?? []).filter((n) => n.state === "suggested");
  const kept = (notes ?? []).filter((n) => n.state === "kept");
  return (
    <>
      <PageHead
        mark={
          <MarkTile>
            <UserRound size={24} />
          </MarkTile>
        }
        title="About you"
        says="What every agent knows about you. Agents suggest notes as they learn; nothing is kept until you say so, and none of it reaches people you invite into a room."
      />
      {suggested.length > 0 && (
        <>
          <SectionTitle aside={plural(suggested.length, "suggestion")}>Waiting for you</SectionTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {suggested.map((note) => (
              <Suggestion key={note.id} note={note} onDone={reload} />
            ))}
          </div>
        </>
      )}
      <SectionTitle aside={notes ? `${kept.length} of 60` : undefined}>What every agent knows</SectionTitle>
      <KeptNotes notes={notes} reload={reload} />
      <SectionTitle
        aside={
          <button
            onClick={() => dispatch({ type: "toggleAppSettings", open: true, page: "about-you" })}
            className="hover:text-foreground"
          >
            Also in Settings
          </button>
        }
      >
        In your own words
      </SectionTitle>
      <AboutText />
    </>
  );
}

// ── the sidebar ────────────────────────────────────────────────────────

function PlaceRow({
  active,
  icon,
  label,
  meta,
  badge,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none transition-colors duration-150",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-foreground">{label}</span>
        {meta && <span className="block truncate text-small text-muted-foreground">{meta}</span>}
      </span>
      {badge}
    </button>
  );
}

function statsLine(stats: Stats | null): React.ReactNode {
  if (!stats) return " ";
  if (!stats.lines && !stats.topics.length) return "Nothing kept yet";
  const lines = (
    <span className={cn(stats.truncated && "text-destructive", !stats.truncated && stats.lines / stats.maxLines >= NEAR && "text-warning")}>
      {stats.lines} of {stats.maxLines} lines
    </span>
  );
  return stats.lastChangedAt ? (
    <>
      {lines} · {ago(stats.lastChangedAt)}
    </>
  ) : (
    lines
  );
}

function AgentRow({ bot, active, onClick }: { bot: Bot; active: boolean; onClick: () => void }) {
  const stats = useStats(useMemo(() => ({ kind: "agent", bot }) as Owner, [bot]));
  return <PlaceRow active={active} icon={<AgentAvatar bot={bot} size={30} />} label={bot.name} meta={statsLine(stats)} onClick={onClick} />;
}

function SharedRow({ active, onClick }: { active: boolean; onClick: () => void }) {
  const stats = useStats(useMemo(() => ({ kind: "shared" }) as Owner, []));
  return (
    <PlaceRow
      active={active}
      icon={
        <MarkTile size={30}>
          <Users size={15} />
        </MarkTile>
      }
      label="Shared"
      meta={stats && !stats.lines ? "For every agent" : statsLine(stats)}
      onClick={onClick}
    />
  );
}

function MemorySidebar({
  target,
  agents,
  waiting,
  onPick,
}: {
  target: string;
  agents: Bot[];
  waiting: number;
  onPick: (target: string, file?: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const { hits, loading } = useMemorySearch(searching ? q : "");
  useEffect(() => {
    if (searching) field.current?.focus();
  }, [searching]);
  const close = () => {
    setSearching(false);
    setQ("");
  };
  return (
    <aside aria-label="Memory" className="hidden h-full w-[280px] shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="titlebar-drag flex h-[52px] shrink-0 items-center justify-between pl-4 pr-2.5">
        <span className="text-lead font-semibold text-foreground">Memory</span>
        <button
          onClick={() => (searching ? close() : setSearching(true))}
          aria-label={searching ? "Close the search" : "Search every memory"}
          aria-pressed={searching}
          title="Search"
          className={cn(
            "flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]",
            searching && "bg-accent text-foreground",
          )}
        >
          {searching ? <X size={16} /> : <Search size={16} />}
        </button>
      </div>
      {searching && (
        <div className="px-2.5 pb-2">
          <label className="flex h-9 items-center gap-2 rounded-lg border bg-card px-3 transition-colors duration-150 focus-within:border-ring/50">
            <Search size={14} className="shrink-0 text-muted-foreground" />
            <input
              ref={field}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && close()}
              placeholder="Search every memory"
              aria-label="Search every memory"
              className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
            />
            {loading && <Loader2 size={13} className="shrink-0 animate-spin text-muted-foreground" />}
          </label>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {searching && q.trim() ? (
          hits === null ? null : hits.length === 0 ? (
            <p className="px-2.5 py-3 text-body leading-relaxed text-muted-foreground">Nothing in memory matches “{q.trim()}”.</p>
          ) : (
            hits.map((hit, i) => (
              <HitRow
                key={`${hit.botId}-${hit.file}-${i}`}
                hit={hit}
                owner={agents.find((a) => a.id === hit.botId)}
                showOwner
                onOpen={() => onPick(hit.botId, hit.file)}
              />
            ))
          )
        ) : (
          <>
            <nav className="flex flex-col gap-0.5">
              <SharedRow active={target === "shared"} onClick={() => onPick("shared")} />
              <PlaceRow
                active={target === "you"}
                icon={
                  <MarkTile size={30}>
                    <UserRound size={15} />
                  </MarkTile>
                }
                label="About you"
                meta={waiting > 0 ? `${plural(waiting, "suggestion")} waiting` : "What every agent knows"}
                badge={
                  waiting > 0 ? (
                    <span className="rounded-full bg-warning/15 px-1.5 py-px text-caption font-semibold tabular-nums text-warning">{waiting}</span>
                  ) : undefined
                }
                onClick={() => onPick("you")}
              />
            </nav>
            <div className="mt-5 px-2.5 pb-1.5 text-body text-muted-foreground">Agents</div>
            <div className="flex flex-col gap-0.5">
              {agents.length === 0 ? (
                <p className="px-2.5 text-body leading-relaxed text-muted-foreground/80">Agents you make show up here.</p>
              ) : (
                agents.map((agent) => <AgentRow key={agent.id} bot={agent} active={target === agent.id} onClick={() => onPick(agent.id)} />)
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

/** On a phone the sidebar does not fit: the same entries, as a row of chips. */
function PhonePicker({ target, agents, waiting, onPick }: { target: string; agents: Bot[]; waiting: number; onPick: (target: string) => void }) {
  const chip = (active: boolean) =>
    cn(
      "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-body font-medium outline-none transition-colors duration-150",
      active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div role="tablist" aria-label="Whose memory" className="-mx-6 mb-6 flex gap-1 overflow-x-auto px-6 pb-1 md:hidden">
      <button role="tab" aria-selected={target === "shared"} onClick={() => onPick("shared")} className={chip(target === "shared")}>
        <Users size={14} /> Shared
      </button>
      <button role="tab" aria-selected={target === "you"} onClick={() => onPick("you")} className={chip(target === "you")}>
        <UserRound size={14} /> About you
        {waiting > 0 && <span className="rounded-full bg-warning/15 px-1.5 text-caption tabular-nums text-warning">{waiting}</span>}
      </button>
      {agents.map((agent) => (
        <button key={agent.id} role="tab" aria-selected={target === agent.id} onClick={() => onPick(agent.id)} className={chip(target === agent.id)}>
          <AgentAvatar bot={agent} size={18} /> {agent.name}
        </button>
      ))}
    </div>
  );
}

/** The whole Memory place: its sidebar and the page it has open. */
export function MemoryPlace() {
  const { state, dispatch } = useStore();
  const agents = useMemo(() => state.bots.filter((b) => !b.hidden && !b.archivedAt), [state.bots]);
  const { notes } = useProfileNotes();
  const waiting = (notes ?? []).filter((n) => n.state === "suggested").length;
  // Asked for by a link or a pick, while it still exists; otherwise the
  // notes waiting on you, then the agent in view, then the first one.
  const asked = state.memoryTarget;
  const exists = (t: string) => t === "you" || t === "shared" || agents.some((a) => a.id === t);
  const viewing = agents.find((a) => a.id === state.selectedId)?.id;
  const target = asked && exists(asked) ? asked : waiting > 0 ? "you" : (viewing ?? agents[0]?.id ?? "shared");
  const bot = agents.find((a) => a.id === target) ?? null;
  const [focus, setFocus] = useState<Focus>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const pick = (next: string, file?: string) => {
    dispatch({ type: "openMemory", target: next });
    setFocus(file ? { file, nonce: Date.now() } : null);
  };
  // a new page starts at its top; a file asked for scrolls itself into
  // view after this, from the page's own effects
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [target]);

  return (
    <>
      <MemorySidebar target={target} agents={agents} waiting={waiting} onPick={pick} />
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="titlebar-drag h-3 shrink-0" />
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1080px] px-6 pb-20 pt-7 max-md:pt-16 lg:px-12">
            <PhonePicker target={target} agents={agents} waiting={waiting} onPick={pick} />
            {target === "you" ? (
              <AboutYouPage />
            ) : target === "shared" ? (
              <SharedPage focus={focus} />
            ) : bot ? (
              <AgentPage key={bot.id} bot={bot} focus={focus} onFocus={(file) => setFocus({ file, nonce: Date.now() })} />
            ) : (
              <div className="flex flex-col items-center gap-3 py-24 text-center">
                <Brain size={28} className="text-muted-foreground" />
                <p className="max-w-[320px] text-ui leading-relaxed text-muted-foreground">
                  Memory is what your agents keep between conversations. Make an agent and it shows up here.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
