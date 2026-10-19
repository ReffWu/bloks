// What the person keeps approving, offered as a rule (server/rule-suggestions.ts).
//
// The server reads the habit and decides what may be offered; this only
// fetches the list, keeps it current when the server says it moved, and
// sends the person's answer. Each place that shows one (an agent's tray,
// Settings) asks for its own copy, which is a small list on a local
// server and not worth a store of its own.
import { useCallback, useEffect, useState } from "react";
import { api, useStore } from "@/state/store";

export interface RuleSuggestion {
  id: string;
  tool: string;
  rule: { effect: "allow"; field: string; op: string; value: string; tool: string };
  /** "run `pnpm test`", to follow "always allow it to". */
  what: string;
  count: number;
  agents: Array<{ botId: string; name: string; count: number }>;
  forAgent: { botId: string; name: string; count: number } | null;
  forEveryone: boolean;
  title: string;
  lastAt: number;
}

export function useRuleSuggestions() {
  const { state } = useStore();
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  const tick = state.ticks.suggestions ?? 0;
  const load = useCallback(() => {
    let live = true;
    api("/api/rules/suggestions")
      .then((r: { suggestions?: RuleSuggestion[] }) => live && setSuggestions(r.suggestions ?? []))
      .catch(() => live && setSuggestions([]));
    return () => {
      live = false;
    };
  }, []);
  useEffect(load, [load, tick]);
  // Gone from the screen at once, as a card does when it is answered;
  // the server's own frame brings the list back into line after.
  const settle = (id: string) => setSuggestions((cur) => cur.filter((s) => s.id !== id));
  const accept = (id: string, scope: "agent" | "everyone") => {
    settle(id);
    return api(`/api/rules/suggestions/${id}/accept`, { method: "POST", body: JSON.stringify({ scope }) }).catch((e: Error) => {
      load();
      throw e;
    });
  };
  const dismiss = (id: string) => {
    settle(id);
    return api(`/api/rules/suggestions/${id}/dismiss`, { method: "POST" }).catch(() => load());
  };
  return { suggestions, accept, dismiss };
}

/** The suggestions that belong in one agent's conversation: those it
 * asked for, either on its own or as one of several. */
export function suggestionsFor(list: RuleSuggestion[], botId: string): RuleSuggestion[] {
  return list.filter((s) => s.forAgent?.botId === botId || (s.forEveryone && s.agents.some((a) => a.botId === botId)));
}

/** "run `pnpm test`" as words and code, first letter up. */
export function whatParts(what: string): Array<{ code: boolean; text: string }> {
  const parts = what.split(/(`[^`]+`)/).filter(Boolean).map((part) =>
    part.startsWith("`") && part.endsWith("`") ? { code: true, text: part.slice(1, -1) } : { code: false, text: part },
  );
  if (parts[0] && !parts[0].code) parts[0] = { code: false, text: parts[0].text.charAt(0).toUpperCase() + parts[0].text.slice(1) };
  return parts;
}
