// Bring your past sessions: the person's Claude Code and Codex
// conversations, offered by project, to become conversations here
// (server/session-import.ts).
//
// Two steps, both on one screen. First the list: every project folder
// with its sessions, newest first, ticked one by one or a folder at a
// time, and who they go to. Then the review: each session exactly as it
// will land, how it carries on, and what stays behind, before anything is
// written. The server reads the files again on import and takes from here
// only which sessions, the digests shown, and where, so nothing on this
// screen can change what is brought over.
//
// Nothing is read until this screen is open: it asks for the list as it
// mounts, and not before. Used twice, like Bring your setup: as a page in
// Settings, and as an optional step of the first run.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "@/components/icons";
import { Check } from "@/components/icons";
import { ChevronRight } from "@/components/icons";
import { FolderOpen } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { ShieldCheck } from "@/components/icons";
import { ProviderMark } from "./ProviderIcons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { thisComputer } from "@/lib/thisComputer";
import { formatDate, formatList, t } from "@/lib/i18n";

type Engine = "claude" | "codex";

const ENGINE: Record<Engine, { name: string; driverKind: string }> = {
  claude: { name: "Claude Code", driverKind: "claudeAgent" },
  codex: { name: "Codex", driverKind: "codex" },
};

interface Session {
  key: string;
  engine: Engine;
  title: string;
  from: string;
  folder: string | null;
  startedAt: number;
  lastAt: number;
  messages: number;
  tools: number;
  imported?: { botId: string; laneId: string; name: string };
}

interface Project {
  folder: string | null;
  name: string;
  label: string;
  exists: boolean;
  lastAt: number;
  sessions: Session[];
}

interface Listing {
  projects: Project[];
  skipped: Array<{ from: string; why: string }>;
  looked: Record<Engine, boolean>;
  more: number;
}

type Row = { role: "user" | "assistant"; text: string; at: number } | { role: "tool"; name: string; line: string; ok: boolean; at: number };

interface Reviewed extends Omit<Session, "imported"> {
  removed: number;
  left: number;
  digest: string;
  resumes: boolean;
  why?: string;
  imported?: { botId: string; laneId: string };
  rows: Row[];
  more: number;
}

interface Review {
  sessions: Reviewed[];
  to: { botId: string; name: string; room: number } | { hire: Array<{ folder: string | null; name: string }> };
}

interface Result {
  key: string;
  ok: boolean;
  botId?: string;
  laneId?: string;
  resumes?: boolean;
  error?: string;
}

/** Projects shown before "Show more": a long history is dozens of them. */
const FIRST_PROJECTS = 12;

