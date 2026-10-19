// What shows while an agent is working: its words streaming in, the
// line that says it is at work, and the live browser frame. Split out of
// ChatView.tsx, which only wires them in.
//
// The working line is the one place that says so. It used to be said
// four ways at once (a word in the header, the composer's placeholder, a
// spinner on the tool line, bouncing dots), and none of them said for
// how long or how to stop. Now the line says what the agent is doing in
// plain words, how long the turn has run, and how to stop it; the header
// carries the same clock, small; and a tool call's own row only marks
// which step it is.
import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/state/store";
import type { Message } from "@/state/reducer";
import { Markdownish } from "@/components/Markdown";
import { escapeTaken } from "@/lib/useEscape";
import { clock, turnStartedAt, workingLineOwed, REPLY_HOLD_MS } from "@/lib/transcript";
import { runningCall, stepWords } from "@/lib/tool-summary";
import { showsSpeedStatus, speedStatusLine, type CodexSpeedStatus } from "@/lib/codexSpeed";
import { cn } from "@/lib/cn";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// ── one clock for every counter on screen ──
//
// The header, the working line and a running call all count the same
// seconds, so they share one tick rather than three that drift a beat
// apart. It runs only while something on screen is counting.
const tickers = new Set<() => void>();
let tickNow = Date.now();
let ticking: ReturnType<typeof setInterval> | null = null;

function subscribeTick(listener: () => void) {
  tickers.add(listener);
  if (!ticking) {
    tickNow = Date.now();
    ticking = setInterval(() => {
      tickNow = Date.now();
      tickers.forEach((fn) => fn());
    }, 1000);
  }
  return () => {
    tickers.delete(listener);
    if (!tickers.size && ticking) {
      clearInterval(ticking);
      ticking = null;
    }
  };
}
const subscribeNothing = () => () => {};
function readTick() {
  // stopped, the last tick may be minutes old: a counter that starts now
  // must not open on a number that big
  if (!ticking && Date.now() - tickNow > 1000) tickNow = Date.now();
  return tickNow;
}

/** The time now, a second at a time, while `on`. Off, it stops counting. */
export function useNow(on: boolean): number {
  return useSyncExternalStore(on ? subscribeTick : subscribeNothing, readTick);
}

/** Whether an element is on screen. Something looping or counting where
 * nobody can see it is work for nothing. */
export function useInView(el: Element | null): boolean {
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting));
    watch.observe(el);
    return () => watch.disconnect();
  }, [el]);
  return seen;
}

/** A running count, in a fixed width so it does not jitter. Counts only
 * while on screen. */
export function Elapsed({ since, className }: { since: number; className?: string }) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const now = useNow(useInView(el));
  return (
    <span ref={setEl} className={cn("shrink-0 tabular-nums", className)}>
      {clock(now - since)}
    </span>
  );
}

// ── when the turn began ──
//
// The transcript says when most turns began: at the message that started
// them. A turn started some other way has no such message, and a message
// that waited in the queue is stamped when it was typed, not when it
// went. So what this screen saw also counts: the moment the conversation
// went from idle to working, kept per conversation so the header and the
// line agree, and so coming back to a conversation keeps its clock.
const seenStart = new Map<string, { flip: number | null; sight: number }>();
const seenWorking = new Map<string, boolean>();

function turnSince(key: string, working: boolean, messages: readonly Message[]): number {
  const was = seenWorking.get(key);
  seenWorking.set(key, working);
  if (!working) {
    seenStart.delete(key);
    return Date.now();
  }
  let seen = seenStart.get(key);
  if (!seen) {
    const now = Date.now();
    // opened mid turn: when it began is not something this screen saw
    seen = { flip: was === false ? now : null, sight: now };
    seenStart.set(key, seen);
  }
  const said = turnStartedAt(messages) ?? 0;
  return Math.max(said, seen.flip ?? 0) || seen.sight;
}

/** "Working · 42s", small, for the header beside the agent's name. */
export function WorkingClock({ threadKey, working, messages }: { threadKey: string; working: boolean; messages: readonly Message[] }) {
  const since = turnSince(threadKey, working, messages);
  // the header hides it on a phone, and hidden it need not count
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const inView = useInView(el);
  const now = useNow(working && inView);
  if (!working) return null;
  return (
    <span ref={setEl} className="tabular-nums">
      Working · {clock(now - since)}
    </span>
  );
}

/**
 * Esc stops the agent only from the message box (Composer.tsx, GitHub
 * 258), and only when nothing open on top takes the key first. So the
 * line says "Esc to stop" only while that is true, and otherwise offers
 * the stop itself. The box is the textarea drawn over its skill layer,
 * in the same conversation as the line.
 */
function escStops(line: Element | null): boolean {
  const box = document.activeElement;
  if (!(box instanceof HTMLTextAreaElement) || !box.previousElementSibling?.hasAttribute("data-skill-layer")) return false;
  if (line && box.closest("main") !== line.closest("main")) return false;
  return !escapeTaken();
}

