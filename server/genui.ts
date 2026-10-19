// Answers drawn as interface: the prompt that teaches it, and the tree
// that is kept of it.
//
// The shapes are in ./genui-library.ts. Here are the two things the
// server does with them.
//
//   It writes the part of an agent's briefing that teaches OpenUI Lang,
//   with lang-core's own prompt generator, from the same library the
//   chat renders with. Signatures written by hand drift from the code
//   that reads them; generated ones cannot.
//
//   It reads what an agent wrote, when the reply is stored. Each openui
//   fence is parsed against the same schemas and kept on the message as
//   a plain tree (message.ui), so the iPhone app can draw it natively
//   without a parser of its own. The desktop draws from the text, as it
//   streams; the tree is the same answer, settled. The contract is in
//   docs/GENERATIVE_UI.md.
//
// What arrives is text a model wrote, so nothing here trusts it: every
// limit below is a cap on what one reply can make the server keep.
import {
  createParser,
  createStore,
  evaluateRoot,
  generateSystemPrompt,
  isReactiveAssign,
  type ElementNode,
  type Library,
} from "@openuidev/lang-core";
import {
  GENUI_FOR_KIND,
  GENUI_ROOT,
  genuiShapes,
  openUiFences,
  type GenUiShapeName,
} from "./genui-library.ts";

// lang-core can report usage to its makers, opt in, when a variable
// says so. Bloks never asks it to, and a variable left in someone's
// shell for another project must not decide it here. Set before the
// first parse or prompt, which is when it is read.
process.env.OPENUI_TELEMETRY_DISABLED = "1";

/** The name an agent's settings use to switch interface answers off. It
 * sits in the same `withoutComponents` list as the gallery's kinds. */
export const GENUI_SWITCH = "openui";

// ── the prompt ─────────────────────────────────────────────────────────

const PREAMBLE = [
  "## Answering with interface",
  "",
  "Your answers can be real interface instead of paragraphs: cards, tables, charts, metrics, steps, tabs, forms and buttons. Write it in openui-lang inside a fenced block that opens with ```openui and closes with ```. The chat draws it as you write.",
  "",
  "Use it when the answer has structure: numbers, a comparison, options to choose from, steps, results, a status, details to fill in. Then say at most a sentence or two of prose, put the substance in the block, and do not repeat in prose what the interface already shows.",
  "",
  "Do not use it for a conversational reply, a quick answer, a question back or an acknowledgement. Those are plain text. Never wrap a simple reply in interface.",
  "",
  "One block per answer is usually right, and a small one: a few parts that carry the answer, not a dashboard.",
].join("\n");

const RULES = [
  "Only @ToAssistant, @OpenUrl, @Set and @Reset exist here. There is no Query, Mutation or @Run, and nothing fetches: what shows is what you write.",
  "@ToAssistant(\"...\") sends those words back to you as the person's next message, so write them the way the person would say them.",
  "@OpenUrl takes a full https:// address, and opens it in the browser.",
  "Keep a block under about 40 statements. If it would be longer, the answer is too big for one block.",
];

const EXAMPLES = [
  `Example: a comparison, with a recommendation and follow-ups.

\`\`\`openui
root = Card([head, rents, pick, next])
head = CardHeader("Lisbon or Porto", "One bedroom, city centre, this month")
rents = Table([Col("", ["Rent", "Commute", "Listings"]), Col("Lisbon", ["€1,450", "25 min", "312"]), Col("Porto", ["€980", "15 min", "141"])])
pick = OptionCards([a, b], "Where should I look first?")
a = OptionCard("porto", "Porto", "€470 less a month, shorter commute", true)
b = OptionCard("lisbon", "Lisbon", "More to choose from")
next = FollowUpBlock([FollowUpItem("Show me listings in Porto"), FollowUpItem("What about Braga?")])
\`\`\``,
  `Example: numbers at a glance.

\`\`\`openui
root = Card([revenue, churn, trend])
revenue = MetricIndicator("Revenue", "$48.2k", "+8% on Q2", "up")
churn = MetricIndicator("Churn", "1.8%", "-0.3 pts", "down", "positive")
trend = LineChart(["Jul", "Aug", "Sep"], [Series("Revenue", [14.1, 15.9, 18.2])], null, null, "$k")
\`\`\``,
  `Example: asking for details.

\`\`\`openui
root = Card([intro, form])
intro = TextContent("A few details and I will book it.")
form = Form("booking", Buttons([Button("Book it", @ToAssistant("Book it with these details"), "primary")]), [when, size])
when = FormControl("Date", DatePicker("date", "single", { required: true }))
size = FormControl("People", Select("people", [SelectItem("2", "Two"), SelectItem("4", "Four")], "How many?", { required: true }))
\`\`\``,
];

