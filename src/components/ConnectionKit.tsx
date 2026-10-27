// The parts every connection screen shares: Telegram, phones, Slack,
// Discord, WhatsApp, email and Cloud.
//
// One way of saying whether a thing is working, so "Connected" means the
// same in every card. One checklist, whose steps tick when the server says
// a step happened rather than when a button was pressed. One secret field
// that reads its own shape as it is typed, so a pasted token that is
// clearly the wrong one is caught here and not by a round trip. And one
// small moment for when something pairs, because that is the point at
// which somebody has finished, and it should feel like it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check } from "@/components/icons";
import { Copy } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

const easeOut = [0.23, 1, 0.32, 1] as const;

// ---------------------------------------------------------------------------
// Health

/**
 * on: working, end to end, as far as this computer can tell.
 * wait: on its way, or waiting for somebody to do the next thing.
 * issue: switched on and not working, which is the one worth a glance.
 * off: switched off, or never set up.
 */
export type Health = "on" | "wait" | "issue" | "off";

/** The status pill in a card's corner. A dot, a word or two, and the same
 * colours everywhere, so a glance down the page reads like a list. */
export function HealthLine({ tone, label, title }: { tone: Health; label: string; title?: string }) {
  return (
    <span
      aria-live="polite"
      title={title}
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-small font-medium",
        tone === "on" && "bg-success/10 text-success",
        (tone === "wait" || tone === "issue") && "bg-warning/10 text-warning",
        tone === "off" && "bg-muted text-muted-foreground",
      )}
    >
      {tone === "issue" ? (
        <TriangleAlert size={11} className="shrink-0" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "off" ? "border border-current" : "bg-current",
            tone === "wait" && "animate-pulse",
          )}
        />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** A card's head: its name, what it is for, and how it is doing, with the
 * switch beside the pill when there is one. */