function useEscStops(line: Element | null, on: boolean, tick: number): boolean {
  const [stops, setStops] = useState(false);
  useEffect(() => {
    if (!on) return;
    const check = () => setStops(escStops(line));
    check();
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, [line, on]);
  // something opened on top since the last look takes Esc first
  useEffect(() => {
    if (on) setStops(escStops(line));
  }, [line, on, tick]);
  return stops;
}

/** The line at the end of the transcript while the agent works. */
export function WorkingLine({
  threadKey,
  working,
  streaming,
  messages,
  provisioning,
  speed,
  onStop,
}: {
  threadKey: string;
  working: boolean;
  streaming?: string;
  messages: readonly Message[];
  /** The agent's computer is being set up, which comes before any work. */
  provisioning?: boolean;
  speed?: CodexSpeedStatus;
  onStop: () => void;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const inView = useInView(el);
  const since = turnSince(threadKey, working, messages);
  const now = useNow(working && inView);
  const last = messages[messages.length - 1];

  // How long the newest message has been on screen: a reply at the tail
  // holds the line off for a moment (transcript.ts), then lets it back
  // if the agent is plainly still at work.
  const [arrived, setArrived] = useState(() => ({ id: last?.id, at: Date.now() }));
  if (arrived.id !== last?.id) setArrived({ id: last?.id, at: Date.now() });
  const [, wake] = useState(0);
  const holding = working && !streaming && last?.role === "bot" && last.kind === "text";
  useEffect(() => {
    if (!holding) return;
    const left = REPLY_HOLD_MS - (Date.now() - arrived.at);
    if (left <= 0) return;
    const timer = setTimeout(() => wake((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [holding, arrived]);

  const shown = Boolean(provisioning) || workingLineOwed(working, streaming, last, Date.now() - arrived.at);
  const escHint = useEscStops(el, shown && working, now);

  // the step: only a call from this turn, so one a crash left open in an
  // earlier turn never names what the agent is doing now
  const start = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user" && messages[i].kind === "text") return i + 1;
    return 0;
  })();
  const call = runningCall(messages.slice(start));
  const step = provisioning
    ? "Setting up its computer"
    : streaming
      ? "Writing"
      : ((call?.tool && stepWords(call.tool)) ?? "Working");
  const fast = working && showsSpeedStatus(speed) ? speed : undefined;

  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key="working"
          ref={setEl}
          data-working-line
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12, ease: "easeOut" } }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="flex min-w-0 max-w-full items-center gap-2 px-1.5 py-0.5 text-small text-muted-foreground"
        >
          {/* The one thing that moves. It rests while words stream in,
              since the caret on them already says the agent is there,
              and wherever it is off screen. */}
          <span aria-hidden className="flex size-3 shrink-0 items-center justify-center">
            <span
              className={cn(
                "size-1.5 rounded-full bg-foreground/60",
                inView && !streaming && "motion-safe:animate-pulse",
              )}
            />
          </span>
          <span aria-hidden className="relative min-w-0 truncate text-foreground/80">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={step}
                className="inline-block"
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.16, ease: EASE_OUT }}
              >
                {step}
              </motion.span>
            </AnimatePresence>
          </span>
          {/* the step, said to a screen reader when it changes; the
              clock beside it is read when asked, not each second */}
          <span className="sr-only" role="status">
            {step}
          </span>
          {working && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 tabular-nums">{clock(now - since)}</span>
            </>
          )}
          {fast && (
            <>
              <span aria-hidden>·</span>
              <span data-codex-speed-status title={speedStatusLine(fast) ?? undefined} className="shrink-0">
                Codex {fast.choice.resolved === "fast" ? "Fast" : "Standard"}
              </span>
            </>
          )}
          {working && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={onStop}
                title={escHint ? "Stop the agent" : "Stop the agent. Esc does the same from the message box."}
                className="shrink-0 rounded-md transition-colors duration-150 hover:text-foreground"
              >
                {escHint ? "Esc to stop" : "Stop"}
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Frames arrive as base64 from the agent's computer. The mime type is
 * pinned to an image allowlist so a frame can never widen into some
 * other kind of data URI. */
export const FRAME_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function ScreenFrame({ png, mime }: { png: string; mime?: string }) {
  const safeMime = mime && FRAME_MIMES.has(mime) ? mime : "image/png";
  return (
    <div className="flex animate-rise-in justify-start">
      <img
        src={`data:${safeMime};base64,${png}`}
        alt="Agent screen"
        className="max-w-[82%] rounded-xl border sm:max-w-[68%]"
      />
    </div>
  );
}

/** The agent's browser while it works: the latest frame, and a way in.
 * A click on the picture clicks the page at the same spot, and the line
 * under it types into whatever has focus. For the logins and cookie
 * walls an agent cannot get past on its own. */
export function LiveBrowser({ botId, frame }: { botId: string; frame: { png: string; mime: string } }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const inView = useInView(box);
  const safeMime = FRAME_MIMES.has(frame.mime) ? frame.mime : "image/png";
  const send = (action: "click" | "type", body: Record<string, unknown>) =>
    api(`/api/bots/${botId}/browser/${action}`, { method: "POST", body: JSON.stringify(body) })
      .then(() => setError(null))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <div ref={setBox} className="flex animate-rise-in justify-start">
      <div className="max-w-[82%] overflow-hidden rounded-xl border sm:max-w-[68%]">
        <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-small text-muted-foreground">
          <span className={cn("size-1.5 rounded-full bg-success", inView && "motion-safe:animate-pulse")} />
          Live browser. Click or type to help.
        </div>
        <img
          src={`data:${safeMime};base64,${frame.png}`}
          alt="The agent's browser"
          className="block w-full cursor-pointer"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            void send("click", { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height });
          }}
        />
        <form
          className="border-t"
          onSubmit={(e) => {
            e.preventDefault();
            void send("type", { text, enter: true });
            setText("");
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type here, Enter to send"
            aria-label="Type into the agent's browser"
            className="w-full bg-transparent px-2.5 py-1.5 text-body outline-none placeholder:text-muted-foreground"
          />
        </form>
        {error && <div className="border-t px-2.5 py-1 text-small text-destructive">{error}</div>}
      </div>
    </div>
  );
}

export function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full justify-start">
      <div className="streaming-text min-w-0 max-w-full rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-lead leading-relaxed text-foreground">
        <Markdownish text={text} />
      </div>
    </div>
  );
}
