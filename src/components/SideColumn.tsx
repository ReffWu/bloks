// The column a place keeps beside its page, drawn the same way for every
// place that has one: the chat's list, Settings' pages, an agent's
// settings, Memory, Plugins, and the lists in Automations.
//
// Its right edge is the brand gradient running down it (styles.css,
// .side-divider), and that line is the handle: drag it to size the
// column between its limits, let go narrower than it can usefully be and
// it folds away, double click it to put it back where it started. The
// title bar's toggle and ⌘B fold it and bring it back, as they always
// have for the chat. Each column remembers its width and whether it is
// open under its own name (lib/sideColumn.ts).
//
// Folding is quick, a fifth of a second, and only the width and the
// opacity move; reduce motion makes it a cut. On a phone there is no
// column to fold: the page draws its list its own way, so all of this
// applies from Tailwind's md up.
//
// Folded, a page still needs its sections, and how they come back
// depends on how many there are:
//   SideTabs    many, as a strip of tabs along the top of the page, in
//               the column's own groups and order (Settings)
//   SideSwitch  three or fewer, as a small switch at the right of the
//               page's title row (Plugins, Memory), which a page's
//               header finds through FoldedSwitchSlot and TitleTools
//   ShowColumn  none, only the way to bring the column back (a list of
//               things rather than of sections)
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, PanelLeft } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { keysFor, platformOf } from "@/lib/shortcuts";
import {
  EDGE_STEP,
  SIDE_COLUMN,
  releaseColumnAt,
  setColumnOpen,
  setColumnResizing,
  setColumnWidth,
  stepFocus,
  useColumnInView,
  useColumnsFit,
  useSideColumn,
  type SideColumnSize,
} from "@/lib/sideColumn";

/** How long a fold takes, with the motion class below; the column's
 * contents leave the page once it is over. */
const FOLD_MS = 200;

export function SideColumn({
  id,
  size = SIDE_COLUMN,
  label,
  as: Tag = "aside",
  page = true,
  className,
  children,
}: {
  /** The name it is remembered by. */
  id: string;
  size?: SideColumnSize;
  /** What it is, for a screen reader: the landmark's name. */
  label: string;
  /** A nav for a list of pages; an aside for the rest. */
  as?: "aside" | "nav" | "div";
  /** False for the chat's list, which the title bar finds by place: it
   * is mounted on every page for the phone's drawer. */
  page?: boolean;
  /** The column's own look, and its layout on a phone, where it is not a
   * column. Its width is this component's. */
  className?: string;
  children: React.ReactNode;
}) {
  const column = useSideColumn(id, size);
  const fit = useColumnsFit();
  useColumnInView(id, page);
  const shown = !fit || column.open;

  // Folded, the contents stay for the length of the fold so they are seen
  // going, then leave: nothing hidden in a zero-wide box keeps focus,
  // takes a search, or keeps fetching.
  const [present, setPresent] = useState(shown);
  if (shown && !present) setPresent(true);
  useEffect(() => {
    if (shown || !present) return;
    const gone = setTimeout(() => setPresent(false), FOLD_MS + 60);
    return () => clearTimeout(gone);
  }, [shown, present]);

  return (
    <div
      data-side-column={id}
      className="relative flex shrink-0 flex-col md:h-full"
      style={{ "--side-w": `${column.width}px` } as React.CSSProperties}
    >
      <div
        inert={!shown || undefined}
        onTransitionEnd={(e) => {
          if (!shown && e.target === e.currentTarget && e.propertyName === "width") setPresent(false);
        }}
        className={cn(
          "flex min-h-0 flex-1 flex-col md:overflow-hidden md:transition-[width,opacity] md:duration-200 md:ease-out-quart",
          shown ? "md:w-(--side-w)" : "md:w-0 md:opacity-0",
          column.resizing && "md:transition-none",
        )}
      >
        {present && (
          <Tag
            id={`side-column-${id}`}
            aria-label={label}
            className={cn("flex min-h-0 flex-1 flex-col md:w-(--side-w) md:shrink-0", className)}
          >
            {children}
          </Tag>
        )}
      </div>
      {fit && column.open && <ColumnEdge id={id} size={size} width={column.width} resizing={column.resizing} />}
    </div>
  );
}

