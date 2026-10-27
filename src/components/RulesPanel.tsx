// Rules about what your agents may do, written in a form.
//
// The screen is a sentence builder rather than a text field, because the
// point of the rules comparing instead of evaluating (see server/policy.ts)
// is that a person can write one without learning a syntax. Every rule
// reads back as the sentence it is.
//
// Two things the screen has to say plainly, because getting either wrong
// is how somebody ends up trusting protection they do not have.
//
//   With no rules, nothing changes: every question still reaches you.
//   This is not a gate that starts shut.
//
//   Deny wins. The list is ordered the way it runs, denies first, so that
//   reading it top to bottom is reading what actually happens.
//
// Above the rules, what the person keeps approving, offered as a rule
// (server/rule-suggestions.ts). Taking one adds it to the list below like
// any other, so this is where it is read and removed again.
import { useCallback, useEffect, useState } from "react";
import { Ban } from "@/components/icons";
import { Check } from "@/components/icons";
import { Plus } from "@/components/icons";
import { ShieldCheck } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { useRuleSuggestions } from "@/lib/ruleSuggestions";
import { SuggestionWhat, takeSuggestion } from "@/components/chat/Banners";
import { formatList, t, tr, type MessageKey } from "@/lib/i18n";

type Effect = "allow" | "deny";
type Field = "tool" | "command" | "path" | "url" | "agent";
type Op = "contains" | "not-contains" | "equals" | "starts-with" | "ends-with" | "runs" | "in-folder" | "on-site";

interface Rule {
  id: string;
  effect: Effect;
  field: Field;
  op: Op;
  value: string;
  botId?: string;
  /** Only this tool; absent is any tool. Rules made from a suggestion
   * carry one. */
  tool?: string;
  enabled: boolean;
  summary: string;
}

/** The words for each choice, so the form reads as the sentence it builds.
 * Keys, said where they draw. The form's pieces are the sentence's own
 * slots, so each language orders them in the read-back sentence. */
const FIELD_WORDS: Array<[Field, MessageKey]> = [
  ["tool", "rulesPanel.field.tool"],
  ["command", "rulesPanel.field.command"],
  ["path", "rulesPanel.field.path"],
  ["url", "rulesPanel.field.url"],
  ["agent", "rulesPanel.field.agent"],
];

const OP_WORDS: Array<[Op, MessageKey]> = [
  ["contains", "rulesPanel.op.contains"],
  ["not-contains", "rulesPanel.op.notContains"],
  ["equals", "rulesPanel.op.equals"],
  ["starts-with", "rulesPanel.op.startsWith"],
  ["ends-with", "rulesPanel.op.endsWith"],
];

/** The narrow comparisons a suggestion writes. Read back here, not
 * offered in the form: each belongs to one field and reads it rather
 * than only comparing (server/policy.ts). */
const NARROW_WORDS: Array<[Op, MessageKey]> = [
  ["runs", "rulesPanel.op.runs"],
  ["in-folder", "rulesPanel.op.inFolder"],
  ["on-site", "rulesPanel.op.onSite"],
];

const fieldWords = (field: Field) => {
  const key = FIELD_WORDS.find(([f]) => f === field)?.[1];
  return key ? t(key) : field;
};
const opWords = (op: Op) => {
  const key = [...OP_WORDS, ...NARROW_WORDS].find(([o]) => o === op)?.[1];
  return key ? t(key) : op;
};

const PLACEHOLDER: Record<Field, string> = {
  tool: "Bash",
  command: "rm -rf",
  path: "/etc/",
  url: "example.com",
  agent: "Ivy",
};

