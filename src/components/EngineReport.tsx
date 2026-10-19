// Engine scout (server/engine-report.ts): how often each engine's work is
// kept, what it costs where the provider says, and, for an agent that has
// tried more than one, a lighter model that has been doing as well.
import { useEffect, useState } from "react";
import { Gauge } from "@/components/icons";
import { api, useStore, type Bot } from "@/state/store";
import { AgentAvatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface EngineRow {
  key: string;
  instanceId: string;
  model: string;
  label: string;
  turns: number;
  kept: number;
  undone: number;
  rewound: number;
  discarded: number;
  failed: number;
  out: number;
  keptRate: number | null;
  tokensPerTurn: number;
  cost: number;
  costTurns: number;
}

export interface EngineSuggestion {
  botId: string;
  from: { instanceId: string; model: string; label: string; keptRate: number; turns: number };
  to: { instanceId: string; model: string; label: string; keptRate: number; turns: number };
  saves?: number;
  why: string;
}

interface Report {
  engines: EngineRow[];
  suggestions: EngineSuggestion[];
  turns: number;
}

export function useEngineReport() {
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    api("/api/engines/report")
      .then(setReport)
      .catch(() => setReport(null));
  }, []);
  return report;
}

const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** One suggestion, with the switch that acts on it. */
export function EngineSuggestionCard({ s, bot, compact }: { s: EngineSuggestion; bot?: Bot; compact?: boolean }) {
  const { dispatch } = useStore();
  const [done, setDone] = useState(false);
  if (done) {
    return <div className="rounded-xl bg-muted px-3 py-2 text-body text-muted-foreground">Switched to {s.to.label}.</div>;
  }
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft/30 px-3 py-2.5", compact && "py-2")}>
      {bot && !compact && <AgentAvatar bot={bot} size={24} />}
      <div className="min-w-0 flex-1 text-body leading-relaxed text-foreground">
        {!compact && bot && <span className="font-medium">{bot.name}: </span>}
        {s.why}
        {s.saves ? ` About $${s.saves.toFixed(3)} less a turn.` : ""}
      </div>
      <Button
        size="sm"
        onClick={() => {
          dispatch({ type: "setModel", botId: s.botId, selection: { instanceId: s.to.instanceId, model: s.to.model } });
          setDone(true);
        }}
      >
        Switch
      </Button>
    </div>
  );
}

export function EngineReport() {
  const { state } = useStore();
  const report = useEngineReport();
  if (!report) return null;
  const judged = report.engines.filter((e) => e.turns > 0);
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center gap-2 text-ui font-semibold text-foreground">
          <Gauge size={14} className="text-muted-foreground" /> How your engines are doing
        </div>
        <div className="mt-0.5 text-body leading-relaxed text-muted-foreground">
          Learned from what you do with the work: a change you undo, a conversation you rewind past or a rehearsal you
          discard counts against it. Worked out on this machine only.
        </div>
      </div>
      {report.suggestions.length > 0 && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          {report.suggestions.map((s) => (
            <EngineSuggestionCard key={s.botId} s={s} bot={state.bots.find((b) => b.id === s.botId)} />
          ))}
        </div>
      )}
      {judged.length === 0 ? (
        <div className="border-t px-4 py-4 text-body text-muted-foreground">
          Nothing to go on yet. It fills in as your agents work.
        </div>
      ) : (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-left text-body">
            <thead className="text-caption uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Engine</th>
                <th className="px-2 py-2 text-right font-medium">Turns</th>
                <th className="px-2 py-2 text-right font-medium">Kept</th>
                <th className="px-2 py-2 text-right font-medium">Tokens a turn</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {judged.map((e) => (
                <tr key={e.key}>
                  <td className="px-4 py-2 text-foreground">{e.label}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{e.turns}</td>
                  <td
                    className="px-2 py-2 text-right tabular-nums text-foreground"
                    title={`Undone ${e.undone}, rewound ${e.rewound}, discarded ${e.discarded}, failed ${e.failed}, ran out ${e.out}`}
                  >
                    {e.keptRate === null ? "–".replace("–", "-") : `${e.keptRate}%`}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{tokens(e.tokensPerTurn)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {e.costTurns ? `$${e.cost.toFixed(2)}` : "not reported"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
