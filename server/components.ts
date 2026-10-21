// Answers that are not paragraphs.
//
// An agent asked for last quarter's numbers writes a markdown table, and
// the person reads a markdown table. That is the whole of the interface
// most of the time, and it is a waste of an app: we have a real window,
// real type, and a design system, and the answer arrives as monospace
// pipes because prose is the only shape the model has.
//
// So there is a small gallery, and an agent can answer with one of them
// instead. Four decisions.
//
//   The set is small and closed. Six shapes that cover what an answer
//   usually is: numbers, rows, a recommendation, a sequence, something
//   worth quoting, and something refused. An open set would mean an agent
//   inventing components, which is a design system nobody is maintaining.
//
//   A component renders what it was given and reads nothing. Letting one
//   fetch for itself would mean granting it the right to query, and a
//   permission model for the inside of a chat bubble. Here the thing
//   that rendered is the same thing that fetched, so the question never
//   arises: a much smaller surface, and the right trade for a workspace
//   rather than a dashboard.
//
//   Everything is validated here before it reaches a screen. What arrives
//   is JSON an agent wrote, which makes it the least trustworthy input in
//   the product. A component that renders whatever it is handed is one
//   malformed number away from a broken chat.
//
//   A refusal says what was wrong. The caller is a model: "invalid" sends
//   it round again with the same mistake, and naming the field does not.
//   And nothing is cut. A field over its limit, or an item past the
//   count, is refused by name rather than shortened or dropped: a cell
//   cut at its limit reads as whole while its last word is gone, and the
//   agent that sent it was told it worked (GitHub 319). The limits stay,
//   because they are what keeps a chat bubble a chat bubble.
/** The whole gallery. Closed on purpose. */
export type ComponentKind = "chart" | "table" | "decision" | "steps" | "quote" | "refused";

export const KINDS: ComponentKind[] = ["chart", "table", "decision", "steps", "quote", "refused"];

/** What each one is for, in the words the agent is told. */
export const CATALOG: Array<{ kind: ComponentKind; takes: string; when: string }> = [
  {
    kind: "chart",
    takes: `{"title": "…", "bars": [{"label": "…", "value": 12}], "note": "…"}`,
    when: "comparing a handful of numbers",
  },
  {
    kind: "table",
    takes: `{"title": "…", "columns": ["…"], "rows": [["…", "[Bright loft](https://…)"]], "note": "…"}`,
    when: "rows and columns, instead of pipes and dashes. A cell can hold a link. Keep cells to short values and put longer notes after the table",
  },
  {
    kind: "decision",
    takes: `{"question": "…", "options": [{"label": "…", "detail": "…", "pick": true}], "because": "…"}`,
    when: "recommending one of several things, and saying why",
  },
  {
    kind: "steps",
    takes: `{"title": "…", "steps": [{"label": "…", "state": "done|doing|todo|failed", "detail": "…"}]}`,
    when: "what you did, or what you are about to do, in order",
  },
  {
    kind: "quote",
    takes: `{"text": "…", "from": "…", "where": "…"}`,
    when: "a passage worth reading exactly, from something you found",
  },
  {
    kind: "refused",
    takes: `{"what": "…", "because": "…"}`,
    when: "you could not do something and want it to be visible rather than buried in a paragraph",
  },
];

export const MAX_ROWS = 40;
export const MAX_COLUMNS = 8;
export const MAX_BARS = 24;
export const MAX_STEPS = 24;
export const MAX_OPTIONS = 6;
/** A quote's passage. */
export const MAX_TEXT = 2_000;
/** A title, a heading, a bar's, an option's or a step's label, a quote's source. */
export const MAX_LABEL = 120;
/** A note, a detail, a question, where a quote is from, what was refused. */
export const MAX_DETAIL = 300;
/** Why: a decision's reason, a refusal's. */
export const MAX_REASON = 500;
/** A table cell, counted as the reader sees it: a link's label counts and
 * its address does not, so a long URL does not eat the cell. The raw cap
 * still bounds what reaches disk. */
