// Choosing a workspace's mark: a row of colours, a row of shapes drawn
// in the colour chosen, and a shuffle for somebody who would rather be
// surprised. The same picker in the New workspace dialog and in a
// workspace's settings, so a mark is chosen the same way everywhere.
//
// Each row is a radio group, moved through with the arrow keys and
// chosen as it moves, the way a group of radios is. A choice another
// workspace on this computer already wears is shown and not offered:
// no two marks here are ever the same (electron/workspace-marks.mjs).
import { useRef } from "react";
import { RefreshCw, RotateCcw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { CHOICE_COLORS, CHOICE_PATTERNS, sameMark, type Mark } from "@/lib/workspaceMark";
import { WorkspaceMark } from "./WorkspaceMark";

/** What each colour is called, for a screen reader and a tooltip. */
const COLOR_NAMES: Record<string, string> = {
  "#E9A83A": "Amber",
  "#3E5BD9": "Indigo",
  "#149E8E": "Teal",
  "#8E4FC9": "Violet",
  "#E8664A": "Coral",
  "#D64C7F": "Rose",
  "#2A86C7": "Blue",
  "#7A8F2A": "Olive",
  "#B86A3C": "Copper",
  "#4D6478": "Slate",
  "#3F9A5B": "Green",
  "#5B5F6B": "Graphite",
};

const PATTERN_NAMES: Record<string, string> = {
  "010111101": "House",
  "111101111": "Ring",
  "101010101": "Cross",
  "010111010": "Plus",
  "010101010": "Diamond",
  "111010010": "Tee",
  "100100111": "Corner",
  "100110111": "Steps",
  "101101111": "Cup",
  "110010011": "Zigzag",
  "111000111": "Bars",
  "101000101": "Dots",
};

export const colorName = (color: string) => COLOR_NAMES[color.toUpperCase()] ?? "Colour";

/** Arrow keys move the choice within a radio group, and choose as they
 * go; `dir` is which way, for stepping over a choice that is taken. */
function arrows(count: number, at: number, choose: (i: number, dir: 1 | -1) => void) {
  return (e: React.KeyboardEvent) => {
    const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!by && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Home") return choose(0, 1);
    if (e.key === "End") return choose(count - 1, -1);
    choose((at + by + count) % count, by > 0 ? 1 : -1);
  };
}

export function MarkPicker({
  value,
  onChange,
  taken = [],
  onShuffle,
  defaultMark = null,
  disabled = false,
  className,
}: {
  value: Mark | null;
  onChange: (mark: Mark) => void;
  /** The marks the other workspaces here wear. */
  taken?: readonly Mark[];
  onShuffle?: () => void;
  /** What "Back to default" goes back to, when there is a default. */
  defaultMark?: Mark | null;
  disabled?: boolean;
  className?: string;
}) {
  const colorRow = useRef<HTMLDivElement>(null);
  const shapeRow = useRef<HTMLDivElement>(null);
  const color = value?.color ?? CHOICE_COLORS[0]!;
  const pattern = value?.pattern ?? CHOICE_PATTERNS[0]!;
  const isTaken = (mark: Mark) => taken.some((m) => sameMark(m, mark));
  // a drawn shape the picker does not list is still the one worn, shown first
  const patterns = CHOICE_PATTERNS.includes(pattern) ? CHOICE_PATTERNS : [pattern, ...CHOICE_PATTERNS];
  const colorAt = Math.max(0, CHOICE_COLORS.findIndex((c) => c.toUpperCase() === color.toUpperCase()));
  const patternAt = Math.max(0, patterns.indexOf(pattern));

  const pick = (mark: Mark, row: React.RefObject<HTMLDivElement | null>, index: number) => {
    if (disabled || isTaken(mark) || sameMark(mark, value)) return;
    onChange(mark);
    // the focus follows the choice, as a radio group's does
    requestAnimationFrame(() => row.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[index]?.focus());
  };
  /** The next choice along that nobody else wears, for the arrow keys. */
  const freeFrom = (count: number, start: number, dir: number, markAt: (i: number) => Mark) => {
    for (let n = 0; n < count; n++) {
      const i = (start + dir * n + count) % count;
      if (!isTaken(markAt(i))) return i;
    }
    return start;
  };
  const showDefault = defaultMark && !sameMark(defaultMark, value);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        ref={colorRow}
        role="radiogroup"
        aria-label="Colour"
        className="flex flex-wrap gap-1.5"
        onKeyDown={arrows(CHOICE_COLORS.length, colorAt, (i, dir) => {
          const free = freeFrom(CHOICE_COLORS.length, i, dir, (j) => ({ color: CHOICE_COLORS[j]!, pattern }));
          pick({ color: CHOICE_COLORS[free]!, pattern }, colorRow, free);
        })}
      >
        {CHOICE_COLORS.map((c, i) => {
          const mark = { color: c, pattern };
          const on = i === colorAt;
          const worn = !on && isTaken(mark);
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={worn ? `${colorName(c)}, another workspace wears this` : colorName(c)}
              title={worn ? `${colorName(c)}: another workspace wears this with this shape` : colorName(c)}
              tabIndex={on ? 0 : -1}
              disabled={disabled || worn}
              onClick={() => pick(mark, colorRow, i)}
              className={cn(
                "relative size-6 shrink-0 rounded-full outline-none transition-[scale,box-shadow] duration-150 ease-out",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                on ? "ring-2 ring-foreground/80 ring-offset-2 ring-offset-background" : "hover:scale-110 active:scale-95",
                worn && "cursor-not-allowed opacity-30 hover:scale-100",
              )}
              style={{ backgroundColor: c }}
            />
          );
        })}
      </div>
      <div
        ref={shapeRow}
        role="radiogroup"
        aria-label="Shape"
        className="flex flex-wrap gap-1"
        onKeyDown={arrows(patterns.length, patternAt, (i, dir) => {
          const free = freeFrom(patterns.length, i, dir, (j) => ({ color, pattern: patterns[j]! }));
          pick({ color, pattern: patterns[free]! }, shapeRow, free);
        })}
      >
        {patterns.map((p, i) => {
          const mark = { color, pattern: p };
          const on = i === patternAt;
          const worn = !on && isTaken(mark);
          const name = PATTERN_NAMES[p] ?? "Its own shape";
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={worn ? `${name}, another workspace wears this` : name}
              title={worn ? `${name}: another workspace wears this` : name}
              tabIndex={on ? 0 : -1}
              disabled={disabled || worn}
              onClick={() => pick(mark, shapeRow, i)}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-[9px] outline-none transition-[background-color,scale] duration-150 ease-out",
                "focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-accent ring-1 ring-foreground/25" : "hover:bg-accent/70 active:scale-95",
                worn && "cursor-not-allowed opacity-30 hover:bg-transparent",
              )}
            >
              <WorkspaceMark mark={mark} size={22} />
            </button>
          );
        })}
      </div>
      {(onShuffle || showDefault) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {onShuffle && (
            <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground" disabled={disabled} onClick={onShuffle}>
              <RefreshCw size={13} />
              Shuffle
            </Button>
          )}
          {showDefault && (
            <Button type="button" variant="ghost" size="sm" className={cn("gap-1.5 text-muted-foreground", !onShuffle && "-ml-2")} disabled={disabled || isTaken(defaultMark)} onClick={() => onChange(defaultMark)}>
              <RotateCcw size={13} />
              Back to default
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
