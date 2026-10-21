// Making a workspace: what kind, what it is called, whether it is just
// you or a team, and the mark it will wear, chosen beside a preview of
// how it will look in the switcher. Create makes its folder and opens it
// at once; its first server starts behind the opening page, and the
// welcome that follows is shaped by what was chosen here.
//
// Personal is the one there already, so the choice is Business (one per
// computer, in its own mark until another is chosen) or a name of your
// own (with a mark drawn for it, chosen or shuffled here).
//
// Calm on purpose: one line under the title, one sentence under a field
// only when there is something to say about it, and Create off until it
// would work. A Team workspace is one other people will see you in, so it
// starts with your name: the one you gave already, or asked for here,
// once, before it is made (src/components/YourNameDialog).
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { BUSINESS_MARK, generateMark, sameMark, type Mark } from "@/lib/workspaceMark";
import { act, useWorkspaces } from "@/lib/workspaces";
import { checkDraft, cleanDraftName, draftName, errorPlace } from "@/lib/newWorkspace";
import { MarkActions, MarkPicker } from "./MarkPicker";
import { WorkspaceMark } from "./WorkspaceMark";
import { NeedsTeam } from "./TeamLock";
import { askYourName, ensureYourName } from "./YourNameDialog";

type Kind = "business" | "custom";

/** A field's label, its control, and the one sentence about it, aligned
 * the same way down the dialog. */
function Field({ label, htmlFor, note, error, children }: { label: string; htmlFor?: string; note?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-small font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-pretty text-small text-destructive">
          {error}
        </p>
      ) : note ? (
        <div className="text-pretty text-small text-muted-foreground">{note}</div>
      ) : null}
    </div>
  );
}

