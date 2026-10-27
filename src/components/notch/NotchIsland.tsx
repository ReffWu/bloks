// The agents at work, in the MacBook's notch.
//
// The window (electron/notch.mjs) is a clear frame over the top of the
// screen, larger than anything drawn in it, that lets the mouse through
// everywhere except over the island itself. This page draws the island.
//
// With nothing working and nothing waiting there is no island at all,
// only the notch the Mac already has. While agents work it grows ears:
// their faces on the left, breathing in their colours, and on the right
// how long the longest turn has run, or an amber dot when one of them
// is waiting on you. Pure black, so it reads as the notch itself grown
// wider, flush with the top and rounded below.
//
// Under the pointer it opens downward, the way the Dynamic Island does:
// a row for each agent (who, which conversation, what it is doing right
// now, for how long), and under them every agent's turn on one timeline.
// A row opens that conversation in the main window. Leaving lets it close
// a moment later, so a pointer that slips off the edge does not slam it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BlokAvatar } from "@/components/Avatar";
import { Spinner, colorHex } from "@/components/trace/parts";
import { TraceWaterfall } from "@/components/trace/TraceWaterfall";
import { BLOK_COLORS, shapeForBot, type BlokColor } from "@/lib/mascot";
import { LIVE_TRACES_PATH, type LiveAgent, type LiveTraces } from "@/lib/trace";
import { currentStep, fixtureLive, type TraceGroup } from "@/lib/traceView";
import { clock } from "@/lib/transcript";
import { api } from "@/state/store";
import type { NotchGeometry } from "@/types/bridge";
import { cn } from "@/lib/cn";

/** What a notch looks like when the app has not said: a MacBook's. */
const FALLBACK: NotchGeometry = {
  hasNotch: true,
  notchWidth: 200,
  menuBar: 37,
  compact: { width: 344, height: 37 },
  frame: { width: 680, height: 540 },
};

/** How wide the island opens, inside the frame's margin. */
const OPEN_WIDTH = 600;
/** Hover intent: a pointer passing on its way to the menu bar does not
 * open it. */
const OPEN_AFTER_MS = 140;
const CLOSE_AFTER_MS = 320;
/** Polls: about once a second while it shows anything, slowly while
 * there is nothing to show. */
const POLL_BUSY_MS = 1000;
const POLL_IDLE_MS = 5000;

/** The agents waiting on you first, then the longest at work. */
function inOrder(agents: LiveAgent[]): LiveAgent[] {
  return [...agents].sort((a, b) => Number(b.state === "needs-you") - Number(a.state === "needs-you") || a.trace.startedAt - b.trace.startedAt);
}

const blokColor = (color: string): BlokColor => (color in BLOK_COLORS ? (color as BlokColor) : "blue");

function useGeometry(): NotchGeometry {
  const [geometry, setGeometry] = useState<NotchGeometry>(FALLBACK);
  useEffect(() => {
    const bridge = window.bloks;
    void bridge?.notchGeometry?.().then((g) => g && setGeometry(g));
    return bridge?.onNotchGeometry?.((g) => setGeometry(g));
  }, []);
  return geometry;
}

/** The working agents, read about once a second while there are any (or
 * while it is open) and every few seconds while there are none, and not
 * at all while the window cannot be seen. The demo reads made-up ones. */
function useLive(demo: boolean): { live: LiveTraces | null; offset: number } {
  const [state, setState] = useState<{ live: LiveTraces | null; offset: number }>({ live: null, offset: 0 });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // what the last answer said: anyone at work means the next read is
    // soon (and the island can only be open while someone is)
    let busy = false;
    const epoch = Date.now();
    const next = () => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, busy ? POLL_BUSY_MS : POLL_IDLE_MS);
    };
    const read = async () => {
      if (document.visibilityState === "hidden") return next();
      try {
        const live: LiveTraces = demo ? fixtureLive(Date.now(), epoch) : await api(LIVE_TRACES_PATH);
        const at = Date.now();
        if (alive && live && Array.isArray(live.agents)) {
          busy = live.agents.length > 0;
          setState({ live, offset: Number.isFinite(live.now) ? live.now - at : 0 });
        }
      } catch {
        // a server between restarts says nothing for a moment; the
        // island keeps what it last knew rather than blinking out
      }
      next();
    };
    const onShow = () => document.visibilityState === "visible" && void read();
    document.addEventListener("visibilitychange", onShow);
    void read();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [demo]);
  return state;
}

/** Seconds on the server's clock, a second at a time, while `on`. The
 * offset moves a little with every read; the tick keeps its own pace. */
