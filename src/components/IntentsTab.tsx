// Standing intents (server/intents.ts): whenever some words come up in a
// conversation, do one small thing about it. A note in the person's own
// words, an agent brought in, or a short message to an agent.
//
// The third tab beside Schedules and Watchers, laid out like Watchers:
// the list on the left, the one you are looking at on the right. One an
// agent proposed waits at the top of its page for an Approve, and does
// nothing until it gets one. A new one is read back as a sentence before
// it is made, because "whenever the launch date comes up, Maya is told"
// is easier to check than four fields.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2 } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { UserPlus } from "@/components/icons";
import { Users } from "@/components/icons";
import { Zap } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { AUTOMATIONS_LIST, AUTOMATIONS_LIST_SIZE, useColumnFolded } from "@/lib/sideColumn";
import { ShowColumn, SideColumn } from "./SideColumn";

type ActionKind = "note" | "mention" | "message";

interface IntentRow {
  id: string;
  name: string;
  phrases: string[];
  covers: { everywhere: true } | { agents: string[]; rooms: string[] };
  action: { kind: ActionKind; text?: string; botId?: string };
  cooldownHours: number;
  enabled: boolean;
  status: "active" | "proposed";
  createdAt: number;
  expiresAt: number;
  by: { kind: "person" } | { kind: "agent"; botId: string; name: string };
  fires: Array<{ at: number; threadId: string; messageId: string; phrase: string; excerpt: string; error?: string }>;
  state: "proposed" | "paused" | "expired" | "listening";
  firesToday: number;
}

/** What the form holds, for a new intent or a change to one. */
interface Fields {
  name: string;
  phrases: string;
  everywhere: boolean;
  agents: string[];
  rooms: string[];
  kind: ActionKind;
  botId: string;
  text: string;
}

const KIND: Record<ActionKind, { label: string; icon: typeof Zap; text: string; placeholder: string }> = {
  note: { label: "Post a note", icon: Zap, text: "The note", placeholder: "Refund policy: full refund within 30 days, no questions asked." },
  mention: { label: "Loop in", icon: UserPlus, text: "Why, if it helps (optional)", placeholder: "They own the launch plan." },
  message: { label: "Message", icon: MessageSquare, text: "What to send", placeholder: "Check the press plan still matches the new date." },
};

/** Days until a time, rounded the way a person says it. */
function daysUntil(at: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((at - now) / (24 * 60 * 60 * 1000)));
}

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(at).toLocaleDateString();
};

const fieldsOf = (row: IntentRow): Fields => ({
  name: row.name,
  phrases: row.phrases.join(", "),
  everywhere: "everywhere" in row.covers,
  agents: "agents" in row.covers ? row.covers.agents : [],
  rooms: "rooms" in row.covers ? row.covers.rooms : [],
  kind: row.action.kind,
  botId: row.action.botId ?? "",
  text: row.action.text ?? "",
});

/** The request body the server reads (cleanIntent). */
const bodyOf = (f: Fields) => ({
  name: f.name.trim() || undefined,
  phrases: f.phrases,
  covers: f.everywhere ? { everywhere: true } : { agents: f.agents, rooms: f.rooms },
  action: f.kind === "note" ? { kind: "note", text: f.text } : { kind: f.kind, botId: f.botId, ...(f.text.trim() ? { text: f.text } : {}) },
});

/** The phrases as the person typed them, one per comma. */
const phraseList = (raw: string) =>
  raw
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Why the form cannot be saved yet, or null. Mirrors the server's checks
 * closely enough to say so before asking. */
function missing(f: Fields): string | null {
  if (!phraseList(f.phrases).length) return "Add the words to listen for.";
  if (!f.everywhere && !f.agents.length && !f.rooms.length) return "Pick where it listens.";
  if (f.kind !== "note" && !f.botId) return "Pick an agent.";
  if (f.kind !== "mention" && !f.text.trim()) return f.kind === "note" ? "Write the note." : "Write the message.";
  return null;
}

/** The intent as one sentence, as it is filled in. */
function readback(f: Fields, names: { agent: (id: string) => string | undefined; room: (id: string) => string | undefined }): string {
  const phrases = phraseList(f.phrases);
  const words = phrases.length ? phrases.map((p) => `“${p}”`).join(" or ") : "the words you pick";
  const places = f.everywhere
    ? "any conversation"
    : [...f.agents.map((id) => `${names.agent(id) ?? "an agent"}'s conversations`), ...f.rooms.map((id) => names.room(id) ?? "a room")].join(", ") || "the places you pick";
  const who = names.agent(f.botId) ?? "an agent";
  const does =
    f.kind === "note" ? "a note is posted there" : f.kind === "mention" ? `${who} is brought in` : `${who} gets a message`;
  return `Whenever someone says ${words} in ${places}, ${does}. At most once a day in each conversation, for 90 days.`;
}

