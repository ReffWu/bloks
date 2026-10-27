// The pieces every Customize page is laid out with (Customize.tsx and
// CatalogPage.tsx): a page's heading and tools, the pills that switch
// what it shows, section titles, and the catalogue grid with its tile,
// its two lines and its one action.
import { RefreshCw } from "@/components/icons";
import { Search } from "@/components/icons";
import { Settings } from "@/components/icons";
import { Skeleton, SkeletonAvatar, SkeletonGroup } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { TitleTools } from "./SideColumn";

/** The tile an item's mark sits on, the same for an app and a skill. */
export function Tile({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {children}
    </span>
  );
}

export const pill =
  "flex h-9 items-center rounded-full outline-none transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.97]";

/** The heading every Customize page shares: title, line, and the tools. */
export function PageHeader({
  title,
  says,
  search,
  onSearch,
  searchRef,
  placeholder,
  onRefresh,
  refreshing,
  onSettings,
  add,
}: {
  title: string;
  says: string;
  search: string;
  onSearch: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  placeholder: string;
  onRefresh: () => void;
  refreshing?: boolean;
  onSettings: () => void;
  add: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-balance text-display font-semibold text-foreground">{title}</h1>
        <p className="mt-1.5 text-pretty text-ui text-muted-foreground">{says}</p>
      </div>
      <TitleTools className="max-sm:w-full">
        <label className="flex h-9 w-[240px] items-center max-sm:w-auto max-sm:min-w-0 max-sm:flex-1 gap-2 rounded-full border bg-card px-3.5 transition-colors duration-150 focus-within:border-ring/50 lg:w-[280px]">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (onSearch(""), e.currentTarget.blur())}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <button
          onClick={onRefresh}
          aria-label="Refresh"
          title="Refresh"
          className={cn(pill, "size-9 justify-center text-muted-foreground hover:bg-accent hover:text-foreground")}
        >
          <RefreshCw size={16} className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
        </button>
        <button
          onClick={onSettings}
          aria-label="Settings"
          title="Settings"
          className={cn(pill, "size-9 justify-center text-muted-foreground hover:bg-accent hover:text-foreground")}
        >
          <Settings size={16} />
        </button>
        {add}
      </TitleTools>
    </header>
  );
}

/** Two or three choices of what a page shows, as pills. */
export function Pills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: React.ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="mt-7 flex items-center gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full px-4 text-body font-medium outline-none transition-colors duration-150",
            option.value === value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1 mt-9 flex items-center justify-between border-b pb-3">
      <h2 className="text-lead font-semibold text-foreground">{children}</h2>
      {aside}
    </div>
  );
}

/** "See A, B, and 12 more": what the fold is hiding, by name. */
export function MoreLine({ hidden, onClick }: { hidden: string[]; onClick: () => void }) {
  if (!hidden.length) return null;
  const named = hidden.slice(0, 2);
  const rest = hidden.length - named.length;
  return (
    <button
      onClick={onClick}
      className="mt-3 px-1 text-left text-body text-muted-foreground transition-colors duration-150 hover:text-foreground"
    >
      See {named.join(", ")}
      {rest > 0 ? `, and ${rest} more` : ""}
    </button>
  );
}

/** One item in a catalogue grid: its tile, its name and line, its action. */
export function GridItem({
  tile,
  name,
  line,
  action,
  onOpen,
}: {
  tile: React.ReactNode;
  name: React.ReactNode;
  line?: string;
  action?: React.ReactNode;
  onOpen?: () => void;
}) {
  const body = (
    <>
      {tile}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium text-foreground">{name}</span>
        {line && <span className="mt-0.5 block truncate text-body text-muted-foreground">{line}</span>}
      </span>
    </>
  );
  return (
    <div className="group flex min-w-0 items-center gap-3.5 rounded-xl px-2 py-3 transition-colors duration-150 hover:bg-accent/40">
      {onOpen ? (
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3.5 text-left outline-none">
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3.5">{body}</span>
      )}
      {action && <span className="flex shrink-0 items-center">{action}</span>}
    </div>
  );
}

/** A catalogue grid before it arrives: GridItem's own outline, a tile and
 * two lines, so the real items land where their shapes already were. */
export function GridSkeleton({ label, count = 6, className }: { label: string; count?: number; className?: string }) {
  return (
    <SkeletonGroup label={label} className={cn("grid grid-cols-1 gap-x-8 md:grid-cols-2", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-w-0 items-center gap-3.5 px-2 py-3">
          <SkeletonAvatar size={40} shape="tile" />
          <div className="min-w-0 flex-1">
            <div className="flex h-[22px] items-center">
              <Skeleton className="h-2.5 rounded-full" style={{ width: `${32 + ((i * 17) % 24)}%` }} />
            </div>
            <div className="mt-0.5 flex h-5 items-center">
              <Skeleton className="h-2 rounded-full" style={{ width: `${62 + ((i * 23) % 30)}%` }} />
            </div>
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

export const ROUND = "flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.94] disabled:opacity-40";