/**
 * The column's edge: the line, and twelve pixels of handle centred on it.
 * A drag moves the edge by as much as the pointer moves, wherever in those
 * twelve pixels it was taken, so a click alone never nudges the width.
 * Pointer capture keeps the drag when the pointer runs ahead of the edge.
 * From the keyboard, the arrows move it, Home and End take it to its
 * limits, and Enter folds the column, as a window splitter does.
 */
function ColumnEdge({ id, size, width, resizing }: { id: string; size: SideColumnSize; width: number; resizing: boolean }) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const from = e.clientX;
    const before = width;
    setColumnResizing(id, true);
    document.documentElement.setAttribute("data-column-resize", "");
    const move = (ev: PointerEvent) => setColumnWidth(id, before + ev.clientX - from, false);
    const up = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.documentElement.removeAttribute("data-column-resize");
      releaseColumnAt(id, before, ev.type === "pointercancel" ? before : before + ev.clientX - from);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? EDGE_STEP * 4 : EDGE_STEP;
    const to =
      e.key === "ArrowLeft" ? width - step : e.key === "ArrowRight" ? width + step : e.key === "Home" ? size.min : e.key === "End" ? size.max : null;
    if (to !== null) {
      e.preventDefault();
      setColumnWidth(id, to);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setColumnOpen(id, false);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls={`side-column-${id}`}
      aria-valuemin={size.min}
      aria-valuemax={size.max}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={resizing || undefined}
      onPointerDown={start}
      onDoubleClick={() => setColumnWidth(id, size.initial)}
      onKeyDown={onKey}
      className="side-edge absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
    >
      <span aria-hidden className="side-divider" />
    </div>
  );
}

const quietButton =
  "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.96]";

