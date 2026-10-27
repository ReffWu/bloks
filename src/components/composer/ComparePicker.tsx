// Who else tries the same rehearsal: one quiet button in the rehearse
// line, and a small list behind it.
//
// It used to be a chip per agent, which reads well with five agents and
// turns into a wall with twenty. One button says what is chosen; the list
// it opens can be searched once it is long. The server takes up to three
// agents at a time (this one and two more, server/index.ts, the
// rehearsals route), so a third pick waits for one to be taken off rather
// than failing at send.
import { useMemo, useRef, useState } from "react";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { Search } from "@/components/icons";
import type { Bot } from "@/state/store";
import { AgentAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { useDismiss } from "./Shell";
import { t } from "@/lib/i18n";

/** Others an agent can be compared with in one rehearsal. */
export const MAX_COMPARE = 2;
/** Lists this long or shorter are read, not searched. */
const SEARCH_ABOVE = 6;

export function ComparePicker({
  others,
  chosen,
  onChange,
}: {
  others: Bot[];
  chosen: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const close = () => {
    setOpen(false);
    setWords("");
  };
  const ref = useDismiss(open, close);

  const picked = chosen.map((id) => others.find((b) => b.id === id)).filter((b): b is Bot => Boolean(b));
  const full = chosen.length >= MAX_COMPARE;
  const shown = useMemo(() => {
    const q = words.trim().toLowerCase();
    if (!q) return others;
    return others.filter((b) => `${b.name} ${b.title ?? ""}`.toLowerCase().includes(q));
  }, [others, words]);

  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((c) => c !== id) : full ? chosen : [...chosen, id]);

  // at most two (MAX_COMPARE), said as a pair
  const label =
    picked.length > 1
      ? t("comparePicker.pair", { a: picked[0].name, b: picked[1].name })
      : picked.length
        ? picked[0].name
        : t("comparePicker.compareWith");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : (setOpen(true), requestAnimationFrame(() => search.current?.focus())))}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-small transition-[background-color,color,border-color,transform] duration-150 ease-out active:scale-[0.97]",
          picked.length
            ? "border-brand/40 bg-brand-soft text-brand-ink"
            : "text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
        )}
      >
        {picked.length > 0 && (
          <span className="flex -space-x-1.5">
            {picked.map((b) => (
              <span key={b.id} className="rounded-md ring-2 ring-brand-soft">
                <AgentAvatar bot={b} size={16} />
              </span>
            ))}
          </span>
        )}
        <span className="max-w-[220px] truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0 opacity-70" />
      </button>

      {open && (
        // opens upward: the composer sits at the foot of the window, and
        // the conversation above it has the room
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 origin-bottom-left animate-pop-in rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg shadow-(color:--shadow-color)">
          {others.length > SEARCH_ABOVE && (
            <label className="mb-1 flex h-8 items-center gap-2 rounded-lg bg-muted px-2.5">
              <Search size={14} className="shrink-0 text-muted-foreground" />
              <input
                ref={search}
                value={words}
                onChange={(e) => setWords(e.target.value)}
                placeholder={t("comparePicker.searchAgents")}
                aria-label={t("comparePicker.searchAgents")}
                className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          )}
          <ul role="listbox" aria-multiselectable="true" aria-label={t("comparePicker.compareWith")} className="max-h-64 overflow-y-auto">
            {shown.map((b) => {
              const on = chosen.includes(b.id);
              const locked = full && !on;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={locked}
                    onClick={() => toggle(b.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-accent disabled:opacity-45 disabled:hover:bg-transparent"
                  >
                    <AgentAvatar bot={b} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-foreground">{b.name}</span>
                      {b.title && <span className="block truncate text-small text-muted-foreground">{b.title}</span>}
                    </span>
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150",
                        on ? "border-brand-ink bg-brand-ink text-brand-foreground" : "border-input",
                      )}
                    >
                      {on && <Check size={11} strokeWidth={2.5} />}
                    </span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-2 py-3 text-center text-small text-muted-foreground">{t("comparePicker.noAgentCalledThat")}</li>}
          </ul>
          <div className="mt-1 flex items-center justify-between border-t px-2 pt-1.5 text-small text-muted-foreground">
            <span>{full ? t("comparePicker.thatsTheMostAtOnce") : t("comparePicker.pickUpToTwo")}</span>
            {chosen.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="rounded-md px-1.5 py-0.5 transition-colors duration-150 hover:bg-accent hover:text-foreground">
                {t("common.clear")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