function useSeconds(on: boolean, offset: number): number {
  const ahead = useRef(offset);
  ahead.current = offset;
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now() + ahead.current);
    const timer = setInterval(() => setNow(Date.now() + ahead.current), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

export function NotchIsland({ demo = false }: { demo?: boolean }) {
  const reduce = Boolean(useReducedMotion());
  const geometry = useGeometry();
  // the page under the island is clear, as the window is
  useLayoutEffect(() => {
    document.documentElement.dataset.surface = "notch";
  }, []);

  const [open, setOpen] = useState(false);
  const { live, offset } = useLive(demo);
  const agents = useMemo(() => inOrder(live?.agents ?? []), [live]);
  const showing = agents.length > 0;
  const waiting = agents.find((a) => a.state === "needs-you");
  const now = useSeconds(showing, offset);
  const longest = agents.reduce((most, a) => Math.max(most, now - a.trace.startedAt), 0);

  // ── the pointer ──
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const over = useRef(false);
  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const enter = () => {
    over.current = true;
    // the window takes the mouse only while it is over the island
    void window.bloks?.notchHover?.(true);
    if (!open) later(() => over.current && setOpen(true), OPEN_AFTER_MS);
    else if (timer.current) clearTimeout(timer.current);
  };
  const leave = () => {
    over.current = false;
    void window.bloks?.notchHover?.(false);
    later(() => !over.current && setOpen(false), CLOSE_AFTER_MS);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // nothing to show: closed, and the mouse goes through again
  useEffect(() => {
    if (showing) return;
    setOpen(false);
    over.current = false;
    void window.bloks?.notchHover?.(false);
  }, [showing]);

  const openConversation = (agent: LiveAgent) => {
    void window.bloks?.notchOpen?.({ botId: agent.botId, taskId: agent.taskId });
    setOpen(false);
  };

  // ── the shape's size ──
  const content = useRef<HTMLDivElement>(null);
  const [openHeight, setOpenHeight] = useState(240);
  useLayoutEffect(() => {
    const el = content.current;
    if (!el || !open) return;
    const measure = () => setOpenHeight(el.offsetHeight);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [open]);
  const { compact, menuBar, notchWidth } = geometry;
  const width = open ? Math.min(OPEN_WIDTH, geometry.frame.width - 24) : compact.width;
  const height = open ? Math.min(openHeight, geometry.frame.height - 12) : compact.height;
  const radius = open ? 24 : Math.round(compact.height * 0.3);
  // It comes out of the notch and goes back into it: black on the
  // camera's black, as wide as the notch, it is not there to see. Without
  // a notch to hide in it fades.
  const hidden =
    geometry.hasNotch && !reduce
      ? { opacity: 1, width: notchWidth, height: compact.height, borderBottomLeftRadius: radius, borderBottomRightRadius: radius }
      : { opacity: 0, width: compact.width, height: compact.height, borderBottomLeftRadius: radius, borderBottomRightRadius: radius };
  const spring = reduce
    ? { duration: 0.12, ease: "easeOut" as const }
    : open
      ? { type: "spring" as const, stiffness: 440, damping: 32, mass: 0.9 }
      : { type: "spring" as const, stiffness: 560, damping: 44, mass: 0.9 };

  const groups = useMemo<TraceGroup[]>(
    () => agents.map((a) => ({ id: `${a.botId}:${a.taskId}`, botId: a.botId, name: a.name, subtitle: a.taskTitle, color: a.color, trace: a.trace })),
    [agents],
  );

  return (
    <div className="dark pointer-events-none fixed inset-0 overflow-hidden font-sans text-foreground antialiased">
      {demo && !window.bloks && <DemoBackdrop menuBar={menuBar} />}
      <AnimatePresence>
        {showing && (
          <motion.div
            key="island"
            className="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2 bg-black"
            style={{ "--shoulder": `${open ? 10 : 7}px` } as CSSProperties}
            initial={hidden}
            animate={{
              opacity: 1,
              width,
              height,
              borderBottomLeftRadius: radius,
              borderBottomRightRadius: radius,
              // a shadow only once it is more than the notch, which has none
              boxShadow: open ? "0 22px 50px -14px rgba(0,0,0,0.6)" : "0 0px 0px 0px rgba(0,0,0,0)",
            }}
            exit={{ ...hidden, transition: reduce ? { duration: 0.12 } : { duration: 0.28, ease: [0.4, 0, 0.2, 1] } }}
            transition={spring}
            onPointerEnter={enter}
            onPointerLeave={leave}
            onClick={() => !open && setOpen(true)}
          >
            <span className="notch-shoulder" data-side="left" />
            <span className="notch-shoulder" data-side="right" />
            <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: "inherit" }}>
              {/* the ears, in the menu bar's band either side of the notch */}
              <motion.div
                className="absolute inset-x-0 top-0 flex items-center justify-between px-2.5"
                style={{ height: menuBar }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: reduce ? 0 : 0.1, duration: 0.2 } }}
              >
                <Faces agents={agents} reduce={reduce} />
                <span className="min-w-0" style={{ width: notchWidth }} aria-hidden />
                {waiting ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-caption font-medium text-warning">
                    <span className={cn("size-1.5 rounded-full bg-warning", !reduce && "animate-pulse")} />
                    Needs you
                  </span>
                ) : (
                  <span className="shrink-0 text-caption font-medium tabular-nums text-white/85">{clock(longest)}</span>
                )}
              </motion.div>
              <AnimatePresence>
                {open && (
                  <motion.div
                    key="open"
                    ref={content}
                    className="absolute inset-x-0 top-0 flex flex-col"
                    style={{ paddingTop: menuBar, maxHeight: geometry.frame.height - 12 }}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { delay: reduce ? 0 : 0.07, duration: 0.24, ease: [0.23, 1, 0.32, 1] } }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  >
                    {/* a long list scrolls, so the timeline under it keeps its place */}
                    <div className="flex max-h-[232px] shrink-0 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
                      {agents.map((agent) => (
                        <AgentRow key={`${agent.botId}:${agent.taskId}`} agent={agent} now={now} reduce={reduce} onOpen={() => openConversation(agent)} />
                      ))}
                    </div>
                    <div className="flex min-h-0 flex-col border-t border-white/10" style={{ maxHeight: 280 }}>
                      <TraceWaterfall groups={groups} now={live?.now ?? Date.now()} variant="island" className="min-h-0" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Up to three faces, overlapping, the one waiting on you in front. */
function Faces({ agents, reduce }: { agents: LiveAgent[]; reduce: boolean }) {
  const shown = agents.slice(0, 3);
  const more = agents.length - shown.length;
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((agent, i) => (
        <motion.span
          key={`${agent.botId}:${agent.taskId}`}
          layout={!reduce}
          initial={reduce ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn("relative rounded-[6px]", i > 0 && "-ml-[7px]", agent.state === "working" && !reduce && "notch-pulse")}
          style={{ zIndex: shown.length - i, "--c": colorHex(agent.color), boxShadow: "0 0 0 1.5px #000" } as CSSProperties}
        >
          <BlokAvatar color={blokColor(agent.color)} shape={shapeForBot({ id: agent.botId, name: agent.name })} expression="focused" size={18} />
        </motion.span>
      ))}
      {more > 0 && <span className="ml-1 text-micro font-medium tabular-nums text-white/60">+{more}</span>}
    </span>
  );
}

/** One agent: who, which conversation, what it is doing now, how long. */
function AgentRow({ agent, now, reduce, onOpen }: { agent: LiveAgent; now: number; reduce: boolean; onOpen: () => void }) {
  const step = currentStep(agent.trace);
  const asking = agent.state === "needs-you";
  const doing = step ? `${step.name}${step.detail ? ` ${step.detail}` : ""}` : "Starting";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${agent.taskTitle}`}
      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 hover:bg-white/[0.07]"
    >
      <BlokAvatar color={blokColor(agent.color)} shape={shapeForBot({ id: agent.botId, name: agent.name })} expression={asking ? "surprised" : "focused"} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-1.5 text-small">
          <span className="shrink-0 font-semibold text-white">{agent.name}</span>
          <span className="min-w-0 truncate text-white/50">{agent.taskTitle}</span>
        </span>
        <span className={cn("flex min-w-0 items-center gap-1.5 text-caption", asking ? "text-warning" : "text-white/60")}>
          {asking ? (
            <span className="size-1.5 shrink-0 rounded-full bg-warning" />
          ) : (
            <Spinner size={10} className="text-white/60" />
          )}
          <span className={cn("min-w-0 truncate", !asking && !reduce && "trace-shimmer")} style={{ "--trace-shine": "#fff" } as CSSProperties}>
            {asking ? `Waiting for you${step?.detail ? `: ${step.detail}` : ""}` : doing}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-caption tabular-nums text-white/70">{clock(now - agent.trace.startedAt)}</span>
    </button>
  );
}

/** In a browser, a strip where the menu bar would be, so the black shape
 * has something to sit in. The app's window has the real one. */
function DemoBackdrop({ menuBar }: { menuBar: number }) {
  return (
    <div className="absolute inset-0 bg-sidebar">
      <div className="w-full bg-foreground/10" style={{ height: menuBar }} />
    </div>
  );
}