/** The way back to a folded column, with the key that does the same. */
export function ShowColumn({ id, label = "Show sidebar", text, className }: { id: string; label?: string; text?: string; className?: string }) {
  const keys = keysFor("toggleSidebar", platformOf())[0];
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setColumnOpen(id, true)}
            aria-label={text ? undefined : label}
            aria-expanded={false}
            className={cn(quietButton, text ? "px-2 text-body" : "w-8", className)}
          >
            <PanelLeft size={16} strokeWidth={1.75} />
            {text && <span className="whitespace-nowrap">{text}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          {label}
          {keys && <kbd className="rounded bg-primary-foreground/15 px-1.5 py-px font-sans text-caption">{keys}</kbd>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── many sections: a strip of tabs ────────────────────────────────────

export interface SideTab {
  id: string;
  label: string;
  /** A count or a word beside the label, as the column showed it. */
  badge?: React.ReactNode;
  tone?: "default" | "danger";
}

export interface SideTabGroup {
  id: string;
  /** What the group is called, for a screen reader. */
  name: string;
  /** Drawn before the group's tabs; a group without one is set apart by
   * the hairline alone. */
  label?: React.ReactNode;
  tabs: SideTab[];
}

/**
 * A folded column's sections as tabs along the top of its page: the same
 * groups in the same order, each after a hairline and its name, the
 * current one lit. The strip scrolls sideways when they do not fit, with
 * the wheel as well as a trackpad, fades at an edge with more beyond it,
 * and keeps the current tab in view. It is navigation, so a screen reader
 * hears a list of pages with the current one marked; the arrows walk it
 * and Home and End reach its ends, and Tab enters it once, at the
 * current page.
 */
export function SideTabs({
  column,
  label,
  groups,
  current,
  onPick,
  tools,
}: {
  /** The folded column, for the button that brings it back. */
  column: string;
  label: string;
  groups: SideTabGroup[];
  current: string | null;
  onPick: (id: string) => void;
  /** Buttons after the one that brings the column back, such as search. */
  tools?: React.ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const uid = useId();
  const reduce = useReducedMotion();
  const [more, setMore] = useState({ before: false, after: false });

  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      const before = el.scrollLeft > 1;
      const after = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((m) => (m.before === before && m.after === after ? m : { before, after }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      watch.disconnect();
    };
  }, []);

  // the current tab in view, with room either side so its neighbours show;
  // at once the first time, since the strip has only just appeared
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = row.current;
    const tab = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !tab) return;
    const pad = 40;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    const to = left - pad < el.scrollLeft ? left - pad : right + pad > el.scrollLeft + el.clientWidth ? right + pad - el.clientWidth : null;
    if (to !== null) el.scrollTo({ left: Math.max(0, to), behavior: reduce || !placed.current ? "auto" : "smooth" });
    placed.current = true;
  }, [current, reduce]);

  const walk = (e: React.KeyboardEvent) => {
    const tabs = [...(row.current?.querySelectorAll<HTMLButtonElement>("[data-side-tab]") ?? [])];
    const next = stepFocus(e.key, tabs.indexOf(document.activeElement as HTMLButtonElement), tabs.length);
    if (next === null) return;
    e.preventDefault();
    // focus brings it into view along the strip on its own
    tabs[next]?.focus();
  };

  const hasCurrent = groups.some((g) => g.tabs.some((t) => t.id === current));
  const fade =
    more.before || more.after
      ? `linear-gradient(to right, ${more.before ? "transparent, #000 32px" : "#000"}, ${more.after ? "#000 calc(100% - 32px), transparent" : "#000"})`
      : undefined;

  return (
    <div className="flex h-12 shrink-0 animate-fade-in items-center gap-0.5 border-b pl-2.5 pr-1.5">
      <ShowColumn id={column} />
      {tools}
      <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-border" />
      <nav aria-label={label} className="min-w-0 flex-1">
        <motion.div
          ref={row}
          layoutScroll
          onKeyDown={walk}
          onWheel={(e) => {
            // a mouse wheel only scrolls down; here down means along
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
          }}
          style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
          className="relative flex items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {groups.map((group, gi) => (
            <div key={group.id} role="group" aria-label={group.name} className="flex shrink-0 items-center gap-0.5">
              {gi > 0 && <span aria-hidden className="mx-2 h-4 w-px shrink-0 bg-border" />}
              {group.label && (
                <span aria-hidden className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pl-1 pr-1.5 text-small text-muted-foreground">
                  {group.label}
                </span>
              )}
              {group.tabs.map((tab, ti) => {
                const on = tab.id === current;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    data-side-tab
                    tabIndex={on || (!hasCurrent && gi === 0 && ti === 0) ? 0 : -1}
                    aria-current={on ? "page" : undefined}
                    onClick={() => onPick(tab.id)}
                    className={cn(
                      "relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-body outline-none transition-[background-color,color] duration-150",
                      on ? "font-medium text-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                      tab.tone === "danger" && !on && "text-destructive/85 hover:text-destructive",
                    )}
                  >
                    {/* the lit tab slides to the one picked rather than
                        blinking there, as the column's own list does */}
                    {on && (
                      <motion.span
                        layoutId={`side-tab-${uid}`}
                        transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                        className="absolute inset-0 rounded-lg bg-accent"
                      />
                    )}
                    <span className="relative">{tab.label}</span>
                    {tab.badge && <span className="relative flex items-center">{tab.badge}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </motion.div>
      </nav>
    </div>
  );
}

// ── three or fewer: a switch on the title row ─────────────────────────

export interface SideSwitchItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  /** Picked from a menu instead, for a section that is a list of its own
   * (Memory's agents): the segment opens it, and is lit while one of its
   * entries is the page. */
  menu?: Array<{ id: string; label: React.ReactNode; icon?: React.ReactNode }>;
}

/**
 * A folded column's few sections as a switch, sized to sit at the right
 * of the page's title. The selection slides to the one picked, the way
 * every switch in the app moves. Navigation like the tabs: a group of
 * pages with the current one marked, and the arrows walk it.
 */
export function SideSwitch({
  column,
  label,
  items,
  current,
  onPick,
}: {
  column: string;
  label: string;
  items: SideSwitchItem[];
  current: string;
  onPick: (id: string) => void;
}) {
  const uid = useId();
  const group = useRef<HTMLDivElement>(null);
  const walk = (e: React.KeyboardEvent) => {
    const segments = [...(group.current?.querySelectorAll<HTMLButtonElement>("[data-side-tab]") ?? [])];
    const next = stepFocus(e.key, segments.indexOf(document.activeElement as HTMLButtonElement), segments.length);
    if (next === null) return;
    e.preventDefault();
    segments[next]?.focus();
  };
  const segment = (on: boolean) =>
    cn(
      "relative flex h-7 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-body font-medium outline-none transition-colors duration-150",
      on ? "text-foreground" : "text-muted-foreground hover:text-foreground data-[state=open]:text-foreground",
    );
  const lit = (
    <motion.span
      layoutId={`side-switch-${uid}`}
      transition={{ type: "spring", duration: 0.25, bounce: 0 }}
      className="absolute inset-0 rounded-lg bg-background shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.08)]"
    />
  );

  return (
    <div className="flex shrink-0 animate-fade-in items-center gap-1">
      <ShowColumn id={column} />
      <div ref={group} role="group" aria-label={label} onKeyDown={walk} className="flex min-w-0 gap-0.5 rounded-[10px] bg-muted p-0.5">
        {items.map((item) => {
          const on = item.id === current || Boolean(item.menu?.some((entry) => entry.id === current));
          const body = (
            <>
              {on && lit}
              <span className="relative flex min-w-0 items-center gap-1.5">
                {item.icon && <span className="flex shrink-0 items-center text-muted-foreground">{item.icon}</span>}
                <span className="max-w-[160px] truncate">{item.label}</span>
                {item.badge}
                {item.menu && <ChevronDown size={13} className="shrink-0 text-muted-foreground" />}
              </span>
            </>
          );
          if (!item.menu) {
            return (
              <button
                key={item.id}
                type="button"
                data-side-tab
                aria-current={on ? "page" : undefined}
                onClick={() => onPick(item.id)}
                className={segment(on)}
              >
                {body}
              </button>
            );
          }
          return (
            <DropdownMenu key={item.id}>
              <DropdownMenuTrigger asChild>
                <button type="button" data-side-tab aria-current={on ? "page" : undefined} className={segment(on)}>
                  {body}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-[220px] overflow-y-auto">
                {item.menu.map((entry) => (
                  <DropdownMenuItem key={entry.id} onSelect={() => onPick(entry.id)}>
                    {entry.icon}
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry.id === current && <Check size={14} />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
    </div>
  );
}

// The switch belongs on the title row of whatever page is open, and each
// page draws its own heading, so the place hands the switch down and the
// headings take it from here rather than every page being passed it.
const FoldedSwitch = createContext<React.ReactNode>(null);

/** Around a place's pages: the switch their headings show, or nothing
 * while the column is open. */
export const FoldedSwitchSlot = FoldedSwitch.Provider;

export function useFoldedSwitch(): React.ReactNode {
  return useContext(FoldedSwitch);
}

/** The right of a page's title row: the folded column's switch on the
 * title's own line when there is one, and the page's tools under it. */
export function TitleTools({ children, className }: { children?: React.ReactNode; className?: string }) {
  const folded = useFoldedSwitch();
  const tools = children ? <div className={cn("flex items-center gap-1.5", className)}>{children}</div> : null;
  if (!folded) return tools;
  return (
    <div className="flex flex-col items-end gap-3">
      {folded}
      {tools}
    </div>
  );
}