/** The fields, shared by a new intent and the page of one. */
function IntentForm({ value, onChange }: { value: Fields; onChange: (next: Fields) => void }) {
  const { state } = useStore();
  const bots = state.bots.filter((b) => !b.hidden && !b.archivedAt);
  const rooms = state.bloks.filter((r) => !r.archived);
  const set = (patch: Partial<Fields>) => onChange({ ...value, ...patch });
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const chip = (on: boolean) =>
    cn(
      "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-body outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.97]",
      on ? "border-brand bg-brand-soft font-medium text-foreground" : "bg-card text-foreground/90 hover:border-foreground/20",
    );
  return (
    <div className="flex flex-col">
      <label className="mb-2 text-body font-medium text-foreground" htmlFor="intent-phrases">
        When any of these come up
      </label>
      <Input
        id="intent-phrases"
        value={value.phrases}
        onChange={(e) => set({ phrases: e.target.value })}
        placeholder="launch date, launch day"
        spellCheck={false}
        className="rounded-xl text-body"
      />
      <span className="mt-1.5 text-small text-muted-foreground">
        Commas between phrases. Whole words in any case; end a word with * for its other endings, like refund*.
      </span>

      <div className="mt-6 mb-2 text-body font-medium text-foreground">Where it listens</div>
      <Segmented
        aria-label="Where it listens"
        className="max-w-[360px]"
        value={value.everywhere ? "everywhere" : "chosen"}
        onChange={(v) => set({ everywhere: v === "everywhere" })}
        options={[
          { value: "everywhere", label: "Everywhere" },
          { value: "chosen", label: "Chosen places" },
        ]}
      />
      <AnimatePresence initial={false} mode="popLayout">
        {value.everywhere ? (
          <motion.p
            key="everywhere"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="mt-2 text-small text-muted-foreground"
          >
            Every conversation with your agents, and every room you have not shared with other people.
          </motion.p>
        ) : (
          <motion.div
            key="chosen"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="mt-3 flex flex-wrap gap-1.5"
            role="group"
            aria-label="Places it listens"
          >
            {bots.map((b) => (
              <button key={b.id} type="button" aria-pressed={value.agents.includes(b.id)} onClick={() => set({ agents: toggle(value.agents, b.id) })} className={chip(value.agents.includes(b.id))}>
                <AgentAvatar bot={b} size={22} />
                {b.name}
              </button>
            ))}
            {rooms.map((r) => (
              <button key={r.id} type="button" aria-pressed={value.rooms.includes(r.id)} onClick={() => set({ rooms: toggle(value.rooms, r.id) })} className={cn(chip(value.rooms.includes(r.id)), "pl-2.5")}>
                <Users size={13} className="text-muted-foreground" />
                {r.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 mb-2 text-body font-medium text-foreground">What happens</div>
      <div role="radiogroup" aria-label="What happens" className="grid grid-cols-3 gap-2">
        {(Object.keys(KIND) as ActionKind[]).map((k) => {
          const Icon = KIND[k].icon;
          const on = value.kind === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set({ kind: k })}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-xl border p-2.5 text-left outline-none transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.985]",
                on ? "border-brand bg-brand-soft" : "bg-card hover:border-foreground/20 hover:bg-accent/40",
              )}
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150", on ? "bg-brand-ink text-brand-foreground" : "bg-muted text-muted-foreground")}>
                <Icon size={14} />
              </span>
              <span className="truncate text-body font-medium text-foreground">{KIND[k].label}</span>
            </button>
          );
        })}
      </div>
      {value.kind !== "note" && (
        <div role="radiogroup" aria-label="Which agent" className="mt-3 flex flex-wrap gap-1.5">
          {bots.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={value.botId === b.id} onClick={() => set({ botId: b.id })} className={chip(value.botId === b.id)}>
              <AgentAvatar bot={b} size={22} />
              {b.name}
            </button>
          ))}
        </div>
      )}
      <label className="mt-4 mb-2 text-body text-muted-foreground" htmlFor="intent-text">
        {KIND[value.kind].text}
      </label>
      <Textarea
        id="intent-text"
        value={value.text}
        onChange={(e) => set({ text: e.target.value })}
        placeholder={KIND[value.kind].placeholder}
        className="min-h-[80px] rounded-xl text-body"
      />
      {value.kind === "mention" && (
        <span className="mt-1.5 text-small text-muted-foreground">
          In a room they are in, they are woken there. Anywhere else they are sent what was said.
        </span>
      )}

      <label className="mt-6 mb-2 text-body text-muted-foreground" htmlFor="intent-name">
        Name (optional)
      </label>
      <Input id="intent-name" value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="Launch date" className="max-w-[360px] rounded-xl text-body" />
    </div>
  );
}

