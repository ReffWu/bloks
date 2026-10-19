// Where an interface answer is being read, for the parts of it that act.
//
// A reply's markdown is drawn the same way wherever it appears, and most
// of those places are not a conversation: a forwarded quote, a preview.
// Only a conversation can take a click as words to an agent, so the chat
// and the room say where they are with GenUiHost, and an answer drawn
// anywhere else simply has buttons that do nothing but open links.
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import type { GenUiLabels, GenUiTarget } from "@/lib/genui/actions";

const HostContext = createContext<GenUiTarget | null>(null);

export function GenUiHost({ target, children }: { target: GenUiTarget; children: ReactNode }) {
  // A fresh object each render would redraw every answer under it.
  const key = target.kind === "chat" ? `c:${target.botId}` : `r:${target.roomId}:${target.agentName ?? ""}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => target, [key]);
  return <HostContext.Provider value={stable}>{children}</HostContext.Provider>;
}

export function useGenUiTarget(): GenUiTarget | null {
  return useContext(HostContext);
}

// ── what the person saw a field called ──
//
// A form's answers go back as the person's own message, so they should
// read the way the form did: "Party size: Four", not "people: 4". Fields
// and options say their labels here as they draw; the answer is written
// from it.

export interface LabelBook extends GenUiLabels {
  setField(name: string, label: string): void;
  setOption(name: string, value: string, label: string): void;
}

const LabelContext = createContext<LabelBook | null>(null);

export function useLabelBook(): LabelBook {
  const book = useRef<LabelBook | null>(null);
  if (!book.current) {
    const fields = new Map<string, string>();
    const options = new Map<string, string>();
    const seen = new Map<string, number>();
    book.current = {
      setField(name, label) {
        fields.set(name, label);
        if (!seen.has(name)) seen.set(name, seen.size);
      },
      setOption(name, value, label) {
        options.set(`${name}\u0000${value}`, label);
      },
      field: (name) => fields.get(name),
      option: (name, value) => options.get(`${name}\u0000${value}`),
      order: (name) => seen.get(name) ?? Number.MAX_SAFE_INTEGER,
    };
  }
  return book.current;
}

export const LabelProvider = LabelContext.Provider;

export function useLabels(): LabelBook | null {
  return useContext(LabelContext);
}
