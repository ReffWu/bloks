// Arranging the morning brief: which sections it shows, in what order,
// which are pinned to the top, and whether it notifies (GitHub 378).
//
// Every routine and watcher is a section of its own, beside the brief's
// own few, so choosing what feeds the brief and arranging it are the same
// list: a card shown is a source that feeds it, a card hidden is one that
// does not. A routine can also be told to keep its reports to the brief,
// with no notification of its own, which is how several routines become
// one notification in the morning. Each change is saved as it is made,
// the way the brief's time is.
import { ChevronDown } from "@/components/icons";
import { ChevronUp } from "@/components/icons";
import { Eye } from "@/components/icons";
import { Pin } from "@/components/icons";
import { Repeat } from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SubHead } from "./OverviewParts";
import { cn } from "@/lib/cn";
import { moveSection, SECTION_NAMES, toggleHidden, togglePin, type LayoutSection } from "@/lib/briefLayout";
import { t } from "@/lib/i18n";

export interface ArrangedSection extends LayoutSection {
  /** "waiting", "failed", "agents", "memory", or the source's kind. */
  kind: string;
  name?: string;
  briefOnly?: boolean;
}

export function BriefCustomize({
  open,
  onOpenChange,
  sections,
  notify,
  allClear,
  onArrange,
  onSettings,
  onBriefOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: ArrangedSection[];
  notify: boolean;
  allClear: boolean;
  onArrange: (next: ArrangedSection[]) => void;
  onSettings: (patch: { notify?: boolean; allClear?: boolean }) => void;
  onBriefOnly: (routineId: string, on: boolean) => void;
}) {
  const byKey = new Map(sections.map((s) => [s.key, s]));
  // the editing helpers know only the layout; what each section is rides
  // along by its key
  const keep = (next: LayoutSection[]) => onArrange(next.map((s) => ({ ...byKey.get(s.key)!, ...s })));
  const pinnedCount = sections.filter((s) => s.pinned).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-[520px] flex-col p-0">
        <div className="px-5 pt-5">
          <DialogTitle>{t("briefCustomize.customizeTheBrief")}</DialogTitle>
          <DialogDescription>
            {t("briefCustomize.whatItShowsInWhat")}
          </DialogDescription>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          <SubHead>{t("briefCustomize.sections")}</SubHead>
          <ul className="-mx-2 flex flex-col" aria-label={t("briefCustomize.sectionsOfTheBrief")}>
            {sections.map((s, i) => {
              const name = s.name ?? (SECTION_NAMES[s.key] ? t(SECTION_NAMES[s.key]) : s.key);
              const source = s.kind === "routine" || s.kind === "watcher";
              const first = i === 0 || sections[i - 1].pinned !== s.pinned;
              const last = i === sections.length - 1 || sections[i + 1].pinned !== s.pinned;
              return (
                <li
                  key={s.key}
                  className={cn(
                    "flex items-start gap-2 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-accent/40",
                    // where the pinned group ends, a hairline says so
                    s.pinned && i === pinnedCount - 1 && pinnedCount < sections.length && "mb-1 rounded-b-none border-b border-border/70",
                  )}
                >
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label={t("briefCustomize.moveUp", { name })}
                      disabled={first}
                      onClick={() => keep(moveSection(sections, s.key, -1))}
                      className="rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("briefCustomize.moveDown", { name })}
                      disabled={last}
                      onClick={() => keep(moveSection(sections, s.key, 1))}
                      className="rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <div className={cn("min-w-0 flex-1 pt-0.5 transition-opacity duration-150", s.hidden && "opacity-55")}>
                    <div className="flex items-center gap-1.5">
                      {s.kind === "routine" ? (
                        <Repeat size={12} className="shrink-0 text-muted-foreground" />
                      ) : s.kind === "watcher" ? (
                        <Eye size={12} className="shrink-0 text-muted-foreground" />
                      ) : null}
                      <span className="truncate text-ui text-foreground">{name}</span>
                    </div>
                    <p className="text-small text-muted-foreground">
                      {s.kind === "routine" ? t("briefCustomize.aRoutinesLatestReport") : s.kind === "watcher" ? t("briefCustomize.aWatchersLatestChange") : t("briefCustomize.partOfEveryBrief")}
                    </p>
                    {s.kind === "routine" && !s.hidden && (
                      <label className="mt-1.5 flex items-center gap-2 text-small text-muted-foreground">
                        <Switch
                          checked={Boolean(s.briefOnly)}
                          onCheckedChange={(on) => onBriefOnly(s.key.slice("routine:".length), on)}
                          aria-label={t("briefCustomize.reportOnlyInBrief", { name })}
                          className="scale-[0.8] origin-left"
                        />
                        <span className="-ml-1.5">{s.briefOnly ? t("briefCustomize.onlyInTheBriefNo") : t("briefCustomize.alsoNotifiesWhenItRuns")}</span>
                      </label>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={s.pinned ? t("briefCustomize.unpin", { name }) : t("briefCustomize.pinNameToTop", { name })}
                    aria-pressed={s.pinned}
                    title={s.pinned ? t("briefCustomize.pinnedToTheTop") : t("briefCustomize.pinToTheTop")}
                    onClick={() => keep(togglePin(sections, s.key))}
                    className={cn(s.pinned ? "text-brand-ink" : "text-muted-foreground")}
                  >
                    <Pin size={14} />
                  </Button>
                  <Switch
                    checked={!s.hidden}
                    onCheckedChange={() => keep(toggleHidden(sections, s.key))}
                    aria-label={source ? t("briefCustomize.feedsTheBrief", { name }) : t("briefCustomize.show", { name })}
                    className="mt-1"
                  />
                </li>
              );
            })}
          </ul>

          <SubHead className="mt-6">{t("briefCustomize.notification")}</SubHead>
          <div className="flex flex-col gap-3 pb-3 text-body text-foreground">
            <label className="flex items-start justify-between gap-4">
              <span>
                {t("briefCustomize.oneNotificationWhenReady")}
                <span className="block text-small text-muted-foreground">{t("briefCustomize.opensThatMorningsBriefYour")}</span>
              </span>
              <Switch checked={notify} onCheckedChange={(on) => onSettings({ notify: on })} aria-label={t("briefCustomize.notifyWhenTheBriefIs")} />
            </label>
            <label className={cn("flex items-start justify-between gap-4 transition-opacity duration-150", !notify && "opacity-50")}>
              <span>
                {t("briefCustomize.alsoOnAQuietMorning")}
                <span className="block text-small text-muted-foreground">{t("briefCustomize.toHearThatAllIs")}</span>
              </span>
              <Switch checked={allClear} disabled={!notify} onCheckedChange={(on) => onSettings({ allClear: on })} aria-label={t("briefCustomize.notifyOnAQuietMorning")} />
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