function useNames() {
  const { state } = useStore();
  return useMemo(
    () => ({
      agent: (id: string) => state.bots.find((b) => b.id === id)?.name,
      room: (id: string) => state.bloks.find((r) => r.id === id)?.name,
    }),
    [state.bots, state.bloks],
  );
}

function Draft({ onMade }: { onMade: (id: string) => void }) {
  const names = useNames();
  const [fields, setFields] = useState<Fields>({ name: "", phrases: "", everywhere: true, agents: [], rooms: [], kind: "note", botId: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const why = missing(fields);
  const make = () => {
    if (why || busy) return;
    setBusy(true);
    setError(null);
    api("/api/intents", { method: "POST", body: JSON.stringify(bodyOf(fields)) })
      .then((r) => onMade(r.intent.id))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
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
      <h2 className="text-heading font-semibold text-foreground">New intent</h2>
      <p className="mt-1 mb-6 text-body text-muted-foreground">Whenever something comes up in a conversation, do one small thing about it.</p>
      <IntentForm value={fields} onChange={setFields} />
      <div className="mt-6 flex items-start gap-3 rounded-xl bg-muted/60 px-3.5 py-3">
        <Zap size={16} className="mt-0.5 shrink-0 text-brand-ink" />
        <p className="min-w-0 flex-1 text-pretty break-words text-body leading-relaxed text-foreground">{readback(fields, names)}</p>
      </div>
      {error && <div className="mt-3 text-body text-destructive">{error}</div>}
      <div className="mt-5 flex items-center gap-3">
        <Button size="lg" disabled={busy || Boolean(why)} onClick={make}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
          {busy ? "Starting" : "Start listening"}
        </Button>
        {why && <span className="text-small text-muted-foreground">{why}</span>}
      </div>
    </div>
  );
}

function Detail({ row, onChanged }: { row: IntentRow; onChanged: () => void }) {
  const { state, dispatch } = useStore();
  const names = useNames();
  const [fields, setFields] = useState<Fields>(() => fieldsOf(row));
  const [saving, setSaving] = useState(false);
  // a change from elsewhere (the phone, a renew) shows unless this page
  // has edits of its own in hand
  const saved = useMemo(() => JSON.stringify(fieldsOf(row)), [row]);
  const dirty = JSON.stringify(fields) !== saved;
  useEffect(() => {
    if (!dirty) setFields(fieldsOf(row));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const patch = (body: Record<string, unknown>, done?: string) =>
    api(`/api/intents/${row.id}`, { method: "PATCH", body: JSON.stringify(body) })
      .then(() => {
        if (done) toast.success(done);
        onChanged();
      })
      .catch((e: Error) => toast.error(e.message));

  const save = () => {
    setSaving(true);
    void patch(bodyOf(fields), "Saved").finally(() => setSaving(false));
  };
  const remove = async () => {
    const proposal = row.status === "proposed";
    const yes = await confirm({
      title: proposal ? "Decline this intent?" : "Delete this intent?",
      body: proposal ? "It is removed and never listens." : "It stops listening, and its history goes with it.",
      confirmLabel: proposal ? "Decline" : "Delete",
      destructive: true,
    });
    if (!yes) return;
    api(`/api/intents/${row.id}`, { method: "DELETE" })
      .then(onChanged)
      .catch((e: Error) => toast.error(e.message));
  };
  const open = (threadId: string) => {
    if (state.bloks.some((r) => r.id === threadId)) return dispatch({ type: "select", id: threadId });
    const bot = state.bots.find((b) => b.tasks?.some((t) => t.id === threadId));
    if (bot) dispatch({ type: "select", id: bot.id, lane: threadId });
  };
  const proposer = row.by.kind === "agent" ? state.bots.find((b) => b.id === (row.by as { botId: string }).botId) : undefined;
  const left = daysUntil(row.expiresAt);
  const why = missing(fields);

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
      {row.status === "proposed" && (
        <div className="flex flex-col gap-2 rounded-xl border border-brand/40 bg-brand-soft px-3.5 py-3 text-body text-foreground">
          <div className="flex items-center gap-2 font-medium">
            {proposer ? <AgentAvatar bot={proposer} size={20} /> : <Zap size={14} className="text-brand-ink" />}
            {row.by.kind === "agent" ? row.by.name : "An agent"} suggests this
          </div>
          <div className="text-muted-foreground">It does nothing until you approve it. Check what it listens for and what it does.</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void patch({ approve: true }, "Approved")}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              Decline
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lead font-semibold text-foreground">
            <Zap size={15} className="text-brand-ink" /> {row.name}
          </div>
          <p className="mt-1 text-pretty text-body text-muted-foreground">{readback(fieldsOf(row), names)}</p>
        </div>
        {row.status === "active" && <Switch checked={row.enabled} onCheckedChange={(on) => void patch({ enabled: on })} aria-label="Listening" />}
      </div>
      {row.status === "active" && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-body",
            row.state === "expired" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
          )}
        >
          <span>
            {row.state === "expired"
              ? "Stopped listening: 90 days are up."
              : `Listens for ${left} more ${left === 1 ? "day" : "days"}. Fired ${row.firesToday} of 3 times today.`}
          </span>
          {(row.state === "expired" || left <= 14) && (
            <Button size="sm" variant="secondary" onClick={() => void patch({ renew: true }, "Renewed for 90 days")}>
              Renew
            </Button>
          )}
        </div>
      )}

      <IntentForm value={fields} onChange={setFields} />
      {dirty && (
        <div className="flex items-center gap-3">
          <Button disabled={saving || Boolean(why)} onClick={save}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            Save changes
          </Button>
          <Button variant="ghost" onClick={() => setFields(fieldsOf(row))}>
            Discard
          </Button>
          {why && <span className="text-small text-muted-foreground">{why}</span>}
        </div>
      )}

      <div>
        <div className="mb-1.5 text-small font-medium text-muted-foreground">Fired</div>
        {row.fires.length === 0 ? (
          <div className="text-body text-muted-foreground">Not yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {row.fires.map((fire) => (
              <li key={`${fire.at}-${fire.messageId}`} className="flex gap-3 text-body">
                <span className="w-[86px] shrink-0 text-muted-foreground">{ago(fire.at)}</span>
                <button onClick={() => open(fire.threadId)} className="min-w-0 flex-1 truncate text-left text-foreground hover:underline hover:underline-offset-2">
                  {fire.excerpt}
                </button>
                {fire.error && <span className="shrink-0 text-warning" title={fire.error}>Did not go through</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void remove()}>
          <Trash2 size={13} /> {row.status === "proposed" ? "Decline" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

export function IntentsTab() {
  const { state } = useStore();
  const [rows, setRows] = useState<IntentRow[] | null>(null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const load = useCallback(() => {
    api("/api/intents")
      .then((r) => setRows(r.intents ?? []))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load, state.ticks.intents]);
  // proposals first: they are the ones waiting on the person
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => Number(b.status === "proposed") - Number(a.status === "proposed") || b.createdAt - a.createdAt), [rows]);
  const current = sorted.find((r) => r.id === selected) ?? null;
  const showing = selected === "new" || (!current && rows?.length === 0) ? "new" : (current ?? sorted[0] ?? null);
  const folded = useColumnFolded(AUTOMATIONS_LIST, AUTOMATIONS_LIST_SIZE);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <SideColumn id={AUTOMATIONS_LIST} size={AUTOMATIONS_LIST_SIZE} label="Intents" className="max-h-[200px] w-full border-b md:max-h-none md:border-b-0">
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="text-small font-medium text-muted-foreground">Intents</span>
          <button onClick={() => setSelected("new")} className="rounded-lg px-1.5 py-1 text-small text-muted-foreground hover:bg-accent hover:text-foreground">
            + New
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sorted.map((row) => {
            const target = row.action.botId ? state.bots.find((b) => b.id === row.action.botId) : undefined;
            const active = showing !== "new" && showing?.id === row.id;
            const status =
              row.state === "proposed"
                ? "Needs your approval"
                : row.state === "paused"
                  ? "Paused"
                  : row.state === "expired"
                    ? "Expired"
                    : row.fires[0]
                      ? `Fired ${ago(row.fires[0].at)}`
                      : "Listening";
            return (
              <button
                key={row.id}
                onClick={() => setSelected(row.id)}
                className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors", active ? "bg-accent" : "hover:bg-accent/60")}
              >
                {target ? (
                  <AgentAvatar bot={target} size={26} />
                ) : (
                  <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Zap size={13} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-foreground">{row.name}</span>
                  <span className={cn("block truncate text-caption", row.state === "proposed" || row.state === "expired" ? "text-warning" : "text-muted-foreground")}>
                    {status}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SideColumn>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {/* the list folded away: the way back to it, named for what it lists */}
        {folded && <ShowColumn id={AUTOMATIONS_LIST} text="Intents" label="Show the list" className="-ml-2 -mt-2 mb-3" />}
        {rows === null ? null : showing === "new" ? (
          <Draft
            onMade={(id) => {
              setSelected(id);
              load();
            }}
          />
        ) : showing ? (
          <Detail key={showing.id} row={showing} onChanged={load} />
        ) : null}
      </div>
    </div>
  );
}
