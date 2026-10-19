// The pieces of the skill library the Skills page (Customize.tsx) is
// built from: adding your own from a markdown file or pasted text, and
// the skills the workspace suggests from your conversations.
//
// Installing a skill means injecting its text into every turn of every
// agent that uses it, the highest-trust content in the app. So the
// import flow always shows the exact body before it is written, and
// nothing is ever fetched and installed automatically.
import { useRef, useState } from "react";
import { FileText } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { ShieldAlert } from "@/components/icons";
import { api, type Skill } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { DiffLines, type DiffLine } from "./DiffLines";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MAX_SKILL_CHARS, skillLength } from "@/lib/skillLength";

/** How long the instructions are against the limit, red once over it. */
function LengthCount({ length }: { length: number }) {
  return (
    <span
      className={cn(
        "text-[11.5px] tabular-nums",
        length > MAX_SKILL_CHARS ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {length.toLocaleString()} / {MAX_SKILL_CHARS.toLocaleString()}
    </span>
  );
}

/** Best name for a pasted or dropped document: the frontmatter's own
 * name wins, then a leading heading, then the filename. */
function nameFor(markdown: string, fileName: string): string {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const declared = frontmatter?.[1].match(/^name\s*:\s*(.+)$/m)?.[1];
  const heading = markdown.match(/^#{1,3}\s+(.+)$/m)?.[1];
  return (
    declared?.trim().replace(/^["']|["']$/g, "") ||
    heading?.trim() ||
    fileName ||
    "New skill"
  );
}

/** Step 2 of import: show exactly what will be injected, then install. */
function ReviewImport({
  draft,
  onBack,
  onInstalled,
}: {
  draft: { name: string; markdown: string };
  onBack: () => void;
  onInstalled: (skill: Skill) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = skillLength(draft.markdown);
  const tooLong = length > MAX_SKILL_CHARS;

  const install = () => {
    setSaving(true);
    setError(null);
    api("/api/skills", {
      method: "POST",
      body: JSON.stringify({ markdown: draft.markdown, name: name.trim() || draft.name, id: name }),
    })
      .then(({ skill }) => onInstalled(skill))
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-2.5 rounded-xl bg-warning/10 px-3 py-2.5">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warning" />
        <div className="text-[12.5px] leading-relaxed text-warning">
          These instructions go into every turn of any agent you attach this to. Read them before
          installing, and only add skills from a source you trust.
        </div>
      </div>

      <label className="mt-3 block">
        <div className="mb-1.5 text-[12.5px] font-medium text-muted-foreground">Name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-[14px] text-foreground outline-none focus-visible:border-ring/60"
        />
      </label>

      <div className="mb-1.5 mt-3 text-[12.5px] font-medium text-muted-foreground">
        Instructions to be installed
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/50 p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
        {draft.markdown}
      </pre>

      {tooLong && (
        <div className="mt-2 text-[12px] text-destructive">
          Too long. This skill is {length.toLocaleString()} characters, and skills are capped at{" "}
          {MAX_SKILL_CHARS.toLocaleString()}.
        </div>
      )}
      {error && <div className="mt-2 text-[12px] text-destructive">{error}</div>}

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button onClick={install} disabled={saving || tooLong} className="flex-1">
          {saving ? <Loader2 size={13} className="animate-spin" /> : "Install skill"}
        </Button>
      </div>
    </div>
  );
}

export function AddSkill({
  onBack,
  onInstalled,
}: {
  onBack: () => void;
  onInstalled: (skill: Skill) => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const [fileName, setFileName] = useState("");
  const [review, setReview] = useState<{ name: string; markdown: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    file.text().then((text) => {
      setMarkdown(text);
      setFileName(file.name.replace(/\.mdx?$/i, ""));
    });
  };

  if (review) {
    return <ReviewImport draft={review} onBack={() => setReview(null)} onInstalled={onInstalled} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) readFile(file);
        }}
        className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-6 transition-colors duration-150 hover:border-ring/50 hover:bg-accent/50"
      >
        <FileText size={18} className="text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">Drop a .md file, or click to pick</span>
        <span className="text-[12px] text-muted-foreground">
          Markdown, with optional name/description frontmatter
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) readFile(file);
        }}
      />

      <div className="my-3 flex items-center gap-3 text-[11.5px] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or write it
        <span className="h-px flex-1 bg-border" />
      </div>

      <Textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        placeholder={`Use this when…\n\n1. First step\n2. Second step\n\nNot for: when to leave this alone.\nReturn: what to hand back.\nApproval: what needs a human first.`}
        className="min-h-[180px] flex-1 resize-none font-mono text-[12px] leading-relaxed"
      />
      <div className="mt-1.5 text-right">
        <LengthCount length={skillLength(markdown)} />
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={onBack} className="flex-1">
          Cancel
        </Button>
        <Button
          disabled={!markdown.trim()}
          onClick={() => setReview({ name: nameFor(markdown, fileName), markdown })}
          className="flex-1"
        >
          Review
        </Button>
      </div>
    </div>
  );
}

/** Adding a skill in a window over the page it was asked for from: the
 * Skills page, or Settings, Plugins. */
export function AddSkillDialog({
  open,
  onOpenChange,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: (skill: Skill) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[84vh] max-w-[620px] flex-col">
        <DialogTitle>Add a skill</DialogTitle>
        <DialogDescription>Teach your agents something new: drop a Markdown file, or write it here.</DialogDescription>
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <AddSkill
            onBack={() => onOpenChange(false)}
            onInstalled={(skill) => {
              onOpenChange(false);
              onInstalled(skill);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface Proposal {
  id: string;
  kind: "new" | "patch";
  botName: string;
  skillId?: string;
  name: string;
  description: string;
  body: string;
  because: string;
  at: number;
  overwritesEdits?: boolean;
  /** A change to a skill you have: what it does to it, line by line. */
  diff?: DiffLine[];
  /** The skill has changed so much since that the change no longer fits. */
  stale?: boolean;
}

/**
 * A skill the workspace wrote and has not installed.
 *
 * It opens closed, because the interesting question is whether to keep it
 * at all and that is answerable from one line. Opening it shows the whole
 * thing, editable: a suggestion is a draft with the words already
 * written, so changing them before keeping it is the ordinary case rather
 * than an exception.
 */
export function ProposedSkill({ proposal, onDone }: { proposal: Proposal; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(proposal.name);
  const [description, setDescription] = useState(proposal.description);
  const [body, setBody] = useState(proposal.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A change to a skill you have opens as its diff. Editing the result is
  // one press away; until then, keeping it applies the change to the
  // skill as it is at that moment, so nothing written since is lost.
  const patch = proposal.kind === "patch";
  const [editing, setEditing] = useState(!patch);

  const act = (keep: boolean) => {
    setBusy(true);
    setError(null);
    const call = keep
      ? api(`/api/skills/proposals/${proposal.id}`, {
          method: "POST",
          body: JSON.stringify(patch && !editing ? {} : { name, description, body }),
        })
      : api(`/api/skills/proposals/${proposal.id}`, { method: "DELETE" });
    call
      .then(onDone)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft/30 p-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <div className="text-[13px] font-medium text-foreground">
          {patch ? `A change to ${proposal.name}` : name}
        </div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {proposal.because}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground/80">
          From {proposal.botName}. {open ? "Hide it" : "Read it"}
        </div>
      </button>

      {/* An edited skill is somebody's own work, and a suggestion that
          would land on top of it should say so before it is approved. */}
      {proposal.overwritesEdits && (
        <div className="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-warning">
          You have your own changes in that skill. Keeping this replaces them.
        </div>
      )}

      {open && patch && proposal.stale && (
        <div className="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-warning">
          The skill has changed since this was suggested, and the change no longer fits. Discard it.
        </div>
      )}

      {open && patch && !editing && proposal.diff && (
        <div className="mt-2.5">
          <div className="max-h-[320px] overflow-auto rounded-lg border bg-background py-2">
            <DiffLines lines={proposal.diff} />
          </div>
          {!proposal.stale && (
            <button
              onClick={() => setEditing(true)}
              className="mt-1.5 text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Edit the result before keeping it
            </button>
          )}
        </div>
      )}

      {open && editing && (
        <div className="mt-2.5 flex flex-col gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="text-[13px]" />
          <Input
            value={description}
            placeholder="When to use it"
            onChange={(e) => setDescription(e.target.value)}
            className="text-[13px]"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[160px] font-mono text-[12px]"
          />
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-destructive">{error}</div>}

      <div className="mt-2.5 flex items-center gap-2">
        <Button
          size="sm"
          disabled={busy || !name.trim() || !body.trim() || (patch && proposal.stale && !editing)}
          onClick={() => act(true)}
        >
          Keep it
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(false)}>
          Discard
        </Button>
      </div>
    </div>
  );
}
