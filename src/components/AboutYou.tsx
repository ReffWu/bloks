// What your agents know about you (server/profile-notes.ts).
//
// Suggestions first, because they are the part waiting on you: keep one
// as it is, change the words and keep it, or let it go. Below, what every
// agent has been told, each note removable, and a line to add your own.
import { useCallback, useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { Pencil } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { X } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export interface ProfileNote {
  id: string;
  text: string;
  state: "suggested" | "kept";
  by: { id: string; name: string };
  at: number;
  keptAt?: number;
}

/** The notes, re-read whenever the server says they changed. */
export function useProfileNotes() {
  const { state } = useStore();
  const [notes, setNotes] = useState<ProfileNote[] | null>(null);
  const reload = useCallback(() => {
    api("/api/profile/notes")
      .then((r) => setNotes(r.notes ?? []))
      .catch(() => setNotes([]));
  }, []);
  useEffect(reload, [reload, state.ticks.profile]);
  return { notes, reload };
}

function Suggestion({ note, onDone }: { note: ProfileNote; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [busy, setBusy] = useState(false);
  const act = (call: Promise<unknown>) => {
    setBusy(true);
    call.then(onDone).catch(() => {}).finally(() => setBusy(false));
  };
  const keep = () =>
    act(api(`/api/profile/notes/${note.id}/keep`, { method: "POST", body: JSON.stringify(editing ? { text } : {}) }));
  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft/30 p-3">
      {editing ? (
        <Input value={text} onChange={(e) => setText(e.target.value)} className="text-[13px]" autoFocus />
      ) : (
        <div className="text-[13.5px] text-foreground">{note.text}</div>
      )}
      <div className="mt-1 text-[11.5px] text-muted-foreground">Suggested by {note.by.name}</div>
      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" disabled={busy || text.trim().length < 3} onClick={keep}>
          <Check size={13} /> Keep
        </Button>
        {!editing && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>
            <Pencil size={12} /> Change it
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => act(api(`/api/profile/notes/${note.id}`, { method: "DELETE" }))}
        >
          <X size={13} /> Dismiss
        </Button>
      </div>
    </div>
  );
}

export function AboutYou() {
  const { notes, reload } = useProfileNotes();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const suggested = (notes ?? []).filter((n) => n.state === "suggested");
  const kept = (notes ?? []).filter((n) => n.state === "kept").sort((a, b) => (a.keptAt ?? a.at) - (b.keptAt ?? b.at));

  const add = () => {
    if (draft.trim().length < 3) return;
    setError(null);
    api("/api/profile/notes", { method: "POST", body: JSON.stringify({ text: draft }) })
      .then(() => {
        setDraft("");
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Short notes every agent is told about you. Agents suggest them as they learn; nothing is added until you keep
        it. They are never shared with people you invite into a room.
      </p>

      {suggested.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            Suggested ({suggested.length})
          </h3>
          {suggested.map((note) => (
            <Suggestion key={note.id} note={note} onDone={reload} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">What agents know</h3>
        {notes === null ? null : kept.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
            Nothing yet. Add a note below, or keep one your agents suggest.
          </div>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {kept.map((note) => (
              <li key={note.id} className="group flex items-start gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] text-foreground">{note.text}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {note.by.id === "you" ? "You wrote this" : `From ${note.by.name}`}
                  </div>
                </div>
                <button
                  aria-label={`Remove "${note.text}"`}
                  onClick={() => api(`/api/profile/notes/${note.id}`, { method: "DELETE" }).then(reload).catch(() => {})}
                  className={cn(
                    "rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
                  )}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            value={draft}
            placeholder="Add one, like: I prefer short answers with bullet points"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="text-[13px]"
          />
          <Button variant="secondary" disabled={draft.trim().length < 3} onClick={add}>
            <Plus size={14} /> Add
          </Button>
        </div>
        {error && <div className="text-[12px] text-destructive">{error}</div>}
      </section>
    </div>
  );
}
