// Making a workspace: what kind, what it is called, whether it is just
// you or a team, and the mark it will wear, shown as it will look in the
// switcher. Create makes its folder, starts its server and opens it on
// its own first-run welcome.
//
// Personal is the one there already, so the choice is Business (one per
// computer, with its fixed mark) or a name of your own (with a mark of its
// own, rerolled here until it feels right).
//
// A Team workspace is one other people will see you in, so it starts with
// your name: the one you gave already, or asked for here, once, before it
// is made (src/components/YourNameDialog).
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { BUSINESS_MARK, generateMark, type Mark } from "@/lib/workspaceMark";
import { act, useWorkspaces } from "@/lib/workspaces";
import { WorkspaceMark } from "./WorkspaceMark";
import { NeedsTeam } from "./TeamLock";
import { askYourName, ensureYourName } from "./YourNameDialog";

type Kind = "business" | "custom";

export function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useWorkspaces();
  const list = useMemo(() => (s.available ? s.workspaces : []), [s]);
  const hasBusiness = list.some((w) => w.kind === "business");
  // A workspace with other people in it is Bloks Team's: the licence's
  // plan, as the workspaces' servers last told the app
  const teamOpen = s.available && s.plan === "team";
  const [kind, setKind] = useState<Kind>("custom");
  const [name, setName] = useState("");
  const [team, setTeam] = useState(false);
  const [mark, setMark] = useState<Mark | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  const taken = useMemo(() => list.map((w) => w.mark).filter((m): m is Mark => Boolean(m)), [list]);

  // a fresh start each time it opens, with a mark already drawn
  useEffect(() => {
    if (!open) return;
    setKind("custom");
    setName("");
    setTeam(false);
    setError(null);
    setBusy(false);
    setMark(generateMark(taken));
    // only on opening: a list that changes underneath keeps what was typed
  }, [open]);

  const shownMark = kind === "business" ? { ...BUSINESS_MARK } : mark;
  const clean = name.replace(/\s+/g, " ").trim();
  const shownName = clean || (kind === "business" ? "Business" : "Untitled");
  const clash = list.some((w) => w.name.toLowerCase() === (clean || (kind === "business" ? "business" : "")).toLowerCase());
  const ready = !busy && (kind === "business" || clean.length > 0) && !clash;

  const reroll = () => setMark((was) => generateMark(taken, { avoid: was }));

  const create = async () => {
    if (!ready) return;
    const asTeam = team && teamOpen;
    let ownerName: string | undefined;
    if (asTeam) {
      // a window on a workspace you joined has somebody else's server
      // behind it, so the name is only handed to the app from there
      const why = `Everyone you invite to ${clean || "Business"} sees it.`;
      const said = (s.available && s.ownerName) || (window.bloks?.workspace?.kind === "joined" ? await askYourName({ why, save: false }) : await ensureYourName({ why }));
      if (!said) return;
      ownerName = said;
    }
    setBusy(true);
    setError(null);
    const said = await act(
      window.bloks?.workspaceCreate?.({ kind, name: clean || "Business", team: asTeam, mark: kind === "custom" ? mark : null, ...(ownerName ? { ownerName } : {}) }),
    );
    // on success the window is already loading the new workspace
    if (said) {
      setError(said);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="max-w-[500px] rounded-[20px] p-6"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameField.current?.focus();
        }}
      >
        <DialogTitle className="text-balance">New workspace</DialogTitle>
        <DialogDescription className="text-pretty">
          A Bloks of its own: its own agents, memory, keys and rooms. Nothing moves between workspaces.
        </DialogDescription>

        <form
          className="mt-5 flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          {/* a choice only while there is one: with a Business already
              here, every new workspace is one with a name of its own */}
          {!hasBusiness && (
            <div className="flex flex-col gap-2">
              <span className="text-small font-medium text-muted-foreground">Kind</span>
              <Segmented<Kind>
                aria-label="Kind"
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setError(null);
                  if (next === "business" && !clean) setName("Business");
                  if (next === "custom" && clean === "Business") setName("");
                  nameField.current?.focus();
                }}
                options={[
                  { value: "custom", label: "Its own name" },
                  { value: "business", label: "Business" },
                ]}
              />
            </div>
          )}

          <label className="flex flex-col gap-2">
            <span className="text-small font-medium text-muted-foreground">Name</span>
            <Input
              ref={nameField}
              value={name}
              maxLength={40}
              placeholder={kind === "business" ? "Business" : "Okafor Studio"}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              aria-invalid={clash || undefined}
              className="h-10 rounded-[10px]"
            />
            {clash && <span className="text-small text-destructive">There is a workspace called {clean || "Business"} already.</span>}
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-small font-medium text-muted-foreground">Who uses it</span>
            <Segmented<"solo" | "team">
              aria-label="Who uses it"
              value={team && teamOpen ? "team" : "solo"}
              onChange={(next) => setTeam(next === "team" && teamOpen)}
              options={[
                { value: "solo", label: "Just me" },
                { value: "team", label: "Team", disabled: !teamOpen },
              ]}
            />
            {teamOpen ? (
              <span className="text-pretty text-small text-muted-foreground">
                {team
                  ? "Invite people from its settings once it is made. Each has their own conversations with its agents."
                  : "Only you. You can invite people later."}
              </span>
            ) : (
              <NeedsTeam />
            )}
          </div>

          {/* how it will look in the switcher, as it will look there */}
          <div className="flex items-center gap-3.5 rounded-[14px] border bg-sidebar/60 p-3.5">
            <span key={shownMark ? `${shownMark.color}${shownMark.pattern}` : "none"} className="flex animate-pop-in">
              <WorkspaceMark mark={shownMark} size={44} label={`${shownName}'s mark`} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-lead font-semibold text-foreground">{shownName}</span>
              <span className="text-small text-muted-foreground">
                {kind === "business" ? "The Business mark is the same everywhere" : "Its own mark, on this computer only"}
              </span>
            </div>
            {kind === "custom" && (
              <Button type="button" variant="outline" size="sm" onClick={reroll} className="gap-1.5">
                <RefreshCw size={13} />
                New mark
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-pretty text-small text-muted-foreground">
              {error ? <span className="text-destructive">{error}</span> : "It opens beside your others. You can upload a logo later."}
            </span>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready} className="min-w-[84px]">
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
