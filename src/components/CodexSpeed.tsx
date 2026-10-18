// Codex speed: the workspace default under Engines, and an agent's own
// choice beside its engine settings.
//
// Shown only where it can mean something: a server that knows about it
// (an older one sends no codex section in its config) and a workspace
// with a Codex engine. Standard is Codex as it always ran here; Fast asks
// Codex for its priority tier, and a turn that cannot have it is not sent.
import { useState } from "react";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { codexSpeedRoute, resolveCodexSpeed, type CodexSpeed } from "@/lib/codexSpeed";

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
      setError(e instanceof Error ? e.message : "Could not save the Codex speed");
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
      <div className="text-[13.5px] font-semibold text-foreground">Codex speed</div>
      <div className="mt-0.5 text-[12.5px] text-muted-foreground">
        {bot ? "For this agent's Codex turns, primary and backup. " : "For every agent's Codex turns, unless it has its own. "}
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
                "flex-1 rounded-lg py-1 text-[12.5px] transition-colors duration-150 disabled:opacity-50",
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
        <p className="mt-2 text-[12px] text-muted-foreground">Codex does not offer Fast for this agent's model.</p>
      )}
      {remote && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Codex on a Box or Boat runs at Standard. Fast is not available there yet, and a Fast turn there is not sent.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
