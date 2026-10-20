// A workspace's mark: a rounded tile in its colour with a three by three
// grid of blocks, some on. Drawn to the spec's proportions (radius 27% of
// the size, padding 15.6%, gap 6.25%) on a 48 unit square, so it is crisp
// from a 16 px switcher row to the middle of a QR code.
import type { WorkspaceMark as Mark } from "@/lib/members";

const CELL = 9;
const PAD = 7.5;
const GAP = 3;

export function WorkspaceMark({ mark, size = 28, className, title }: { mark: Mark; size?: number; className?: string; title?: string }) {
  const cells = [...mark.pattern.padEnd(9, "0").slice(0, 9)];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width="48" height="48" rx="13" fill={mark.color} />
      {cells.map((on, i) => (
        <rect
          key={i}
          x={PAD + (i % 3) * (CELL + GAP)}
          y={PAD + Math.floor(i / 3) * (CELL + GAP)}
          width={CELL}
          height={CELL}
          rx="2.5"
          fill="#fff"
          fillOpacity={on === "1" ? 0.95 : 0.2}
        />
      ))}
    </svg>
  );
}
