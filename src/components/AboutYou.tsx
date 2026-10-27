// What your agents know about you (server/profile-notes.ts), as the pieces
// the Memory place's About you page lays out (MemoryPlace.tsx).
//
// Suggestions first, because they are the part waiting on you: keep one
// as it is, change the words and keep it, or let it go. Then what every
// agent has been told, each note removable, with a line to add your own;
// and the paragraph in your own words, which is the same field Settings
// shows under About you, saved to the same place.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "@/components/icons";
import { Pencil } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { X } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

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

/** One suggestion, as a card with the three things it can become. */
export function Suggestion({ note, onDone }: { note: ProfileNote; onDone: () => void }) {
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
    <div className="flex min-w-0 flex-col rounded-2xl border border-warning/30 bg-warning/[0.06] p-4">
      {editing ? (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), keep());
            if (e.key === "Escape") (e.preventDefault(), setEditing(false), setText(note.text));
          }}
          className="min-h-[64px] resize-none bg-card text-ui leading-relaxed"
          aria-label={t("aboutYou.theNoteInYourWords")}
          autoFocus
        />
      ) : (
        <p className="text-pretty text-lead leading-relaxed text-foreground">{note.text}</p>
      )}
      <p className="mt-1.5 text-body text-muted-foreground">{t("aboutYou.suggestedBy", { name: note.by.name })}</p>
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <Button size="sm" disabled={busy || text.trim().length < 3} onClick={keep}>
          <Check size={13} /> {editing ? t("aboutYou.keepThis") : t("common.keep")}
        </Button>
        {!editing && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>
            <Pencil size={12} /> {t("common.edit")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => act(api(`/api/profile/notes/${note.id}`, { method: "DELETE" }))}
        >
          <X size={13} /> {t("common.dismiss")}
        </Button>
      </div>
    </div>
  );
}

/** What every agent is told, a removable row each, and a line to add one. */
export function KeptNotes({ notes, reload }: { notes: ProfileNote[] | null; reload: () => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    <div className="overflow-hidden rounded-2xl border bg-card">
      {notes !== null && kept.length === 0 ? (
        <p className="px-5 py-6 text-ui text-muted-foreground">
          {t("aboutYou.nothingYetAddANote")}
        </p>
      ) : (
        <ul className="divide-y">
          {kept.map((note) => (
            <li key={note.id} className="group flex items-start gap-3 px-5 py-3.5">
              <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
              <div className="min-w-0 flex-1">
                <div className="text-pretty text-ui leading-relaxed text-foreground">{note.text}</div>
                <div className="mt-0.5 text-small text-muted-foreground">
                  {note.by.id === "you" ? t("aboutYou.youWroteThis") : t("aboutYou.fromName", { name: note.by.name })}
                </div>
              </div>
              <button
                aria-label={t("aboutYou.removeNote", { note: note.text })}
                title={t("common.remove")}
                onClick={() => api(`/api/profile/notes/${note.id}`, { method: "DELETE" }).then(reload).catch(() => {})}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 outline-none transition-[opacity,background-color,color] duration-150 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
                )}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2.5">
        <Plus size={15} className="ml-2 shrink-0 text-muted-foreground" />
        <input
          value={draft}
          placeholder={t("aboutYou.addANoteLikeI")}
          aria-label={t("aboutYou.addANoteAboutYou")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="min-w-0 flex-1 bg-transparent py-1 text-ui text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Button size="sm" variant="secondary" disabled={draft.trim().length < 3} onClick={add}>
          {t("common.add")}
        </Button>
      </div>
      {error && <div className="border-t px-5 py-2 text-body text-destructive">{error}</div>}
    </div>
  );
}

/**
 * The paragraph you write about yourself: `profile.about` in the config,
 * the same field Settings shows under About you, so either place edits
 * the one value. Saved a moment after typing stops, like Settings does.
 */
export function AboutText() {
  const { state, dispatch } = useStore();
  const saved = state.config?.profile?.about ?? "";
  const [value, setValue] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  // adopt the server value once it arrives, without stomping an edit
  useEffect(() => {
    if (hydrated.current || !state.config) return;
    hydrated.current = true;
    setValue(saved);
  }, [state.config, saved]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const save = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api("/api/config", { method: "PUT", body: JSON.stringify({ profile: { about: next } }) })
        .then((status) => {
          dispatch({ type: "configStatus", config: status });
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 1600);
        })
        .catch(() => {});
    }, 600);
  };

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <textarea
        value={value}
        onChange={(e) => save(e.target.value)}
        aria-label={t("aboutYou.aboutYouInYourOwn")}
        placeholder={t("aboutYou.imAFounderBuildingA")}
        className="block [field-sizing:content] min-h-[132px] w-full resize-none bg-transparent px-5 py-4 text-ui leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-2.5 text-body text-muted-foreground">
        <span>{t("aboutYou.everyAgentReadsThisPeople")}</span>
        <span
          className={cn("flex shrink-0 items-center gap-1 text-success transition-opacity duration-200", justSaved ? "opacity-100" : "opacity-0")}
          aria-live="polite"
        >
          <Check size={12} /> {t("common.saved")}
        </span>
      </div>
    </div>
  );
}