export function RulesPanel() {
  const { state } = useStore();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      api("/api/rules")
        .then((r) => {
          setRules(r.rules ?? []);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  // a rule taken from a suggestion, or changed in another window
  const rulesTick = state.ticks.rules ?? 0;
  useEffect(() => {
    void load();
  }, [load, rulesTick]);

  // Naming looks at everyone, so a rule about an agent that has since
  // been archived still reads. Choosing offers only the ones that can
  // act, or you write a rule about nobody.
  const bots = state.bots ?? [];
  const choosable = bots.filter((b) => !b.archivedAt);
  const nameOf = (botId?: string) => (botId ? (bots.find((b) => b.id === botId)?.name ?? t("rulesPanel.anAgent")) : null);

  return (
    <>
      <div className="mb-9 rounded-2xl border bg-card p-5 last:mb-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-ui font-semibold text-foreground">{t("rulesPanel.yourRules")}</div>
            <div className="mt-0.5 text-body leading-relaxed text-muted-foreground">
              {t("rulesPanel.theseAnswerPermissionRequestsFor")}
            </div>
          </div>
          {!adding && (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setAdding(true)}>
              <Plus size={13} /> {t("rulesPanel.newRule")}
            </Button>
          )}
        </div>
        <div className="mt-2.5 rounded-xl bg-muted/50 px-3 py-2 text-small leading-relaxed text-muted-foreground">
          {t("rulesPanel.refuseAlwaysWinsOverAllow")}
        </div>
      </div>

      <Suggested />

      {adding && (
        <RuleForm
          bots={choosable}
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      {error && (
        <div className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-body text-destructive">{error}</div>
      )}

      {rules?.length === 0 && !adding && (
        <div className="mt-3 px-4 py-10 text-center">
          <div className="text-body text-foreground">{t("rulesPanel.noRulesYet")}</div>
          <div className="mx-auto mt-1 max-w-[380px] text-body leading-relaxed text-muted-foreground">
            {t("rulesPanel.addOneWhenYouKeep")}
          </div>
        </div>
      )}

      {rules && rules.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5",
                !rule.enabled && "opacity-55",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg",
                  rule.effect === "deny" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success",
                )}
              >
                {rule.effect === "deny" ? <Ban size={13} /> : <Check size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-body text-foreground">
                  {tr(rule.effect === "deny" ? "rulesPanel.readBack.deny" : "rulesPanel.readBack.allow", {
                    field: fieldWords(rule.field),
                    op: opWords(rule.op),
                    value: <span className="font-mono text-small">{rule.value}</span>,
                  })}
                </div>
                <div className="mt-0.5 text-small text-muted-foreground">
                  {rule.tool
                    ? rule.botId
                      ? t("rulesPanel.onlyAgentTool", { name: nameOf(rule.botId) ?? "", tool: rule.tool })
                      : t("rulesPanel.everyAgentTool", { tool: rule.tool })
                    : rule.botId
                      ? t("rulesPanel.onlyAgent", { name: nameOf(rule.botId) ?? "" })
                      : t("rulesPanel.everyAgent")}
                  {rule.enabled ? "" : ` · ${t("rulesPanel.off")}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  aria-label={t("rulesPanel.switchLabel", { rule: rule.summary })}
                  checked={rule.enabled}
                  onCheckedChange={(enabled) =>
                    api(`/api/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) })
                      .then(load)
                      .catch((e: Error) => setError(e.message))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("rulesPanel.removeRule")}
                  onClick={() =>
                    api(`/api/rules/${rule.id}`, { method: "DELETE" })
                      .then(load)
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RuleForm({
  bots,
  onCancel,
  onAdded,
}: {
  bots: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [effect, setEffect] = useState<Effect>("deny");
  const [field, setField] = useState<Field>("command");
  const [op, setOp] = useState<Op>("contains");
  const [value, setValue] = useState("");
  const [botId, setBotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    api("/api/rules", {
      method: "POST",
      body: JSON.stringify({ effect, field, op, value, ...(botId ? { botId } : {}) }),
    })
      .then(onAdded)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const select = "rounded-lg border border-input bg-transparent px-2 py-1.5 text-body text-foreground outline-none";

  return (
    <div className="mt-3 rounded-2xl border bg-card p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(["deny", "allow"] as const).map((choice) => (
            <button
              key={choice}
              onClick={() => setEffect(choice)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-body transition-colors duration-150",
                effect === choice
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {choice === "deny" ? t("rulesPanel.refuse") : t("rulesPanel.allow")}
            </button>
          ))}
        </div>
        <span className="text-body text-muted-foreground">{t("rulesPanel.when")}</span>
        <select value={field} onChange={(e) => setField(e.target.value as Field)} className={select}>
          {FIELD_WORDS.map(([f, words]) => (
            <option key={f} value={f}>
              {t(words)}
            </option>
          ))}
        </select>
        <select value={op} onChange={(e) => setOp(e.target.value as Op)} className={select}>
          {OP_WORDS.map(([o, words]) => (
            <option key={o} value={o}>
              {t(words)}
            </option>
          ))}
        </select>
        <Input
          value={value}
          placeholder={PLACEHOLDER[field]}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 min-w-[140px] flex-1 font-mono text-body"
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-body text-muted-foreground">{t("rulesPanel.for")}</span>
        <select value={botId} onChange={(e) => setBotId(e.target.value)} className={select}>
          <option value="">{t("rulesPanel.form.everyAgent")}</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {t("rulesPanel.form.onlyAgent", { name: bot.name })}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="mt-2 text-small text-destructive">{error}</div>}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="brand" size="sm" disabled={busy || !value.trim()} onClick={save}>
          {t("rulesPanel.addRule")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * What the person keeps approving, each with the three answers. Taken,
 * one becomes a rule in the list below; Not now keeps it away for a
 * month. Nothing at all when nothing is on offer.
 */
function Suggested() {
  const { suggestions, accept, dismiss } = useRuleSuggestions();
  if (!suggestions.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5" aria-label={t("rulesPanel.suggestedRules")}>
      <div className="px-1 text-small font-medium text-muted-foreground">{t("rulesPanel.youKeepApprovingThese")}</div>
      {suggestions.map((s) => (
        <div key={s.id} className="flex animate-rise-in items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
            <ShieldCheck size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-body text-foreground">{s.title}</div>
            <div className="mt-0.5 text-small text-muted-foreground">
              {s.agents.length > 1 ? (
                tr("rulesPanel.whatApprovedFor", {
                  what: <SuggestionWhat what={s.what} />,
                  names: formatList(s.agents.map((a) => a.name), { type: "unit", style: "short" }),
                })
              ) : (
                <SuggestionWhat what={s.what} />
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {s.forAgent && (
                <Button variant="brand" size="sm" onClick={() => takeSuggestion(accept, s, "agent")}>
                  {t("rulesPanel.allowFor", { name: s.forAgent.name })}
                </Button>
              )}
              {s.forEveryone && (
                <Button size="sm" variant={s.forAgent ? "secondary" : "default"} onClick={() => takeSuggestion(accept, s, "everyone")}>
                  {t("rulesPanel.allowForEveryone")}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void dismiss(s.id)}>
                {t("common.notNow")}
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
