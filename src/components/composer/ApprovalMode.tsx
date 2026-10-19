// How much this agent asks, said under the box where the next message is
// written, and changed there.
//
// The same four modes and the same words as onboarding, Settings and the
// agent's own settings (ApprovalsChooser), and the same check: widening
// asks who is there first, narrowing never does. Full access is the one
// mode with nothing between an agent and the machine, so it wears the
// warning colour here too, on the row and in the menu.
import { Check } from "@/components/icons";
import { ShieldAlert } from "@/components/icons";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { APPROVAL_MODES, confirmWidening, type ApprovalMode } from "@/components/ApprovalsChooser";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { quietButton } from "./Shell";

export function ApprovalModeMenu({ bot, onRefused }: { bot: Bot; onRefused: (refused: boolean) => void }) {
  const { dispatch } = useStore();
  const mode: ApprovalMode = bot.approvals ?? "ask";
  const current = APPROVAL_MODES.find((m) => m.id === mode) ?? APPROVAL_MODES[0];
  const full = mode === "full";

  const choose = async (next: ApprovalMode) => {
    if (next === mode) return;
    onRefused(false);
    if (!(await confirmWidening(mode, next, bot.name))) return onRefused(true);
    dispatch({ type: "updateBot", botId: bot.id, patch: { approvals: next } });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`How much ${bot.name} asks: ${current.label}`}
          aria-label={`How much ${bot.name} asks: ${current.label}`}
          className={cn(quietButton, full && "text-warning hover:text-warning aria-expanded:text-warning")}
        >
          {full && <ShieldAlert size={14} className="shrink-0" />}
          <span className="truncate">{current.label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-[300px] max-w-[calc(100vw-24px)]"
      >
        <DropdownMenuLabel>How much {bot.name} asks</DropdownMenuLabel>
        {APPROVAL_MODES.map((m) => {
          const on = m.id === mode;
          const risky = m.id === "full";
          return (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => void choose(m.id)}
              aria-checked={on}
              role="menuitemradio"
              className="items-start gap-2.5 py-2 [&_svg]:text-inherit"
            >
              <span
                className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center", on ? "text-brand-ink" : "text-warning")}
              >
                {on ? <Check size={14} /> : risky ? <ShieldAlert size={14} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block font-medium", risky ? "text-warning" : "text-foreground")}>{m.label}</span>
                <span className="block text-pretty text-small leading-snug text-muted-foreground">{m.hint}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
