// Search: everything, one field away, from the sidebar's search button or
// ⌘K.
//
// Empty, it is a switcher: the chats you were most recently in, each a
// Ctrl+number away, then the few things the app can be told to do and the
// settings people reach for most. Typing filters the agents and rooms by
// name (prefix matches first) and, after a short debounce, searches every
// transcript on the server, best match first (ranked as an agent's own
// recall is); a message hit jumps to the exact conversation and lane it
// lives in. One flat keyboard cursor runs across all sections, because
// reaching for arrow keys should never care about headings.
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot as BotIcon } from "@/components/icons";
import { Keyboard } from "@/components/icons";
import { MessageSquare } from "@/components/icons";
import { Settings2 as SettingsIcon } from "@/components/icons";
import { SquarePen } from "@/components/icons";
import { Users } from "@/components/icons";
import { api, useStore, type Action, type Blok, type Bot } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { SETTINGS_PAGES } from "./AppSettingsPanel";
import { keysFor, platformOf } from "@/lib/shortcuts";
import { cn } from "@/lib/cn";

interface MessageHit {
  threadId: string;
  messageId: string;
  at: number;
  snippet: string;
  botId?: string;
  blokId?: string;
  name: string;
  task?: string;
}

const OPEN_EVENT = "bloks:search";

/** Opens the search window from anywhere: the sidebar's button, a menu. */
export function openSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Things to do rather than places to go. `id` is the command's line in
 * the shortcuts list, when it has a key. */
const COMMANDS: ReadonlyArray<{
  id: string;
  label: string;
  /** Words people search for that the label does not say. */
  keywords: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  action: Action;
}> = [
  { id: "newAgent", label: "New agent", keywords: "create add hire bot chat", icon: SquarePen, action: { type: "toggleNewAgent", open: true } },
  { id: "newRoom", label: "New room", keywords: "create add group team", icon: Users, action: { type: "toggleNewRoom", open: true } },
  { id: "settings", label: "Settings", keywords: "preferences options", icon: SettingsIcon, action: { type: "toggleAppSettings", open: true } },
  { id: "shortcuts", label: "Keyboard shortcuts", keywords: "keys hotkeys help", icon: Keyboard, action: { type: "toggleShortcuts", open: true } },
];

/** The Settings pages shown before anything is typed. */
const FIRST_PAGES = ["general", "engines", "devices"];

/** How many recent chats an empty search offers, each with its Ctrl key. */
const RECENT = 6;

/** Name ranking: prefix beats substring, and input order (recency,
 * pinning) survives inside each tier. */
function rankByName<T>(items: T[], nameOf: (item: T) => string, query: string): T[] {
  if (!query) return items;
  const q = query.toLowerCase();
  const prefix: T[] = [];
  const inside: T[] = [];
  for (const item of items) {
    const name = nameOf(item).toLowerCase();
    if (name.startsWith(q)) prefix.push(item);
    else if (name.includes(q)) inside.push(item);
  }
  return [...prefix, ...inside];
}

type Chat = { kind: "agent"; bot: Bot } | { kind: "room"; room: Blok };

