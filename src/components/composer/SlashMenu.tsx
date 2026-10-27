// The `/` list (#51), drawn: matches under where they come from, and a
// line at the foot that says which keys work, since a list that takes
// the arrow keys away from the text is otherwise a surprise.
//
// It floats over the tray rather than pushing it up. Opening a list is a
// glance, and a glance should not move everything above the box.
import { cn } from "@/lib/cn";
import { grouped, type Command } from "@/lib/slashCommands";
import { t } from "@/lib/i18n";

export function SlashMenu({
  label,
  offered,
  pick,
  onHover,
  onChoose,
  empty,
}: {
  label: string;
  /** In the order the list draws them (see grouped), which is the order
   * the arrow keys walk. */
  offered: Command[];
  pick: number;
  onHover: (index: number) => void;
  onChoose: (command: Command) => void;
  /** Said when there is nothing to offer at all. */
  empty: string;
}) {
  const groups = grouped(offered);
  return (
    <div className="animate-pop-in origin-bottom overflow-hidden rounded-xl border bg-popover shadow-lg shadow-(color:--shadow-color)">
      <div role="listbox" aria-label={label} className="max-h-[min(22rem,50vh)] overflow-y-auto overscroll-contain p-1">
        {offered.length === 0 ? (
          <div className="px-2 py-1.5 text-body text-muted-foreground">{empty}</div>
        ) : (
          groups.map((group) => (
            <div key={group.source} role="group" aria-label={group.label}>
              <div className="px-2 pb-0.5 pt-1.5 text-caption font-medium text-muted-foreground">{group.label}</div>
              {group.commands.map((c) => {
                const i = offered.indexOf(c);
                return (
                  <button
                    key={`${c.source}:${c.id}`}
                    type="button"
                    role="option"
                    aria-selected={i === pick}
                    onMouseEnter={() => onHover(i)}
                    // mousedown, not click, so the textarea keeps its caret
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChoose(c);
                    }}
                    className={cn(
                      "flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-100",
                      i === pick ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <span className="shrink-0 font-mono text-body font-medium text-brand-ink">
                      {c.prefix ?? "/"}
                      {c.id}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">{c.description || c.name}</span>
                    {c.source === "engine" && (
                      <span className="shrink-0 text-caption text-muted-foreground/80">
                        {c.kind === "command" ? "command" : "skill"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      {offered.length > 0 && (
        <div className="border-t px-3 py-1.5 text-caption text-muted-foreground max-sm:hidden" aria-hidden>
          {t("slashMenu.pickTabInsertEscClose")}
        </div>
      )}
    </div>
  );
}
