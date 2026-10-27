// The record, read in the app rather than off disk.
//
// Every consequential thing carries the hash of the entry before it, so
// the list is only worth as much as the check next to it. The check is
// therefore the first thing on the screen, not a detail at the bottom,
// and it says plainly what it does and does not prove.
import { useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { ShieldAlert } from "@/components/icons";
import { api } from "@/state/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { thisComputer } from "@/lib/thisComputer";
import { formatDate, t, type MessageKey } from "@/lib/i18n";

interface Entry {
  seq: number;
  at: number;
  kind: string;
  actor: string;
  summary: string;
  detail?: Record<string, string | number | boolean>;
  prev: string;
  hash: string;
  /** Present only when the entry carries a signature: whether it holds.
   * Most entries are things the person did and nobody claimed. */
  signature?: "ok" | "bad";
  /** The agent's public key, when it signed. */
  signedBy?: string;
}

type VerifyResult =
  | { ok: true; entries: number; through: number | null }
  | { ok: false; entries: number; seq: number | null; reason: string };

/** Plain words for each kind, so the list reads as a sentence rather than
 * as a set of event names. */
const LABEL: Record<string, MessageKey> = {
  genesis: "recordPanel.kind.genesis",
  approval: "recordPanel.kind.approval",
  "agent.created": "recordPanel.kind.agentCreated",
  "approvals.changed": "recordPanel.kind.approvalsChanged",
  "engine.installed": "recordPanel.kind.engineInstalled",
  "agent.imported": "recordPanel.kind.agentImported",
  "agent.exported": "recordPanel.kind.agentExported",
  "agent.archived": "recordPanel.kind.agentArchived",
  "agent.restored": "recordPanel.kind.agentRestored",
  "agent.deleted": "recordPanel.kind.agentDeleted",
  "skill.installed": "recordPanel.kind.skillInstalled",
  "skill.deleted": "recordPanel.kind.skillDeleted",
  "skill.changed": "recordPanel.kind.skillChanged",
  "team.installed": "recordPanel.kind.teamInstalled",
  "routine.ran": "recordPanel.kind.routineRan",
  "job.posted": "recordPanel.kind.jobPosted",
  "workflow.ran": "recordPanel.kind.workflowRan",
  "policy.changed": "recordPanel.kind.policyChanged",
  "control.taken": "recordPanel.kind.controlTaken",
  "control.released": "recordPanel.kind.controlReleased",
  "conversation.rewound": "recordPanel.kind.conversationRewound",
  "setup.imported": "recordPanel.kind.setupImported",
  "setup.undone": "recordPanel.kind.setupUndone",
  "sessions.imported": "recordPanel.kind.sessionsImported",
  "server.update": "recordPanel.kind.serverUpdate",
  "home.call": "recordPanel.kind.homeCall",
};

function when(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  const time = formatDate(date, { hour: "numeric", minute: "2-digit" });
  return today ? time : t("recordPanel.dateTime", { date: formatDate(date, { month: "short", day: "numeric" }), time });
}

function capitalized(text: string): string {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

export function RecordPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [stray, setStray] = useState(0);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api("/api/ledger?limit=200")
      .then((r) => {
        setEntries(r.entries ?? []);
        setStray(r.strayLines ?? 0);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const check = () => {
    setChecking(true);
    setResult(null);
    api("/api/ledger/verify")
      .then((r) => setResult(r.result))
      .catch((e: Error) => setError(e.message))
      .finally(() => setChecking(false));
  };

  return (
    <>
      <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-ui font-semibold text-foreground">{t("recordPanel.theRecord")}</div>
            <div className="mt-0.5 text-body leading-relaxed text-muted-foreground">
              {t("recordPanel.whatYourAgentsDidAnd")}
            </div>
          </div>
          <Button variant="secondary" size="sm" disabled={checking} onClick={check}>
            {checking ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {checking ? t("recordPanel.checking") : t("recordPanel.checkIt")}
          </Button>
        </div>

        {result && (
          <div
            className={cn(
              "mt-3 flex gap-2 rounded-xl px-3 py-2.5 text-body leading-relaxed",
              result.ok
                ? "bg-muted/60 text-foreground"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {result.ok ? (
              <Check size={14} className="mt-[2px] shrink-0" />
            ) : (
              <ShieldAlert size={14} className="mt-[2px] shrink-0" />
            )}
            <span>
              {result.ok
                ? result.entries === 0
                  ? t("recordPanel.nothingRecordedYet")
                  : t("recordPanel.allCheckOut", { count: result.entries })
                : // the reason is the server's own words
                  result.seq !== null
                  ? t("recordPanel.brokenAt", { reason: capitalized(result.reason), seq: String(result.seq) })
                  : t("recordPanel.broken", { reason: capitalized(result.reason) })}
            </span>
          </div>
        )}

        {stray > 0 && (
          <div className="mt-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-small text-destructive">
            {stray === 1
              ? t("recordPanel.oneLineInTheFile")
              : t("recordPanel.strayLines", { count: stray })}
          </div>
        )}

        <div className="mt-2 rounded-xl bg-muted/50 px-3 py-2.5 text-small leading-relaxed text-muted-foreground">
          {t("recordPanel.whatTheCheckProves", { computer: thisComputer() })}
        </div>
      </div>

      <div className="mb-9 rounded-2xl border bg-card p-1.5 last:mb-0">
        {error && (
          <div className="m-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-small text-destructive">
            {error}
          </div>
        )}
        {!entries && !error && (
          <div className="flex items-center gap-2 px-3 py-6 text-body text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {t("recordPanel.readingTheRecord")}
          </div>
        )}
        {entries?.length === 0 && (
          <div className="px-3 py-6 text-center text-body text-muted-foreground">
            {t("recordPanel.nothingYetApprovalsAndChanges")}
          </div>
        )}
        {entries?.map((entry) => (
          <div
            key={entry.hash}
            className="flex items-start gap-3 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-accent/50"
          >
            {/* The time is a column when there is room for one, and part
                of the line underneath when there is not: 86px of gutter
                out of a 375px window is the difference between a readable
                summary and three words a line. */}
            <span className="mt-[3px] hidden w-[86px] shrink-0 text-caption tabular-nums text-muted-foreground/70 sm:block">
              {when(entry.at)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body text-foreground">{entry.summary}</span>
              <span className="mt-0.5 block text-small text-muted-foreground">
                <span className="sm:hidden">{when(entry.at)} · </span>
                {LABEL[entry.kind] ? t(LABEL[entry.kind]) : entry.kind}
                {entry.actor && entry.kind !== "genesis" ? ` · ${entry.actor}` : ""}
                {entry.detail?.answer ? ` · ${entry.detail.answer}` : ""}
                {entry.detail?.decidedBy ? ` · ${t("recordPanel.decidedBy", { name: String(entry.detail.decidedBy) })}` : ""}
                {/* Only ever said about an entry that carries a signature.
                    Silence here means nobody claimed it, which is the
                    normal case and not something to flag. */}
                {entry.signature === "ok" && (
                  <span className="text-success" title={entry.signedBy}>
                    {` · ${t("recordPanel.signed")}`}
                  </span>
                )}
                {entry.signature === "bad" && (
                  <span className="text-destructive" title={entry.signedBy}>
                    {` · ${t("recordPanel.badSignature")}`}
                  </span>
                )}
              </span>
            </span>
            {/* The first bytes of the fingerprint. Not useful on its own,
                which is the point: it is here so the chain is visible as a
                thing that exists rather than a claim in a paragraph. */}
            <span
              title={entry.hash}
              className="mt-[3px] shrink-0 font-mono text-caption text-muted-foreground/50"
            >
              {entry.hash.slice(0, 8)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
