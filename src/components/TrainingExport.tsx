// Export for training: agents' runs written to a file on this computer,
// in the shapes people fine-tune tool-calling models on
// (server/run-export.ts).
//
// The person chooses, previews, then writes. The preview is the whole
// export run dry: the same counts of what was left out and why and of
// what was taken out, and the first record exactly as it will be written.
// Changing anything puts the page back before the preview, so what is
// written is always what was last looked at.
//
// The server answers only this computer, so a phone or bloks.dev/web gets
// a sentence instead of the page, as Backups does.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, Eye, FolderOpen, Loader2, ShieldCheck, Trash2, TriangleAlert } from "@/components/icons";
import { api } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { thisComputer } from "@/lib/thisComputer";
import { deviceWord } from "@/lib/thisComputer";
import { SettingRow, SettingsGroup, SettingsSkeleton } from "./SettingsLayout";

type Format = "openai" | "sharegpt" | "trajectory";
type Unit = "turn" | "conversation";
type Completeness = "complete" | "partial" | "missing" | "none";

interface Conversation {
  id: string;
  title: string;
  kind: "own" | "team" | "member";
  turns: number;
  lastAt: number | null;
}
interface Agent {
  id: string;
  name: string;
  archived: boolean;
  conversations: Conversation[];
}
interface ExportFile {
  name: string;
  size: number;
  created: number;
  format: Format;
  unit: Unit;
}
interface Listing {
  agents: Agent[];
  engines: Array<{ kind: string; name: string; toolResults: Exclude<Completeness, "none"> }>;
  privateReadable: boolean;
  folder: string;
  exports: ExportFile[];
}
interface Summary {
  records: number;
  turns: number;
  considered: number;
  leftOut: { total: number; reasons: Array<{ reason: string; label: string; count: number }> };
  removed: { secrets: number; emails: number; phones: number; homePaths: number; names: number };
  compression: { rule: string | null; shortened: number; repeats: number; capped: number; droppedTurns: number };
  engines: Array<{ kind: string; name: string; turns: number; toolResults: Completeness }>;
  bytes: number;
  warnings: string[];
}
interface Preview {
  summary: Summary;
  preview: string | null;
  previewOf: { agent: string; conversation: string; startedAt: string } | null;
}

