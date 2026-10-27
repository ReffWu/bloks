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
import { sizeText } from "@/lib/backups";
import { formatDate, formatList, formatNumber, t, tr, type MessageKey } from "@/lib/i18n";
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

// Words are kept as keys and translated where they are drawn, so a change of
// language reaches them.
const FORMATS: Array<{ value: Format; label: MessageKey; line: MessageKey }> = [
  { value: "openai", label: "trainingExport.format.openai.label", line: "trainingExport.format.openai.line" },
  { value: "sharegpt", label: "trainingExport.format.sharegpt.label", line: "trainingExport.format.sharegpt.line" },
  { value: "trajectory", label: "trainingExport.format.trajectory.label", line: "trainingExport.format.trajectory.line" },
];
const RESULTS: Record<Completeness, MessageKey> = {
  complete: "trainingExport.results.complete",
  partial: "trainingExport.results.partial",
  missing: "trainingExport.results.missing",
  none: "trainingExport.results.none",
};

const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const day = (at: number) => formatDate(at, { month: "short", day: "numeric", year: "numeric" });
/** Counts of different things in a row ("2 email addresses, 1 name"): the reader's own joiner, with no "and". */
const run = (items: string[]) => formatList(items, { type: "unit" });
const whole = (text: string) => (text.trim() === "" ? null : Number(text));

export function TrainingExportPage() {
  if (window.bloksWeb) return <Elsewhere />;
  return <TrainingExport />;
}

