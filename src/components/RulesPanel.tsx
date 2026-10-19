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
import { useCallback, useEffect, useState } from "react";
import { Ban } from "@/components/icons";
import { Check } from "@/components/icons";
import { Plus } from "@/components/icons";
import { Trash2 } from "@/components/icons";
import { api, useStore } from "@/state/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

type Effect = "allow" | "deny";
type Field = "tool" | "command" | "path" | "url" | "agent";
type Op = "contains" | "not-contains" | "equals" | "starts-with" | "ends-with";

interface Rule {
  id: string;
  effect: Effect;
  field: Field;
  op: Op;
  value: string;
  botId?: string;
  enabled: boolean;
  summary: string;
}

/** The words for each choice, so the form reads as the sentence it builds. */
const FIELD_WORDS: Array<[Field, string]> = [
  ["tool", "the tool"],
  ["command", "the command"],
  ["path", "the file"],
  ["url", "the address"],
  ["agent", "the agent"],
];

const OP_WORDS: Array<[Op, string]> = [
  ["contains", "contains"],
  ["not-contains", "does not contain"],
  ["equals", "is exactly"],
  ["starts-with", "starts with"],
  ["ends-with", "ends with"],
];

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

  useEffect(() => {
    void load();
  }, [load]);

  // Naming looks at everyone, so a rule about an agent that has since
  // been archived still reads. Choosing offers only the ones that can
  // act, or you write a rule about nobody.
  const bots = state.bots ?? [];
  const choosable = bots.filter((b) => !b.archivedAt);
  const nameOf = (botId?: string) => (botId ? (bots.find((b) => b.id === botId)?.name ?? "an agent") : null);

  return (
    <>
      <div className="mt-4 rounded-2xl border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-ui font-semibold text-foreground">Your rules</div>
            <div className="mt-0.5 text-body leading-relaxed text-muted-foreground">
              These answer permission requests for you. Anything they do not cover still comes to
              you.
            </div>
          </div>
          {!adding && (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setAdding(true)}>
              <Plus size={13} /> New rule
            </Button>
          )}
        </div>
        <div className="mt-2.5 rounded-xl bg-muted/50 px-3 py-2 text-small leading-relaxed text-muted-foreground">
          Refuse always wins over allow.
        </div>
      </div>

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
          <div className="text-body text-foreground">No rules yet.</div>
          <div className="mx-auto mt-1 max-w-[380px] text-body leading-relaxed text-muted-foreground">
            Add one when you keep answering the same question.
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
                  {rule.effect === "deny" ? "Refuse" : "Allow"} when{" "}
                  {FIELD_WORDS.find(([f]) => f === rule.field)?.[1] ?? rule.field}{" "}
                  {OP_WORDS.find(([o]) => o === rule.op)?.[1] ?? rule.op}{" "}
                  <span className="font-mono text-small">{rule.value}</span>
                </div>
                <div className="mt-0.5 text-small text-muted-foreground">
                  {rule.botId ? `Only ${nameOf(rule.botId)}` : "Every agent"}
                  {rule.enabled ? "" : " · off"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  aria-label={`${rule.summary}: on or off`}
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
                  aria-label="Remove rule"
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
              {choice === "deny" ? "Refuse" : "Allow"}
            </button>
          ))}
        </div>
        <span className="text-body text-muted-foreground">when</span>
        <select value={field} onChange={(e) => setField(e.target.value as Field)} className={select}>
          {FIELD_WORDS.map(([f, words]) => (
            <option key={f} value={f}>
              {words}
            </option>
          ))}
        </select>
        <select value={op} onChange={(e) => setOp(e.target.value as Op)} className={select}>
          {OP_WORDS.map(([o, words]) => (
            <option key={o} value={o}>
              {words}
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
        <span className="text-body text-muted-foreground">for</span>
        <select value={botId} onChange={(e) => setBotId(e.target.value)} className={select}>
          <option value="">every agent</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              only {bot.name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="mt-2 text-small text-destructive">{error}</div>}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={busy || !value.trim()} onClick={save}>
          Add rule
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
