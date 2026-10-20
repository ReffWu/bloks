// The shape every settings page is made of: a titled group of rows, each
// row a name, one line of why, and its control on the right.
//
// One pattern on purpose. Settings is read more than it is changed, and a
// page where every block is its own card with its own heading makes the
// eye re-learn the layout each time; rows in a group read like a list.
//
// The pieces, all here so a page never invents its own:
//   SettingsPageHeader  the title, one line under it, and an eyebrow when
//                       the page belongs to something (a workspace)
//   SettingsGroup       a heading, the rows in one card, a footnote under
//                       it; `tone="danger"` for what cannot be undone
//   SettingRow          label, line, ? for the long story, control on the
//                       right; the control drops under the words when the
//                       column is too narrow to hold both
//   SettingsCard        a free-form block in the same card, for the
//                       connection cards and anything that is not rows
//   SettingsSelect      the one select, so every dropdown looks alike
//   SettingsEmpty       nothing here yet, and the one thing to do about it
//   SettingsSkeleton    the shape of a group while it loads
//   SavedMark           the quiet "Saved" beside a field that saves itself
import { forwardRef } from "react";
import { Check, ChevronDown } from "@/components/icons";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton, SkeletonLines } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { rowKey } from "@/lib/settingsPages";

export function SettingsPageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  /** A line above the title saying whose page this is. */
  eyebrow?: React.ReactNode;
  /** Beside the title, for the one thing the whole page offers. */
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-[280px]">
        {eyebrow && <div className="mb-2 flex items-center gap-2 text-small font-medium text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-balance text-heading font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-1.5 max-w-[62ch] text-pretty text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SettingsGroup({
  title,
  description,
  footnote,
  action,
  tone = "default",
  children,
  className,
}: {
  title?: React.ReactNode;
  /** A sentence under the heading, for a group that needs one. */
  description?: React.ReactNode;
  /** Small print under the card: a limit, a consequence, a pointer. */
  footnote?: React.ReactNode;
  /** One control on the heading's line, such as "Add". */
  action?: React.ReactNode;
  /** "danger" for the group that holds what cannot be undone. */
  tone?: "default" | "danger";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-9 last:mb-0", className)}>
      {(title || action) && (
        <div className="mb-2.5 flex min-h-[24px] items-center justify-between gap-3 px-1">
          {title && <h2 className={cn("text-body font-medium", tone === "danger" ? "text-destructive" : "text-muted-foreground")}>{title}</h2>}
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {description && <p className="-mt-1 mb-3 max-w-[62ch] px-1 text-pretty text-small text-muted-foreground">{description}</p>}
      <div
        className={cn(
          "flex flex-col divide-y overflow-hidden rounded-2xl border bg-card",
          tone === "danger" && "border-destructive/25 divide-destructive/15",
        )}
      >
        {children}
      </div>
      {footnote && <div className="mt-2.5 max-w-[66ch] px-1 text-pretty text-small leading-relaxed text-muted-foreground">{footnote}</div>}
    </section>
  );
}

export function SettingRow({
  label,
  description,
  info,
  control,
  children,
  htmlFor,
  error,
  rowId,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  info?: string;
  /** Sits on the right, vertically centred on the label block, and under
   * it when the column is narrow. */
  control?: React.ReactNode;
  /** Anything that belongs under the row: an expanded editor, a slider. */
  children?: React.ReactNode;
  htmlFor?: string;
  /** What went wrong, said where it happened. */
  error?: React.ReactNode;
  /** The row's address for a search result; taken from the label when
   * the label is plain words. */
  rowId?: string;
  className?: string;
}) {
  const key = rowId ?? (typeof label === "string" ? rowKey(label) : undefined);
  return (
    <div data-setting-row={key} className={cn("px-5 py-4 transition-colors duration-700", className)}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-ui font-medium text-foreground">
            {label}
            {info && <InfoTip text={info} />}
          </label>
          {description && (
            <div className="mt-0.5 max-w-[62ch] text-pretty text-body leading-relaxed text-muted-foreground">{description}</div>
          )}
        </div>
        {control && <div className="flex max-w-full shrink-0 items-center gap-2">{control}</div>}
      </div>
      {children}
      {error && (
        <p role="alert" className="mt-2 text-pretty text-small text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A block in the same card as a group, for what is not a list of rows. */
export function SettingsCard({ children, className, tone = "default" }: { children: React.ReactNode; className?: string; tone?: "default" | "danger" }) {
  return (
    <div className={cn("mb-9 rounded-2xl border bg-card p-5 last:mb-0", tone === "danger" && "border-destructive/25", className)}>
      {children}
    </div>
  );
}

/** The one dropdown: a native select, so the keyboard and the system's own
 * list work as people expect, dressed like the fields around it. */
export const SettingsSelect = forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(function SettingsSelect(
  { className, children, ...props },
  ref,
) {
  return (
    <span className={cn("relative inline-flex max-w-full", className)}>
      <select
        ref={ref}
        {...props}
        className="h-8 w-full min-w-0 appearance-none truncate rounded-lg border border-input bg-background pl-2.5 pr-8 text-body text-foreground outline-none transition-[border-color] duration-150 hover:border-foreground/25 focus-visible:border-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
});

/** Nothing here yet: what would be, and the one thing to do about it. */
export function SettingsEmpty({ title, body, action, icon }: { title: string; body?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-9 text-center">
      {icon && <div className="mb-1.5 flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">{icon}</div>}
      <div className="text-ui font-medium text-foreground">{title}</div>
      {body && <div className="max-w-[46ch] text-pretty text-body text-muted-foreground">{body}</div>}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  );
}

/** A group's shape while it loads: rows with a control where one will be. */
export function SettingsSkeleton({ rows = 3, title = true, label = "Loading" }: { rows?: number; title?: boolean; label?: string }) {
  return (
    <section aria-busy="true" aria-label={label} className="mb-9 last:mb-0">
      {title && <Skeleton className="mb-3.5 ml-1 h-3 w-28 rounded-full" />}
      <div className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-6 px-5 py-[18px]">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-40 rounded-full" />
              <SkeletonLines lines={1} size="body" className="mt-1.5 max-w-[340px]" />
            </div>
            <Skeleton className="h-[22px] w-[38px] rounded-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Saved", for a moment, beside a field that saves on its own. */
export function SavedMark({ on }: { on: boolean }) {
  return (
    <span
      aria-live="polite"
      className={cn("flex items-center gap-1 text-small text-success transition-opacity duration-200", on ? "opacity-100" : "opacity-0")}
    >
      {on && (
        <>
          <Check size={12} /> Saved
        </>
      )}
    </span>
  );
}
