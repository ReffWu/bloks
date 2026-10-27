// Choosing what an agent thinks with.
//
// One list, read top to bottom: every engine as a heading with its models
// under it, the one in use first and checked. Selection is always an
// exact instance id: two instances can share a driver, and guessing from
// the driver would silently send a turn to the wrong one.
//
// Engines that are not usable stay in the list, dimmed, carrying the
// reason and a way to set them up. Hiding them would leave someone
// wondering where their engine went, when what they need to know is that
// it is installed but signed out. The same goes for an engine with a
// newer release: a model that is not in the list is usually a CLI that is
// out of date, so the list says so under that engine's name.
//
// A long catalog (OpenRouter has hundreds) shows its first few and the
// one in use, with the rest a press away, and a search box at the top
// matches every word typed against the name or the id across every
// engine. Enter takes the first match, the arrows walk the list, and
// Escape clears the search, then closes.
//
// It lives in two places. Settings has it as a field. Under the composer
// it is the model's name in quiet text with the effort beside it, where
// the choice is made, since what a message runs on is decided while
// writing it; there it opens upwards and carries the effort as a small
// choice at its foot, because the two are one decision about how hard
// this agent thinks.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "@/components/icons";
import { ChevronDown } from "@/components/icons";
import { Settings2 as SettingsIcon } from "@/components/icons";
import { Search } from "@/components/icons";
import { useStore, type Bot, type InstanceInfo, type ModelSelection } from "@/state/store";
import { ProviderMark } from "./ProviderIcons";
import { EngineUpdateNote } from "./EngineSetup";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/cn";
import { backupOptions, isOwnRun, offersBackup } from "@/lib/backupChoice";
import { BLOKS_AI_NAME, CREDITS_ENGINE } from "@/lib/credits";
import { EFFORT_LABELS, effortChoice, isEffort } from "@/lib/effort";
import { quietButton, useDismiss } from "./composer/Shell";
import { SettingsSelect } from "./SettingsLayout";
import { t } from "@/lib/i18n";

/** Catalogs this long or shorter are read at a glance, not searched. */
const SEARCH_ABOVE = 8;
/** How many of an engine's models show before "Show all". */
const FOLDED = 6;

function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  // one model, whatever was saved before it had only one
  if (instance?.driverKind === CREDITS_ENGINE) return BLOKS_AI_NAME;
  const label = instance?.models.options.find((o) => o.id === model)?.label;
  return label && label !== model ? label : readableId(model);
}

/** Words that read as letters, not as a name. */
const ACRONYMS = new Set(["gpt", "glm", "llm", "ai", "api", "xl", "mini"]);

/**
 * A model id said as a name, for engines that list ids with no label of
 * their own: "opencode/big-pickle" reads "Big Pickle", "gpt-5.2-codex"
 * reads "GPT 5.2 Codex", "claude-sonnet-4-5" reads "Claude Sonnet 4.5".
 * The id itself stays one hover away, in the row's tooltip.
 */