function Elsewhere() {
  return (
    <SettingsGroup>
      <SettingRow label={t("trainingExport.elsewhere")} description={t("trainingExport.openElsewhere")} />
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
  const [metadata, setMetadata] = useState(true);

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
      metadata,
    };
  }, [format, unit, picked, conversations.length, from, to, offEngines, listing, finishedWell, uncorrected, thumbsUp, completeResults, minTokens, maxTokens, privacy, include, shortenOn, resultChars, repeats, capOn, capTokens, metadata]);

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
        toast.success(t("trainingExport.exported", { records: t("trainingExport.count.records", { count: done.summary.records }), size: sizeText(done.file.size) }));
      } else setProblem(t("trainingExport.nothingMatched"));
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
              title: t("trainingExport.includeMemberPrivateTitle"),
              body: t("trainingExport.includeMemberPrivateBody"),
              confirmLabel: t("trainingExport.includeThem"),
            }
          : {
              title: t("trainingExport.includeOtherPeopleTitle"),
              body: t("trainingExport.includeOtherPeopleBody"),
              confirmLabel: t("trainingExport.includeThem"),
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
        <SettingsSkeleton rows={2} label={t("trainingExport.loading")} />
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
          <div className="font-medium text-foreground">{t("trainingExport.verdict", { computer: thisComputer() })}</div>
          <div className="text-muted-foreground">{t("trainingExport.verdictHint")}</div>
        </div>
      </div>

      <SettingsGroup title={t("trainingExport.format")}>
        <SettingRow label={t("trainingExport.shape")} description={t(FORMATS.find((f) => f.value === format)!.line)}>
          <Segmented className="mt-3 max-w-[520px]" aria-label={t("trainingExport.shape")} value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: t(f.label) }))} />
        </SettingRow>
        <SettingRow
          label={t("trainingExport.eachRecordIs")}
          description={unit === "turn" ? t("trainingExport.unitTurnHint") : t("trainingExport.unitConversationHint")}
          control={<Segmented size="sm" aria-label={t("trainingExport.eachRecordIs")} value={unit} onChange={setUnit} options={[{ value: "turn", label: t("trainingExport.unitTurn") }, { value: "conversation", label: t("trainingExport.unitConversation") }]} />}
        />
        {/* the trajectory is Bloks's own shape, all of it metadata */}
        {format !== "trajectory" && (
          <SettingRow
            label={t("trainingExport.metadata")}
            description={t("trainingExport.metadataHint")}
            control={<Switch aria-label={t("trainingExport.metadata")} checked={metadata} onCheckedChange={setMetadata} />}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={t("trainingExport.whichRuns")} footnote={nothing ? undefined : t("trainingExport.pickedOf", { count: picked.length, total: conversations.length })}>
        {nothing ? (
          <SettingRow label={t("trainingExport.noConversations")} description={t("trainingExport.noConversationsHint")} />
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
        <SettingRow label={t("trainingExport.dates")} description={t("trainingExport.datesHint")}>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input type="date" aria-label={t("trainingExport.from")} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto" />
            <span className="text-body text-muted-foreground">{t("trainingExport.rangeTo")}</span>
            <Input type="date" aria-label={t("trainingExport.to")} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto" />
          </div>
        </SettingRow>
        {engineChoice && (
          <SettingRow label={t("trainingExport.engines")} description={t("trainingExport.enginesHint")}>
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
                    <span className="text-muted-foreground"> · {t(RESULTS[engine.toolResults])}</span>
                  </label>
                </li>
              ))}
            </ul>
          </SettingRow>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("trainingExport.quality")}>
        <SettingRow
          label={t("trainingExport.onlyFinishedWell")}
          description={t("trainingExport.onlyFinishedWellHint")}
          control={<Switch aria-label={t("trainingExport.onlyFinishedWell")} checked={finishedWell} onCheckedChange={setFinishedWell} />}
        />
        <SettingRow
          label={t("trainingExport.onlyUncorrected")}
          description={t("trainingExport.onlyUncorrectedHint")}
          control={<Switch aria-label={t("trainingExport.onlyUncorrected")} checked={uncorrected} onCheckedChange={setUncorrected} />}
        />
        <SettingRow
          label={t("trainingExport.onlyThumbsUp")}
          description={t("trainingExport.onlyThumbsUpHint")}
          control={<Switch aria-label={t("trainingExport.onlyThumbsUp")} checked={thumbsUp} onCheckedChange={setThumbsUp} />}
        />
        <SettingRow
          label={t("trainingExport.onlyCompleteResults")}
          description={t("trainingExport.onlyCompleteResultsHint")}
          control={<Switch aria-label={t("trainingExport.onlyCompleteResults")} checked={completeResults} onCheckedChange={setCompleteResults} />}
        />
        <SettingRow label={t("trainingExport.length")} description={t("trainingExport.lengthHint")}>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input inputMode="numeric" aria-label={t("trainingExport.shortestTokens")} placeholder={t("trainingExport.shortest")} value={minTokens} onChange={(e) => setMinTokens(e.target.value.replace(/\D/g, ""))} className="h-8 w-28" />
            <span className="text-body text-muted-foreground">{t("trainingExport.rangeTo")}</span>
            <Input inputMode="numeric" aria-label={t("trainingExport.longestTokens")} placeholder={t("trainingExport.longest")} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value.replace(/\D/g, ""))} className="h-8 w-28" />
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("trainingExport.privacy")} footnote={t("trainingExport.privacyHint")}>
        <SettingRow label={t("trainingExport.takeOutEmails")} control={<Switch aria-label={t("trainingExport.takeOutEmails")} checked={privacy.emails} onCheckedChange={(on) => setPrivacy((p) => ({ ...p, emails: on }))} />} />
        <SettingRow label={t("trainingExport.takeOutPhones")} control={<Switch aria-label={t("trainingExport.takeOutPhones")} checked={privacy.phones} onCheckedChange={(on) => setPrivacy((p) => ({ ...p, phones: on }))} />} />
        <SettingRow
          label={t("trainingExport.shortenPaths")}
          description={t("trainingExport.shortenPathsHint")}
          control={<Switch aria-label={t("trainingExport.shortenPaths")} checked={privacy.homePaths} onCheckedChange={(on) => setPrivacy((p) => ({ ...p, homePaths: on }))} />}
        />
        <SettingRow
          label={t("trainingExport.takeOutNames")}
          description={t("trainingExport.takeOutNamesHint")}
          control={<Switch aria-label={t("trainingExport.takeOutNames")} checked={privacy.names} onCheckedChange={(on) => setPrivacy((p) => ({ ...p, names: on }))} />}
        />
      </SettingsGroup>

      <SettingsGroup title={t("trainingExport.alsoInclude")} description={t("trainingExport.alsoIncludeHint")}>
        <SettingRow
          label={t("trainingExport.memberPrivate")}
          description={listing.privateReadable ? t("trainingExport.memberPrivateHint") : t("trainingExport.memberPrivateOff")}
          control={<Switch aria-label={t("trainingExport.memberPrivate")} checked={include.memberPrivate} disabled={!listing.privateReadable} onCheckedChange={(on) => void ask("memberPrivate", on)} />}
        />
        <SettingRow
          label={t("trainingExport.otherPeople")}
          description={t("trainingExport.otherPeopleHint")}
          control={<Switch aria-label={t("trainingExport.otherPeople")} checked={include.otherPeople} onCheckedChange={(on) => void ask("otherPeople", on)} />}
        />
        <SettingRow
          label={t("trainingExport.agentDescriptions")}
          description={t("trainingExport.agentDescriptionsHint")}
          control={<Switch aria-label={t("trainingExport.agentDescriptions")} checked={include.systemPrompt} onCheckedChange={(on) => setInclude((i) => ({ ...i, systemPrompt: on }))} />}
        />
        <SettingRow
          label={t("trainingExport.agentMemory")}
          description={t("trainingExport.agentMemoryHint")}
          control={<Switch aria-label={t("trainingExport.agentMemory")} checked={include.memory} onCheckedChange={(on) => setInclude((i) => ({ ...i, memory: on }))} />}
        />
      </SettingsGroup>

      <SettingsGroup title={t("trainingExport.longRuns")} footnote={t("trainingExport.longRunsHint")}>
        <SettingRow
          label={t("trainingExport.shortenLong")}
          description={t("trainingExport.shortenLongHint")}
          control={<Switch aria-label={t("trainingExport.shortenLong")} checked={shortenOn} onCheckedChange={setShortenOn} />}
        >
          {shortenOn && (
            <div className="mt-3 flex items-center gap-2 text-body text-muted-foreground">
              {tr("trainingExport.pastCharacters", {
                input: <Input inputMode="numeric" aria-label={t("trainingExport.charactersKept")} value={resultChars} onChange={(e) => setResultChars(e.target.value.replace(/\D/g, ""))} className="h-8 w-24" />,
              })}
            </div>
          )}
        </SettingRow>
        <SettingRow
          label={t("trainingExport.leaveOutRepeats")}
          description={t("trainingExport.leaveOutRepeatsHint")}
          control={<Switch aria-label={t("trainingExport.leaveOutRepeats")} checked={repeats} onCheckedChange={setRepeats} />}
        />
        <SettingRow
          label={t("trainingExport.capEach")}
          description={t("trainingExport.capEachHint")}
          control={<Switch aria-label={t("trainingExport.capEach")} checked={capOn} onCheckedChange={setCapOn} />}
        >
          {capOn && (
            <div className="mt-3 flex items-center gap-2 text-body text-muted-foreground">
              {tr("trainingExport.capTokensLine", {
                input: <Input inputMode="numeric" aria-label={t("trainingExport.capTokensLabel")} value={capTokens} onChange={(e) => setCapTokens(e.target.value.replace(/\D/g, ""))} className="h-8 w-24" />,
              })}
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
            {busy === "preview" ? t("trainingExport.readingEveryTurn") : preview ? t("trainingExport.previewAgain") : t("common.preview")}
          </Button>
          {preview && !written && (
            <Button variant="brand" disabled={busy !== null || preview.summary.records === 0} onClick={() => void write()}>
              {busy === "write" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {busy === "write"
                ? t("trainingExport.writing")
                : preview.summary.records === 0
                  ? t("trainingExport.nothingToExport")
                  : t("trainingExport.exportCount", { records: t("trainingExport.count.records", { count: preview.summary.records }) })}
            </Button>
          )}
        </div>
        <p className="mt-2 px-1 text-small text-muted-foreground">{t("trainingExport.savedIn", { folder: listing.folder })}</p>
      </section>

      {listing.exports.length > 0 && (
        <SettingsGroup title={t("trainingExport.exportsCount", { count: listing.exports.length })}>
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
        <Tick checked={on === rows.length} mixed={on > 0 && on < rows.length} onChange={(next) => onPick(rows.map((c) => c.id), next)} label={t("trainingExport.everyConversationWith", { name: agent.name })} />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui font-medium text-foreground">
              {agent.name}
              {agent.archived && <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-caption font-normal text-muted-foreground">{t("trainingExport.archived")}</span>}
            </div>
            <div className="text-small text-muted-foreground">
              {t("trainingExport.agentCounts", {
                conversations: t("trainingExport.count.conversations", { count: rows.length }),
                turns: t("trainingExport.count.turns", { count: turns }),
              })}
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
                    {[c.kind === "team" ? t("trainingExport.kindTeam") : c.kind === "member" ? t("trainingExport.kindPrivate") : null, t("trainingExport.count.turns", { count: c.turns }), c.lastAt ? t("trainingExport.latest", { date: day(c.lastAt) }) : null]
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
    r.secrets && t("trainingExport.count.secrets", { count: r.secrets }),
    r.emails && t("trainingExport.count.emails", { count: r.emails }),
    r.phones && t("trainingExport.count.phones", { count: r.phones }),
    r.homePaths && t("trainingExport.count.homePaths", { count: r.homePaths }),
    r.names && t("trainingExport.count.names", { count: r.names }),
  ].filter(Boolean) as string[];
  const c = summary.compression;
  const shortened = [
    c.shortened && t("trainingExport.count.shortened", { count: c.shortened }),
    c.repeats && t("trainingExport.count.repeats", { count: c.repeats }),
    c.droppedTurns && t("trainingExport.count.droppedTurns", { count: c.droppedTurns }),
  ].filter(Boolean) as string[];
  return (
    <div className="mb-4 rounded-2xl border bg-card p-4">
      <div className="text-ui font-medium text-foreground">
        {summary.records
          ? t("trainingExport.summary", {
              records: t("trainingExport.count.records", { count: summary.records }),
              turns: t("trainingExport.count.turns", { count: summary.turns }),
              size: sizeText(summary.bytes),
            })
          : t("trainingExport.nothingMatches")}
      </div>
      <ul className="mt-1.5 flex flex-col gap-1 text-body leading-relaxed text-muted-foreground">
        {summary.leftOut.total > 0 && (
          <li>
            {t("trainingExport.leftOut", {
              turns: t("trainingExport.count.turns", { count: summary.leftOut.total }),
              reasons: run(summary.leftOut.reasons.map((x) => `${formatNumber(x.count)} ${x.label}`)),
            })}
          </li>
        )}
        {taken.length > 0 && <li>{t("trainingExport.takenOut", { items: run(taken) })}</li>}
        {shortened.length > 0 && <li>{t("trainingExport.shortened", { items: run(shortened) })}</li>}
        {summary.engines.map((e) => (
          <li key={e.kind}>
            {t("trainingExport.engineLine", { name: e.name, turns: t("trainingExport.count.turns", { count: e.turns }), results: t(RESULTS[e.toolResults]) })}
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
            {t("trainingExport.firstRecordIntro", { agent: preview.previewOf.agent, conversation: preview.previewOf.conversation, date: day(Date.parse(preview.previewOf.startedAt)) })}
          </div>
          <pre
            tabIndex={0}
            aria-label={t("trainingExport.firstRecord")}
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
    const yes = await confirm({ title: t("trainingExport.deleteExportTitle"), body: t("trainingExport.deleteExportBody"), confirmLabel: t("common.delete"), destructive: true });
    if (!yes) return;
    api(`/api/training-export/files/${encodeURIComponent(name)}`, { method: "DELETE" })
      .then(() => {
        toast(t("trainingExport.exportDeleted"));
        onDeleted();
      })
      .catch((e: Error) => toast.error(e.message));
  };
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      <Button size="sm" variant="secondary" onClick={() => void reveal(name)}>
        <FolderOpen size={13} />
        {deviceWord() === "Mac" ? t("trainingExport.showInFinder") : t("trainingExport.showInFolder")}
      </Button>
      <Button size="sm" variant="secondary" asChild>
        <a href={`/api/training-export/files/${encodeURIComponent(name)}`} download={name}>
          <Download size={13} />
          {t("trainingExport.download")}
        </a>
      </Button>
      <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => void remove()}>
        <Trash2 size={13} />
        {t("common.delete")}
      </Button>
    </div>
  );
}

function WrittenRow({ file, onDeleted }: { file: { name: string; path: string; size: number; summary: Summary }; onDeleted: () => void }) {
  return (
    <div role="status" className="mb-4 rounded-2xl border border-success/30 bg-success/5 p-4">
      <div className="text-ui font-medium text-foreground">
        {t("trainingExport.exported", { records: t("trainingExport.count.records", { count: file.summary.records }), size: sizeText(file.size) })}
      </div>
      <div className="mt-0.5 break-all font-mono text-small text-muted-foreground">{file.path}</div>
      <FileActions name={file.name} onDeleted={onDeleted} />
    </div>
  );
}

function ExportRow({ file, onChanged }: { file: ExportFile; onChanged: () => void }) {
  const format = FORMATS.find((f) => f.value === file.format);
  const shape = format ? t(format.label) : file.format;
  return (
    <div className="px-4 py-3.5">
      <div className="text-ui font-medium text-foreground">
        {formatDate(file.created, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
      </div>
      <div className="mt-0.5 text-body text-muted-foreground">
        {t("trainingExport.exportLine", { shape, unit: file.unit === "turn" ? t("trainingExport.oneTurnEach") : t("trainingExport.conversationEach"), size: sizeText(file.size) })}
      </div>
      <FileActions name={file.name} onDeleted={onChanged} />
    </div>
  );
}
