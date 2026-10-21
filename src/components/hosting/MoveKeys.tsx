// The keys and connections a move left behind, to be entered again where
// it landed, one row per Settings page with the button that opens it
// there. Keys never travel, so this is the one list of what to do next.
import { ArrowRight, Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { BLOKS_AI_LINE, keyGroups } from "@/lib/hostingMove";
import type { HostingMoveKey } from "@/types/bridge";
import { said } from "./useHostingMove";

export function MoveKeys({ keys, bloksAi, where }: { keys: HostingMoveKey[] | null; bloksAi: boolean; where: string }) {
  const groups = keyGroups(keys, bloksAi);
  const open = (page: string) => {
    void said(window.bloks?.hostingMoveOpenSettings?.(page)).catch((e: Error) => toast.error(e.message));
  };
  return (
    <div className="flex flex-col gap-3">
      {bloksAi && (
        <p className="flex items-start gap-2 text-pretty text-body text-muted-foreground">
          <Sparkles size={14} aria-hidden className="mt-1 shrink-0 text-brand-ink" />
          {BLOKS_AI_LINE}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="text-pretty text-body text-muted-foreground">No keys were left behind, so there is nothing to enter again {where}.</p>
      ) : (
        <>
          <p className="text-pretty text-body text-muted-foreground">Keys stay where they were. Enter these again {where}:</p>
          <ul aria-label="Keys to enter again" className="flex flex-col divide-y rounded-xl border">
            {groups.map((group) => (
              <li key={group.page} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5">
                <div className="min-w-0 flex-1 basis-[200px]">
                  <div className="text-ui font-medium text-foreground">{group.items.join(", ")}</div>
                  <div className="text-small text-muted-foreground">In Settings, {group.label}</div>
                </div>
                <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => open(group.page)}>
                  Open {group.label}
                  <ArrowRight size={13} />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