export function readableId(id: string): string {
  const bare = id.split("/").pop() || id;
  // a version split by a dash ("4-5") is one number, not two words
  const joined = bare.replace(/(\d)[-_](\d)(?!\d{3,})/g, "$1.$2");
  // a trailing release date ("20251101") is for machines, not people
  const words = joined.split(/[-_\s]+/).filter((w, i, all) => w && !(i === all.length - 1 && i > 0 && /^\d{8}$/.test(w)));
  if (!words.length) return id;
  return words
    .map((w) => (w.toLowerCase() === "mini" ? "mini" : ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** A model's name without its engine's in front: "Opus 5.5" rather than
 * "Claude Opus 5.5". It already sits under the engine's heading in the
 * list, and in the composer's row the shorter name is the one people say. */
function shortName(instance: InstanceInfo | undefined, label: string): string {
  if (!instance) return label;
  const engine = instance.displayName.toLowerCase();
  for (const sep of [" ", "/", ": "]) {
    const prefix = `${engine}${sep}`;
    if (label.toLowerCase().startsWith(prefix) && label.length > prefix.length) return label.slice(prefix.length);
  }
  return label;
}

const usable = (i: InstanceInfo) => i.snapshot.state === "available";

/** The model a selection runs on. An empty one means the engine's
 * default; any other is exactly what is sent, listed or not, so it is
 * shown as itself rather than as the default it is not. */
function effectiveModel(instance: InstanceInfo | undefined, model: string): string {
  return model || (instance?.models.default ?? model);
}

/** The characters a model id is made of; the server holds to the same. */
const MODEL_ID = /^[\w.:@/[\]+-]+$/;

/** One focusable row in the list, so the arrow keys can walk them all. */
const OPTION = "[data-model-option]:not(:disabled)";

const optionRow =
  "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-body leading-snug outline-none transition-colors duration-150 focus-visible:bg-accent";

export function ModelPicker({
  bot,
  className,
  value,
  onPick,
  noneLabel,
  exclude,
  variant = "header",
}: {
  /** Whose model this is. Optional only with `onPick`, which picks
   * for something that is not an agent yet (the new-agent default). */
  bot?: Bot;
  className?: string;
  /** Pick something other than what the agent runs on (its backup).
   * `value` null shows `noneLabel`, and the list offers it as a choice. */
  value?: ModelSelection | null;
  onPick?: (selection: ModelSelection | null) => void;
  noneLabel?: string;
  /** The engine and model not to offer: what the backup stands in for.
   * Other models on that engine are still offered. */
  exclude?: ModelSelection;
  /** "composer" is the row under the box: quiet text, opens upwards, and
   * offers the agent's reasoning effort under the models. */
  variant?: "header" | "composer";
}) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [unfolded, setUnfolded] = useState<string[]>([]);
  // Which engines' lists are open. Each opening starts with only the one
  // in use, so the menu reads as a short list of engines with the familiar
  // one ready; any other is a tap on its name away.
  const [expanded, setExpanded] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Where a field's list sits, measured from the field when it opens. */
  const [place, setPlace] = useState<CSSProperties | null>(null);
  // Closing from inside (Escape in the search) hands the keyboard back
  // to the name it opened from, not to nowhere.
  const close = () => {
    if (rootRef.current?.contains(document.activeElement) || panelRef.current?.contains(document.activeElement)) {
      triggerRef.current?.focus();
    }
    setOpen(false);
  };
  const rootRef = useDismiss(open, () => close(), panelRef);

  const custom = onPick !== undefined;
  const composer = variant === "composer";
  // effort belongs to an agent, so only a picker for one offers it, and
  // only the levels its engine and model have; beside the name is the
  // level its turns are sent, which a saved one the engine lacks is not
  const effort = composer && bot && !custom ? effortChoice(state.instances, bot.modelSelection, bot.effort) : undefined;
  const effortLabel = effort?.value ? EFFORT_LABELS[effort.value] : undefined;
  const selection: ModelSelection = (custom ? value : bot?.modelSelection) ?? { instanceId: "", model: "" };
  // an engine whose only model is the excluded one has nothing to offer
  const instances = exclude ? state.instances.filter((i) => offersBackup(i, exclude)) : state.instances;
  const active = instances.find((i) => i.instanceId === selection.instanceId);
  // the one in use first, then what can be used, then what cannot, ties
  // keeping the fleet's own order
  const ordered = [...instances].sort(
    (a, b) =>
      Number(b.instanceId === selection.instanceId) - Number(a.instanceId === selection.instanceId) ||
      Number(usable(b)) - Number(usable(a)),
  );
  const searchable =
    instances.reduce((n, i) => n + (usable(i) ? i.models.options.length : 0), 0) > SEARCH_ABOVE ||
    instances.some((i) => usable(i) && i.models.acceptsAnyId);

  // As a field (Settings) the list is drawn over the whole page, since the
  // card the field sits in clips what hangs out of it. It opens below
  // when there is room and above when there is not, and a scroll of the
  // page, which would leave it floating off its field, closes it.
  useLayoutEffect(() => {
    if (!open || composer) return setPlace(null);
    const at = triggerRef.current?.getBoundingClientRect();
    if (!at) return;
    const right = Math.max(12, window.innerWidth - at.right);
    const below = window.innerHeight - at.bottom - 18;
    const above = at.top - 18;
    setPlace(
      below >= Math.min(420, above)
        ? { top: at.bottom + 6, right, maxHeight: Math.min(544, below) }
        : { bottom: window.innerHeight - at.top + 6, right, maxHeight: Math.min(544, above) },
    );
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, composer]);

  // Opening starts at the model in use, so a long list never hides it.
  // each opening starts folded to the engine in use
  useEffect(() => {
    if (open) setExpanded(selection.instanceId ? [selection.instanceId] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const current = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const typed = query.trim();
  const groups = ordered.map((instance) => {
    const matching = backupOptions(instance, exclude).filter((o) => {
      const text = `${o.label} ${o.id} ${instance.displayName}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const isActive = selection.instanceId === instance.instanceId;
    const runs = effectiveModel(instance, selection.model);
    // A saved model this list does not have (a newer one typed in, or one
    // the engine stopped listing) still runs as itself; it is flagged,
    // never swapped for the default behind the person's back.
    const unlisted =
      isActive &&
      instance.driverKind !== CREDITS_ENGINE &&
      selection.model &&
      !instance.models.options.some((o) => o.id === selection.model) &&
      words.every((w) => selection.model.toLowerCase().includes(w))
        ? selection.model
        : null;
    // an engine that takes any id offers the one being typed
    const typedId =
      usable(instance) &&
      instance.models.acceptsAnyId &&
      MODEL_ID.test(typed) &&
      typed !== unlisted &&
      !isOwnRun(instance, typed, exclude) &&
      !instance.models.options.some((o) => o.id === typed)
        ? typed
        : null;
    // a search opens every engine: a match tucked away is no match at all
    const closed = !words.length && !expanded.includes(instance.instanceId);
    const folds = !words.length && !unfolded.includes(instance.instanceId) && matching.length > FOLDED + 1;
    const shown = folds
      ? matching.filter((o, i) => i < FOLDED || (isActive && o.id === runs))
      : matching;
    return { instance, matching, shown, unlisted, typedId, folds, isActive, runs, closed };
  });
  // while searching, an engine with nothing that matches has nothing to say
  const visible = words.length
    ? groups.filter((g) => g.matching.length || g.unlisted || g.typedId)
    : groups;
  // Enter takes a model some engine lists before an id one would accept,
  // or "gpt" typed with Claude in use would send Claude a GPT id
  const first =
    visible.find((g) => usable(g.instance) && g.matching.length) ?? visible.find((g) => usable(g.instance) && g.typedId);

  const pick = (instance: InstanceInfo, model: string) => {
    const next = { instanceId: instance.instanceId, model };
    if (custom) onPick(next);
    else if (bot) dispatch({ type: "setModel", botId: bot.id, selection: next });
    close();
  };

  const openSettings = () => {
    setOpen(false);
    dispatch({ type: "toggleAppSettings", open: true, page: "engines" });
  };

  /** Up and down walk the rows, from the search box too. */
  const walk = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    // the effort list at the foot has arrows of its own
    if (e.target instanceof HTMLSelectElement) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(OPTION) ?? [])];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + step));
    rows[next].focus();
  };

  const full = active || !custom ? modelLabel(active, effectiveModel(active, selection.model)) : (noneLabel ?? "None");
  const name = composer ? shortName(active, full) : full;
  const portalled = (panel: ReactNode) => (composer ? panel : createPortal(panel, document.body));
  const described = active ? `${active.displayName}, ${full}` : full;

  return (
    // Under the composer the list hangs from the row, not from the name,
    // so it lines up with the box's edge and covers Send cleanly.
    <div ref={rootRef} className={cn("min-w-0", !composer && "relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setQuery("");
          setUnfolded([]);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={described}
        aria-label={`Model: ${described}${effortLabel ? `, ${effortLabel} effort` : ""}`}
        className={
          composer
            ? cn(quietButton, "max-w-full")
            : "flex h-7 items-center gap-1.5 rounded-lg px-2 text-body text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-[0.98]"
        }
      >
        {!composer && active && (
          <span className="relative flex">
            <ProviderMark driverKind={active.driverKind} size={13} />
            {state.engineUpdates[active.driverKind] && (
              <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-brand ring-2 ring-background" aria-label={t("modelPicker.updateAvailable")} />
            )}
          </span>
        )}
        <span className={cn("truncate", composer ? "max-w-[150px] sm:max-w-[220px]" : "max-w-[140px]")}>{name}</span>
        {effortLabel && <span className="shrink-0 text-muted-foreground/70">{effortLabel}</span>}
        {!composer && <ChevronDown size={13} className="opacity-60" />}
      </button>

      {open && (composer || place) && portalled(
        <div
          ref={panelRef}
          data-model-picker-content
          role="dialog"
          aria-label={t("modelPicker.chooseAModel")}
          onKeyDown={walk}
          style={place ?? undefined}
          // capped to the window, so a long list scrolls instead of running
          // off the edge where nothing can reach it
          className={cn(
            "z-50 flex w-[320px] max-w-[calc(100vw-24px)] animate-pop-in flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg shadow-(color:--shadow-color)",
            composer
              ? "absolute bottom-full right-0 mb-2 max-h-[min(32rem,calc(100dvh-9rem))] origin-bottom-right"
              : cn("fixed", place?.top !== undefined ? "origin-top-right" : "origin-bottom-right"),
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1 pt-2.5">
            <span className="text-small font-medium text-muted-foreground">{t("modelPicker.model")}</span>
            {/* the way to everything this list cannot do: connect an
                engine, sign in, update, add a key */}
            {!custom && (
              <button
                type="button"
                onClick={openSettings}
                className="-mr-1 flex h-6 items-center gap-1 rounded-md px-1.5 text-small text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-95"
              >
                <SettingsIcon size={13} />
                {t("modelPicker.engines")}
              </button>
            )}
          </div>
          {searchable && (
            <div className="shrink-0 px-2 pb-1.5 pt-1">
              <div className="flex items-center gap-1.5 rounded-lg bg-accent/70 px-2 py-[5px] transition-colors duration-150 focus-within:bg-accent">
                <Search size={13} className="shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && query) {
                      e.preventDefault();
                      e.stopPropagation();
                      setQuery("");
                    } else if (e.key === "Enter" && first) {
                      e.preventDefault();
                      const id = first.matching[0]?.id ?? first.typedId;
                      if (id) pick(first.instance, id);
                    }
                  }}
                  placeholder={instances.some((i) => i.models.acceptsAnyId) ? t("modelPicker.searchOrTypeAModel") : t("modelPicker.searchModels")}
                  aria-label={t("modelPicker.searchModels")}
                  className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          )}

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
            {custom && active && !words.length && (
              <button
                type="button"
                data-model-option
                onClick={() => {
                  onPick(null);
                  setOpen(false);
                }}
                className={cn(optionRow, "mt-1 text-muted-foreground hover:bg-accent hover:text-foreground")}
              >
                {noneLabel ?? t("modelPicker.none")}
              </button>
            )}
            {visible.length === 0 && (
              <div className="px-2 py-3 text-body text-muted-foreground">
                {instances.length ? t("modelPicker.noModelsMatch") : t("modelPicker.noEnginesFoundIsBloks")}
              </div>
            )}
            {visible.map(({ instance, shown, matching, unlisted, typedId, folds, runs, isActive, closed }) => {
              const off = !usable(instance);
              const update = Boolean(state.engineUpdates[instance.driverKind]);
              const provider = state.providers.find((p) => p.kind === instance.driverKind);
              return (
                <div key={instance.instanceId} role="group" aria-label={instance.displayName} className="border-t border-border/70 pt-1 first:border-t-0 [&:not(:first-child)]:mt-1">
                  <div className="flex items-center gap-2 px-2 pb-0.5 pt-1.5">
                    {off ? (
                      <>
                        <span className="flex shrink-0 opacity-50">
                          <ProviderMark driverKind={instance.driverKind} size={14} />
                        </span>
                        <span className="min-w-0 truncate text-small font-medium text-muted-foreground">{instance.displayName}</span>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-expanded={!closed}
                        onClick={() =>
                          setExpanded((e) => (e.includes(instance.instanceId) ? e.filter((id) => id !== instance.instanceId) : [...e, instance.instanceId]))
                        }
                        className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none transition-colors duration-150 hover:bg-accent"
                      >
                        <span className="flex shrink-0">
                          <ProviderMark driverKind={instance.driverKind} size={14} />
                        </span>
                        <span className="min-w-0 truncate text-small font-medium text-foreground">{instance.displayName}</span>
                        {closed && <span className="shrink-0 text-caption tabular-nums text-muted-foreground">{matching.length}</span>}
                        <ChevronDown
                          size={13}
                          className={cn("shrink-0 text-muted-foreground transition-transform duration-150 ease-out", closed && "-rotate-90")}
                        />
                      </button>
                    )}
                    {/* an agent on a chat-only engine cannot run commands
                        or touch files, and that is worth knowing here */}
                    {provider && !provider.agentic && (
                      <span className="shrink-0 text-caption text-muted-foreground">{t("modelPicker.chatOnly")}</span>
                    )}
                    {/* how this engine's list was made is a footnote, not
                        something to read on the way to picking a model */}
                    {!off && instance.models.note && <InfoTip text={instance.models.note} />}
                    {/* the whole update note is for the engine in use, where
                        a missing model is being looked for; elsewhere a dot */}
                    {update && !isActive && !off && (
                      <span title={t("modelPicker.updateAvailable2")} aria-label={t("modelPicker.updateAvailable2")} className="size-1.5 shrink-0 rounded-full bg-brand" />
                    )}
                    {off && !custom && (
                      <button
                        type="button"
                        onClick={openSettings}
                        className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-caption font-medium text-brand-ink transition-colors duration-150 hover:bg-brand-soft"
                      >
                        {t("modelPicker.setUp")}
                      </button>
                    )}
                  </div>
                  {off ? (
                    <div className="px-2 pb-1.5 pl-[30px] text-caption leading-snug text-muted-foreground">
                      {instance.snapshot.reason ?? t("modelPicker.notAvailable")}
                    </div>
                  ) : closed ? null : (
                    <>
                      {!words.length && update && isActive && (
                        <div className="px-2 pb-1 pl-[30px]">
                          <EngineUpdateNote kind={instance.driverKind} name={instance.displayName} />
                        </div>
                      )}
                      {unlisted && (
                        <div
                          aria-current="true"
                          title={`${unlisted}\nNot listed, but still in use`}
                          className={cn(optionRow, "bg-accent text-foreground")}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="line-clamp-2 [overflow-wrap:anywhere]">{readableId(unlisted)}</span>
                            <span className="shrink-0 text-caption text-muted-foreground">{t("modelPicker.custom")}</span>
                          </span>
                          <Check size={14} className="shrink-0 text-brand-ink" />
                        </div>
                      )}
                      {typedId && (
                        <button
                          type="button"
                          data-model-option
                          onClick={() => pick(instance, typedId)}
                          className={cn(optionRow, "text-foreground hover:bg-accent")}
                        >
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            Use <span className="font-mono text-small">{typedId}</span>
                          </span>
                        </button>
                      )}
                      {shown.map((option) => {
                        const current = selection.instanceId === instance.instanceId && runs === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            data-model-option
                            aria-current={current ? "true" : undefined}
                            onClick={() => pick(instance, option.id)}
                            title={option.label === option.id ? option.id : `${option.label}\n${option.id}`}
                            className={cn(
                              optionRow,
                              "text-foreground hover:bg-accent",
                              current && "bg-accent",
                            )}
                          >
                            {/* long names (OpenRouter's run to fifty characters)
                                get two lines before they are cut, and the
                                tooltip has the rest */}
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={cn("line-clamp-2 [overflow-wrap:anywhere]", current && "font-medium")}>
                                {shortName(instance, option.label === option.id ? readableId(option.id) : option.label)}
                              </span>
                              {option.id === instance.models.default && (
                                <span className="shrink-0 text-caption text-muted-foreground">{t("modelPicker.default")}</span>
                              )}
                            </span>
                            {current && <Check size={14} className="shrink-0 text-brand-ink" />}
                          </button>
                        );
                      })}
                      {folds && (
                        <button
                          type="button"
                          data-model-option
                          onClick={() => setUnfolded((u) => [...u, instance.instanceId])}
                          className={cn(optionRow, "text-small text-muted-foreground hover:bg-accent hover:text-foreground")}
                        >
                          Show all {matching.length}
                          <ChevronDown size={13} className="shrink-0" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {effort && bot && (effort.levels.length > 0 || effort.note) && (
            <div className="shrink-0 border-t px-3 py-2">
              {/* A list rather than a row of segments: five levels and the
                  default do not fit across a menu this narrow. */}
              {effort.levels.length > 0 && (
                <div className="flex items-center gap-2.5">
                  <label htmlFor={`effort-${bot.id}`} className="text-small text-muted-foreground">
                    {t("modelPicker.effort")}
                  </label>
                  <SettingsSelect
                    id={`effort-${bot.id}`}
                    aria-label={t("modelPicker.reasoningEffort")}
                    className="flex-1"
                    value={effort.value ?? ""}
                    // null, not left out, so the saved level is cleared
                    onChange={(e) => dispatch({ type: "updateBot", botId: bot.id, patch: { effort: isEffort(e.target.value) ? e.target.value : null } })}
                  >
                    {effort.options.map((option) => (
                      <option key={option.value ?? "default"} value={option.value ?? ""}>
                        {option.label}
                      </option>
                    ))}
                  </SettingsSelect>
                </div>
              )}
              {effort.note && <p className={cn("text-small text-muted-foreground", effort.levels.length > 0 && "mt-1.5")}>{effort.note}</p>}
            </div>
          )}
        </div>,
      )}
    </div>
  );
}