export function CommandPalette() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const platform = platformOf();

  useEffect(() => {
    const show = (toggle: boolean) => {
      setOpen((was) => (toggle ? !was : true));
      setQuery("");
      setHits([]);
      setCursor(0);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        show(true);
      }
    };
    const onOpen = () => show(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // transcript search rides a debounce; stale answers are dropped
  useEffect(() => {
    if (!open || !query.trim()) {
      setHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(query.trim())}&limit=12`)
        .then((r) => alive && setHits(r.hits ?? []))
        .catch(() => alive && setHits([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, query]);

  const q = query.trim();
  // Agents and rooms together, as the sidebar lists them: most recently
  // with you first. Empty, only the latest few; typed, every match.
  const chats = useMemo<Chat[]>(() => {
    const all: Array<Chat & { at: number; name: string }> = [
      ...state.bots.filter((b) => !b.hidden).map((bot) => ({ kind: "agent" as const, bot, at: bot.activeWithYouAt ?? 0, name: bot.name })),
      ...state.bloks.map((room) => ({ kind: "room" as const, room, at: room.activeWithYouAt ?? 0, name: room.name })),
    ].sort((a, b) => b.at - a.at);
    return q ? rankByName(all, (c) => c.name, q) : all.slice(0, RECENT);
  }, [state.bots, state.bloks, q]);
  const commands = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return COMMANDS.filter((c) => words.every((w) => `${c.label} ${c.keywords}`.toLowerCase().includes(w)));
  }, [q]);
  // Settings pages by what they hold, so "voice" or "telegram" goes
  // straight to the page rather than through the Settings menu.
  const pages = useMemo(() => {
    const all = SETTINGS_PAGES.flatMap((g) => g.pages);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return FIRST_PAGES.map((id) => all.find((p) => p.id === id)).filter((p) => p !== undefined);
    return all.filter((p) => words.every((w) => `${p.label} ${p.keywords}`.toLowerCase().includes(w)));
  }, [q]);
  const total = chats.length + commands.length + pages.length + hits.length;

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, total - 1)));
  }, [total]);

  if (!open) return null;

  // where each section starts in the one flat cursor
  const commandsAt = chats.length;
  const pagesAt = commandsAt + commands.length;
  const hitsAt = pagesAt + pages.length;

  const activate = (index: number) => {
    if (index < commandsAt) {
      const chat = chats[index];
      dispatch({ type: "select", id: chat.kind === "agent" ? chat.bot.id : chat.room.id });
    } else if (index < pagesAt) {
      dispatch(commands[index - commandsAt].action);
    } else if (index < hitsAt) {
      dispatch({ type: "toggleAppSettings", open: true, page: pages[index - pagesAt].id });
    } else {
      const hit = hits[index - hitsAt];
      if (!hit) return;
      if (hit.blokId) {
        dispatch({ type: "select", id: hit.blokId });
      } else if (hit.botId) {
        const bot = state.bots.find((b) => b.id === hit.botId);
        // the hit may live in another lane; open that lane
        const lane = bot?.tasks?.some((t) => t.id === hit.threadId) ? hit.threadId : undefined;
        dispatch({ type: "select", id: hit.botId, lane });
      }
    }
    setOpen(false);
  };

  const move = (delta: number) => {
    if (!total) return;
    const next = (cursor + delta + total) % total;
    setCursor(next);
    listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const ctrl = platform === "mac" ? "⌃" : "Ctrl+";
  const row = (index: number, icon: React.ReactNode, label: React.ReactNode, meta?: React.ReactNode, keys?: string[]) => (
    <button
      key={index}
      data-index={index}
      onClick={() => activate(index)}
      onMouseMove={() => setCursor(index)}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left outline-none",
        index === cursor && "bg-accent",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-ui text-foreground">{label}</span>
      {meta && <span className="max-w-[40%] shrink-0 truncate text-body text-muted-foreground">{meta}</span>}
      {keys && keys.length > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          {keys.map((k) => (
            <kbd
              key={k}
              className="min-w-[26px] rounded-md bg-muted px-1.5 py-0.5 text-center font-sans text-caption tabular-nums text-muted-foreground"
            >
              {k}
            </kbd>
          ))}
        </span>
      )}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-black/30 pt-[18vh] dark:bg-black/50"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="flex max-h-[min(560px,64vh)] w-[680px] max-w-[92vw] animate-pop-in flex-col overflow-hidden rounded-2xl border bg-popover shadow-2xl shadow-(color:--shadow-color)"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search chats, settings and messages"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), move(1));
            else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
            else if (e.key === "Enter") activate(cursor);
            else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
              // Ctrl+number opens that chat, as its key says
              const n = Number(e.key) - 1;
              if (n < Math.min(chats.length, RECENT)) (e.preventDefault(), activate(n));
            }
          }}
          placeholder="Search chats"
          className="h-14 w-full shrink-0 bg-transparent px-5 text-lead text-foreground outline-none placeholder:text-muted-foreground"
        />

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {chats.length > 0 && (
            <Section label="Chats">
              {chats.map((chat, i) =>
                chat.kind === "agent"
                  ? row(
                      i,
                      <AgentAvatar bot={chat.bot} size={20} />,
                      chat.bot.name,
                      chat.bot.section ?? chat.bot.title,
                      i < RECENT ? [`${ctrl}${i + 1}`] : undefined,
                    )
                  : row(
                      i,
                      <Users size={16} strokeWidth={1.75} />,
                      chat.room.name,
                      chat.room.section ?? "Room",
                      i < RECENT ? [`${ctrl}${i + 1}`] : undefined,
                    ),
              )}
            </Section>
          )}
          {commands.length > 0 && (
            <Section label="Quick actions">
              {commands.map((command, i) => {
                const Icon = command.icon;
                return row(commandsAt + i, <Icon size={16} strokeWidth={1.75} />, command.label, undefined, keysFor(command.id, platform));
              })}
            </Section>
          )}
          {pages.length > 0 && (
            <Section label="Settings">
              {pages.map((page, i) => {
                const Icon = page.icon;
                return row(pagesAt + i, <Icon size={16} />, page.label, q ? page.description : undefined);
              })}
            </Section>
          )}
          {hits.length > 0 && (
            <Section label="Messages">
              {hits.map((hit, i) =>
                row(
                  hitsAt + i,
                  <MessageSquare size={15} strokeWidth={1.75} />,
                  hit.snippet,
                  `${hit.name}${hit.task ? ` · ${hit.task}` : ""}`,
                ),
              )}
            </Section>
          )}
          {total === 0 && (
            <div className="flex flex-col items-center gap-1 px-3 py-10 text-center">
              <BotIcon size={18} className="text-muted-foreground" />
              <div className="text-ui text-muted-foreground">Nothing matches “{q}”</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pb-1">
      <div className="px-3 pb-1.5 pt-2.5 text-body font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