const FORMATS: Array<{ value: Format; label: string; line: string }> = [
  { value: "openai", label: "OpenAI chat", line: "messages with tools and tool_calls, the JSONL OpenAI fine-tuning reads." },
  { value: "sharegpt", label: "ShareGPT", line: "conversations of from and value, with calls and results as tagged blocks." },
  { value: "trajectory", label: "Bloks trajectory", line: "every step with its timing, engine, model, tokens and cost." },
];
const RESULTS: Record<Completeness, string> = {
  complete: "Tool results complete",
  partial: "Some tool results not recorded",
  missing: "Tool results not recorded",
  none: "No tool calls",
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const sizeText = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dayFormat = new Intl.DateTimeFormat([], { month: "short", day: "numeric", year: "numeric" });
const whole = (text: string) => (text.trim() === "" ? null : Number(text));

export function TrainingExportPage() {
  if (window.bloksWeb) return <Elsewhere />;
  return <TrainingExport />;
}

function Elsewhere() {
  return (
    <SettingsGroup>
      <SettingRow label="Exports are written on the computer running Bloks" description="Open Bloks there to export your agents' runs." />
    </SettingsGroup>
  );
}

function Tick({ id, checked, mixed, onChange, label }: { id?: string; checked: boolean; mixed?: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <input
      id={id}
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(mixed);
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-[3px] size-4 shrink-0 accent-(--brand)"
    />
  );
}

function TrainingExport() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [refused, setRefused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const [format, setFormat] = useState<Format>("openai");
  const [unit, setUnit] = useState<Unit>("turn");
  /** Conversation ids left out; everything else listed is in. */
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offEngines, setOffEngines] = useState<Set<string>>(new Set());
  const [finishedWell, setFinishedWell] = useState(true);
  const [uncorrected, setUncorrected] = useState(false);
  const [thumbsUp, setThumbsUp] = useState(false);
  const [completeResults, setCompleteResults] = useState(false);
  const [minTokens, setMinTokens] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [privacy, setPrivacy] = useState({ emails: true, phones: true, homePaths: true, names: true });
  const [include, setInclude] = useState({ memberPrivate: false, otherPeople: false, systemPrompt: false, memory: false });
  const [shortenOn, setShortenOn] = useState(true);
  const [resultChars, setResultChars] = useState("6000");
  const [repeats, setRepeats] = useState(true);
  const [capOn, setCapOn] = useState(false);
  const [capTokens, setCapTokens] = useState("16000");

  const [busy, setBusy] = useState<"preview" | "write" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [written, setWritten] = useState<{ name: string; path: string; size: number; summary: Summary } | null>(null);

  const load = useCallback(() => {
    api("/api/training-export")
      .then((l: Listing) => {
        setListing(l);
        setProblem(null);
      })
      .catch((e: Error & { status?: number }) => {
        if (e.status === 403) setRefused(true);
        else setProblem(e.message);
      });
  }, []);
  useEffect(load, [load]);

  // members' private conversations are only offered once their switch is on
  const conversations = useMemo(
    () => (listing?.agents ?? []).flatMap((a) => a.conversations.filter((c) => c.turns > 0 && (c.kind !== "member" || include.memberPrivate)).map((c) => ({ agent: a, c }))),
    [listing, include.memberPrivate],
  );
  const picked = conversations.filter(({ c }) => !unticked.has(c.id));

  const body = useMemo(() => {
    const allPicked = picked.length === conversations.length;
    return {
      format,
      unit,
      ...(allPicked ? {} : { conversations: picked.map(({ c }) => c.id) }),
      from: from || null,
      to: to || null,
      ...(offEngines.size && listing ? { engines: listing.engines.map((e) => e.kind).filter((k) => !offEngines.has(k)) } : {}),
      finishedWell,
      uncorrected,
      thumbsUp,
      completeResults,
      minTokens: whole(minTokens),
      maxTokens: whole(maxTokens),
      privacy,
      include,
      compression: { toolResultChars: shortenOn ? whole(resultChars) : null, repeats, capTokens: capOn ? whole(capTokens) : null },
    };
  }, [format, unit, picked, conversations.length, from, to, offEngines, listing, finishedWell, uncorrected, thumbsUp, completeResults, minTokens, maxTokens, privacy, include, shortenOn, resultChars, repeats, capOn, capTokens]);

  // anything changed is a new export: the old preview no longer says what it would write
  const key = JSON.stringify(body);
  useEffect(() => {
    setPreview(null);
    setWritten(null);
  }, [key]);

  const runPreview = async () => {
    setBusy("preview");
    setProblem(null);
    try {
      setPreview(await api("/api/training-export/preview", { method: "POST", body: key }));
    } catch (e) {
      setProblem(errorOf(e));
    } finally {
      setBusy(null);
    }
  };

  const write = async () => {
    setBusy("write");
    setProblem(null);
    try {
      const done: { summary: Summary; file: { name: string; path: string; size: number } | null; exports: ExportFile[] } = await api("/api/training-export", { method: "POST", body: key });
      setListing((l) => (l ? { ...l, exports: done.exports } : l));
      if (done.file) {
        setWritten({ ...done.file, summary: done.summary });
        toast.success(`Exported ${plural(done.summary.records, "record", "records")}, ${sizeText(done.file.size)}`);
      } else setProblem("Nothing matched, so nothing was written.");
    } catch (e) {
      setProblem(errorOf(e));
    } finally {
      setBusy(null);
    }
  };

  /** A switch that lets someone else's words in asks first. */
  const ask = async (what: "memberPrivate" | "otherPeople", on: boolean) => {
    if (on) {
      const yes = await confirm(
        what === "memberPrivate"
          ? {
              title: "Include members' private conversations?",
              body: "Members wrote these to an agent, not to you. Ask them before you share the file, and keep it to yourself if you can't.",
              confirmLabel: "Include them",
            }
          : {
              title: "Include other people's messages?",
              body: "Members in team conversations, people on Telegram, email and chat apps. Their names are still taken out if you keep that on, but their words are theirs.",
              confirmLabel: "Include them",
            },
      );
      if (!yes) return;
    }
    setInclude((i) => ({ ...i, [what]: on }));
  };

  if (refused) return <Elsewhere />;
  if (!listing) {
    if (problem) return <div className="px-1 py-6 text-body text-destructive">{problem}</div>;
    return (
      <>
        <SettingsSkeleton rows={2} label="Loading the export" />
        <SettingsSkeleton rows={4} />
      </>
    );
  }

  const nothing = conversations.length === 0;
  const engineChoice = listing.engines.length > 1;

  return (
    <>
      <div className="mb-8 flex items-start gap-2.5 rounded-xl bg-success/10 px-3 py-2.5">
        <ShieldCheck size={16} className="mt-px shrink-0 text-success" />
        <div className="min-w-0 text-body leading-relaxed">
          <div className="font-medium text-foreground">Written to a file on {thisComputer()}. Nothing is sent anywhere.</div>
          <div className="text-muted-foreground">Keys, tokens and passwords are always taken out. Nothing is written until you preview it.</div>
        </div>
      </div>

      <SettingsGroup title="Format">
        <SettingRow label="Shape" description={FORMATS.find((f) => f.value === format)!.line}>
          <Segmented className="mt-3 max-w-[520px]" aria-label="Shape" value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.label }))} />
        </SettingRow>
        <SettingRow
          label="Each record is"
          description={unit === "turn" ? "One ask and everything the agent did for it." : "A whole conversation, its kept turns in order."}
          control={<Segmented size="sm" aria-label="Each record is" value={unit} onChange={setUnit} options={[{ value: "turn", label: "One turn" }, { value: "conversation", label: "A conversation" }]} />}
        />
      </SettingsGroup>

      <SettingsGroup title="Which runs" footnote={nothing ? undefined : `${plural(picked.length, "conversation", "conversations")} of ${conversations.length.toLocaleString()} ticked.`}>
        {nothing ? (
          <SettingRow label="No conversations yet" description="Once your agents have done some work, their runs can be exported here." />
        ) : (
          <div className="px-2 py-2">
            {listing.agents.map((agent) => (
              <AgentPicks
                key={agent.id}
                agent={agent}
                rows={conversations.filter((r) => r.agent.id === agent.id).map((r) => r.c)}
                unticked={unticked}
                onPick={(ids, on) =>
                  setUnticked((cur) => {
                    const next = new Set(cur);
                    for (const id of ids) (on ? next.delete(id) : next.add(id));
                    return next;
                  })
                }
              />
            ))}
          </div>
        )}
        <SettingRow label="Dates" description="Only turns started on these days. Leave either empty for no limit.">
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto" />
            <span className="text-body text-muted-foreground">to</span>
            <Input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto" />
          </div>
        </SettingRow>
        {engineChoice && (
          <SettingRow label="Engines" description="What each engine writes down of its tool calls is beside it. Every record says what it has.">
            <ul className="mt-3 flex flex-col gap-2">
              {listing.engines.map((engine) => (
                <li key={engine.kind} className="flex items-start gap-2.5">
                  <Tick
                    id={`engine-${engine.kind}`}
                    checked={!offEngines.has(engine.kind)}
                    onChange={(on) =>
                      setOffEngines((cur) => {
                        const next = new Set(cur);
                        if (on) next.delete(engine.kind);
                        else next.add(engine.kind);
                        return next;
                      })
                    }
                  />
                  <label htmlFor={`engine-${engine.kind}`} className="min-w-0 cursor-pointer text-body">
                    <span className="text-foreground">{engine.name}</span>
                    <span className="text-muted-foreground"> · {RESULTS[engine.toolResults]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </SettingRow>
        )}
      </SettingsGroup>

      <SettingsGroup title="Quality">
        <SettingRow
          label="Only turns that finished well"
          description="No error, and not stopped."
          control={<Switch aria-label="Only turns that finished well" checked={finishedWell} onCheckedChange={setFinishedWell} />}
        />
        <SettingRow
          label="Only turns you didn't correct"
          description="Leaves out turns you stopped, steered while they ran, edited, redid or gave a thumbs down."
          control={<Switch aria-label="Only turns you didn't correct" checked={uncorrected} onCheckedChange={setUncorrected} />}
        />
        <SettingRow
          label="Only turns with a thumbs up"
          description="A 👍 you added to one of the agent's replies."
          control={<Switch aria-label="Only turns with a thumbs up" checked={thumbsUp} onCheckedChange={setThumbsUp} />}
        />
        <SettingRow
          label="Only turns with every tool result"
          description="Some engines never send what their tools returned. Leaves those turns out rather than marking the gaps."
          control={<Switch aria-label="Only turns with every tool result" checked={completeResults} onCheckedChange={setCompleteResults} />}
        />
        <SettingRow label="Length" description="In tokens, estimated at four characters each, of the record as written.">
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input inputMode="numeric" aria-label="Shortest, in tokens" placeholder="Shortest" value={minTokens} onChange={(e) => setMinTokens(e.target.value.replace(/\D/g, ""))} className="h-8 w-28" />
            <span className="text-body text-muted-foreground">to</span>
            <Input inputMode="numeric" aria-label="Longest, in tokens" placeholder="Longest" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value.replace(/\D/g, ""))} className="h-8 w-28" />
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Privacy" footnote="Keys, tokens and passwords are always taken out, and so is every key saved in this workspace.">
        <SettingRow label="Take out email addresses" control={<Switch aria-label="Take out email addresses" checked={privacy.emails} onCheckedChange={(on) => setPrivacy((p) => ({ ...p, emails: on }))} />} />
        <SettingRow label="Take out phone numbers" control={<Switch aria-label="Take out phone numbers" checked={privacy.phones} onCheckedChange={(on) => setPrivacy((p) => ({ ...p, phones: on }))} />} />
        <SettingRow
          label="Shorten paths in your home folder"
          description="Your home folder is written as ~, so your account name stays behind."
          control={<Switch aria-label="Shorten paths in your home folder" checked={privacy.homePaths} onCheckedChange={(on) => setPrivacy((p) => ({ ...p, homePaths: on }))} />}
        />
        <SettingRow
          label="Take out people's names"
          description="Yours, and everyone this workspace knows: members, guests and people on Telegram."
          control={<Switch aria-label="Take out people's names" checked={privacy.names} onCheckedChange={(on) => setPrivacy((p) => ({ ...p, names: on }))} />}
        />
      </SettingsGroup>

      <SettingsGroup title="Also include" description="Left out unless you ask for them.">
        <SettingRow
          label="Members' private conversations"
          description={listing.privateReadable ? "Members wrote these to an agent, not to you." : "Turn on reading members' private conversations in Members first."}
          control={<Switch aria-label="Members' private conversations" checked={include.memberPrivate} disabled={!listing.privateReadable} onCheckedChange={(on) => void ask("memberPrivate", on)} />}
        />
        <SettingRow
          label="Other people's messages"
          description="Members in team conversations, people on Telegram, email and chat apps."
          control={<Switch aria-label="Other people's messages" checked={include.otherPeople} onCheckedChange={(on) => void ask("otherPeople", on)} />}
        />
        <SettingRow
          label="Agent descriptions"
          description="Each agent's name, title and description, as the system message."
          control={<Switch aria-label="Agent descriptions" checked={include.systemPrompt} onCheckedChange={(on) => setInclude((i) => ({ ...i, systemPrompt: on }))} />}
        />
        <SettingRow
          label="Agent memory"
          description="Each agent's MEMORY.md, in the system message."
          control={<Switch aria-label="Agent memory" checked={include.memory} onCheckedChange={(on) => setInclude((i) => ({ ...i, memory: on }))} />}
        />
      </SettingsGroup>

      <SettingsGroup title="Long runs" footnote="Every record that was shortened says how, in its metadata.">
        <SettingRow
          label="Shorten long tool results"
          description="Keeps the start and the end, with the gap marked."
          control={<Switch aria-label="Shorten long tool results" checked={shortenOn} onCheckedChange={setShortenOn} />}
        >
          {shortenOn && (
            <div className="mt-3 flex items-center gap-2 text-body text-muted-foreground">
              <span>Past</span>
              <Input inputMode="numeric" aria-label="Characters kept" value={resultChars} onChange={(e) => setResultChars(e.target.value.replace(/\D/g, ""))} className="h-8 w-24" />
              <span>characters</span>
            </div>
          )}
        </SettingRow>
        <SettingRow
          label="Leave out repeated results"
          description="The same call with the same result again keeps the call and points back at the first."
          control={<Switch aria-label="Leave out repeated results" checked={repeats} onCheckedChange={setRepeats} />}
        />
        <SettingRow
          label="Cap each record"
          description="Shortens the longest results further, then drops a conversation's earliest turns. A record that still doesn't fit is left out."
          control={<Switch aria-label="Cap each record" checked={capOn} onCheckedChange={setCapOn} />}
        >
          {capOn && (
            <div className="mt-3 flex items-center gap-2 text-body text-muted-foreground">
              <span>At</span>
              <Input inputMode="numeric" aria-label="Cap, in tokens" value={capTokens} onChange={(e) => setCapTokens(e.target.value.replace(/\D/g, ""))} className="h-8 w-24" />
              <span>tokens</span>
            </div>
          )}
        </SettingRow>
      </SettingsGroup>

      <section className="mb-9" aria-live="polite">
        {preview && <PreviewCard preview={preview} />}
        {written && (
          <WrittenRow file={written} onDeleted={load} />
        )}
        {problem && <div className="mb-3 px-1 text-body text-destructive">{problem}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={preview ? "secondary" : "brand"} disabled={busy !== null || nothing || picked.length === 0} onClick={() => void runPreview()}>
            {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            {busy === "preview" ? "Reading every turn…" : preview ? "Preview again" : "Preview"}
          </Button>
          {preview && !written && (
            <Button variant="brand" disabled={busy !== null || preview.summary.records === 0} onClick={() => void write()}>
              {busy === "write" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {busy === "write" ? "Writing…" : preview.summary.records === 0 ? "Nothing to export" : `Export ${plural(preview.summary.records, "record", "records")}`}
            </Button>
          )}
        </div>
        <p className="mt-2 px-1 text-small text-muted-foreground">Saved in {listing.folder}.</p>
      </section>

      {listing.exports.length > 0 && (
        <SettingsGroup title={`Exports (${listing.exports.length})`}>
          {listing.exports.map((file) => (
            <ExportRow key={file.name} file={file} onChanged={load} />
          ))}
        </SettingsGroup>
      )}
    </>
  );
}

function AgentPicks({ agent, rows, unticked, onPick }: { agent: Agent; rows: Conversation[]; unticked: Set<string>; onPick: (ids: string[], on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const on = rows.filter((c) => !unticked.has(c.id)).length;
  const turns = rows.reduce((n, c) => n + c.turns, 0);
  return (
    <div className="rounded-xl">
      <div className="flex items-start gap-3 px-3 py-2">
        <Tick checked={on === rows.length} mixed={on > 0 && on < rows.length} onChange={(next) => onPick(rows.map((c) => c.id), next)} label={`Every conversation with ${agent.name}`} />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui font-medium text-foreground">
              {agent.name}
              {agent.archived && <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-caption font-normal text-muted-foreground">Archived</span>}
            </div>
            <div className="text-small text-muted-foreground">
              {plural(rows.length, "conversation", "conversations")}, {plural(turns, "turn", "turns")}
            </div>
          </div>
          <ChevronRight size={14} className={cn("mt-1 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")} />
        </button>
      </div>
      {open && (
        <ul className="mb-1 ml-7 flex flex-col">
          {rows.map((c) => {
            const id = `export-${c.id}`;
            return (
              <li key={c.id} className="flex items-start gap-3 px-3 py-1.5">
                <Tick id={id} checked={!unticked.has(c.id)} onChange={(next) => onPick([c.id], next)} />
                <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                  <div className="truncate text-body text-foreground">{c.title}</div>
                  <div className="text-small text-muted-foreground">
                    {[c.kind === "team" ? "Team conversation" : c.kind === "member" ? "Private" : null, plural(c.turns, "turn", "turns"), c.lastAt ? `the latest ${dayFormat.format(c.lastAt)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** What the export would be: the counts, then the first record. */
function PreviewCard({ preview }: { preview: Preview }) {
  const { summary } = preview;
  const r = summary.removed;
  const taken = [
    r.secrets && plural(r.secrets, "key or password", "keys or passwords"),
    r.emails && plural(r.emails, "email address", "email addresses"),
    r.phones && plural(r.phones, "phone number", "phone numbers"),
    r.homePaths && plural(r.homePaths, "home folder path", "home folder paths"),
    r.names && plural(r.names, "name", "names"),
  ].filter(Boolean) as string[];
  const c = summary.compression;
  const shortened = [
    c.shortened && plural(c.shortened, "long result shortened", "long results shortened"),
    c.repeats && plural(c.repeats, "repeated result left out", "repeated results left out"),
    c.droppedTurns && plural(c.droppedTurns, "early turn dropped to fit the cap", "early turns dropped to fit the cap"),
  ].filter(Boolean) as string[];
  return (
    <div className="mb-4 rounded-2xl border bg-card p-4">
      <div className="text-ui font-medium text-foreground">
        {summary.records
          ? `${plural(summary.records, "record", "records")} from ${plural(summary.turns, "turn", "turns")}, about ${sizeText(summary.bytes)}`
          : "Nothing matches these choices"}
      </div>
      <ul className="mt-1.5 flex flex-col gap-1 text-body leading-relaxed text-muted-foreground">
        {summary.leftOut.total > 0 && (
          <li>
            Left out {plural(summary.leftOut.total, "turn", "turns")}: {summary.leftOut.reasons.map((x) => `${x.count.toLocaleString()} ${x.label}`).join(", ")}.
          </li>
        )}
        {taken.length > 0 && <li>Taken out: {taken.join(", ")}.</li>}
        {shortened.length > 0 && <li>Shortened: {shortened.join(", ")}.</li>}
        {summary.engines.map((e) => (
          <li key={e.kind}>
            {e.name}: {plural(e.turns, "turn", "turns")}. {RESULTS[e.toolResults]}.
          </li>
        ))}
      </ul>
      {summary.warnings.map((w) => (
        <div key={w} className="mt-2 flex items-start gap-2 rounded-lg bg-warning/10 px-2.5 py-2 text-body text-foreground">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" />
          {w}
        </div>
      ))}
      {preview.preview && preview.previewOf && (
        <>
          <div className="mt-3 text-small text-muted-foreground">
            The first record, as it will be written: {preview.previewOf.agent}, {preview.previewOf.conversation}, {dayFormat.format(Date.parse(preview.previewOf.startedAt))}
          </div>
          <pre
            tabIndex={0}
            aria-label="The first record"
            className="mt-1.5 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-2.5 font-mono text-caption leading-relaxed text-foreground/90"
          >
            {preview.preview}
          </pre>
        </>
      )}
    </div>
  );
}

const reveal = (name: string) =>
  api(`/api/training-export/files/${encodeURIComponent(name)}/reveal`, { method: "POST" })
    .then((r: { path: string; shown: boolean }) => {
      if (!r.shown) toast(r.path);
    })
    .catch((e: Error) => toast.error(e.message));

function FileActions({ name, onDeleted }: { name: string; onDeleted: () => void }) {
  const remove = async () => {
    const yes = await confirm({ title: "Delete this export?", body: "The file is deleted from this computer. This can't be undone.", confirmLabel: "Delete", destructive: true });
    if (!yes) return;
    api(`/api/training-export/files/${encodeURIComponent(name)}`, { method: "DELETE" })
      .then(() => {
        toast("Export deleted");
        onDeleted();
      })
      .catch((e: Error) => toast.error(e.message));
  };
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      <Button size="sm" variant="secondary" onClick={() => void reveal(name)}>
        <FolderOpen size={13} />
        {deviceWord() === "Mac" ? "Show in Finder" : "Show in folder"}
      </Button>
      <Button size="sm" variant="secondary" asChild>
        <a href={`/api/training-export/files/${encodeURIComponent(name)}`} download={name}>
          <Download size={13} />
          Download
        </a>
      </Button>
      <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => void remove()}>
        <Trash2 size={13} />
        Delete
      </Button>
    </div>
  );
}

function WrittenRow({ file, onDeleted }: { file: { name: string; path: string; size: number; summary: Summary }; onDeleted: () => void }) {
  return (
    <div role="status" className="mb-4 rounded-2xl border border-success/30 bg-success/5 p-4">
      <div className="text-ui font-medium text-foreground">
        Exported {plural(file.summary.records, "record", "records")}, {sizeText(file.size)}
      </div>
      <div className="mt-0.5 break-all font-mono text-small text-muted-foreground">{file.path}</div>
      <FileActions name={file.name} onDeleted={onDeleted} />
    </div>
  );
}

function ExportRow({ file, onChanged }: { file: ExportFile; onChanged: () => void }) {
  const shape = FORMATS.find((f) => f.value === file.format)?.label ?? file.format;
  return (
    <div className="px-4 py-3.5">
      <div className="text-ui font-medium text-foreground">
        {new Date(file.created).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
      </div>
      <div className="mt-0.5 text-body text-muted-foreground">
        {shape}, {file.unit === "turn" ? "one turn each" : "a conversation each"}, {sizeText(file.size)}
      </div>
      <FileActions name={file.name} onDeleted={onChanged} />
    </div>
  );
}