export function ConnectionHeader({
  icon,
  title,
  info,
  says,
  health,
  control,
}: {
  icon?: ReactNode;
  title: string;
  /** The longer story behind a ? beside the title, so `says` can stay
   * one line. */
  info?: string;
  says: ReactNode;
  health?: ReactNode;
  control?: ReactNode;
}) {
  // The pill and the switch share the title's line, so the sentence under
  // it gets the card's full width, which on a phone is most of what it has.
  return (
    <div>
      <div className="flex min-h-[22px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {icon}
          <span className="truncate text-ui font-semibold text-foreground">{title}</span>
          {info && <InfoTip text={info} className="shrink-0" />}
        </div>
        {(health || control) && (
          <div className="flex shrink-0 items-center gap-2.5">
            {health}
            {control}
          </div>
        )}
      </div>
      <div className="mt-1 max-w-[60ch] text-pretty text-body leading-relaxed text-muted-foreground">{says}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The checklist

/** done: the server said so. now: yours to do. wait: done on your side,
 * waiting to hear back. later: not yet. */
export type StepState = "done" | "now" | "wait" | "later";

export interface Step {
  key: string;
  title: ReactNode;
  state: StepState;
  /** Shown while the step is now or wait: the instructions and the field. */
  body?: ReactNode;
  /** Shown once it is done: what it came to, like the bot's name. */
  summary?: ReactNode;
  /** Keep the body in view once done. A step ticked by a field's own
   * shape check is still being typed into, and folding it away would
   * take the field out from under the cursor. */
  keep?: boolean;
}

export function Checklist({ label, steps, className }: { label: string; steps: Step[]; className?: string }) {
  return (
    <ol aria-label={label} className={cn("mt-4", className)}>
      {steps.map((step, i) => {
        const open = step.state === "now" || step.state === "wait" || (step.state === "done" && step.keep);
        const last = i === steps.length - 1;
        return (
          <li
            key={step.key}
            aria-current={step.state === "now" || step.state === "wait" ? "step" : undefined}
            className={cn("relative flex gap-3", !last && "pb-4")}
          >
            {/* the thread between the marks fills in behind each done step */}
            {!last && (
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-0.5 left-[11px] top-7 w-px transition-colors duration-300",
                  step.state === "done" ? "bg-brand-ink/45" : "bg-border",
                )}
              />
            )}
            <StepMark n={i + 1} state={step.state} />
            <div className="min-w-0 flex-1 pt-px">
              <div
                className={cn(
                  "text-body font-medium transition-colors duration-150",
                  step.state === "later" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.title}
              </div>
              {step.state === "done" && !open && step.summary && (
                <div className="mt-0.5 truncate text-small text-muted-foreground">{step.summary}</div>
              )}
              {open && step.body && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: easeOut }}
                  className="mt-1.5"
                >
                  {step.body}
                </motion.div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepMark({ n, state }: { n: number; state: StepState }) {
  return (
    <span className="relative z-[1] flex size-6 shrink-0 items-center justify-center">
      {state === "done" ? (
        <motion.span
          key="done"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 0.28, bounce: 0.45 }}
          className="flex size-6 items-center justify-center rounded-full bg-brand-ink text-brand-foreground"
        >
          <Check size={12} strokeWidth={3} />
        </motion.span>
      ) : (
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full border bg-card text-small font-medium tabular-nums transition-colors duration-150",
            state === "later" ? "text-muted-foreground" : "border-foreground/40 text-foreground",
          )}
        >
          {state === "wait" ? <Loader2 size={12} className="animate-spin text-muted-foreground" /> : n}
        </span>
      )}
    </span>
  );
}

/** Small print under a step: the how, kept to a sentence or two. */
export function StepNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-pretty text-small leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

// ---------------------------------------------------------------------------
// Secrets, read as they are typed

/**
 * A field for something secret, which never shows what was typed, says
 * calmly what the thing should look like until it does, and then says so.
 *
 * `shape` is only ever a format the server or the platform has written
 * down. Whether a mismatch also holds back saving is the caller's to
 * decide: where the platform keeps the right to change its format, it is
 * a hint and nothing more, and the server's real check is the one that
 * counts.
 */
export function SecretField({
  id,
  label,
  value,
  onChange,
  shape,
  hint,
  placeholder,
  secret = true,
  quietLabel,
  onEnter,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  shape: RegExp;
  hint: string;
  placeholder?: string;
  secret?: boolean;
  /** The step's own title already names the field, so the label is for
   * screen readers only. */
  quietLabel?: boolean;
  onEnter?: () => void;
  className?: string;
}) {
  const typed = value.trim();
  const ok = shape.test(typed);
  return (
    <div className={className}>
      <label htmlFor={id} className={quietLabel ? "sr-only" : "mb-1 block text-small font-medium text-muted-foreground"}>
        {label}
      </label>
      <Input
        id={id}
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={`${id}-hint`}
        aria-invalid={typed && !ok ? true : undefined}
        className="h-8 bg-background font-mono text-body"
      />
      <div id={`${id}-hint`} className="mt-1 flex min-h-[18px] items-center gap-1 text-small text-muted-foreground">
        {typed && ok ? (
          <>
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", duration: 0.24, bounce: 0.4 }}
              className="flex"
            >
              <Check size={12} strokeWidth={2.5} className="text-success" />
            </motion.span>
            Looks right
          </>
        ) : (
          hint
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The moment

/**
 * True for a moment after `now` turns true, and only when this screen saw
 * it false first: opening Settings on something that has worked for a
 * week is not news. `undefined` means not known yet, and counts as
 * neither, so a first load never sets it off.
 */
export function useJustHappened(now: boolean | undefined, ms = 2600): boolean {
  const sawFalse = useRef(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (now === undefined) return;
    if (!now) {
      sawFalse.current = true;
      setOn(false);
      return;
    }
    if (!sawFalse.current) return;
    sawFalse.current = false;
    setOn(true);
    const timer = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(timer);
  }, [now, ms]);
  return on;
}

/** Something just paired or connected: its name, a check that lands, and
 * one ring going out. Over in under 300ms; reduced motion keeps the fade. */
export function PairedMoment({ icon, title, detail }: { icon: ReactNode; title: ReactNode; detail?: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, ease: easeOut }}
      className="mt-4 flex items-center gap-3.5 rounded-xl bg-brand-soft px-3.5 py-3"
    >
      <span className="relative flex size-10 shrink-0 items-center justify-center">
        {!reduced && (
          <motion.span
            aria-hidden
            initial={{ scale: 0.8, opacity: 0.55 }}
            animate={{ scale: 1.75, opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="absolute inset-0 rounded-full bg-brand-ink/30"
          />
        )}
        <motion.span
          initial={{ scale: 0.55, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 0.28, bounce: 0.45 }}
          className="relative flex size-10 items-center justify-center rounded-full bg-brand-ink text-brand-foreground"
        >
          {icon}
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", duration: 0.24, bounce: 0.5, delay: 0.06 }}
            className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-brand-ink text-brand-foreground ring-2 ring-brand-soft"
          >
            <Check size={9} strokeWidth={3} />
          </motion.span>
        </motion.span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-ui font-semibold text-foreground">{title}</span>
        {detail && <span className="block text-pretty text-small text-muted-foreground">{detail}</span>}
      </span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Small things

/** A value to take somewhere else: a link, a callback URL, a word. */
export function CopyRow({ label, value, big }: { label?: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {label && <span className="w-[92px] shrink-0 text-small text-muted-foreground">{label}</span>}
      {/* a word to read off a screen and type on a phone gets room to be read */}
      <code
        className={cn(
          "min-w-0 flex-1 truncate rounded-md bg-muted font-mono text-foreground",
          big ? "px-2.5 py-1 text-lead tracking-wider" : "px-2 py-1 text-small",
        )}
      >
        {value}
      </code>
      <Button
        size="sm"
        variant="secondary"
        className={big ? "h-8" : undefined}
        aria-label={copied ? t("common.copied") : `Copy ${label ?? (big ? "the word" : "this")}`}
        onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </Button>
    </div>
  );
}

/** What went wrong, in the words of whatever said no. */
export function ConnectionError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="mt-3 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-small leading-relaxed text-destructive">
      {children}
    </div>
  );
}

/** A plain-spoken aside that has to be read before anything is typed:
 * where messages go, what is and is not encrypted. */
export function ConnectionNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-3 rounded-lg bg-muted/60 px-3 py-2 text-pretty text-small leading-relaxed text-muted-foreground", className)}>
      {children}
    </div>
  );
}
