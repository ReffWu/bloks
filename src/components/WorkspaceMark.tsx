// A workspace's mark: a rounded tile in its colour with nine blocks on
// it, lit to its pattern (src/lib/workspaceMark.ts), or the logo its
// owner uploaded in the same rounded square. Drawn as one SVG on a 48
// unit box, so the switcher's 22px mark and the settings' 64px one are
// the same picture, not two drawings that drift apart.
import { useId } from "react";
import { MARK_BOX, MARK_CELL, MARK_CELL_RADIUS, MARK_RADIUS, markCells, type Mark } from "@/lib/workspaceMark";
import { cn } from "@/lib/cn";

export function WorkspaceMark({
  mark,
  logo,
  size = 24,
  label,
  className,
}: {
  mark: Mark | null;
  logo?: string | null;
  size?: number;
  /** Said to a screen reader; without it the mark is decoration beside
   * a name that says the same. */
  label?: string;
  className?: string;
}) {
  const clip = useId();
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  // a joined workspace whose owner's mark has not arrived yet is a quiet
  // tile, never a blank space where the switcher's eye expects one
  const color = mark?.color ?? "var(--muted-foreground)";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`}
      className={cn("shrink-0", className)}
      {...a11y}
    >
      {logo ? (
        <>
          <clipPath id={clip}>
            <rect width={MARK_BOX} height={MARK_BOX} rx={MARK_RADIUS} />
          </clipPath>
          <image href={logo} width={MARK_BOX} height={MARK_BOX} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
          {/* a hairline, so a white logo on a white page still has an edge */}
          <rect
            x={0.5}
            y={0.5}
            width={MARK_BOX - 1}
            height={MARK_BOX - 1}
            rx={MARK_RADIUS - 0.5}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.12}
          />
        </>
      ) : (
        <>
          <rect width={MARK_BOX} height={MARK_BOX} rx={MARK_RADIUS} fill={color} />
          {markCells(mark?.pattern ?? "000000000").map((cell, i) => (
            <rect
              key={i}
              x={cell.x}
              y={cell.y}
              width={MARK_CELL}
              height={MARK_CELL}
              rx={MARK_CELL_RADIUS}
              fill="#fff"
              fillOpacity={cell.on ? 0.95 : 0.2}
            />
          ))}
        </>
      )}
    </svg>
  );
}