export const MAX_CELL = 300;
export const MAX_CELL_RAW = 2_000;
/** How many fields one refusal names before it says how many more. */
const NAMED_PROBLEMS = 10;

export interface Bar {
  label: string;
  value: number;
}
export interface Option {
  label: string;
  detail?: string;
  pick?: boolean;
}
export interface Step {
  label: string;
  state: "done" | "doing" | "todo" | "failed";
  detail?: string;
}

export type Component =
  | { kind: "chart"; title?: string; note?: string; bars: Bar[] }
  | { kind: "table"; title?: string; note?: string; columns: string[]; rows: string[][] }
  | { kind: "decision"; question: string; because?: string; options: Option[] }
  | { kind: "steps"; title?: string; steps: Step[] }
  | { kind: "quote"; text: string; from?: string; where?: string }
  | { kind: "refused"; what: string; because?: string };

export type Parsed = { ok: true; component: Component } | { ok: false; error: string };

/** What a field says, as text: a string trimmed, a number or a yes or no
 * as written (a year is a fine label, a count a fine cell), nothing for
 * nothing, and null for anything else, which has no text to show and is
 * refused rather than drawn as a blank. */
function asText(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean") return String(value);
  return null;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** What one component got wrong, field by field. Collected rather than
 * returned at the first, so one refusal names every field to fix and the
 * agent does not find them one round trip at a time. */
class Problems {
  readonly found: string[] = [];
  /** Some field is past its limit, and the refusal says nothing was cut. */
  long = false;
  /** Some field has the wrong shape, and the refusal says the right one. */
  shape = false;

  /** A field of the wrong shape: not text, empty, not a number. */
  add(problem: string) {
    this.shape = true;
    this.found.push(problem);
  }

  /** A field or a list past its limit. */
  over(problem: string) {
    this.long = true;
    this.found.push(problem);
  }

  /** A text field, whole, with a problem noted when it runs past `max`
   * or is not text; `required` is what to say when it is empty. */
  text(name: string, value: unknown, max: number, required?: string): string {
    const said = asText(value);
    if (said === null) {
      this.add(`${name} is not text`);
      return "";
    }
    if (!said && required) this.add(required);
    if (said.length > max) this.over(`${name} has ${said.length} characters, over its limit of ${max}`);
    return said;
  }

  /** A list that has more in it than its component draws. */
  count(name: string, n: number, max: number) {
    if (n > max) this.over(`${name} has ${n}, over its limit of ${max}`);
  }

  /** The refusal, or null when nothing was wrong. */
  refusal(kind: ComponentKind): { ok: false; error: string } | null {
    if (!this.found.length) return null;
    const named = this.found.slice(0, NAMED_PROBLEMS).join("; ");
    const more = this.found.length > NAMED_PROBLEMS ? `; and ${this.found.length - NAMED_PROBLEMS} more` : "";
    const head = this.long ? `${kind} not shown, and nothing in it was cut` : `${kind} not shown`;
    const then = [this.long ? FIX[kind] : "", this.shape ? SHAPE[kind] : ""].filter(Boolean).join(" ");
    return { ok: false, error: `${head}: ${named}${more}. ${then}` };
  }
}

/** `[label](http...)`, the shape the chat draws as a link, with one level
 * of brackets allowed in the address, for the Wikipedia kind. Anything
 * else shows on screen as typed, so it counts as typed. */
const LINK = /\[([^[\]\n]+)\]\((https?:\/\/[^\s()[\]]*(?:\([^\s()[\]]*\)[^\s()[\]]*)*)\)/gi;

/** How long a cell reads on screen: a link counts its label, not its address. */
function shownLength(raw: string): number {
  let shown = 0;
  let at = 0;
  for (const m of raw.matchAll(LINK)) {
    shown += m.index - at + m[1].length;
    at = m.index + m[0].length;
  }
  return shown + raw.length - at;
}

/** A table cell, whole, or a problem named for it: past MAX_CELL as the
 * reader sees it, or past MAX_CELL_RAW with its link addresses. */
function cell(problems: Problems, name: string, value: unknown): string {
  const raw = asText(value);
  if (raw === null) {
    problems.add(`${name} is not text`);
    return "";
  }
  if (raw.length > MAX_CELL_RAW) {
    problems.over(`${name} has ${raw.length} characters with its link addresses, over its limit of ${MAX_CELL_RAW}`);
    return raw;
  }
  const shown = shownLength(raw);
  if (shown > MAX_CELL) problems.over(`${name} has ${shown} characters as shown, over its limit of ${MAX_CELL}`);
  return raw;
}

/** What to do about a field over its limit, said once after the fields
 * a refusal names. */
const FIX: Record<ComponentKind, string> = {
  chart: "Shorten what is named, or split the bars across more than one chart, and show it again.",
  table: "Shorten what is named and put longer text after the table, or split the rows across more than one table, and show it again.",
  decision: "Shorten what is named, or say the rest in a sentence alongside, and show it again.",
  steps: "Shorten what is named, or split the steps across more than one list, and show it again.",
  quote: "Quote the part that matters, or split the passage across more than one quote, and show it again.",
  refused: "Shorten what is named, or say the rest in a sentence alongside, and show it again.",
};

/** The shape each one takes, for a field that does not have it. */
const SHAPE: Record<ComponentKind, string> = {
  chart: "Each bar needs a label and a number: {label, value}.",
  table: "Each row is a list of cells, one for each column, and each cell is text.",
  decision: "Each option needs a label: {label, detail, pick}.",
  steps: "Each step needs a label: {label, state, detail}.",
  quote: "Each field is text: {text, from, where}.",
  refused: "Each field is text: {what, because}.",
};

/**
 * One component, checked into shape, or why it is not one.
 *
 * Every refusal names the field, because the caller is a model and a bare
 * "invalid" sends it round again to make the same mistake. What passes
 * is what was sent, trimmed and nothing else: a field is never shortened
 * and an item never dropped to make it fit.
 */
export function parseComponent(kind: string, data: unknown): Parsed {
  if (!KINDS.includes(kind as ComponentKind)) {
    return { ok: false, error: `there is no "${kind}". The ones there are: ${KINDS.join(", ")}` };
  }
  const raw = record(data) ?? {};
  const problems = new Problems();

  switch (kind as ComponentKind) {
    case "chart": {
      const entries = list(raw.bars);
      if (!entries.length) {
        return { ok: false, error: "chart needs bars, each with a label and a number: {label, value}" };
      }
      const title = problems.text("title", raw.title, MAX_LABEL);
      const note = problems.text("note", raw.note, MAX_DETAIL);
      problems.count("bars", entries.length, MAX_BARS);
      const bars = entries.map((entry, i) => {
        const bar = record(entry);
        if (!bar) {
          problems.add(`bars[${i}] is not a bar: {label, value}`);
          return { label: "", value: 0 };
        }
        const label = problems.text(`bars[${i}].label`, bar.label, MAX_LABEL, `bars[${i}] needs a label`);
        // a number, or a number written as text; nothing, an empty string
        // or a yes is not one, though Number() would read each as one
        const value = typeof bar.value === "number" ? bar.value : typeof bar.value === "string" && bar.value.trim() ? Number(bar.value) : NaN;
        if (!Number.isFinite(value)) problems.add(`bars[${i}].value is not a number`);
        return { label, value };
      });
      return problems.refusal("chart") ?? { ok: true, component: { kind: "chart", title, note, bars } };
    }

    case "table": {
      const heads = list(raw.columns);
      if (!heads.length) return { ok: false, error: "table needs columns, as a list of headings" };
      // an empty heading keeps its place: dropping it would move every
      // cell after it under the wrong heading
      const columns = heads.map((heading, i) => problems.text(`columns[${i}]`, heading, MAX_LABEL));
      if (!columns.some(Boolean) && !problems.found.length) return { ok: false, error: "table needs columns, as a list of headings" };
      problems.count("columns", heads.length, MAX_COLUMNS);
      const given = list(raw.rows);
      if (!given.length) return { ok: false, error: "table needs rows, each a list of cells" };
      const title = problems.text("title", raw.title, MAX_LABEL);
      const note = problems.text("note", raw.note, MAX_DETAIL);
      const rows: string[][] = [];
      given.forEach((row, r) => {
        if (!Array.isArray(row)) {
          // nothing in place of a row is no row; anything else had
          // something to say and nowhere to say it
          if (asText(row) !== "") problems.add(`rows[${r}] is not a list of cells`);
          return;
        }
        if (!row.length) return;
        const cells = row.map((value, c) => cell(problems, `rows[${r}][${c}]`, value));
        // empty cells past the last column are nothing lost; words are
        if (cells.slice(columns.length).some(Boolean)) {
          problems.add(`rows[${r}] has ${row.length} cells for ${columns.length} column${columns.length === 1 ? "" : "s"}`);
        }
        const kept = cells.slice(0, columns.length);
        // short rows are padded rather than refused: a missing cell is a
        // gap in the answer, not a reason to send the whole thing back
        rows.push([...kept, ...Array<string>(columns.length - kept.length).fill("")]);
      });
      if (!rows.length && !problems.found.length) return { ok: false, error: "table needs rows, each a list of cells" };
      problems.count("rows", rows.length, MAX_ROWS);
      return problems.refusal("table") ?? { ok: true, component: { kind: "table", title, note, columns, rows } };
    }

    case "decision": {
      const question = problems.text("question", raw.question, MAX_DETAIL);
      if (!question) return { ok: false, error: "decision needs a question: what is being decided" };
      const because = problems.text("because", raw.because, MAX_REASON);
      const entries = list(raw.options);
      const options: Option[] = [];
      entries.forEach((entry, i) => {
        const option = record(entry);
        if (!option) return void problems.add(`options[${i}] is not an option: {label, detail, pick}`);
        options.push({
          label: problems.text(`options[${i}].label`, option.label, MAX_LABEL, `options[${i}] needs a label`),
          detail: problems.text(`options[${i}].detail`, option.detail, MAX_DETAIL) || undefined,
          pick: option.pick === true,
        });
      });
      if (options.filter((option) => option.label).length < 2) {
        return { ok: false, error: "decision needs at least two options, each with a label" };
      }
      problems.count("options", entries.length, MAX_OPTIONS);
      // Exactly one recommendation, or none. Two picks is not a
      // recommendation, it is the question again.
      let seen = false;
      for (const option of options) {
        if (option.pick && seen) option.pick = false;
        if (option.pick) seen = true;
      }
      return problems.refusal("decision") ?? {
        ok: true,
        component: { kind: "decision", question, because: because || undefined, options },
      };
    }

    case "steps": {
      const entries = list(raw.steps);
      const title = problems.text("title", raw.title, MAX_LABEL);
      const steps: Step[] = [];
      entries.forEach((entry, i) => {
        const step = record(entry);
        if (!step) return void problems.add(`steps[${i}] is not a step: {label, state, detail}`);
        const state = String(step.state ?? "todo");
        steps.push({
          label: problems.text(`steps[${i}].label`, step.label, MAX_LABEL, `steps[${i}] needs a label`),
          state: (["done", "doing", "todo", "failed"].includes(state) ? state : "todo") as Step["state"],
          detail: problems.text(`steps[${i}].detail`, step.detail, MAX_DETAIL) || undefined,
        });
      });
      if (!steps.some((step) => step.label)) {
        return { ok: false, error: "steps needs steps, each with a label and a state of done, doing, todo or failed" };
      }
      problems.count("steps", entries.length, MAX_STEPS);
      return problems.refusal("steps") ?? { ok: true, component: { kind: "steps", title, steps } };
    }

    case "quote": {
      const body = problems.text("text", raw.text, MAX_TEXT);
      if (!body) return { ok: false, error: "quote needs text: the passage itself" };
      const from = problems.text("from", raw.from, MAX_LABEL);
      const where = problems.text("where", raw.where, MAX_DETAIL);
      return problems.refusal("quote") ?? {
        ok: true,
        component: { kind: "quote", text: body, from: from || undefined, where: where || undefined },
      };
    }

    case "refused": {
      const what = problems.text("what", raw.what, MAX_DETAIL);
      if (!what) return { ok: false, error: "refused needs what: the thing that could not be done" };
      const because = problems.text("because", raw.because, MAX_REASON);
      return problems.refusal("refused") ?? { ok: true, component: { kind: "refused", what, because: because || undefined } };
    }
  }
}

// ── which agent may use which ──────────────────────────────────────────

/**
 * May this agent render this.
 *
 * By exclusion rather than by grant: withholding one component from one
 * agent should not touch anybody else, and a list of everything
 * permitted goes stale the moment the gallery grows.
 *
 * There is no separate published state here. A component that exists in
 * this build is published by definition; a half finished one would not
 * have shipped.
 */
export function mayRender(kind: ComponentKind, without: string[] | undefined): boolean {
  return !(without ?? []).includes(kind);
}

/** The line an agent is told, listing what it may answer with. */
export function galleryPrompt(without: string[] | undefined, howToShow: string): string | null {
  const allowed = CATALOG.filter((entry) => mayRender(entry.kind, without));
  if (!allowed.length) return null;
  return [
    "Instead of describing something in prose, you can answer with one of these. Prefer them whenever the answer is really numbers, rows, a recommendation, a sequence or a passage: they render as proper interface in the chat rather than as markdown.",
    "",
    ...allowed.map((entry) => `- ${entry.kind}, for ${entry.when}\n  ${entry.takes}`),
    "",
    howToShow,
    `Each field has a limit: ${MAX_LABEL} characters for a title or a label, ${MAX_CELL} for a table cell as shown, ${MAX_TEXT} for a quote. Text over a limit is refused, never cut, and the refusal names the field.`,
    "Say a sentence alongside it if there is something to add. Do not repeat the component's own contents in prose.",
  ].join("\n");
}

/** Kept for the settings screen, which needs a name for each. */
export const KIND_LABEL: Record<ComponentKind, string> = {
  chart: "Charts",
  table: "Tables",
  decision: "Decisions",
  steps: "Step lists",
  quote: "Quotes",
  refused: "Refusals",
};

/**
 * Components an engine wrote into its own answer.
 *
 * The CLI is the route for engines that run a process. An API model has
 * no shell, so it needs a way to send a component that is just text, and
 * a fenced block is the one shape every model already emits reliably:
 *
 *     ```bloks
 *     { "kind": "chart", "bars": [...] }
 *     ```
 *
 * Anything that parses becomes a component; anything that does not is
 * left exactly where it was, because a malformed fence is more useful to
 * a reader as visible text than as a silent deletion.
 */
export function extractComponents(text: string): {
  components: Component[];
  text: string;
  /** Fences that looked like ours and did not parse, for the log. */
  rejected: number;
} {
  const components: Component[] = [];
  let rejected = 0;
  const fence = /^[ \t]*```[ \t]*bloks[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  const remaining = text.replace(fence, (whole, body: string) => {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      rejected++;
      return whole;
    }
    const kind = (data as { kind?: unknown })?.kind;
    if (typeof kind !== "string" || !KINDS.includes(kind as ComponentKind)) {
      rejected++;
      return whole;
    }
    const parsed = parseComponent(kind, data);
    if (!parsed.ok) {
      rejected++;
      return whole;
    }
    components.push(parsed.component);
    return "";
  });
  // Collapse the blank run a lifted fence leaves behind, so the sentence
  // above and the one below do not end up separated by a hole.
  return { components, text: remaining.replace(/\n{3,}/g, "\n\n").trim(), rejected };
}