export function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const s = useWorkspaces();
  const list = useMemo(() => (s.available ? s.workspaces : []), [s]);
  const hasBusiness = list.some((w) => w.kind === "business");
  // A workspace with other people in it is Bloks Team's: the plan the app
  // keeps for every workspace on this computer
  const teamOpen = s.available && s.plan === "team";
  const [kind, setKind] = useState<Kind>("custom");
  const [name, setName] = useState("");
  const [team, setTeam] = useState(false);
  // one mark for each kind, so trying Business and coming back keeps the
  // one that was being chosen for the named workspace
  const [marks, setMarks] = useState<Record<Kind, Mark | null>>({ custom: null, business: null });
  const [busy, setBusy] = useState(false);
  /** The name being made, while it is. */
  const [making, setMaking] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; place: ReturnType<typeof errorPlace> } | null>(null);
  const nameField = useRef<HTMLInputElement>(null);

  // the marks the other workspaces wear; once one is being made, the list
  // holds it too, and its own mark is not somebody else's
  const taken = useMemo(
    () => list.filter((w) => w.mark && w.name !== making).map((w) => w.mark as Mark),
    [list, making],
  );

  // a fresh start each time it opens, with a mark already drawn
  useEffect(() => {
    if (!open) return;
    setKind("custom");
    setName("");
    setTeam(false);
    setError(null);
    setBusy(false);
    setMaking(null);
    setMarks({
      custom: generateMark(taken),
      // Business's own, unless Personal has chosen to wear it
      business: taken.some((m) => sameMark(m, BUSINESS_MARK)) ? generateMark(taken) : { ...BUSINESS_MARK },
    });
    // only on opening: a list that changes underneath keeps what was typed
  }, [open]);

  const mark = marks[kind];
  const clean = cleanDraftName(name);
  const shownName = clean || (kind === "business" ? "Business" : "Untitled");
  // while one is being made the list already holds it, and it is not a clash
  const check = checkDraft({ kind, name }, list, making);
  const nameError = check.problem ?? (error?.place === "name" ? error.text : null);
  const markWorn = Boolean(mark && taken.some((m) => sameMark(m, mark)));
  // Business's own mark to go back to, unless somebody else wears it
  const businessDefault = kind === "business" && !taken.some((m) => sameMark(m, BUSINESS_MARK)) ? { ...BUSINESS_MARK } : null;
  const ready = check.ready && Boolean(mark) && !markWorn;

  const choose = (next: Mark) => {
    setMarks((was) => ({ ...was, [kind]: next }));
    if (error?.place === "mark") setError(null);
  };

  // Enter held down, or Create pressed twice, is one workspace: the guard
  // is set before anything is awaited, where a re-render would be too late
  const submitting = useRef(false);
  const create = async () => {
    if (!ready || submitting.current) return;
    submitting.current = true;
    try {
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
      const named = draftName(kind, name);
      setMaking(named);
      setBusy(true);
      setError(null);
      let code: string | undefined;
      const said = await act(
        window.bloks
          ?.workspaceCreate?.({ kind, name: named, team: asTeam, mark, ...(ownerName ? { ownerName } : {}) })
          .then((answer) => {
            code = answer?.code;
            return answer;
          }),
      );
      // on success the window is already on its way to the new workspace
      if (said) {
        setError({ text: said, place: errorPlace(said, code) });
        setBusy(false);
        setMaking(null);
        if (errorPlace(said, code) === "name") nameField.current?.focus();
      }
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="max-w-[460px] gap-0 rounded-[20px] p-6"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          // The menu this opens from (the switcher, the palette) still
          // holds the focus in its trap until it is gone, and takes it back
          // from the field at once: so the field asks again each frame
          // until it keeps it, and the first key typed lands in it.
          const take = (tries: number) => {
            const field = nameField.current;
            if (!field) return;
            field.focus();
            if (document.activeElement !== field && tries > 0) requestAnimationFrame(() => take(tries - 1));
          };
          take(30);
        }}
      >
        <DialogTitle className="text-balance">New workspace</DialogTitle>
        <DialogDescription className="mt-1 text-pretty">Its own agents, memory, keys and rooms.</DialogDescription>

        <form
          className="mt-5 flex flex-col gap-4"
          aria-busy={busy || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          {/* a choice only while there is one: with a Business already
              here, every new workspace is one with a name of its own */}
          {!hasBusiness && (
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
          )}

          <Field label="Name" htmlFor="new-workspace-name" error={nameError}>
            <Input
              id="new-workspace-name"
              ref={nameField}
              value={name}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              placeholder={kind === "business" ? "Business" : "Okafor Studio"}
              disabled={busy}
              onChange={(e) => {
                setName(e.target.value);
                if (error?.place === "name" || error?.place === "form") setError(null);
              }}
              aria-invalid={Boolean(nameError) || undefined}
              className="h-10 rounded-[10px]"
            />
          </Field>

          <Field
            label="Who uses it"
            error={error?.place === "team" ? error.text : null}
            note={!teamOpen ? <NeedsTeam /> : team ? "You'll invite people next." : null}
          >
            <Segmented<"solo" | "team">
              aria-label="Who uses it"
              value={team && teamOpen ? "team" : "solo"}
              onChange={(next) => {
                setTeam(next === "team" && teamOpen);
                if (error?.place === "team") setError(null);
              }}
              options={[
                { value: "solo", label: "Just me" },
                { value: "team", label: "Team", disabled: !teamOpen },
              ]}
            />
          </Field>

          <Field label="Mark" error={error?.place === "mark" ? error.text : markWorn ? "Another workspace has that mark. Choose another." : null}>
            {/* how it will look in the switcher, chosen right beside it */}
            <div className="rounded-[14px] border bg-sidebar/60 p-3">
              <div className="mb-2.5 flex min-w-0 items-center gap-3 pl-0.5">
                <span key={mark ? `${mark.color}${mark.pattern}` : "none"} className="flex animate-pop-in">
                  <WorkspaceMark mark={mark} size={36} label={`${shownName}'s mark`} />
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-lead font-semibold", clean || kind === "business" ? "text-foreground" : "text-muted-foreground")}>
                  {shownName}
                </span>
                <MarkActions
                  className="-mr-1.5 shrink-0"
                  value={mark}
                  taken={taken}
                  disabled={busy}
                  onChange={choose}
                  onShuffle={() => choose(generateMark(taken, { avoid: mark }) ?? mark!)}
                  defaultMark={businessDefault}
                />
              </div>
              <MarkPicker value={mark} taken={taken} disabled={busy} onChange={choose} actions="none" />
            </div>
          </Field>

          {error?.place === "form" && (
            <p role="alert" className="-mt-1 text-pretty text-small text-destructive">
              {error.text}
            </p>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {/* off until it would work; while it works it stays lit with
                its spinner, and a second press is the same workspace */}
            <Button type="submit" disabled={busy ? false : !ready} aria-disabled={busy || undefined} aria-label={busy ? "Creating" : undefined} className="min-w-[92px]">
              {/* both in one cell, so the button keeps its width either way */}
              <span className="grid place-items-center">
                <span className={cn("col-start-1 row-start-1", busy && "invisible")}>Create</span>
                {busy && <Loader2 size={15} className="col-start-1 row-start-1 animate-spin" aria-hidden />}
              </span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
