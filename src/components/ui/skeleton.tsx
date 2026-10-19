// The shape of what is coming, drawn while it comes.
//
// A spinner says "wait"; a skeleton says "wait, and here is roughly what
// you will get", so the page does not jump when the real rows land on top
// of it. The shapes are quiet on purpose: the surface a shade off the
// page, and one slow band of light across it (styles.css, .skeleton),
// moved by transform so it stays on the compositor. Reduce motion stills
// the band and leaves the shapes.
//
// The pieces hide themselves from screen readers. Whatever holds them
// says what is loading once, through SkeletonGroup, rather than every bar
// announcing itself as nothing.
import { cn } from "@/lib/cn";

/** A block: a tile, a card, a button, anything with a size given. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} {...props} />;
}

/** The widths lines take, so a paragraph reads as a paragraph and not a
 * stack of equal bars. The last line is always the short one. */
const WIDTHS = ["100%", "92%", "96%", "88%"];

/**
 * Lines of text. Each bar is the cap height of the size it stands in for
 * and sits in that size's line box, so swapping in the real words moves
 * nothing.
 */
export function SkeletonLines({
  lines = 3,
  size = "body",
  className,
}: {
  lines?: number;
  size?: "small" | "body" | "ui";
  className?: string;
}) {
  const box = { small: "h-[18px]", body: "h-5", ui: "h-[22px]" }[size];
  const bar = { small: "h-2", body: "h-2.5", ui: "h-2.5" }[size];
  return (
    <div aria-hidden="true" className={cn("flex flex-col", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cn("flex items-center", box)}>
          <div
            className={cn("skeleton rounded-full", bar)}
            style={{ width: lines > 1 && i === lines - 1 ? "60%" : WIDTHS[i % WIDTHS.length] }}
          />
        </div>
      ))}
    </div>
  );
}

/** A face or an app tile: round for people and agents, a rounded square
 * for apps. */
export function SkeletonAvatar({
  size = 32,
  shape = "circle",
  className,
}: {
  size?: number;
  shape?: "circle" | "tile";
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton shrink-0", shape === "circle" ? "rounded-full" : "rounded-xl", className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * What holds a skeleton, and says once what it stands for. It fades in,
 * so a load that finishes quickly never shows a flash of grey.
 */
export function SkeletonGroup({
  label,
  className,
  children,
}: {
  /** Said to screen readers: "Loading skills". */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("skeleton-group", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
