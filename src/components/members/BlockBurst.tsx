// A burst of the workspace mark's own blocks: the small celebration when
// somebody new is in. Rare by nature (once per person), so it is allowed
// a moment of delight, and it never blocks anything: pointer events pass
// through, and it removes itself when done.
//
// Each block flies on transform and opacity only, nothing that makes the
// page lay itself out again. With reduced motion asked for there is no flight: the
// blocks fade in where they would have landed and fade out, which still
// says "something good happened" without anything moving.
import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";

const BLOKS_COLOURS = ["#4c86f5", "#f0b44c", "#f972b6", "#a468f7", "#ff9432", "#3bc76b"];

/** A small seeded random, so a burst looks the same on every render of
 * the same key and tests see the same frame twice. */
function seeded(seed: number) {
  let s = seed % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function BlockBurst({
  color,
  count = 14,
  spread = 70,
  seed = 7,
  className,
}: {
  color: string;
  count?: number;
  /** How far the blocks fly, in px, from the middle. */
  spread?: number;
  seed?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const bits = useMemo(() => {
    const r = seeded(seed);
    return Array.from({ length: count }, (_, i) => {
      const angle = r() * Math.PI * 2;
      const distance = spread * (0.45 + r() * 0.55);
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance - spread * 0.15,
        size: 4 + Math.round(r() * 4),
        rotate: Math.round(r() * 160 - 80),
        // half in the workspace's own colour, the rest in the Bloks ones
        color: i % 2 === 0 ? color : BLOKS_COLOURS[Math.floor(r() * BLOKS_COLOURS.length)],
        delay: r() * 0.06,
      };
    });
  }, [color, count, spread, seed]);

  return (
    <span aria-hidden className={className} style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, pointerEvents: "none" }}>
      {bits.map((b, i) => (
        <motion.span
          key={i}
          style={{ position: "absolute", width: b.size, height: b.size, borderRadius: Math.max(1, b.size / 4), background: b.color, left: -b.size / 2, top: -b.size / 2 }}
          initial={reduce ? { opacity: 0, x: b.x, y: b.y, rotate: b.rotate } : { opacity: 1, x: 0, y: 0, rotate: 0, scale: 0.6 }}
          animate={
            reduce
              ? { opacity: [0, 0.9, 0], x: b.x, y: b.y, rotate: b.rotate }
              : { opacity: [1, 1, 0], x: b.x, y: b.y + spread * 0.35, rotate: b.rotate, scale: 1 }
          }
          // the flight eases out; the fade keeps its own timing, so the
          // blocks are still there when they land and gone a beat later
          transition={{
            default: { duration: reduce ? 1.2 : 0.9, delay: b.delay, ease: [0.23, 1, 0.32, 1] },
            opacity: { duration: reduce ? 1.2 : 0.9, delay: b.delay, times: [0, 0.6, 1], ease: "linear" },
          }}
        />
      ))}
    </span>
  );
}

/** The welcome's confetti: blocks frozen mid-fall across an area, then
 * settling, for the "You're in" screen. Same rules as the burst. */
export function BlockConfetti({ color, seed = 11, count = 36 }: { color: string; seed?: number; count?: number }) {
  const reduce = useReducedMotion();
  const bits = useMemo(() => {
    const r = seeded(seed);
    return Array.from({ length: count }, (_, i) => ({
      left: r() * 100,
      top: r() * 70,
      size: 5 + Math.round(r() * 8),
      rotate: Math.round(r() * 80 - 40),
      opacity: 0.55 + r() * 0.45,
      color: i % 3 === 0 ? color : BLOKS_COLOURS[Math.floor(r() * BLOKS_COLOURS.length)],
      delay: r() * 0.25,
      fall: 30 + r() * 50,
    }));
  }, [color, seed, count]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          style={{
            position: "absolute",
            left: `${b.left}%`,
            top: `${b.top}%`,
            width: b.size,
            height: b.size,
            borderRadius: Math.max(1, Math.round(b.size / 4)),
            background: b.color,
          }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -b.fall, rotate: 0 }}
          animate={reduce ? { opacity: b.opacity } : { opacity: b.opacity, y: 0, rotate: b.rotate }}
          transition={{ duration: reduce ? 0.3 : 0.9, delay: reduce ? 0 : b.delay, ease: [0.23, 1, 0.32, 1] }}
        />
      ))}
    </div>
  );
}
