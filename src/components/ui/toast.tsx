// A word about something that just happened, said once and then gone.
//
// `toast` is a plain function, not a hook, so a click handler, a promise's
// catch or the store can all say something without being handed a
// context: `toast.success("Saved", { action: { label: "Undo", onClick } })`.
// The list lives outside React and one Toaster draws it (App.tsx).
//
// They sit at the top, under the title bar, where the old error notice
// was: the bottom of the window belongs to the composer, and a toast that
// covers the box you are typing in is a toast in the way. Three at most;
// a fourth sends the oldest home. Hovering or focusing any of them holds
// every timer, and so does the window being hidden, so nothing is missed
// while you are reading it or looking elsewhere. Esc on a focused toast
// puts it away.
//
// Screen readers hear each one through two quiet live regions that are
// always on the page (one polite, one assertive for errors), because a
// region added at the same moment as its words is often not read at all.
// The visible list is a labelled region with real buttons in it, so an
// Undo is reachable by keyboard like anything else.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Info, TriangleAlert, X } from "@/components/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Saying the same id again updates that toast and restarts its time,
   * rather than stacking a copy of it. */
  id?: string;
  /** A second, quieter line. */
  description?: string;
  /** One thing to do about it: Undo, Retry, Open. */
  action?: ToastAction;
  /** In milliseconds; Infinity stays until dismissed. */
  duration?: number;
  /** When it leaves, however it leaves. */
  onDismiss?: () => void;
}

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  description?: string;
  action?: ToastAction;
  duration: number;
  onDismiss?: () => void;
  /** Bumped by an update, so the timer starts over. */
  version: number;
}

/** Long enough to read a short line twice. An action buys more time,
 * since deciding to press Undo takes longer than reading "Archived". An
 * error keeps the six seconds the old notice had. */
const DURATION: Record<ToastKind, number> = { info: 4000, success: 4000, error: 6000 };
const WITH_ACTION = 6000;
const MOST = 3;

let items: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** What screen readers hear next, by urgency (see the live regions). */
let spoken = { polite: "", assertive: "" };
let said = 0;

function show(kind: ToastKind, message: string, options: ToastOptions = {}): string {
  const id = options.id ?? `toast-${++counter}`;
  const existing = items.find((t) => t.id === id);
  const item: ToastItem = {
    id,
    kind,
    message,
    description: options.description,
    action: options.action,
    duration: options.duration ?? (options.action ? WITH_ACTION : DURATION[kind]),
    onDismiss: options.onDismiss,
    version: (existing?.version ?? 0) + 1,
  };
  if (existing) {
    items = items.map((t) => (t.id === id ? item : t));
  } else {
    // newest first, and the oldest goes once there are too many
    const next = [item, ...items];
    for (const gone of next.slice(MOST)) gone.onDismiss?.();
    items = next.slice(0, MOST);
  }
  // the same words twice are still two things to hear; a region whose
  // text did not change says nothing, so every other one carries a space
  const words = `${item.description ? `${message}. ${item.description}` : message}${++said % 2 ? "\u00a0" : ""}`;
  spoken = kind === "error" ? { ...spoken, assertive: words } : { ...spoken, polite: words };
  emit();
  return id;
}

function dismiss(id?: string) {
  const leaving = id === undefined ? items : items.filter((t) => t.id === id);
  if (!leaving.length) return;
  items = id === undefined ? [] : items.filter((t) => t.id !== id);
  emit();
  for (const t of leaving) t.onDismiss?.();
}

type ToastFn = ((message: string, options?: ToastOptions) => string) & {
  info: (message: string, options?: ToastOptions) => string;
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  dismiss: (id?: string) => void;
};

export const toast: ToastFn = Object.assign((message: string, options?: ToastOptions) => show("info", message, options), {
  info: (message: string, options?: ToastOptions) => show("info", message, options),
  success: (message: string, options?: ToastOptions) => show("success", message, options),
  error: (message: string, options?: ToastOptions) => show("error", message, options),
  dismiss,
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
const spokenSnapshot = () => spoken;

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <Check size={15} strokeWidth={2.2} className="text-success" />,
  error: <TriangleAlert size={15} className="text-destructive" />,
  info: <Info size={15} className="text-muted-foreground" />,
};

/** Every toast, drawn. Mounted once, at the top of the app. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const words = useSyncExternalStore(subscribe, spokenSnapshot, spokenSnapshot);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hidden = useHidden();
  const paused = hovered || focused || hidden;

  // an empty list cannot be hovered, and a pointer that was over the last
  // one as it left never sends the leave
  useEffect(() => {
    if (list.length === 0) {
      setHovered(false);
      setFocused(false);
    }
  }, [list.length]);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {words.polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {words.assertive}
      </div>
      <section
        aria-label={t("toast.notifications")}
        // Below the header and off to the right on a desktop, over the
        // transcript's empty margin, so a toast never sits on the chat's
        // name or the composer's Send. A phone has no margin to spare, so
        // there they keep to the top centre.
        className="pointer-events-none fixed inset-x-0 top-14 z-70 flex justify-center px-4 md:inset-x-auto md:right-5 md:top-24 md:px-0"
      >
        <ol
          className="relative flex w-full max-w-[420px] flex-col items-center gap-2 md:w-[360px] md:items-stretch"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
          }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((item) => (
              <ToastRow key={item.id} item={item} paused={paused} />
            ))}
          </AnimatePresence>
        </ol>
      </section>
    </>
  );
}

function ToastRow({ item, paused }: { item: ToastItem; paused: boolean }) {
  const remaining = useRef(item.duration);
  // an update is a new message, owed its full time
  useEffect(() => {
    remaining.current = item.duration;
  }, [item.version, item.duration]);
  useEffect(() => {
    if (paused || !Number.isFinite(remaining.current)) return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss(item.id), Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, item.id, item.version]);

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // the same width for every toast in a stack on a desktop, so they
      // line up as a column instead of a ragged edge
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: "easeOut" } }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          dismiss(item.id);
        }
      }}
      className={cn(
        "pointer-events-auto flex w-fit min-w-0 max-w-full items-start gap-2.5 md:w-full rounded-xl border bg-popover py-2 pl-3 pr-1.5 text-popover-foreground shadow-lg shadow-(color:--shadow-color)",
        item.kind === "error" && "border-destructive/30",
      )}
    >
      <span className="flex h-5 shrink-0 items-center" aria-hidden="true">
        {ICON[item.kind]}
      </span>
      <div className="min-w-0 flex-1 py-px">
        <div className="text-pretty break-words text-body text-foreground">{item.message}</div>
        {item.description && (
          <div className="mt-0.5 text-pretty break-words text-small text-muted-foreground">{item.description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              dismiss(item.id);
            }}
            className="h-6 rounded-md px-2 text-small font-medium text-brand-ink outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.96]"
          >
            {item.action.label}
          </button>
        )}
        <button
          type="button"
          aria-label={t("common.dismiss")}
          onClick={() => dismiss(item.id)}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]"
        >
          <X size={13} />
        </button>
      </div>
    </motion.li>
  );
}

/** Whether the window is out of sight, which holds every timer. */
function useHidden() {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}
