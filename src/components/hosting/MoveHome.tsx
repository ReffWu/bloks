// Moving the hosted workspace to this Mac: from the hosted workspace's
// own Settings, and from Hosting on the Plan page.
//
// Never on its own, and never without one confirm that says what moves
// and which keys are to be entered again. It lands in a workspace here
// that is empty, or in a new one named after the hosted one, or, when the
// copy it was moved out of is still here, back in that copy, which it
// replaces whole: said in so many words before it starts. A licence has
// one hosted machine today, so this is a list of one; with more, each
// moves alone, or all of them in turn. The subscription is never touched.
import { useEffect, useRef, useState } from "react";
import { Monitor } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { STILL_PAID_LINE, countsWords, keyGroups } from "@/lib/hostingMove";
import type { HostingMoveState, HostingMoveTarget } from "@/types/bridge";
import { SettingRow, SettingsGroup, SettingsSelect } from "../SettingsLayout";
import { said, useHostingMove } from "./useHostingMove";

/** `only` keeps the list to one hosted workspace: its own Settings. */
export function MoveHome({ state: given, only }: { state?: HostingMoveState; only?: string }) {
  const own = useHostingMove();
  const state = given ?? own;
  const [targets, setTargets] = useState<HostingMoveTarget[] | null>(null);
  const queue = useRef<string[]>([]);
  const hosted = (state?.hosted ?? []).filter((h) => !only || h.id === only);
  const busy = Boolean(state?.move && state.move.phase !== "done");

  useEffect(() => {
    if (!hosted.length || !window.bloks?.hostingMoveTargets) return;
    let live = true;
    void window.bloks
      .hostingMoveTargets()
      .then((said) => live && setTargets(said.targets))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hosted.length, state?.move?.phase]);

  // "Move all": the next one goes once the last is done
  useEffect(() => {
    const move = state?.move;
    if (move?.phase !== "done" || move.direction !== "to-mac" || !queue.current.length) return;
    const next = queue.current.shift()!;
    void said(window.bloks?.hostingMoveDismiss?.())
      .then(() => said(window.bloks?.hostingMoveStart?.({ direction: "to-mac", from: next })))
      .catch((e: Error) => toast.error(e.message));
  }, [state?.move?.phase, state?.move?.id]);

  if (!state?.available || !hosted.length) return null;

  const moveAll = async () => {
    const ok = await confirm({
      title: "Move every hosted workspace to this Mac?",
      body: `${hosted.map((h) => h.name).join(", ")} each come to a new workspace here, one after another, with everything in them. Keys stay where they are, and each one's are listed to enter again here.\n\n${STILL_PAID_LINE}`,
      confirmLabel: "Move them all",
    });
    if (!ok) return;
    queue.current = hosted.slice(1).map((h) => h.id);
    void said(window.bloks?.hostingMoveStart?.({ direction: "to-mac", from: hosted[0].id })).catch((e: Error) => toast.error(e.message));
  };

  return (
    <SettingsGroup
      title="Move to this Mac"
      action={
        hosted.length > 1 ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void moveAll()}>
            Move all to this Mac
          </Button>
        ) : undefined
      }
      footnote={STILL_PAID_LINE}
      className="mb-0"
    >
      {hosted.map((h) => (
        <HomeRow key={h.id} hosted={h} state={state} targets={targets} busy={busy} />
      ))}
    </SettingsGroup>
  );
}

/** Where one hosted workspace can land here, best first: the copy it came
 * from, then empty workspaces, then a new one. */
export function landings(hosted: { id: string; name: string }, state: HostingMoveState, targets: HostingMoveTarget[] | null) {
  const copies = state.copies.filter((c) => c.to === hosted.id);
  const out: Array<{ key: string; to: string | null; name: string; replace: boolean; label: string }> = [];
  for (const copy of copies) out.push({ key: `copy:${copy.id}`, to: copy.id, name: copy.name, replace: true, label: `Back into ${copy.name}, replacing what it has on this Mac` });
  for (const t of targets ?? []) {
    if (t.empty && !t.copy) out.push({ key: `empty:${t.id}`, to: t.id, name: t.name, replace: false, label: `Into ${t.name}, which is empty` });
  }
  out.push({ key: "new", to: null, name: hosted.name, replace: false, label: `Into a new workspace, ${hosted.name}` });
  return out;
}

function HomeRow({ hosted, state, targets, busy }: { hosted: { id: string; name: string }; state: HostingMoveState; targets: HostingMoveTarget[] | null; busy: boolean }) {
  const options = landings(hosted, state, targets);
  const [chosen, setChosen] = useState("");
  const [asking, setAsking] = useState(false);
  const pick = options.find((o) => o.key === chosen) ?? options[0];

  const go = async () => {
    setAsking(true);
    try {
      // what it holds and what it leaves behind, asked of the hosted machine
      const preview = await said(window.bloks?.hostingMovePreview?.(hosted.id)).catch(() => null);
      const groups = keyGroups(preview?.keys ?? [], false);
      const keysLine = groups.length
        ? `Keys stay on your hosted machine. Enter these again here: ${groups.flatMap((g) => g.items).join(", ")}.`
        : "No keys need entering again.";
      const into = pick.replace
        ? `This replaces everything in ${pick.name} on this Mac with what is on the hosted machine now. Nothing is merged; what ${pick.name} has here is kept in a backup first.`
        : pick.to
          ? `It lands in ${pick.name}, which is empty.`
          : `It lands in a new workspace here, ${pick.name}.`;
      const ok = await confirm({
        title: `Move ${hosted.name} to this Mac?`,
        body: `Moving: ${countsWords(preview?.counts)}, with its memory, skills and settings. ${into}\n\n${keysLine} Afterwards it runs here, and your hosted machine is left empty and running.\n\n${STILL_PAID_LINE}`,
        confirmLabel: pick.replace ? "Replace and move" : "Move to this Mac",
        destructive: pick.replace,
      });
      if (!ok) return;
      await said(window.bloks?.hostingMoveStart?.({ direction: "to-mac", from: hosted.id, to: pick.to, replace: pick.replace, name: hosted.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  return (
    <SettingRow
      label={hosted.name}
      description="Bring everything in it to this Mac, to run here."
      control={
        <Button size="sm" className="gap-1.5" disabled={busy || asking} onClick={() => void go()}>
          <Monitor size={14} />
          Move to this Mac
        </Button>
      }
    >
      {options.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor={`land-${hosted.id}`} className="text-body text-muted-foreground">
            Where it goes
          </label>
          <SettingsSelect id={`land-${hosted.id}`} value={pick.key} onChange={(e) => setChosen(e.target.value)} className="min-w-[240px]">
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </SettingsSelect>
        </div>
      )}
    </SettingRow>
  );
}
