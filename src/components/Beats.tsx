// The language of a whole-screen flow told in beats: making an agent, and
// first-run setup. One stepper, one way for a beat to turn, one heading,
// one agent card, so the two read as the same product rather than two
// that happen to share a palette.
//
// Lifted out of the new agent screen as it was, not redesigned on the
// way: what is here is what that screen already did.
import { motion } from "motion/react";
import { Check } from "@/components/icons";
import { BLOK_COLORS, type BlokColor, type BlokShape } from "@/lib/mascot";
import { BlokAvatar } from "./Avatar";
import { cn } from "@/lib/cn";

/** Quick, and over before the eye has finished moving: a beat changing is
 * a page turning, not a show. Reduce motion keeps only the fade. */
export const beat = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.23, 1, 0.32, 1] as const } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12, ease: "easeOut" as const } },
};

/** The ease every settle in these flows shares. */
export const settleEase = [0.23, 1, 0.32, 1] as const;

/**
 * Where you are in the beats; the ones already open are a click away.
 * `complete` ticks every beat, for the moment after the last one.
 */
export function Stepper<T extends string>({
  steps,
  step,
  isOpen,
  onGo,
  layoutId,
  complete = false,
}: {
  steps: ReadonlyArray<{ id: T; label: string }>;
  step: T;
  isOpen: (index: number) => boolean;
  onGo: (step: T) => void;
  /** One per flow, so two steppers never trade their highlight. */
  layoutId: string;
  complete?: boolean;
}) {
  const at = complete ? steps.length : steps.findIndex((s) => s.id === step);
  return (
    <nav aria-label="Steps" className="flex items-center gap-1 rounded-full border bg-card/80 p-1 backdrop-blur-sm">
      {steps.map((s, i) => {
        const on = !complete && s.id === step;
        const open = isOpen(i);
        return (
          <button
            key={s.id}
            onClick={() => open && onGo(s.id)}
            disabled={!open}
            aria-current={on ? "step" : undefined}
            className={cn(
              "relative flex h-7 items-center gap-1.5 rounded-full px-2.5 text-body font-medium outline-none transition-colors duration-150 disabled:opacity-45",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {on && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                className="absolute inset-0 z-0 rounded-full bg-accent"
              />
            )}
            <span
              className={cn(
                "relative z-[1] flex size-4 items-center justify-center rounded-full text-micro tabular-nums transition-colors duration-150",
                i < at ? "bg-brand-ink text-brand-foreground" : on ? "bg-foreground text-background" : "border border-current",
              )}
            >
              {i < at ? <Check size={9} strokeWidth={3} /> : i + 1}
            </span>
            <span className="relative z-[1] max-sm:hidden">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** A face that lands when it changes: a small settle, never a cut. */
export function AvatarLanding({
  color,
  shape,
  size,
  excited,
}: {
  color: BlokColor;
  shape: BlokShape;
  size: number;
  excited?: boolean;
}) {
  return (
    <motion.span
      key={`${color}-${shape}`}
      initial={{ scale: 0.86, opacity: 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", duration: 0.42, bounce: 0.4 }}
      className="block shrink-0"
    >
      <BlokAvatar color={color} shape={shape} expression={excited ? "excited" : "friendly"} size={size} />
    </motion.span>
  );
}

export function BeatHeading({ title, says }: { title: string; says: React.ReactNode }) {
  return (
    <header className="mb-7">
      <h1 className="text-balance text-display font-semibold text-foreground">{title}</h1>
      <p className="mt-1.5 text-pretty text-ui text-muted-foreground">{says}</p>
    </header>
  );
}

export function BeatLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-body font-semibold text-foreground">{children}</h2>
      {aside}
    </div>
  );
}

/**
 * The agent as it will be, before it is: the face, the name and line, the
 * first thing it will say, and the few facts that decide how it works.
 * Everything chosen on the left lands here as it is chosen.
 *
 * `compact` is the same card a size down, for a row of them side by side:
 * a smaller face, the greeting held to a few lines, and room at the foot
 * for the one thing to do with it.
 */
export function PreviewCard({
  identity,
  name,
  title,
  greeting,
  skills,
  facts = [],
  creating = false,
  empty = false,
  compact = false,
  footer,
}: {
  identity: { color: BlokColor; shape: BlokShape };
  name: string;
  title: string;
  greeting: string;
  skills: string[];
  facts?: Array<[string, string]>;
  creating?: boolean;
  empty?: boolean;
  compact?: boolean;
  footer?: React.ReactNode;
}) {
  const shownSkills = skills.filter((s) => s.trim());
  const most = compact ? 2 : 3;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl border bg-card shadow-[0_12px_40px_-16px_var(--shadow-color)]",
        compact && "flex h-full flex-col",
      )}
    >
      {/* the agent's own colour, faint, behind its face */}
      <div
        className={cn(
          "relative flex flex-col items-center px-6 transition-[background-color] duration-300",
          compact ? "pb-4 pt-6" : "pb-5 pt-8",
        )}
        style={{ backgroundColor: `color-mix(in srgb, ${BLOK_COLORS[identity.color]} 13%, transparent)` }}
      >
        <motion.div
          animate={creating ? { y: [0, -6, 0] } : { y: 0 }}
          transition={creating ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        >
          <AvatarLanding color={identity.color} shape={identity.shape} size={compact ? 64 : 88} excited={creating} />
        </motion.div>
        <div className={cn("w-full text-center", compact ? "mt-3" : "mt-4")}>
          <div className={cn("truncate text-title font-semibold tracking-tight", name ? "text-foreground" : "text-muted-foreground")}>
            {name || "Your agent"}
          </div>
          <div className="mt-0.5 line-clamp-2 min-h-[20px] text-body text-muted-foreground">
            {empty ? "Describe a job and they take shape here." : title || " "}
          </div>
        </div>
      </div>

      <div className={cn("px-5 pb-5 pt-4", compact && "flex flex-1 flex-col")}>
        {/* the first thing they will say, as it will look in the chat */}
        <div className="text-small font-medium text-muted-foreground">First words</div>
        <div className="mt-2 flex items-end gap-2">
          <BlokAvatar color={identity.color} shape={identity.shape} expression="friendly" size={22} />
          <div className="min-w-0 rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-body leading-relaxed text-foreground">
            <span className={cn(empty && "text-muted-foreground", compact && "line-clamp-3")}>{greeting}</span>
          </div>
        </div>

        {shownSkills.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {shownSkills.slice(0, most).map((skill, i) => (
              <span key={i} className="max-w-full truncate rounded-full border px-2.5 py-0.5 text-small text-muted-foreground">
                {skill.split(":")[0].slice(0, 32)}
              </span>
            ))}
            {shownSkills.length > most && (
              <span className="rounded-full border px-2.5 py-0.5 text-small text-muted-foreground">+{shownSkills.length - most}</span>
            )}
          </div>
        )}

        {facts.length > 0 && (
          <dl className="mt-4 flex flex-col divide-y rounded-xl border text-small">
            {facts.map(([term, value]) => (
              <div key={term} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="shrink-0 text-muted-foreground">{term}</dt>
                <dd className="min-w-0 truncate text-right font-medium text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {footer && <div className={cn("mt-4", compact && "mt-auto pt-4")}>{footer}</div>}
      </div>
    </div>
  );
}
