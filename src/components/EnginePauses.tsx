// Pauses: an engine, a kind of engine, a family of models or one model,
// held for a while (server/engine-pauses.ts).
//
// Nothing about any agent's engine changes, so there is nothing to put
// back. While a pause holds, an agent on that engine uses its backup if
// the backup may go; otherwise what is said to it waits, and goes on its
// own when the pause ends. A pause always has an end, a week at most.
//
// A server too old to know pauses answers the list with an error, and
// then this card is not shown at all.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { stamp } from "@/lib/when";

type What = { family?: string; driver?: string; instanceId?: string; model?: string };

interface PauseRow {
  id: string;
  what: What;
  label: string;
  agents: "all" | string[];
  agentNames?: string[];
  until: number;
  by: string;
  byName?: string;
  note?: string;
  running?: number;
}

interface PausesState {
  pauses: PauseRow[];
  choices: Array<{ what: What; label: string; group: string }>;
  fault: string | null;
}

/** How long, offered. A week is the most a pause may last. */
const LENGTHS: Array<[minutes: number, label: string]> = [
  [30, "30 minutes"],
  [60, "1 hour"],
  [120, "2 hours"],
  [240, "4 hours"],
  [480, "8 hours"],
  [24 * 60, "1 day"],
  [3 * 24 * 60, "3 days"],
  [7 * 24 * 60, "1 week"],
];

const key = (what: What) => JSON.stringify([what.family, what.driver, what.instanceId, what.model]);

export function EnginePauses() {
  const { state } = useStore();
  const [data, setData] = useState<PausesState | null>(null);
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState("");
  const [everyone, setEveryone] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(120);
  const [note, setNote] = useState("");
  const [stopRunning, setStopRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(() => {
    api("/api/engine-pauses")
      .then((body) => setData({ pauses: body.pauses ?? [], choices: body.choices ?? [], fault: body.fault ?? null }))
      .catch(() => setData(null));
  }, []);
  useEffect(load, [load, state.ticks.enginePauses]);

  const agents = useMemo(() => state.bots.filter((b) => !b.archivedAt && !b.hidden), [state.bots]);
  const groups = useMemo(() => {
    const out = new Map<string, Array<{ what: What; label: string }>>();
    for (const c of data?.choices ?? []) out.set(c.group, [...(out.get(c.group) ?? []), c]);
    return [...out];
  }, [data]);

  if (!data) return null;

  const picked = data.choices.find((c) => key(c.what) === choice);
  const add = () => {
    if (busy || !picked || (!everyone && !chosen.length)) return;
    setBusy(true);
    setError(null);
    setSaid(null);
    api("/api/engine-pauses", {
      method: "POST",
      body: JSON.stringify({
        what: picked.what,
        agents: everyone ? "all" : chosen,
        minutes,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(stopRunning ? { stopRunning: true } : {}),
      }),
    })
      .then((body: { running: number; stopped: number }) => {
        setAdding(false);
        setChoice("");
        setNote("");
        setStopRunning(false);
        setChosen([]);
        setEveryone(true);
        // what happens to work already under way is the one thing a
        // pause does not decide on its own, so it is said
        if (body.stopped) setSaid(`Paused. Stopped ${body.stopped} running ${body.stopped === 1 ? "task" : "tasks"}.`);
        else if (body.running) setSaid(`Paused. ${body.running} running ${body.running === 1 ? "task finishes" : "tasks finish"} first.`);
        load();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const end = (id: string) => {
    setError(null);
    setSaid(null);
    void api(`/api/engine-pauses/${id}`, { method: "DELETE" })
      .then(load)
      .catch((e: Error) => {
        setError(e.message);
        load();
      });
  };

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-ui font-semibold text-foreground">Pauses</div>
            <div className="mt-0.5 text-body leading-relaxed text-muted-foreground">
              Pause an engine or model for a while. Agents use their backup, or wait until it ends.
            </div>
          </div>
          {!adding && (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)} className="shrink-0">
              <Pause size={13} />
              Pause
            </Button>
          )}
        </div>
      </div>

      {data.fault && (
        <div className="border-t bg-warning/5 px-4 py-2.5 text-small leading-relaxed text-warning">{data.fault}</div>
      )}

      {data.pauses.map((p) => (
        <div key={p.id} className="flex items-start gap-3 border-t px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-ui font-medium text-foreground">{p.label}</div>
            <div className="mt-0.5 text-small leading-relaxed text-muted-foreground">
              {p.agents === "all" ? "Every agent" : (p.agentNames ?? p.agents).join(", ")}, until {stamp(p.until)}
              {p.byName ? ` · ${p.byName} paused itself` : ""}
              {p.running ? ` · ${p.running} running ${p.running === 1 ? "task finishes" : "tasks finish"} first` : ""}
            </div>
            {p.note && <div className="mt-0.5 text-small text-muted-foreground">{p.note}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => end(p.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
            End now
          </Button>
        </div>
      ))}

      {data.pauses.length === 0 && !adding && (
        <div className="border-t px-4 py-3 text-body text-muted-foreground">Nothing is paused.</div>
      )}

      {adding && (
        <div className="flex flex-col gap-2.5 border-t px-4 py-3 text-body">
          <label className="flex items-center justify-between gap-3 text-muted-foreground">
            <span>What</span>
            <select
              autoFocus
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="min-w-0 max-w-[70%] rounded-md border bg-background px-2 py-1 text-body text-foreground"
            >
              <option value="">Choose an engine or a model</option>
              {groups.map(([group, rows]) => (
                <optgroup key={group} label={group}>
                  {rows.map((c) => (
                    <option key={key(c.what)} value={key(c.what)}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-muted-foreground">
            <span>For</span>
            <select
              value={everyone ? "all" : "some"}
              onChange={(e) => setEveryone(e.target.value === "all")}
              className="rounded-md border bg-background px-2 py-1 text-body text-foreground"
            >
              <option value="all">Every agent</option>
              <option value="some">Agents I choose</option>
            </select>
          </label>
          {!everyone && (
            <div className="flex flex-wrap gap-1.5">
              {agents.map((b) => {
                const on = chosen.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setChosen(on ? chosen.filter((id) => id !== b.id) : [...chosen, b.id])}
                    className={
                      on
                        ? "rounded-full border border-brand/50 bg-brand/10 px-2.5 py-0.5 text-small text-foreground"
                        : "rounded-full border px-2.5 py-0.5 text-small text-muted-foreground hover:text-foreground"
                    }
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          )}
          <label className="flex items-center justify-between gap-3 text-muted-foreground">
            <span>How long</span>
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1 text-body text-foreground"
            >
              {LENGTHS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Why (optional)"
            className="h-8 text-body"
          />
          <label className="flex items-center justify-between gap-3 text-muted-foreground">
            <span>Also stop what's running now</span>
            <Switch checked={stopRunning} onCheckedChange={setStopRunning} aria-label="Also stop what's running now" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={add} disabled={busy || !picked || (!everyone && !chosen.length)}>
              Pause until {stamp(Date.now() + minutes * 60_000)}
            </Button>
          </div>
        </div>
      )}

      {(error || said) && (
        <div className={error ? "border-t px-4 py-2.5 text-small text-destructive" : "border-t px-4 py-2.5 text-small text-muted-foreground"}>
          {error ?? said}
        </div>
      )}
    </div>
  );
}
