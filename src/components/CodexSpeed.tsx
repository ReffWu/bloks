// Codex speed: the workspace default under Engines, an agent's own
// choice beside its engine settings, and the same choice as one word
// under the composer, beside the model it belongs to.
//
// Shown only where it can mean something: a server that knows about it
// (an older one sends no codex section in its config) and a workspace
// with a Codex engine. Standard is Codex as it always ran here; Fast asks
// Codex for its priority tier, and a turn that cannot have it is not sent.
import { useState } from "react";
import { Check } from "@/components/icons";
import { Zap } from "@/components/icons";
import { api, useStore, type Bot, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { codexSpeedRoute, resolveCodexSpeed, type CodexSpeed } from "@/lib/codexSpeed";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { quietButton } from "./composer/Shell";

/** A catalog older than this says nothing about Fast today. */
const CATALOG_FRESH_MS = 300_000;

export function CodexSpeedControl({ bot, className }: { bot?: Bot; className?: string }) {
  const { state, dispatch } = useStore();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const config = state.config;
  if (!config?.codex || !state.instances.some((i) => i.driverKind === "codex")) return null;

  const choice = resolveCodexSpeed(config, bot);
  // Where this agent would run Codex: on this computer, where the catalog
  // may say a model has no Fast, or on a Box or Boat, which has no Fast yet
  const routes = bot
    ? [bot.modelSelection, bot.backupSelection].flatMap((pick) => {
        if (!pick) return [];
        const instance = state.instances.find((i) => i.instanceId === pick.instanceId);
        const fresh = Boolean(instance?.models.checkedAt && Date.now() - instance.models.checkedAt < CATALOG_FRESH_MS);
        const model = instance?.models.options.find((m) => m.id === pick.model);
        return [{ route: codexSpeedRoute(instance?.driverKind, pick.model), fast: fresh ? model?.codexFast : undefined }];
      })
    : [];
  const noFastModel = routes.some((r) => r.route === "native" && r.fast === false);
  const remote = routes.some((r) => r.route === "remote");

  const save = async (value: CodexSpeed | null) => {
    setError("");
    if (bot) {
      dispatch({ type: "updateBot", botId: bot.id, patch: { codexSpeed: value } });
      return;
    }
    if (!value) return;
    setSaving(true);
    try {
      const result = await api("/api/config", { method: "PATCH", body: JSON.stringify({ codex: { speed: value } }) });
      dispatch({ type: "configStatus", config: result });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the Codex speed");
    } finally {
      setSaving(false);
    }
  };

  const workspaceLabel = `Workspace (${choice.default === "fast" ? "Fast" : "Standard"})`;
  const options: Array<[CodexSpeed | null, string]> = bot
    ? [[null, workspaceLabel], ["standard", "Standard"], ["fast", "Fast"]]
    : [["standard", "Standard"], ["fast", "Fast"]];
  const selected = bot ? choice.override : choice.default;

  return (
    <section
      className={cn("rounded-2xl border bg-card p-4", className)}
      aria-label={bot ? "Agent Codex speed" : "Workspace Codex speed"}
    >
      <div className="text-ui font-semibold text-foreground">Codex speed</div>
      <div className="mt-0.5 text-body text-muted-foreground">
        {bot ? "For this agent on Codex. " : "For every agent on Codex, unless set per agent. "}
        Fast answers sooner and uses more:{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="https://learn.chatgpt.com/docs/agent-configuration/speed"
          target="_blank"
          rel="noreferrer"
        >
          2.5x included usage, 2x purchased credits
        </a>
        .
      </div>
      <div className="mt-3 flex gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Codex speed">
        {options.map(([value, label]) => {
          const unavailable = value === "fast" && noFastModel;
          return (
            <button
              key={label}
              role="radio"
              aria-checked={selected === value}
              disabled={saving || unavailable}
              onClick={() => void save(value)}
              className={cn(
                "flex-1 rounded-lg py-1 text-body transition-colors duration-150 disabled:opacity-50",
                selected === value
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      {noFastModel && (
        <p className="mt-2 text-small text-muted-foreground">Fast isn't offered for this model.</p>
      )}
      {remote && (
        <p className="mt-2 text-small text-muted-foreground">
          Box and Boat run Codex at Standard only. Fast messages there won't send.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-small text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Whether speed means anything for the model this agent runs on now:
 * Codex on this computer, on a server that knows about speed, and a model
 * the catalog has not said lacks Fast. Anywhere else there is nothing to
 * choose, so the composer shows nothing.
 */
function speedFor(bot: Bot, config: { codex?: { speed?: unknown } } | null | undefined, instances: InstanceInfo[]) {
  if (!config?.codex) return null;
  const instance = instances.find((i) => i.instanceId === bot.modelSelection.instanceId);
  const model = bot.modelSelection.model || instance?.models.default || "";
  if (codexSpeedRoute(instance?.driverKind, model) !== "native") return null;
  const fresh = Boolean(instance?.models.checkedAt && Date.now() - instance.models.checkedAt < CATALOG_FRESH_MS);
  const noFast = fresh && instance?.models.options.find((m) => m.id === model)?.codexFast === false;
  const choice = resolveCodexSpeed(config, bot);
  // An agent left on Fast by a model that has none would have its turns
  // refused, so that case stays on show, marked, rather than vanishing.
  if (noFast && choice.resolved !== "fast") return null;
  return { choice, noFast };
}

/** The speed as a word under the composer, for the models that have one. */
export function CodexSpeedMenu({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const speed = speedFor(bot, state.config, state.instances);
  if (!speed) return null;
  const { choice, noFast } = speed;
  const fast = choice.resolved === "fast";
  const options: Array<{ value: CodexSpeed | null; label: string; hint: string }> = [
    {
      value: null,
      label: `Workspace default (${choice.default === "fast" ? "Fast" : "Standard"})`,
      hint: "Follows the setting under Engines.",
    },
    { value: "standard", label: "Standard", hint: "Codex as it usually runs." },
    { value: "fast", label: "Fast", hint: "Answers sooner. Uses 2.5x included usage." },
  ];
  const label = fast ? "Fast" : "Standard";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={noFast ? "Fast isn't offered for this model. Messages won't send." : `Codex speed: ${label}`}
          aria-label={`Codex speed: ${label}`}
          className={cn(quietButton, "shrink-0", noFast && "text-warning hover:text-warning aria-expanded:text-warning")}
        >
          {fast && <Zap size={13} className="shrink-0" />}
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-[260px] max-w-[calc(100vw-24px)]">
        <DropdownMenuLabel>Codex speed</DropdownMenuLabel>
        {options.map((option) => {
          const on = choice.override === option.value;
          const unavailable = option.value === "fast" && noFast;
          return (
            <DropdownMenuItem
              key={option.label}
              role="menuitemradio"
              aria-checked={on}
              disabled={unavailable}
              onSelect={() => dispatch({ type: "updateBot", botId: bot.id, patch: { codexSpeed: option.value } })}
              className="items-start gap-2.5 py-2 [&_svg]:text-inherit"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-brand-ink">
                {on && <Check size={14} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{option.label}</span>
                <span className="block text-small leading-snug text-muted-foreground">
                  {unavailable ? "Not offered for this model." : option.hint}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
