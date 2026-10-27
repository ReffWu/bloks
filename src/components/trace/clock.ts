// One clock for a whole waterfall.
//
// The data arrives about once a second; between arrivals the playhead,
// the running bars and their counters move on by themselves. So this
// takes the time each arrival was true at and runs it forward on the
// page's own clock, one requestAnimationFrame loop for everything on
// screen, and only while something is running or something asked for
// one more frame (the ruler settling after a rescale). It never steps
// back for a reading a moment behind the one before it, which is what
// keeps the playhead from twitching on every poll.
import { useEffect, useLayoutEffect, useRef } from "react";

/** Called each frame with the time (epoch ms, the server's clock) and the
 * milliseconds since the last frame. Answers true to be called again even
 * when nothing is running. */
export type ClockListener = (now: number, dt: number) => boolean | void;

export interface TraceClock {
  read(): number;
  subscribe(listener: ClockListener): () => void;
  /** One more frame, for a listener that has something to settle. */
  kick(): void;
}

/** A correction this large is new data, not jitter: taken as it is. */
const JUMP_MS = 2000;

function createClock(): TraceClock & { set(now: number, running: boolean): void } {
  let base = 0;
  let baseAt = 0;
  let live = false;
  let last = 0;
  let raf = 0;
  let previous = 0;
  const listeners = new Set<ClockListener>();
  const read = () => {
    if (!live) return (last = base);
    const ahead = base + (performance.now() - baseAt);
    last = ahead < last && last - ahead < JUMP_MS ? last : ahead;
    return last;
  };
  const frame = (at: number) => {
    raf = 0;
    const dt = previous ? Math.min(100, at - previous) : 16;
    previous = at;
    const now = read();
    let again = live;
    for (const listener of listeners) if (listener(now, dt)) again = true;
    if (again && listeners.size) raf = requestAnimationFrame(frame);
    else previous = 0;
  };
  const kick = () => {
    if (!raf && listeners.size && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
  };
  return {
    read,
    kick,
    set(now, running) {
      base = now;
      baseAt = performance.now();
      live = running;
      kick();
    },
    subscribe(listener) {
      listeners.add(listener);
      kick();
      return () => {
        listeners.delete(listener);
        if (!listeners.size && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
          previous = 0;
        }
      };
    },
  };
}

/** A clock that `now` (as of the last arrival) sets, running on while
 * `running`. */
export function useTraceClock(now: number, running: boolean): TraceClock {
  const clock = useRef<ReturnType<typeof createClock> | null>(null);
  if (!clock.current) {
    clock.current = createClock();
    clock.current.set(now, running);
  }
  useLayoutEffect(() => {
    clock.current!.set(now, running);
  }, [now, running]);
  return clock.current;
}

/** Text that follows the clock, written straight into its element when
 * it changes rather than rendered: a running step's "4.2s" ticks ten
 * times a second, and nothing else on the row needs to know. Text that
 * is not `live` is written once per render and never listens. */
export function useLiveText<T extends HTMLElement>(clock: TraceClock, format: (now: number) => string, live = true) {
  const ref = useRef<T>(null);
  const said = useRef(format);
  said.current = format;
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = said.current(clock.read());
  });
  useEffect(() => {
    if (!live) return;
    return clock.subscribe((now) => {
      const el = ref.current;
      if (!el) return;
      const text = said.current(now);
      if (el.textContent !== text) el.textContent = text;
    });
  }, [clock, live]);
  return ref;
}