/** No em or en dashes in what the agent is told. The generator's own
 * text uses them, and a prompt full of them is a style the agent copies. */
export function withoutDashes(text: string): string {
  return text.replace(/[ \t]*\u2014[ \t]*/g, ": ").replace(/[ \t]+\u2013[ \t]+/g, ": ");
}

/** What an agent with these switches off is not shown. */
export function withheldShapes(without: string[] | undefined): GenUiShapeName[] {
  return [...new Set((without ?? []).flatMap((kind) => GENUI_FOR_KIND[kind] ?? []))];
}

const prompts = new Map<string, string>();

/**
 * The briefing that teaches interface answers, or null when this agent
 * has them switched off.
 *
 * The old gallery's switches still count: withholding charts from an
 * agent takes the chart shapes out of what it is taught, and the
 * examples that would show them, so the prompt never names a shape the
 * agent is not meant to use.
 */
export function genuiPrompt(without: string[] | undefined): string | null {
  if (without?.includes(GENUI_SWITCH)) return null;
  const removed = withheldShapes(without).sort();
  const key = removed.join(",");
  const kept = prompts.get(key);
  if (kept) return kept;
  const library: Library<null> = removed.length ? genuiShapes.extend({ components: { remove: removed } }) : genuiShapes;
  const mentions = (example: string) => removed.some((name) => new RegExp(`\\b${name}\\b`).test(example));
  const spec = library.toSpec();
  // A note about a shape that is gone goes with it, and so does a
  // section left with nothing in it.
  spec.componentGroups = spec.componentGroups
    ?.map((group) => ({ ...group, notes: group.notes?.filter((note) => !mentions(note)) }))
    .filter((group) => group.components.length > 0);
  const prompt = withoutDashes(
    generateSystemPrompt({
      library: spec,
      promptOptions: {
        preamble: PREAMBLE,
        // Local state only: $variables, @Set and @Reset. No tools, so no
        // Query, Mutation or @Run is ever taught.
        toolCalls: false,
        bindings: true,
        builtinFunctions: false,
        examples: EXAMPLES.filter((example) => !mentions(example)),
        additionalRules: RULES,
      },
    }),
  );
  prompts.set(key, prompt);
  return prompt;
}

// ── the tree ───────────────────────────────────────────────────────────

/** More fences than this in one reply are not kept as trees. */
export const MAX_FENCES = 6;
/** A fence longer than this is not parsed at all. */
export const MAX_SOURCE = 24_000;
/** Components in one tree; past it, the rest are left out. */
export const MAX_NODES = 300;
/** How deep a tree may nest. */
export const MAX_DEPTH = 12;
/** Items in any one list. */
export const MAX_ITEMS = 200;
/** Characters in any one string. */
export const MAX_STRING = 4_000;
/** A tree whose JSON is bigger than this is not kept. */
export const MAX_TREE_BYTES = 64_000;

/** A component in the stored tree. */
export interface UiNode {
  type: string;
  props: Record<string, UiValue>;
}
/** A prop's value: plain JSON, a component, a binding, or an action. */
export type UiValue =
  | string
  | number
  | boolean
  | null
  | UiValue[]
  | { [key: string]: UiValue }
  | UiNode
  | { $binding: string }
  | { actions: UiAction[] };
