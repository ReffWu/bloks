// The sidebar's newer parts: an agent's conversations listed under it,
// the row that says something is waiting on you, and the footer that
// keeps everything else one click away instead of nine rows deep.
//
// Motion is kept for the moments that change what is on screen: a list
// of conversations opening under an agent, the waiting row arriving. The
// rows themselves are clicked tens of times a day, so they get colour and
// a press, never an entrance.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellDot } from "@/components/icons";
import { ClipboardCopy } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Pencil } from "@/components/icons";
import { X } from "@/components/icons";
import { ChevronRight } from "@/components/icons";
import { Hand } from "@/components/icons";
import { Target } from "@/components/icons";
import { formatWhen, useStore, type Bot, laneHasMessages } from "@/state/store";
import { cn } from "@/lib/cn";
import { ContextRing, RING_FROM, type TaskChipData } from "./TaskStrip";
import { contextTitle, measuredContext } from "@/lib/contextCard";

/** The one spring for things that open in place: quick, and no bounce,
 * because a list that overshoots reads as unsure of its own height. */
export const OPEN = { type: "spring", duration: 0.3, bounce: 0 } as const;

/** A lane's state as a mark: working spins, waiting glows amber, unread
 * is a still dot, idle leaves the slot empty so titles stay aligned. A
 * spinner rather than a pulse, because it reads as "busy" at a glance
 * and a dot that pulses reads as one more notification. */
export function LaneMark({ state, unread }: { state: string; unread?: boolean }) {
  if (state === "working") {
    return <Loader2 size={11} className="shrink-0 animate-spin text-brand motion-reduce:animate-none" aria-label="working" />;
  }
  if (state === "needs-you") return <span className="mx-[2.5px] size-1.5 shrink-0 rounded-full bg-warning" />;
  if (unread) return <span className="mx-[2.5px] size-1.5 shrink-0 rounded-full bg-brand" />;
  return <span className="w-[11px] shrink-0" />;
}

/** How full a conversation is, once that is worth a glance. It lived on
 * the tab strip, which the sidebar replaces while it lists conversations. */
export function LaneRing({ lane }: { lane: Pick<TaskChipData, "context"> }) {
  const c = lane.context;
  if (!c || (!(measuredContext(c) && c.fraction >= RING_FROM) && !c.summarised)) return null;
  return (
    <span
      className="shrink-0 text-muted-foreground"
      title={contextTitle(c)}
    >
      <ContextRing fraction={measuredContext(c) ? c.fraction : 0} summarised={c.summarised} size={12} />
    </span>
  );
}

interface LaneMenuState {
  laneId: string;
  x: number;
  y: number;
}

/** A conversation's own right-click menu: the agent's has the actions for
 * the agent, this one has the ones for a single conversation. */
function LaneMenu({
  bot,
  menu,
  onRename,
  onClose,
}: {
  bot: Bot;
  menu: LaneMenuState;
  onRename: (laneId: string) => void;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-lane-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  const lane = bot.tasks?.find((t) => t.id === menu.laneId);
  if (!lane) return null;
  const top = Math.min(menu.y, window.innerHeight - 222);
  const left = Math.min(menu.x, window.innerWidth - 220);
  const item = (icon: React.ReactNode, label: string, run: () => void, danger = false) => (
    <button
      key={label}
      onClick={() => {
        run();
        onClose();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px]",
        danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-accent",
      )}
    >
      {icon}
      {label}
    </button>
  );
  const busy = lane.state === "working";
  return (
    <div
      data-lane-menu
      role="menu"
      style={{ top, left }}
      className="fixed z-40 w-[208px] animate-pop-in rounded-xl border bg-popover p-1 shadow-lg shadow-(color:--shadow-color)"
    >
      {item(<Pencil size={15} className="text-muted-foreground" />, "Rename", () => onRename(lane.id))}
      {item(<BellDot size={15} className="text-muted-foreground" />, "Mark as unread", () =>
        dispatch({ type: "markLaneUnread", botId: bot.id, taskId: lane.id }),
      )}
      {item(<ClipboardCopy size={15} className="text-muted-foreground" />, "Copy conversation ID", () => {
        void navigator.clipboard?.writeText(lane.id);
      })}
      {/* opened in this conversation, so the goal it sets is plainly its own */}
      {!lane.noGoals &&
        item(<Target size={15} className="text-muted-foreground" />, lane.goal ? "Set a new goal" : "Set a goal", () => {
          dispatch({ type: "select", id: bot.id, lane: lane.id });
          dispatch({ type: "openGoal", botId: bot.id, taskId: lane.id });
        })}
      <div className="mx-2 my-1 h-px bg-border" />
      {busy ? (
        <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">Stop it before closing</div>
      ) : (
        item(
          <X size={15} />,
          "Close conversation",
          () => {
            // The same rule as a tab's ×: closing deletes the transcript, so
            // one with anything in it names what goes first; an empty one
            // just goes.
            if (laneHasMessages(lane) && !window.confirm(`Close "${lane.title}"? Its messages are deleted.`)) return;
            dispatch({ type: "closeTask", botId: bot.id, taskId: lane.id });
          },
          true,
        )
      )}
    </div>
  );
}

