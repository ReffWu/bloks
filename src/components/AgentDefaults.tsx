// Where a new agent starts: a folder, a model and an effort, applied
// before its first turn, because a chat's folder is pinned on that turn
// and cannot be moved after it. Approvals are chosen once, on the Rules
// and approvals page, which shows how many agents are on each mode and
// can move them; here they are only said, with the way there.
//
// Set by the person only. Agents cannot read or write /api/config, so an
// agent that hires another cannot hand it more than the person chose
// here, and an agent hiring another passes on no more approvals than it
// has itself. The server checks each value again at hire time; this card
// only shows what it refused.
//
// A server that does not report agentDefaults does not have the feature,
// and the card is not drawn at all rather than offering a form that
// saves nowhere.
import { useEffect, useRef, useState } from "react";
import { Check } from "@/components/icons";
import { api, useStore, type AgentDefaults as Defaults } from "@/state/store";
import { ModelPicker } from "./ModelPicker";
import { BrowseFolderButton } from "@/components/ui/browse-folder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Segmented } from "@/components/ui/segmented";
import { SettingRow, SettingsGroup } from "./SettingsLayout";
import { APPROVAL_MODES, useWorkspaceApprovals } from "./ApprovalsChooser";
import { effortChoice } from "@/lib/effort";

export function AgentDefaults() {
  const { state, dispatch } = useStore();
  const saved = state.config?.agentDefaults;
  const [folder, setFolder] = useState(saved?.cwd ?? "");
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const approvals = useWorkspaceApprovals().state;
  const hydrated = useRef(false);

  // adopt the server value once it arrives, without stomping an edit
  useEffect(() => {
    if (hydrated.current || !saved) return;
    hydrated.current = true;
    setFolder(saved.cwd ?? "");
  }, [saved]);

  if (!saved) return null;

  /** The whole object every time: the server replaces the section, so
   * an unset key is one left out, not one sent empty. */
  const save = (patch: Partial<Defaults>) => {
    const next: Defaults = { ...saved, ...patch };
    for (const key of Object.keys(next) as Array<keyof Defaults>) {
      if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
    }
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ agentDefaults: next }) })
      .then((status) => {
        dispatch({ type: "configStatus", config: status });
        setFolder(status?.agentDefaults?.cwd ?? "");
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1600);
      })
      .catch((e: Error) => setError(e.message));
  };

  const saveFolder = (value: string) => save({ cwd: value.trim() || undefined });
  const anySet = Boolean(saved.cwd || saved.modelSelection || saved.effort);
  // Offered by the engine new agents start on, when one is chosen. With
  // the engine default, which engine a hire gets is settled when it is
  // hired, so every level is offered and each runs at the nearest its
  // engine has.
  const effort = effortChoice(state.instances, saved.modelSelection, saved.effort);

  return (
    <>
      <SettingsGroup title="Where they start">
        <SettingRow
          label="Working folder"
          info="Applied when an agent is made. Only you can change these, not your agents. Team hires keep their team's model but take the rest."
          description={error ? <span className="text-destructive">{error}</span> : "Existing agents keep their own settings."}
          control={
            <span
              className={cn(
                "flex items-center gap-1 text-small text-success transition-opacity duration-200",
                justSaved ? "opacity-100" : "opacity-0",
              )}
              aria-live="polite"
            >
              <Check size={12} /> Saved
            </span>
          }
        >
          <div className="mt-3 flex gap-2">
            <Input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveFolder(folder)}
              placeholder="Their own workspace"
              spellCheck={false}
              aria-label="Working folder for new agents"
              className="h-8 font-mono text-small"
            />
            <BrowseFolderButton
              onPick={(path) => {
                setFolder(path);
                saveFolder(path);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={folder.trim() === (saved.cwd ?? "")}
              onClick={() => saveFolder(folder)}
            >
              Save
            </Button>
          </div>
        </SettingRow>
        <SettingRow
          label="Model"
          control={
            <ModelPicker
              value={saved.modelSelection ?? null}
              onPick={(selection) => save({ modelSelection: selection ?? undefined })}
              noneLabel="Engine default"
            />
          }
        />
        <SettingRow
          label="Reasoning effort"
          description={effort.note ?? undefined}
          control={
            effort.levels.length > 0 && (
              <Segmented
                size="sm"
                aria-label="Reasoning effort"
                value={effort.value}
                onChange={(next) => save({ effort: next })}
                options={effort.options}
              />
            )
          }
        />
      </SettingsGroup>
      <SettingsGroup title="What they may do">
        <SettingRow
          label="Approvals"
          description={
            approvals
              ? `New agents start on ${APPROVAL_MODES.find((m) => m.id === approvals.mode)?.label ?? approvals.mode}.`
              : "How much a new agent does before asking you."
          }
          control={
            <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "toggleAppSettings", open: true, page: "rules" })}>
              Change in Rules and approvals
            </Button>
          }
        />
      </SettingsGroup>
      {anySet && (
        <button
          onClick={() => save({ cwd: undefined, modelSelection: undefined, effort: undefined })}
          className="px-1 text-body text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Reset to defaults
        </button>
      )}
    </>
  );
}