/** One step of an action, in the shape OpenUI's conformance fixtures use. */
export type UiAction =
  | { action: "ToAssistant"; args: [string] | [string, UiValue] }
  | { action: "OpenUrl"; args: [string] }
  | { action: "Set"; args: [string] | [string, UiValue]; dynamic?: true }
  | { action: "Reset"; args: string[] };

/** One fence of a message, settled. */
export interface UiEntry {
  /** Which openui fence in the message text, counting from 0. */
  fence: number;
  tree: UiNode;
  /** The `$variables` the fence declared, with their starting values. */
  state?: Record<string, UiValue>;
  /** Something was over a limit and was left out. */
  truncated?: true;
}

// Made on the first reply that has a fence, not when the server starts:
// most replies never need it.
let parser: ReturnType<typeof createParser> | null = null;

/** An address that may be opened: http or https, and nothing else. A
 * `javascript:` or `file:` link written by a model is the first thing a
 * prompt injection would try. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

// The parser's own node kinds (lang-core, parser/ast.ts).
const AST_KINDS = new Set([
  "Comp", "Str", "Num", "Bool", "Null", "Arr", "Obj", "Ref", "Ph", "StateRef",
  "RuntimeRef", "BinOp", "UnaryOp", "Ternary", "Member", "Index", "Assign",
]);

const isElement = (value: unknown): value is ElementNode =>
  typeof value === "object" && value !== null && (value as { type?: unknown }).type === "element" &&
  typeof (value as { typeName?: unknown }).typeName === "string";

const isPlan = (value: unknown): value is { steps: Array<Record<string, unknown>> } =>
  typeof value === "object" && value !== null && Array.isArray((value as { steps?: unknown }).steps);

/** A value of a literal, for a @Set: a click on the phone sets what was
 * written, and anything worked out from state is left to the desktop. */
function literal(node: unknown): { ok: true; value: UiValue } | { ok: false } {
  if (typeof node !== "object" || node === null) return { ok: false };
  const ast = node as { k?: string; v?: unknown };
  if (ast.k === "Str" || ast.k === "Num" || ast.k === "Bool") return { ok: true, value: ast.v as UiValue };
  if (ast.k === "Null") return { ok: true, value: null };
  return { ok: false };
}

/** The evaluated tree, as plain JSON, within the limits. */
function toTree(root: ElementNode): { tree: UiNode | null; truncated: boolean } {
  let nodes = 0;
  let truncated = false;
  const cut = () => {
    truncated = true;
    return null;
  };

  const actions = (plan: { steps: Array<Record<string, unknown>> }): UiValue => {
    const out: UiAction[] = [];
    for (const step of plan.steps.slice(0, 8)) {
      switch (step.type) {
        case "continue_conversation": {
          const message = String(step.message ?? "").slice(0, MAX_STRING);
          const context = step.context === undefined ? undefined : value(step.context, 1);
          out.push({ action: "ToAssistant", args: context === undefined ? [message] : [message, context] });
          break;
        }
        case "open_url": {
          const url = safeHttpUrl(step.url);
          if (url) out.push({ action: "OpenUrl", args: [url] });
          break;
        }
        case "set": {
          const target = String(step.target ?? "");
          if (!target.startsWith("$")) break;
          const fixed = literal(step.valueAST);
          out.push(fixed.ok ? { action: "Set", args: [target, fixed.value] } : { action: "Set", args: [target], dynamic: true });
          break;
        }
        case "reset": {
          const targets = (Array.isArray(step.targets) ? step.targets : []).map(String).filter((t) => t.startsWith("$"));
          if (targets.length) out.push({ action: "Reset", args: targets.slice(0, 20) });
          break;
        }
        // @Run and custom actions are not part of this library: a
        // button that would run one does nothing, here as on screen.
      }
    }
    return { actions: out };
  };

  function value(input: unknown, depth: number): UiValue {
    if (depth > MAX_DEPTH) return cut();
    if (input === null || input === undefined) return null;
    if (typeof input === "string") {
      if (input.length > MAX_STRING) truncated = true;
      return input.slice(0, MAX_STRING);
    }
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input === "boolean") return input;
    if (isReactiveAssign(input)) return { $binding: input.target };
    if (isElement(input)) return node(input, depth);
    if (isPlan(input)) return actions(input);
    if (Array.isArray(input)) {
      if (input.length > MAX_ITEMS) truncated = true;
      return input.slice(0, MAX_ITEMS).map((item) => value(item, depth + 1));
    }
    if (typeof input === "object") {
      // an AST node that never resolved (a reference to nothing, a query
      // that is not there) has no value to keep
      if (AST_KINDS.has((input as { k?: unknown }).k as string)) return null;
      const out: Record<string, UiValue> = {};
      for (const [key, item] of Object.entries(input as Record<string, unknown>).slice(0, 50)) {
        out[key] = value(item, depth + 1);
      }
      return out;
    }
    return null;
  }

  function node(element: ElementNode, depth: number): UiNode | null {
    if (++nodes > MAX_NODES) return cut();
    const props: Record<string, UiValue> = {};
    for (const [key, prop] of Object.entries(element.props)) {
      if (prop === undefined) continue;
      props[key] = value(prop, depth + 1);
    }
    return { type: element.typeName, props };
  }

  return { tree: node(root, 0), truncated };
}

