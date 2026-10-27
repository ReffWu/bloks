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
import { t } from "@/lib/i18n";

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
const LABEL: Record<string, string> = {
  genesis: "Record started",
  approval: "Approval",
  "agent.created": "Agent made",
  "approvals.changed": "Approvals changed",
  "engine.installed": "Engine installed",
  "agent.imported": "Agent brought in",
  "agent.exported": "Agent exported",
  "agent.archived": "Agent archived",
  "agent.restored": "Agent restored",
  "agent.deleted": "Agent deleted",
  "skill.installed": "Skill added",
  "skill.deleted": "Skill removed",
  "skill.changed": "Skill changed",
  "team.installed": "Team installed",
  "routine.ran": "Routine",
  "job.posted": "Job posted",
  "workflow.ran": "Workflow",
  "policy.changed": "Rule",
  "control.taken": "You took over",
  "control.released": "You handed back",
  "conversation.rewound": "Rewound",
  "setup.imported": "Setup brought over",
  "setup.undone": "Setup import undone",
  "sessions.imported": "Past sessions brought over",
  "server.update": "Server update",
  "home.call": "Home Assistant",
};

function when(at: number): string {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return today ? time : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
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
                  : `All ${result.entries} entries check out. Nothing was changed.`
                : `${result.reason[0].toUpperCase()}${result.reason.slice(1)}${
                    result.seq !== null ? `, at entry ${result.seq}` : ""
                  }.`}
            </span>
          </div>
        )}

        {stray > 0 && (
          <div className="mt-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-small text-destructive">
            {stray === 1
              ? t("recordPanel.oneLineInTheFile")
              : `${stray} lines in the file aren't entries.`}
          </div>
        )}

        <div className="mt-2 rounded-xl bg-muted/50 px-3 py-2.5 text-small leading-relaxed text-muted-foreground">
          This catches edited lines and checks signatures. Someone with access
          to {thisComputer()} could still rewrite the whole file.
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
                {LABEL[entry.kind] ?? entry.kind}
                {entry.actor && entry.kind !== "genesis" ? ` · ${entry.actor}` : ""}
                {entry.detail?.answer ? ` · ${entry.detail.answer}` : ""}
                {entry.detail?.decidedBy ? ` · decided by ${entry.detail.decidedBy}` : ""}
                {/* Only ever said about an entry that carries a signature.
                    Silence here means nobody claimed it, which is the
                    normal case and not something to flag. */}
                {entry.signature === "ok" && (
                  <span className="text-success" title={entry.signedBy}>
                    {" "}
                    · signed
                  </span>
                )}
                {entry.signature === "bad" && (
                  <span className="text-destructive" title={entry.signedBy}>
                    {" "}
                    · bad signature
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
