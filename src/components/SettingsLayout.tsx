// The shape every settings page is made of: a titled group of rows, each
// row a name, one line of why, and its control on the right.
//
// One pattern on purpose. Settings is read more than it is changed, and a
// page where every block is its own card with its own heading makes the
// eye re-learn the layout each time; rows in a group read like a list.
import { cn } from "@/lib/cn";
import { InfoTip } from "@/components/ui/info-tip";

export function SettingsPageHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-balance text-heading font-semibold text-foreground">{title}</h1>
      {description && <p className="mt-1.5 text-pretty text-body text-muted-foreground">{description}</p>}
    </div>
  );
}

export function SettingsGroup({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-9", className)}>
      {title && (
        <h2 className="mb-2.5 px-1 text-body font-medium text-muted-foreground">{title}</h2>
      )}
      <div className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">{children}</div>
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
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  info?: string;
  /** Sits on the right, vertically centred on the label block. */
  control?: React.ReactNode;
  /** Anything that belongs under the row: an error, an expanded editor. */
  children?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-ui font-medium text-foreground">
            {label}
            {info && <InfoTip text={info} />}
          </label>
          {description && (
            <div className="mt-0.5 text-pretty text-body leading-relaxed text-muted-foreground">{description}</div>
          )}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children}
    </div>
  );
}