/** A conversation's title, edited where it sits. Enter or clicking away
 * keeps the new name; Escape, or blank, or unchanged, keeps the old one. */
function LaneRename({ title, onDone }: { title: string; onDone: (next: string | null) => void }) {
  const [value, setValue] = useState(title);
  const ended = useRef(false);
  const end = (next: string | null) => {
    if (ended.current) return;
    ended.current = true;
    onDone(next);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={40}
      aria-label="Rename this conversation"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const next = value.replace(/\s+/g, " ").trim();
        end(next && next !== title ? next : null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") end(null);
      }}
      className="min-w-0 flex-1 rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-[12.5px] text-foreground outline-none"
    />
  );
}

/** An agent's conversations other than General, under its row. Titles
 * line up with the agent's name above, and the state mark sits in the
 * gutter left of them, under the avatar. */
export function ConversationRows({ bot, open }: { bot: Bot; open: boolean }) {
  const { state, dispatch } = useStore();
  const [menu, setMenu] = useState<LaneMenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const lanes = (bot.tasks ?? []).slice(1);
  const showing = open && lanes.length > 0;
  const activeId = state.selectedId === bot.id ? (bot.activeTaskId ?? bot.threadId) : null;

  return (
    <>
      <AnimatePresence initial={false}>
        {showing && (
          <motion.div
            key="lanes"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={OPEN}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-px pb-1 pt-0.5">
              {lanes.map((lane) => {
                const active = lane.id === activeId;
                const waiting = lane.state === "needs-you";
                const rowClass = cn(
                  "flex h-[30px] w-full items-center gap-[7px] rounded-lg pl-[26px] pr-2.5 text-left text-[12.5px] transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.98]",
                  active ? "bg-accent text-foreground" : "hover:bg-accent/60",
                );
                if (renaming === lane.id) {
                  return (
                    <div key={lane.id} className={rowClass}>
                      <LaneMark state={lane.state} unread={lane.unread} />
                      <LaneRename
                        title={lane.title}
                        onDone={(next) => {
                          setRenaming(null);
                          if (next) dispatch({ type: "renameTask", botId: bot.id, taskId: lane.id, title: next });
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <button
                    key={lane.id}
                    onClick={() => dispatch({ type: "select", id: bot.id, lane: lane.id })}
                    onDoubleClick={() => setRenaming(lane.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ laneId: lane.id, x: e.clientX, y: e.clientY });
                    }}
                    className={rowClass}
                  >
                    <LaneMark state={lane.state} unread={lane.unread} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        active || lane.unread ? "text-foreground" : "text-muted-foreground",
                        lane.unread && !active && "font-medium",
                      )}
                    >
                      {lane.title}
                    </span>
                    <LaneRing lane={lane} />
                    <span
                      className={cn(
                        "shrink-0 text-[11px] tabular-nums",
                        waiting ? "text-warning" : "text-muted-foreground/80",
                      )}
                    >
                      {waiting ? "waiting" : lane.state === "working" ? "working" : formatWhen(lane.lastAt ?? lane.createdAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {menu && (
        <LaneMenu bot={bot} menu={menu} onRename={setRenaming} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

/** Every conversation, on every agent, that has stopped for you. */
export function useWaiting(): Array<{ bot: Bot; laneId: string }> {
  const { state } = useStore();
  return state.bots
    .filter((b) => !b.hidden && !b.archivedAt)
    .flatMap((bot) => (bot.tasks ?? []).filter((t) => t.state === "needs-you").map((t) => ({ bot, laneId: t.id })));
}

/** The first thing in the list when something needs an answer, because
 * it is the thing you most need to see. One goes straight there; several
 * open Overview, which lists them with everything else going on. */
export function WaitingRow() {
  const { dispatch } = useStore();
  const waiting = useWaiting();
  const go = () => {
    if (waiting.length === 1) dispatch({ type: "select", id: waiting[0].bot.id, lane: waiting[0].laneId });
    else dispatch({ type: "openPage", page: "overview" });
  };
  const label = `${waiting.length} waiting on you`;
  return (
    <AnimatePresence initial={false}>
      {waiting.length > 0 && (
        <motion.div
          key="waiting"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={OPEN}
          className="shrink-0 overflow-hidden"
        >
          <div className="px-3 pb-2">
            <button
              onClick={go}
              aria-label={label}
              className="flex w-full items-center gap-2 rounded-xl bg-warning/12 px-3 py-[7px] text-left text-[13px] font-medium text-warning transition-[background-color,scale] duration-150 ease-out hover:bg-warning/18 active:scale-[0.97]"
            >
              <Hand size={15} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate tabular-nums">{label}</span>
              <ChevronRight size={14} className="shrink-0 opacity-70" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
