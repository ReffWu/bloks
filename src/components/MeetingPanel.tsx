// Meeting notes (server/meetings.ts): an agent listens in, on this Mac,
// and writes it up when you stop.
//
// While it listens the panel shows what is being heard, you and, when
// asked, the other side of the call; nothing is recorded, only text. When
// you stop, the agent writes a summary, the decisions and the action
// items in its Meetings lane, and an item that belongs to one of your
// agents can be handed to it from here with one press.
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines } from "@/components/icons";
import { CircleStop } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Send } from "@/components/icons";
import { X } from "@/components/icons";
import { api, useStore, type Bot } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

interface Item {
  owner: string;
  botId?: string;
  text: string;
  sentAt?: number;
}
interface MeetingRow {
  id: string;
  botId: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  laneId?: string;
  items?: Item[];
  heard: number;
}
interface Line {
  who: "you" | "them";
  text: string;
}

const NOTICE: Record<string, string> = {
  "system-sound-unavailable": "Can't hear the other side. Allow Bloks under Screen Recording in System Settings. Your side is still being transcribed.",
  "system-sound-needs-macos-13": "Hearing the other side needs macOS 13 or later. Your side is still being transcribed.",
  "system-sound-stopped": "Lost the other side of the call.",
};
const ERROR: Record<string, string> = {
  "speech-not-authorized": "Bloks can't use speech recognition. Allow it in System Settings, Privacy and Security, Speech Recognition.",
  "recognizer-unavailable": "Speech recognition isn't available right now.",
  "mic-failed": "Couldn't open the microphone. Allow Bloks under Microphone in System Settings.",
};

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Items({ meeting, onChanged }: { meeting: MeetingRow; onChanged: () => void }) {
  const { state } = useStore();
  const [error, setError] = useState<string | null>(null);
  if (!meeting.items?.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {meeting.items.map((item, i) => {
        const agent = item.botId ? state.bots.find((b) => b.id === item.botId) : undefined;
        return (
          <div key={i} className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-body">
            <span className="shrink-0 font-medium text-foreground">{item.owner}</span>
            <span className="min-w-0 flex-1 text-muted-foreground">{item.text}</span>
            {agent &&
              (item.sentAt ? (
                <span className="shrink-0 text-small text-muted-foreground">Handed over</span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    api(`/api/meetings/${meeting.id}/items/${i}/send`, { method: "POST" })
                      .then(onChanged)
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  <Send size={12} /> Hand to {agent.name}
                </Button>
              ))}
          </div>
        );
      })}
      {error && <div className="text-small text-destructive">{error}</div>}
    </div>
  );
}

