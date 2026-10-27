// How much agents do before asking you, as one choice.
//
// Four steps from careful to hands-off, each described by what it lets
// through rather than by a word like "safe". Used where the choice is
// first made (onboarding), where it is changed for everyone (Settings,
// Rules and approvals) and for one agent (its own settings), so the three
// can never describe the modes differently.
//
// Widening asks who is there, the same as it does for one agent in its
// own settings; narrowing never does.
import { useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export type ApprovalMode = "ask" | "edits" | "auto" | "full";

export const APPROVAL_MODES: Array<{ id: ApprovalMode; label: string; hint: string }> = [
  {
    id: "ask",
    label: "Ask first",
    hint: "Asks before changing files or running commands.",
  },
  {
    id: "edits",
    label: "Accept edits",
    hint: "Changes files freely. Asks before anything else.",
  },
  {
    id: "auto",
    label: "Auto",
    hint: "Goes ahead unless your rules block it. The engine's sandbox stays on.",
  },
  {
    id: "full",
    label: "Full access",
    hint: "No prompts and no sandbox. Your rules can't block anything.",
  },
];

const RANK: Record<ApprovalMode, number> = { ask: 0, edits: 1, auto: 2, full: 3 };

/** Touch ID, or whatever the Mac has, before letting agents do more.
 * A Mac with no sensor, or a browser, is not blocked. */
export async function confirmWidening(from: ApprovalMode, to: ApprovalMode, who: string): Promise<boolean> {
  if (RANK[to] <= RANK[from] || RANK[to] < RANK.auto || !window.bloks?.authConfirm) return true;
  const answer = await window.bloks.authConfirm(
    to === "full" ? `give ${who} full access, with nothing asking first` : `let ${who} act without asking`,
  );
  return answer !== "denied" && answer !== "cancelled";
}

export function ApprovalsChooser({
  value,
  onChange,
  compact,
}: {
  value: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  compact?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={t("approvalsChooser.howMuchAgentsAsk")} className="flex flex-col gap-1.5">
      {APPROVAL_MODES.map((mode) => {
        const on = mode.id === value;
        return (
          <button
            key={mode.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(mode.id)}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-3 text-left transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.99]",
              compact ? "py-2" : "py-2.5",
              on ? "border-brand bg-brand-soft" : "border-border bg-card hover:border-foreground/25",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                on ? "border-brand bg-brand text-background" : "border-foreground/25",
              )}
            >
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              <span className="block text-body font-medium text-foreground">{mode.label}</span>
              <span className="block text-pretty text-small leading-relaxed text-muted-foreground">{mode.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** What the info tips beside the chooser say about rules, one sentence
 * shared so it cannot drift from the Full access hint above. */
export const RULES_AND_MODES =
  "Your rules apply in every mode except Full access, where nothing asks. Remembered answers keep working too.";

/** The workspace's choice as the server has it, and how many agents are
 * on each mode, for Settings and onboarding. */
export function useWorkspaceApprovals() {
  const [state, setState] = useState<{ mode: ApprovalMode; agents: Record<ApprovalMode, number> } | null>(null);
  const load = () =>
    api("/api/approvals")
      .then(setState)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  const save = (mode: ApprovalMode, applyToAll: boolean) =>
    api("/api/approvals", { method: "PUT", body: JSON.stringify({ mode, applyToAll }) }).then(() => load());
  return { state, save };
}
