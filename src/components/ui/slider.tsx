// A slider for an amount: how long, how big, how many. Not for a choice
// between kinds of thing, which stays a Segmented.
//
// Underneath is a real range input, stretched over the whole control and
// made invisible, so dragging, clicking anywhere on the track, the arrow
// keys, Home and End, and a screen reader's "12 replies" all come from the
// platform rather than from a hand-rolled copy of it. What you see is
// drawn on top and moves only by transform: the fill slides out of the
// track instead of growing, and the thumb rides a rail the width of the
// track, so nothing on screen is laid out again while you drag.
//
// Every slider is a row of stops. A short row (a handful of named steps)
// shows a dot for each and its name underneath, and the thumb glides
// between them even mid-drag, so it feels like it clicks into place. A
// long row (1 to 50) drops the dots, shows its two ends, tracks the
// finger exactly, and reads the value out beside it.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

export interface SliderStop<T> {
  value: T;
  /** Said in full: under the dot, in the readout, to a screen reader. */
  label: string;
}

/** Stops for every whole number from `from` to `to`. */
export function numberStops(from: number, to: number, label: (n: number) => string = String): SliderStop<number>[] {
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    value: from + i,
    label: label(from + i),
  }));
}

/** At or under this many stops, each one gets a dot and a name. */
const NAMED = 7;
/** The thumb's diameter, which the invisible input's thumb has to match
 * so the finger and the dot never drift apart (styles.css, .slider-input). */
const THUMB = 20;

export function Slider<T>({
  stops,
  value,
  onChange,
  onCommit,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  stops: SliderStop<T>[];
  value: T;
  /** Every stop passed through while dragging, for a live preview. */
  onChange?: (value: T) => void;
  /** Once, where the finger lets go or a key lands: the time to save. */
  onCommit?: (value: T) => void;
  disabled?: boolean;
  className?: string;
  "aria-label": string;
}) {
  const reduce = useReducedMotion();
  const last = stops.length - 1;
  const settled = Math.max(
    0,
    stops.findIndex((s) => Object.is(s.value, value)),
  );
  // while a finger is down the slider leads and the saved value follows;
  // the moment it lifts, the saved value is the truth again
  const [held, setHeld] = useState<number | null>(null);
  // where it was let go, shown until the saved value catches up, so the
  // thumb never hops back for the length of a round trip
  const [landed, setLanded] = useState<number | null>(null);
  useEffect(() => {
    setLanded(null);
  }, [settled]);
  useEffect(() => {
    if (landed === null) return;
    // a save that failed never moves the value; stop pretending it did
    const giveUp = setTimeout(() => setLanded(null), 4000);
    return () => clearTimeout(giveUp);
  }, [landed]);
  const pressing = useRef(false);
  const index = held ?? landed ?? settled;
  const before = useRef(index);
  const rising = index >= before.current;
  useEffect(() => {
    before.current = index;
  });
  const named = stops.length <= NAMED;
  const at = last > 0 ? index / last : 0;
  const glide = !reduce && (named || held === null);

  const commit = (i: number) => {
    setHeld(null);
    if (i === settled) return setLanded(null);
    setLanded(i);
    onCommit?.(stops[i].value);
  };

  // the finger can leave the control mid-drag; the release still counts
  const heldRef = useRef(held);
  heldRef.current = held;
  useEffect(() => {
    const up = () => {
      if (!pressing.current) return;
      pressing.current = false;
      if (heldRef.current !== null) commit(heldRef.current);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  const move = (i: number) => {
    if (i === index) return;
    onChange?.(stops[i].value);
    // a key press is a whole decision on its own; a drag is still deciding
    if (pressing.current) setHeld(i);
    else commit(i);
  };

  const ease = "transform 220ms var(--ease-out-quart)";
  return (
    <div className={cn("flex items-center gap-4", disabled && "pointer-events-none opacity-50", className)}>
      <div className={cn("group relative min-w-[160px] flex-1", named && "pb-7")}>
        <div className="relative h-6">
          {/* the track, and the fill sliding out of it */}
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted"
            style={{ left: THUMB / 2, right: THUMB / 2 }}
          >
            <div
              className="absolute inset-0 rounded-full bg-brand"
              style={{
                transform: `translateX(${(at - 1) * 100}%)`,
                transition: glide ? ease : "none",
              }}
            />
          </div>

          {/* the rail: the track's width, so a percentage of it is a
              position on the track */}
          <div className="pointer-events-none absolute inset-y-0" style={{ left: THUMB / 2, right: THUMB / 2 }}>
            {named &&
              stops.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200",
                    i <= index ? "bg-white/75" : "bg-foreground/25",
                  )}
                  style={{ left: `${last ? (i / last) * 100 : 0}%` }}
                />
              ))}
            <div
              className="absolute inset-0"
              style={{
                transform: `translateX(${at * 100}%)`,
                transition: glide ? ease : "none",
              }}
            >
              <span
                className={cn(
                  "absolute left-0 top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25),0_0_0_0.5px_rgba(0,0,0,0.12)] transition-[scale,box-shadow] duration-150 ease-out",
                  "group-hover:scale-105 group-has-[input:focus-visible]:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]",
                  held !== null && "scale-110 group-hover:scale-110",
                )}
                style={{ width: THUMB, height: THUMB }}
              />
              {/* a long row's value, held up above the thumb while it moves
                  or has the keyboard; a short row's names already say it */}
              {!named && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-full left-0 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-small font-medium tabular-nums text-background shadow-sm transition-[opacity,scale] duration-150 ease-out",
                    held !== null
                      ? "scale-100 opacity-100"
                      : "scale-95 opacity-0 group-has-[input:focus-visible]:scale-100 group-has-[input:focus-visible]:opacity-100",
                  )}
                >
                  {stops[index].label}
                </span>
              )}
            </div>
          </div>

          <input
            type="range"
            className="slider-input absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
            min={0}
            max={last}
            step={1}
            value={index}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-valuetext={stops[index].label}
            onPointerDown={() => (pressing.current = true)}
            onChange={(event) => move(Number(event.target.value))}
            onBlur={() => held !== null && commit(held)}
          />
        </div>

        {named && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5" style={{ marginLeft: THUMB / 2, marginRight: THUMB / 2 }}>
            {stops.map((stop, i) => (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                onClick={() => commit(i)}
                className={cn(
                  "pointer-events-auto absolute top-0 whitespace-nowrap text-small transition-colors duration-150",
                  // the ends hug their edge so they never spill past it
                  i === 0 ? "-translate-x-[10px]" : i === last ? "-translate-x-[calc(100%-10px)]" : "-translate-x-1/2",
                  i === index ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                style={{ left: `${last ? (i / last) * 100 : 0}%` }}
              >
                {stop.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!named && (
        <div className="relative h-5 min-w-[5.5rem] overflow-hidden text-right text-body font-medium tabular-nums text-foreground">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={index}
              className="absolute right-0"
              initial={reduce ? false : { opacity: 0, y: rising ? 8 : -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
            >
              {stops[index].label}
            </motion.span>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