export function MeetingPanel({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const bridge = window.bloks;
  const available = Boolean(bridge?.meetingStart) && !state.config?.hosted?.on;
  const [title, setTitle] = useState("");
  const [system, setSystem] = useState(true);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState<Line | null>(null);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [past, setPast] = useState<MeetingRow[]>([]);
  const pending = useRef<Array<{ at: number; who: "you" | "them"; text: string }>>([]);
  const close = () => dispatch({ type: "openMeeting", botId: null });

  const load = useCallback(() => {
    api("/api/meetings")
      .then((r) => setPast((r.meetings ?? []).filter((m: MeetingRow) => m.botId === bot.id)))
      .catch(() => {});
  }, [bot.id]);
  useEffect(load, [load, state.ticks.meetings]);

  const flush = useCallback(async (id: string) => {
    const batch = pending.current.splice(0);
    if (batch.length) await api(`/api/meetings/${id}/segments`, { method: "POST", body: JSON.stringify({ segments: batch }) });
  }, []);

  // what the helper hears, while a meeting runs
  useEffect(() => {
    if (!meetingId || !bridge?.onMeetingLine) return;
    const offLine = bridge.onMeetingLine((line) => {
      if (typeof line.level === "number") setLevel(line.level);
      if (line.notice) setNotice(NOTICE[line.notice] ?? null);
      if (line.error) setError(ERROR[line.error] ?? line.error);
      if (line.partial && line.text && line.who) setPartial({ who: line.who, text: line.text });
      if (line.segment && line.who) {
        pending.current.push({ at: Date.now(), who: line.who, text: line.segment });
        setLines((prev) => [...prev, { who: line.who!, text: line.segment! }].slice(-200));
        setPartial((p) => (p?.who === line.who ? null : p));
      }
    });
    const offEnd = bridge.onMeetingEnd?.(() => setLevel(0));
    const timer = setInterval(() => {
      setNow(Date.now());
      void flush(meetingId).catch(() => {});
    }, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      offLine();
      offEnd?.();
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [meetingId, bridge, flush]);

  const start = () => {
    setError(null);
    setNotice(null);
    setLines([]);
    api("/api/meetings", { method: "POST", body: JSON.stringify({ botId: bot.id, title, system }) })
      .then(async (r) => {
        setMeetingId(r.meeting.id);
        setStartedAt(Date.now());
        await bridge?.meetingStart?.({ system });
      })
      .catch((e: Error) => setError(e.message));
  };

  const stop = async () => {
    if (!meetingId) return;
    setStopping(true);
    await bridge?.meetingStop?.();
    // the helper finishes its last sentence before it exits
    await new Promise((r) => setTimeout(r, 1800));
    try {
      await flush(meetingId);
      const r = await api(`/api/meetings/${meetingId}/end`, { method: "POST" });
      setMeetingId(null);
      setPartial(null);
      load();
      if (r.laneId) {
        dispatch({ type: "selectTask", botId: bot.id, taskId: r.laneId });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopping(false);
    }
  };

  const recording = Boolean(meetingId);

  return (
    <div className="absolute inset-0 z-20 flex animate-fade-in items-center justify-center bg-black/40 dark:bg-black/60" onClick={recording ? undefined : close}>
      <div
        className="flex max-h-[84%] w-[640px] max-w-[94vw] animate-pop-in flex-col overflow-hidden rounded-2xl border bg-popover shadow-2xl shadow-(color:--shadow-color)"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Meeting notes"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-title font-semibold text-foreground">
              <AudioLines size={17} className="text-muted-foreground" /> Meeting notes
            </div>
            <div className="mt-0.5 text-body text-muted-foreground">
              {bot.name} listens on this Mac and writes notes when you stop. No audio is saved.
            </div>
          </div>
          {!recording && (
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
              <X size={16} />
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!available ? (
            <div className="px-4 py-10 text-center text-body text-muted-foreground">
              Meeting notes need the Bloks app on a Mac.
            </div>
          ) : recording ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
                </span>
                <span className="font-mono text-body tabular-nums text-foreground">{clock(now - startedAt)}</span>
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-success transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
              </div>
              {notice && <div className="rounded-lg bg-warning/10 px-3 py-2 text-body text-warning">{notice}</div>}
              <div className="flex max-h-[320px] min-h-[120px] flex-col gap-1.5 overflow-y-auto rounded-xl border bg-muted/30 p-3 text-body leading-relaxed">
                {lines.length === 0 && !partial && <span className="text-muted-foreground">Listening. Words appear here as you talk.</span>}
                {lines.map((line, i) => (
                  <div key={i}>
                    <span className={cn("mr-1.5 font-medium", line.who === "you" ? "text-foreground" : "text-brand-ink")}>
                      {line.who === "you" ? "You" : "Them"}
                    </span>
                    <span className="text-foreground">{line.text}</span>
                  </div>
                ))}
                {partial && (
                  <div className="text-muted-foreground">
                    <span className="mr-1.5 font-medium">{partial.who === "you" ? "You" : "Them"}</span>
                    {partial.text}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting name (optional)" className="text-body" />
              <label className="flex items-center justify-between gap-3 text-body text-foreground">
                <span>
                  Hear the other side too
                  <span className="block text-small text-muted-foreground">
                    From Zoom, Meet and other apps. Needs Screen Recording permission.
                  </span>
                </span>
                <Switch checked={system} onCheckedChange={setSystem} aria-label="Hear the call" />
              </label>
              {past.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1.5 text-small font-medium text-muted-foreground">Earlier</div>
                  <div className="flex flex-col gap-3">
                    {past.slice(0, 5).map((m) => (
                      <div key={m.id} className="rounded-xl border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate text-body font-medium text-foreground">{m.title || "A meeting"}</div>
                          <div className="shrink-0 text-small text-muted-foreground">
                            {new Date(m.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </div>
                        </div>
                        {m.laneId && !m.items && (
                          <div className="mt-1 flex items-center gap-1.5 text-small text-muted-foreground">
                            <Loader2 size={12} className="animate-spin" /> Writing the notes
                          </div>
                        )}
                        <Items meeting={m} onChanged={load} />
                        {m.laneId && (
                          <button
                            onClick={() => {
                              dispatch({ type: "selectTask", botId: bot.id, taskId: m.laneId! });
                              close();
                            }}
                            className="mt-2 text-small text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          >
                            Read the notes
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-body text-destructive">{error}</div>}
        </div>

        {available && (
          <div className="flex justify-end border-t px-5 py-3">
            {recording ? (
              <Button variant="destructive" disabled={stopping} onClick={() => void stop()}>
                {stopping ? <Loader2 size={14} className="animate-spin" /> : <CircleStop size={14} />} Stop and write it up
              </Button>
            ) : (
              <Button onClick={start}>
                <AudioLines size={14} /> Start listening
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