/**
 * The settled trees of a reply's openui fences, or undefined when it has
 * none worth keeping.
 *
 * A fence that does not parse, or parses to nothing, is left out rather
 * than stored half made: the text still has it, and the desktop shows
 * what it can of it there.
 */
export function extractUi(text: string): UiEntry[] | undefined {
  const fences = openUiFences(text).slice(0, MAX_FENCES);
  const entries: UiEntry[] = [];
  fences.forEach(({ code }, fence) => {
    if (!code.trim() || code.length > MAX_SOURCE) return;
    try {
      parser ??= createParser(genuiShapes.toJSONSchema(), GENUI_ROOT);
      const result = parser.parse(code);
      const store = createStore();
      store.initialize(result.stateDeclarations ?? {}, {});
      const root = evaluateRoot(result, {
        ctx: {
          getState: (name) => store.get(name) ?? null,
          // Query and Mutation are not part of this library; anything
          // that reads one reads nothing.
          resolveRef: () => null,
        },
        library: genuiShapes,
        store,
        errors: [],
      });
      if (!root) return;
      const { tree, truncated } = toTree(root);
      if (!tree) return;
      const stateEntries = Object.entries(result.stateDeclarations ?? {}).slice(0, 50);
      const state: Record<string, UiValue> = {};
      for (const [name, start] of stateEntries) {
        state[name] = start === undefined ? null : (JSON.parse(JSON.stringify(start ?? null)) as UiValue);
      }
      const entry: UiEntry = {
        fence,
        tree,
        ...(stateEntries.length ? { state } : {}),
        ...(truncated ? { truncated: true as const } : {}),
      };
      if (JSON.stringify(entry).length > MAX_TREE_BYTES) return;
      entries.push(entry);
    } catch {
      // The parser promises not to throw on anything a model writes. If
      // it ever does, the reply is still stored, as text.
    }
  });
  return entries.length ? entries : undefined;
}

/**
 * A reply with its interface taken out, for somewhere that can only show
 * text: a Telegram message, the one line under a conversation's name.
 * Says so when the interface was the whole of it.
 */
export function withoutUi(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let had = false;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(```|~~~)\s*([\w+#.-]*)\s*$/);
    if (!open) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== open[1]) j++;
    const name = open[2].trim().toLowerCase();
    if (name === "openui" || name === "openui-lang") had = true;
    else out.push(...lines.slice(i, Math.min(j + 1, lines.length)));
    i = j;
  }
  // a reply with no interface in it goes exactly as it was written
  if (!had) return text.trim();
  const left = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return left || "The answer is interactive. Open Bloks to see it.";
}