function day(at: number): string {
  return new Date(at).getFullYear() === new Date().getFullYear()
    ? formatDate(at, { month: "short", day: "numeric" })
    : formatDate(at, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Whether either tool's folder is there, which the first run needs to
 * know to offer the step. Asks only that: no session is listed or opened.
 */
export function usePastSessionPlaces(): Record<Engine, boolean> | null {
  const [places, setPlaces] = useState<Record<Engine, boolean> | null>(null);
  useEffect(() => {
    api("/api/session-import/places")
      .then((r: { places: Record<Engine, boolean> }) => setPlaces(r.places))
      .catch(() => setPlaces({ claude: false, codex: false }));
  }, []);
  return places;
}

/** The line this screen opens with, in both of its places. */
export function PastSessionsPrivacyLine({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl bg-success/10 px-3 py-2.5", className)}>
      <ShieldCheck size={16} className="mt-px shrink-0 text-success" />
      <div className="min-w-0 text-body leading-relaxed">
        <div className="font-medium text-foreground">{t("pastSessions.privacy", { computer: thisComputer() })}</div>
        <div className="text-muted-foreground">{t("pastSessions.linesThatLookLikeKeys")}</div>
      </div>
    </div>
  );
}

function Tick({ id, checked, mixed, disabled, onChange, label }: { id?: string; checked: boolean; mixed?: boolean; disabled?: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <input
      id={id}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(mixed);
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-[3px] size-4 shrink-0 accent-(--brand) disabled:opacity-40"
    />
  );
}

function SessionRow({ session, on, onChange }: { session: Session; on: boolean; onChange: (on: boolean) => void }) {
  const id = `past-${session.key}`;
  return (
    <li className={cn("flex gap-3 px-3.5 py-2.5 transition-colors duration-150", on && "bg-brand-soft/30")}>
      <Tick id={id} checked={on} disabled={Boolean(session.imported)} onChange={onChange} />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="flex min-w-0 items-center gap-1.5">
          <ProviderMark driverKind={ENGINE[session.engine].driverKind} size={13} className="shrink-0" />
          <span className="min-w-0 truncate text-ui text-foreground">
            {session.title}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-muted-foreground">
          <span>{[ENGINE[session.engine].name, day(session.lastAt), t("pastSessions.messages", { count: session.messages })].join(" · ")}</span>
          {session.imported && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-caption">
              <Check size={11} /> {t("pastSessions.withAgent", { name: session.imported.name })}
            </span>
          )}
        </div>
      </label>
    </li>
  );
}

function ProjectCard({ project, picked, onPick }: { project: Project; picked: Set<string>; onPick: (keys: string[], on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  // a session already brought over is shown, and not offered again
  const offered = project.sessions.filter((s) => !s.imported);
  const on = offered.filter((s) => picked.has(s.key)).length;
  return (
    <section aria-label={project.name} className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <Tick
          checked={offered.length > 0 && on === offered.length}
          mixed={on > 0 && on < offered.length}
          disabled={offered.length === 0}
          onChange={(next) => onPick(offered.map((s) => s.key), next)}
          label={t("pastSessions.everyConversationIn", { name: project.name })}
        />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-ui font-medium text-foreground">{project.name}</span>
            </div>
            {project.label && <div className="mt-0.5 truncate font-mono text-caption text-muted-foreground/80">{project.label}</div>}
            <div className="mt-0.5 text-small text-muted-foreground">
              {t(project.folder && !project.exists ? "pastSessions.projectLineGone" : "pastSessions.projectLine", {
                count: project.sessions.length,
                day: day(project.lastAt),
              })}
            </div>
          </div>
          <ChevronRight size={14} className={cn("mt-1 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")} />
        </button>
      </div>
      {open && (
        <ul className="flex flex-col divide-y border-t">
          {project.sessions.map((session) => (
            <SessionRow key={session.key} session={session} on={picked.has(session.key)} onChange={(next) => onPick([session.key], next)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One session as it will land: the person's words, the engine's, and
 * each tool call as its one line. */
function Transcript({ session }: { session: Reviewed }) {
  const engine = ENGINE[session.engine].name;
  return (
    <div className="mt-2 max-h-[320px] overflow-auto rounded-lg border bg-muted/40 p-2.5">
      {session.more + session.left > 0 && (
        <div className="pb-2 text-caption text-muted-foreground">{t("pastSessions.earlierRows", { count: session.more + session.left })}</div>
      )}
      <ol className="flex flex-col gap-1.5">
        {session.rows.map((row, i) =>
          row.role === "tool" ? (
            <li key={i} className={cn("truncate font-mono text-caption", row.ok ? "text-muted-foreground" : "text-destructive")}>
              {row.line}
            </li>
          ) : (
            <li key={i} className="text-small leading-relaxed">
              <span className="font-medium text-foreground">{row.role === "user" ? t("pastSessions.you") : engine}: </span>
              <span className="whitespace-pre-wrap break-words text-foreground/90">{row.text.length > 1200 ? `${row.text.slice(0, 1200)}…` : row.text}</span>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

function ReviewRow({ session, result, onOpen }: { session: Reviewed; result?: Result; onOpen?: (r: Result) => void }) {
  const [open, setOpen] = useState(false);
  const engine = ENGINE[session.engine].name;
  return (
    <li className="px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <ProviderMark driverKind={ENGINE[session.engine].driverKind} size={13} className="shrink-0" />
        <span className="min-w-0 truncate text-ui font-medium text-foreground">{session.title}</span>
      </div>
      <div className="mt-0.5 text-small text-muted-foreground">
        {t("pastSessions.reviewLine", {
          when:
            day(session.startedAt) !== day(session.lastAt)
              ? t("pastSessions.dayRange", { from: day(session.startedAt), to: day(session.lastAt) })
              : day(session.startedAt),
          messages: t("pastSessions.messages", { count: session.messages }),
          tools: t("pastSessions.toolCalls", { count: session.tools }),
        })}
      </div>
      <ul className="mt-1.5 flex flex-col gap-0.5 text-small leading-relaxed">
        <li className={session.resumes ? "text-foreground" : "text-muted-foreground"}>
          {session.resumes ? t("pastSessions.carriesOn", { engine }) : session.why}
        </li>
        {session.removed > 0 && (
          <li className="text-muted-foreground">{t("pastSessions.secretsStay", { count: session.removed })}</li>
        )}
        {session.left > 0 && <li className="text-muted-foreground">{t("pastSessions.earliestLeftOut", { count: session.left })}</li>}
        {session.imported && <li className="text-warning">{t("pastSessions.alreadyAConversationHereSo")}</li>}
      </ul>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-1.5 flex items-center gap-1 rounded-md text-small text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight size={12} className={cn("transition-transform duration-150", open && "rotate-90")} />
        {open ? t("pastSessions.hideWhatComesOver") : t("pastSessions.showWhatComesOver")}
      </button>
      {open && <Transcript session={session} />}
      {result && (
        <div className={cn("mt-1.5 flex flex-wrap items-center gap-2 text-small", result.ok ? "text-success" : "text-destructive")} aria-live="polite">
          {result.ok ? t("pastSessions.broughtOver") : t("pastSessions.notBroughtOver", { error: result.error ?? "" })}
          {result.ok && result.laneId && onOpen && (
            <Button size="sm" variant="secondary" onClick={() => onOpen(result)}>
              {t("common.open")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The list, the review and the button that brings them over.
 *
 * `compact` is the first-run version: the page scrolls rather than a box
 * in it, and the parent owns the way on.
 */
export function PastSessionsImport({ compact = false, onImported }: { compact?: boolean; onImported?: (count: number) => void }) {
  const { state, dispatch } = useStore();
  const agents = state.bots.filter((b) => !b.archivedAt);
  const [listing, setListing] = useState<Listing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState<string>("hire");
  const [showAll, setShowAll] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<"review" | "import" | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});

  const look = useCallback(() => {
    setProblem(null);
    api("/api/session-import")
      .then((r: Listing) => setListing(r))
      .catch((e: Error) => {
        setProblem(e.message);
        setListing({ projects: [], skipped: [], looked: { claude: false, codex: false }, more: 0 });
      });
  }, []);
  useEffect(look, [look]);

  const destination = to === "hire" ? { hire: true } : { botId: to };
  const pick = (keys: string[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      for (const key of keys) (on ? next.add(key) : next.delete(key));
      return next;
    });
  const count = picked.size;
  const projects = useMemo(() => (listing ? (showAll ? listing.projects : listing.projects.slice(0, FIRST_PROJECTS)) : []), [listing, showAll]);

  const toReview = async () => {
    setBusy("review");
    setProblem(null);
    setResults({});
    try {
      setReview(await api("/api/session-import/review", { method: "POST", body: JSON.stringify({ picks: [...picked], to: destination }) }));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : t("pastSessions.reviewFailed"));
    } finally {
      setBusy(null);
    }
  };

  const open = (result: Result) => {
    if (result.botId && result.laneId) dispatch({ type: "select", id: result.botId, lane: result.laneId });
  };

  const bring = async () => {
    if (!review) return;
    setBusy("import");
    setProblem(null);
    try {
      const picks = review.sessions.filter((s) => !s.imported).map((s) => ({ key: s.key, digest: s.digest }));
      const outcome: { results: Result[]; created: string[] } = await api("/api/session-import", {
        method: "POST",
        body: JSON.stringify({ picks, to: destination }),
      });
      setResults(Object.fromEntries(outcome.results.map((r) => [r.key, r])));
      const brought = outcome.results.filter((r) => r.ok);
      const failed = outcome.results.length - brought.length;
      if (brought.length) {
        toast.success(t("pastSessions.broughtOverCount", { count: brought.length }), {
          ...(failed ? { description: t("pastSessions.someFailed", { count: failed }) } : {}),
          ...(compact ? {} : { action: { label: t("common.open"), onClick: () => open(brought[brought.length - 1]) } }),
        });
      } else if (failed) {
        toast.error(t("pastSessions.nothingBroughtOver"), { description: t("pastSessions.theReviewSaysWhy") });
      }
      setPicked(new Set());
      onImported?.(brought.length);
      look();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : t("pastSessions.somethingWentWrong"));
    } finally {
      setBusy(null);
    }
  };

  if (listing === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-body text-muted-foreground">
        <Loader2 size={15} className="animate-spin" /> {t("pastSessions.lookingForPastSessions")}
      </div>
    );
  }

  if (review) {
    const going = review.sessions.filter((s) => !s.imported).length;
    const room = "botId" in review.to ? review.to.room : Infinity;
    const done = Object.keys(results).length > 0;
    return (
      <div className="flex flex-col">
        <div className="mb-3 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setReview(null)} disabled={busy !== null}>
            <ArrowLeft size={14} /> {t("common.back")}
          </Button>
          <h2 className="min-w-0 truncate text-ui font-semibold text-foreground">
            {"botId" in review.to
              ? t("pastSessions.toAgent", { name: review.to.name })
              : review.to.hire.length === 1
                ? t("pastSessions.toNewAgentFor", { name: review.to.hire[0].name })
                : t("pastSessions.toNewAgentForEach", { names: formatList(review.to.hire.map((h) => h.name), { type: "unit" }) })}
          </h2>
        </div>
        {going > room && !done && (
          <div className="mb-3 rounded-xl bg-warning/10 px-3 py-2.5 text-body leading-relaxed text-foreground">
            {t("pastSessions.noRoom", { name: "botId" in review.to ? review.to.name : t("pastSessions.thisAgent"), count: room })}
          </div>
        )}
        <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
          {review.sessions.map((session) => (
            // the first run's way on is its own Continue, not a jump out of it
            <ReviewRow key={session.key} session={session} result={results[session.key]} onOpen={compact ? undefined : open} />
          ))}
        </ul>
        <div className={cn("flex flex-col gap-2", compact ? "mt-4" : "sticky bottom-0 -mx-1 mt-5 bg-background/90 px-1 pb-1 pt-3 backdrop-blur")}>
          {problem && <div className="text-small text-destructive">{problem}</div>}
          {!done && (
            <Button
              size={compact ? "lg" : "default"}
              variant="brand"
              disabled={busy !== null || going === 0}
              onClick={() => void bring()}
              className={cn(compact ? "w-full sm:w-auto sm:self-start" : "self-start")}
            >
              {busy === "import" ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {t("pastSessions.bringingOver")}
                </>
              ) : going === 0 ? (
                t("pastSessions.nothingNewToBringOver")
              ) : (
                t("pastSessions.bringOver", { count: going })
              )}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!listing.projects.length) {
    return (
      <div className="rounded-2xl border bg-card p-4">
        <div className="text-ui font-medium text-foreground">{problem ? t("pastSessions.couldntLook", { problem }) : t("pastSessions.noPastSessionsFound")}</div>
        <div className="mt-1 text-body leading-relaxed text-muted-foreground">
          {t("pastSessions.bloksLooksInClaudeProjects")}
        </div>
        <Button size="sm" variant="secondary" className="mt-3" onClick={look}>
          {t("pastSessions.lookAgain")}
        </Button>
      </div>
    );
  }

  const sessions = listing.projects.reduce((n, p) => n + p.sessions.length, 0);
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 px-1 text-small text-muted-foreground">
        {t("pastSessions.listing", {
          conversations: t("pastSessions.conversations", { count: sessions }),
          folders: t("pastSessions.folders", { count: listing.projects.length }),
        })}
        {listing.more > 0 ? ` ${t("pastSessions.olderLeftOut", { count: listing.more })}` : ""}
      </div>
      <div className="flex flex-col gap-2.5">
        {projects.map((project) => (
          <ProjectCard key={project.folder ?? "none"} project={project} picked={picked} onPick={pick} />
        ))}
      </div>
      {listing.projects.length > FIRST_PROJECTS && !showAll && (
        <Button size="sm" variant="ghost" className="mt-2 self-start" onClick={() => setShowAll(true)}>
          {t("pastSessions.showMoreFolders", { count: listing.projects.length - FIRST_PROJECTS })}
        </Button>
      )}
      {listing.skipped.length > 0 && (
        <details className="group mt-3 px-1">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-small text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight size={12} className="transition-transform duration-150 group-open:rotate-90" />
            {t("pastSessions.leftOut", { count: listing.skipped.length })}
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1 pl-4">
            {listing.skipped.map((skip) => (
              <li key={`${skip.from}:${skip.why}`} className="text-small leading-relaxed text-muted-foreground">
                <span className="break-all font-mono text-caption text-foreground/80">{skip.from}</span>: {skip.why}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={cn("flex flex-col gap-2", compact ? "mt-4" : "sticky bottom-0 -mx-1 mt-5 bg-background/90 px-1 pb-1 pt-3 backdrop-blur")}>
        {problem && <div className="text-small text-destructive">{problem}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="past-sessions-to" className="text-body text-muted-foreground">
            {t("pastSessions.bringTo")}
          </label>
          <select
            id="past-sessions-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-body text-foreground"
          >
            <option value="hire">{t("pastSessions.aNewAgentForEach")}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <Button
            size={compact ? "lg" : "default"}
            variant="brand"
            disabled={busy !== null || count === 0}
            onClick={() => void toReview()}
            className={compact ? "w-full sm:w-auto" : undefined}
          >
            {busy === "review" ? (
              <>
                <Loader2 size={14} className="animate-spin" /> {t("pastSessions.reading")}
              </>
            ) : count === 0 ? (
              t("pastSessions.nothingSelected")
            ) : (
              t("pastSessions.reviewCount", { count })
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The Settings page. */
export function PastSessionsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PastSessionsPrivacyLine />
      <PastSessionsImport />
    </div>
  );
}
