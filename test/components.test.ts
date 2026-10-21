// Answers that are not paragraphs, and what stops one breaking a chat.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  KINDS,
  MAX_BARS,
  MAX_CELL,
  MAX_CELL_RAW,
  MAX_COLUMNS,
  MAX_DETAIL,
  MAX_LABEL,
  MAX_OPTIONS,
  MAX_REASON,
  MAX_ROWS,
  MAX_STEPS,
  MAX_TEXT,
  galleryPrompt,
  mayRender,
  parseComponent,
} from "../server/components.ts";

const ok = <T extends { ok: boolean }>(parsed: T) => {
  assert.equal(parsed.ok, true, "ok" in parsed && !parsed.ok ? (parsed as never as { error: string }).error : "");
  return parsed as Extract<T, { ok: true }>;
};

/** The refusal's words, failing the test if it was not one. */
const refused = (parsed: ReturnType<typeof parseComponent>): string => {
  assert.equal(parsed.ok, false, "it was shown");
  return parsed.ok ? "" : parsed.error;
};

describe("the gallery is closed", () => {
  test("a kind nobody shipped is refused, and the refusal lists the ones there are", () => {
    // the caller is a model: "invalid" sends it round to make the same
    // mistake, and naming the options does not
    const parsed = parseComponent("dashboard", {});
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && parsed.error.includes("chart"));
  });

  test("six shapes, and they are the ones the catalog describes", () => {
    assert.equal(KINDS.length, 6);
  });
});

describe("a chart", () => {
  test("bars with labels and numbers", () => {
    const parsed = ok(parseComponent("chart", { title: "Q4", bars: [{ label: "North", value: 12 }] }));
    assert.equal(parsed.component.kind, "chart");
    assert.deepEqual(parsed.component.kind === "chart" && parsed.component.bars, [{ label: "North", value: 12 }]);
  });

  test("a bar with no number, or no label, is refused by name rather than dropped", () => {
    const error = refused(
      parseComponent("chart", {
        bars: [{ label: "Good", value: 3 }, { label: "Bad", value: "lots" }, { label: "", value: 9 }, { label: "None" }],
      }),
    );
    assert.match(error, /bars\[1\]\.value is not a number/);
    assert.match(error, /bars\[2\] needs a label/);
    assert.match(error, /bars\[3\]\.value is not a number/);
    assert.match(error, /Each bar needs a label and a number/);
    // a shape that is wrong is not a limit, and is not said to be one
    assert.doesNotMatch(error, /cut|limit/);
  });

  test("a number written as text, and a year as a label, are what they say", () => {
    const parsed = ok(parseComponent("chart", { bars: [{ label: 2024, value: "12" }] }));
    assert.deepEqual(parsed.component.kind === "chart" && parsed.component.bars, [{ label: "2024", value: 12 }]);
  });

  test("negative and zero are real numbers and stay", () => {
    const parsed = ok(parseComponent("chart", { bars: [{ label: "Down", value: -4 }, { label: "Flat", value: 0 }] }));
    assert.equal(parsed.component.kind === "chart" && parsed.component.bars.length, 2);
  });

  test("no usable bars at all is refused, and says what it needs", () => {
    const parsed = parseComponent("chart", { title: "Empty" });
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok && /label and a number/.test(parsed.error));
  });

  test("more bars than anybody can read are refused, not cut", () => {
    const many = Array.from({ length: MAX_BARS + 20 }, (_, i) => ({ label: `b${i}`, value: i }));
    assert.match(refused(parseComponent("chart", { bars: many })), new RegExp(`bars has ${MAX_BARS + 20}, over its limit of ${MAX_BARS}`));
    const all = ok(parseComponent("chart", { bars: many.slice(0, MAX_BARS) }));
    assert.equal(all.component.kind === "chart" && all.component.bars.length, MAX_BARS);
  });

  test("infinity is not a number a bar can be", () => {
    const parsed = parseComponent("chart", { bars: [{ label: "Huge", value: Infinity }] });
    assert.equal(parsed.ok, false);
  });
});

describe("a table", () => {
  test("columns and rows", () => {
    const parsed = ok(
      parseComponent("table", { columns: ["Region", "Margin"], rows: [["North", "42%"], ["South", "18%"]] }),
    );
    assert.equal(parsed.component.kind === "table" && parsed.component.rows.length, 2);
  });

  test("a short row is padded rather than refused", () => {
    // a missing cell is a gap in the answer, not a reason to send the
    // whole thing back
    const parsed = ok(parseComponent("table", { columns: ["A", "B", "C"], rows: [["one"]] }));
    assert.deepEqual(parsed.component.kind === "table" && parsed.component.rows[0], ["one", "", ""]);
  });

  test("a row with more cells than columns is refused, not cut to fit", () => {
    const error = refused(parseComponent("table", { columns: ["A"], rows: [["one", "two", "three"]] }));
    assert.match(error, /rows\[0\] has 3 cells for 1 column/);
  });

  test("empty cells past the last column are nothing lost, and go", () => {
    const parsed = ok(parseComponent("table", { columns: ["A", "B"], rows: [["one", "two", "", null]] }));
    assert.deepEqual(parsed.component.kind === "table" && parsed.component.rows[0], ["one", "two"]);
  });

  test("an empty heading keeps its place, so no cell moves under the wrong one", () => {
    const parsed = ok(parseComponent("table", { columns: ["", "Price"], rows: [["QC45", "$96"]] }));
    assert.deepEqual(parsed.component.kind === "table" && parsed.component.columns, ["", "Price"]);
    assert.deepEqual(parsed.component.kind === "table" && parsed.component.rows[0], ["QC45", "$96"]);
  });

  test("no columns, or no rows, is refused with what is missing", () => {
    assert.ok(!parseComponent("table", { rows: [["x"]] }).ok);
    const noRows = parseComponent("table", { columns: ["A"] });
    assert.ok(!noRows.ok && /rows/.test(noRows.error));
  });

  test("more than fits is refused both ways, and says how many fit", () => {
    const error = refused(
      parseComponent("table", {
        columns: Array.from({ length: MAX_COLUMNS + 5 }, (_, i) => `c${i}`),
        rows: Array.from({ length: MAX_ROWS + 20 }, () => ["x"]),
      }),
    );
    assert.match(error, new RegExp(`columns has ${MAX_COLUMNS + 5}, over its limit of ${MAX_COLUMNS}`));
    assert.match(error, new RegExp(`rows has ${MAX_ROWS + 20}, over its limit of ${MAX_ROWS}`));
    assert.match(error, /split the rows across more than one table/);
  });

  test("a cell that is not text is refused rather than drawn as nothing", () => {
    const error = refused(parseComponent("table", { columns: ["A"], rows: [[{ nested: true }]] }));
    assert.match(error, /rows\[0\]\[0\] is not text/);
  });

  test("a number or a yes in a cell is shown as written", () => {
    const parsed = ok(parseComponent("table", { columns: ["Count", "Done"], rows: [[42, true]] }));
    assert.deepEqual(parsed.component.kind === "table" && parsed.component.rows[0], ["42", "true"]);
  });

  test("a row that is not a list is refused rather than dropped", () => {
    assert.match(refused(parseComponent("table", { columns: ["A"], rows: [["fine"], "a row of words"] })), /rows\[1\] is not a list of cells/);
  });
});

describe("a table cell", () => {
  const cellOf = (value: unknown) => {
    const parsed = ok(parseComponent("table", { columns: ["A"], rows: [[value]] }));
    return parsed.component.kind === "table" ? parsed.component.rows[0][0] : "";
  };

  test("a link is kept whole", () => {
    assert.equal(cellOf("[Bright loft](https://example.com/loft)"), "[Bright loft](https://example.com/loft)");
  });

  test("a long address does not count against the cell", () => {
    // the reader sees the label, so the label is what is limited
    const href = `https://example.com/${"p".repeat(1_000)}`;
    const value = `${"a".repeat(MAX_CELL - 10)} [listing](${href})`;
    assert.equal(cellOf(value), value);
  });

  const refusalOf = (value: unknown) => refused(parseComponent("table", { columns: ["A"], rows: [[value]] }));

  test("text past the limit is refused, links or not, and named by its place", () => {
    const value = `[a](https://example.com) ${"x".repeat(MAX_CELL * 2)}`;
    const error = refusalOf(value);
    assert.match(error, new RegExp(`rows\\[0\\]\\[0\\] has ${2 + MAX_CELL * 2} characters as shown, over its limit of ${MAX_CELL}`));
    assert.match(error, /nothing in it was cut/);
  });

  test("a cell exactly at the limit is shown whole, link and all", () => {
    const value = `${"a".repeat(MAX_CELL - 12)}[longer label](https://example.com)`;
    assert.equal(cellOf(value), value);
    assert.match(refusalOf(`a${value}`), new RegExp(`has ${MAX_CELL + 1} characters as shown`));
  });

  test("an address that is not http counts as the text it shows", () => {
    const value = `[x](javascript:${"y".repeat(MAX_CELL)})`;
    assert.match(refusalOf(value), new RegExp(`has ${value.length} characters as shown`));
  });

  test("however many links, the raw cell is still bounded", () => {
    const value = `[a](https://example.com/${"z".repeat(500)}) `.repeat(20);
    assert.match(refusalOf(value), new RegExp(`has ${value.trim().length} characters with its link addresses, over its limit of ${MAX_CELL_RAW}`));
  });
});

describe("a decision", () => {
  test("a question and its options", () => {
    const parsed = ok(
      parseComponent("decision", {
        question: "Which host?",
        because: "cheapest that meets the need",
        options: [{ label: "A", detail: "cheap" }, { label: "B", pick: true }],
      }),
    );
    assert.equal(parsed.component.kind === "decision" && parsed.component.options[1].pick, true);
  });

  test("one recommendation at most", () => {
    // two picks is not a recommendation, it is the question again
    const parsed = ok(
      parseComponent("decision", {
        question: "Which?",
        options: [{ label: "A", pick: true }, { label: "B", pick: true }, { label: "C", pick: true }],
      }),
    );
    const picks = parsed.component.kind === "decision" ? parsed.component.options.filter((o) => o.pick) : [];
    assert.equal(picks.length, 1);
    assert.equal(picks[0].label, "A");
  });

  test("recommending nothing is allowed", () => {
    const parsed = ok(parseComponent("decision", { question: "Which?", options: [{ label: "A" }, { label: "B" }] }));
    assert.equal(parsed.component.kind === "decision" && parsed.component.options.some((o) => o.pick), false);
  });

  test("one option is not a decision", () => {
    const parsed = parseComponent("decision", { question: "Which?", options: [{ label: "Only" }] });
    assert.ok(!parsed.ok && /at least two/.test(parsed.error));
  });

  test("no question is not a decision", () => {
    assert.ok(!parseComponent("decision", { options: [{ label: "A" }, { label: "B" }] }).ok);
  });
});

describe("steps", () => {
  test("each with a state", () => {
    const parsed = ok(
      parseComponent("steps", {
        title: "Deploy",
        steps: [{ label: "Build", state: "done" }, { label: "Ship", state: "doing" }],
      }),
    );
    assert.equal(parsed.component.kind === "steps" && parsed.component.steps[1].state, "doing");
  });

  test("a state nobody defined becomes todo rather than breaking the row", () => {
    const parsed = ok(parseComponent("steps", { steps: [{ label: "Something", state: "vibing" }] }));
    assert.equal(parsed.component.kind === "steps" && parsed.component.steps[0].state, "todo");
  });

  test("a step with no label is not a step", () => {
    const parsed = parseComponent("steps", { steps: [{ state: "done" }] });
    assert.ok(!parsed.ok && /label/.test(parsed.error));
  });
});

describe("a quote and a refusal", () => {
  test("a quote keeps its attribution", () => {
    const parsed = ok(parseComponent("quote", { text: "It shipped on Friday.", from: "the changelog" }));
    assert.equal(parsed.component.kind === "quote" && parsed.component.from, "the changelog");
  });

  test("a quote with nothing in it is refused", () => {
    assert.ok(!parseComponent("quote", { from: "somewhere" }).ok);
  });

  test("a refusal says what could not be done", () => {
    const parsed = ok(parseComponent("refused", { what: "send the invoice", because: "a rule refuses it" }));
    assert.equal(parsed.component.kind === "refused" && parsed.component.what, "send the invoice");
  });

  test("a refusal with no what is not one", () => {
    assert.ok(!parseComponent("refused", { because: "reasons" }).ok);
  });
});

describe("nothing an agent writes reaches a screen unchecked", () => {
  test("junk in place of the whole payload is refused rather than rendered", () => {
    for (const junk of [null, "a string", 42, [], true]) {
      assert.equal(parseComponent("chart", junk).ok, false, JSON.stringify(junk));
    }
  });

  test("junk in place of a list is treated as no list", () => {
    assert.equal(parseComponent("table", { columns: "A,B", rows: "x" }).ok, false);
  });

  test("a very long label is refused rather than rendered whole, or cut", () => {
    assert.match(refused(parseComponent("chart", { bars: [{ label: "x".repeat(5_000), value: 1 }] })), /bars\[0\]\.label has 5000 characters, over its limit of 120/);
  });

  test("a very long quote is refused, not cut", () => {
    assert.match(refused(parseComponent("quote", { text: "y".repeat(9_000) })), /text has 9000 characters, over its limit of 2000/);
  });
});

// GitHub 319: text past a limit used to be cut while the agent was told
// it had been shown. Now each field either goes whole or is refused by
// name, with the limit, so the agent can shorten it or split it.
describe("nothing is cut", () => {
  test("the table cell from the report: the last word is never lost in silence", () => {
    const passage = "a".repeat(MAX_CELL) + "Z";
    const error = refused(parseComponent("table", { columns: ["Passage"], rows: [[passage]] }));
    assert.match(error, new RegExp(`^table not shown, and nothing in it was cut: rows\\[0\\]\\[0\\] has ${MAX_CELL + 1} characters as shown, over its limit of ${MAX_CELL}\\.`));
    assert.match(error, /put longer text after the table/);
    const whole = ok(parseComponent("table", { columns: ["Passage"], rows: [["a".repeat(MAX_CELL - 1) + "Z"]] }));
    assert.ok(whole.component.kind === "table" && whole.component.rows[0][0].endsWith("Z"));
  });

  test("the quote from the report: refused at one past its limit, whole at it", () => {
    const error = refused(parseComponent("quote", { text: "a".repeat(MAX_TEXT) + "Z" }));
    assert.match(error, new RegExp(`^quote not shown, and nothing in it was cut: text has ${MAX_TEXT + 1} characters, over its limit of ${MAX_TEXT}\\.`));
    assert.match(error, /split the passage across more than one quote/);
    const whole = ok(parseComponent("quote", { text: "a".repeat(MAX_TEXT - 1) + "Z" }));
    assert.ok(whole.component.kind === "quote" && whole.component.text.endsWith("Z"));
  });

  // Every text field of every kind that has a limit, with a payload that
  // is otherwise fine, and where in the parsed component that field lands.
  const at = (n: number) => "a".repeat(n - 1) + "Z";
  const fields: Array<{ kind: string; field: string; max: number; data: (v: string) => unknown; read: (c: any) => string | undefined }> = [
    { kind: "chart", field: "title", max: MAX_LABEL, data: (v) => ({ title: v, bars: [{ label: "A", value: 1 }] }), read: (c) => c.title },
    { kind: "chart", field: "note", max: MAX_DETAIL, data: (v) => ({ note: v, bars: [{ label: "A", value: 1 }] }), read: (c) => c.note },
    { kind: "chart", field: "bars[1].label", max: MAX_LABEL, data: (v) => ({ bars: [{ label: "A", value: 1 }, { label: v, value: 2 }] }), read: (c) => c.bars[1].label },
    { kind: "table", field: "title", max: MAX_LABEL, data: (v) => ({ title: v, columns: ["A"], rows: [["x"]] }), read: (c) => c.title },
    { kind: "table", field: "note", max: MAX_DETAIL, data: (v) => ({ note: v, columns: ["A"], rows: [["x"]] }), read: (c) => c.note },
    { kind: "table", field: "columns[1]", max: MAX_LABEL, data: (v) => ({ columns: ["A", v], rows: [["x", "y"]] }), read: (c) => c.columns[1] },
    { kind: "table", field: "rows[1][0]", max: MAX_CELL, data: (v) => ({ columns: ["A"], rows: [["x"], [v]] }), read: (c) => c.rows[1][0] },
    { kind: "decision", field: "question", max: MAX_DETAIL, data: (v) => ({ question: v, options: [{ label: "A" }, { label: "B" }] }), read: (c) => c.question },
    { kind: "decision", field: "because", max: MAX_REASON, data: (v) => ({ question: "Which?", because: v, options: [{ label: "A" }, { label: "B" }] }), read: (c) => c.because },
    { kind: "decision", field: "options[1].label", max: MAX_LABEL, data: (v) => ({ question: "Which?", options: [{ label: "A" }, { label: v }] }), read: (c) => c.options[1].label },
    { kind: "decision", field: "options[0].detail", max: MAX_DETAIL, data: (v) => ({ question: "Which?", options: [{ label: "A", detail: v }, { label: "B" }] }), read: (c) => c.options[0].detail },
    { kind: "steps", field: "title", max: MAX_LABEL, data: (v) => ({ title: v, steps: [{ label: "A" }] }), read: (c) => c.title },
    { kind: "steps", field: "steps[0].label", max: MAX_LABEL, data: (v) => ({ steps: [{ label: v, state: "done" }] }), read: (c) => c.steps[0].label },
    { kind: "steps", field: "steps[1].detail", max: MAX_DETAIL, data: (v) => ({ steps: [{ label: "A" }, { label: "B", detail: v }] }), read: (c) => c.steps[1].detail },
    { kind: "quote", field: "text", max: MAX_TEXT, data: (v) => ({ text: v }), read: (c) => c.text },
    { kind: "quote", field: "from", max: MAX_LABEL, data: (v) => ({ text: "x", from: v }), read: (c) => c.from },
    { kind: "quote", field: "where", max: MAX_DETAIL, data: (v) => ({ text: "x", where: v }), read: (c) => c.where },
    { kind: "refused", field: "what", max: MAX_DETAIL, data: (v) => ({ what: v }), read: (c) => c.what },
    { kind: "refused", field: "because", max: MAX_REASON, data: (v) => ({ what: "x", because: v }), read: (c) => c.because },
  ];

  test("every kind is in the list below, so none is left to cut in silence", () => {
    assert.deepEqual([...new Set(fields.map((f) => f.kind))].sort(), [...KINDS].sort());
  });

  for (const { kind, field, max, data, read } of fields) {
    test(`${kind} ${field}: whole at ${max}, refused by name at ${max + 1}`, () => {
      const whole = ok(parseComponent(kind, data(at(max))));
      assert.equal(read(whole.component), at(max), "the text that fit was changed");
      const error = refused(parseComponent(kind, data(at(max + 1))));
      const named = field.replace(/[[\].]/g, (c) => `\\${c}`);
      assert.match(error, new RegExp(`^${kind} not shown, and nothing in it was cut: ${named} has ${max + 1} characters(?: as shown)?, over its limit of ${max}\\.`));
      assert.match(error, /and show it again\.$/);
    });
  }

  // and every list that has a count
  const counts: Array<{ kind: string; list: string; max: number; data: (n: number) => unknown }> = [
    { kind: "chart", list: "bars", max: MAX_BARS, data: (n) => ({ bars: Array.from({ length: n }, (_, i) => ({ label: `b${i}`, value: i })) }) },
    { kind: "table", list: "columns", max: MAX_COLUMNS, data: (n) => ({ columns: Array.from({ length: n }, (_, i) => `c${i}`), rows: [["x"]] }) },
    { kind: "table", list: "rows", max: MAX_ROWS, data: (n) => ({ columns: ["A"], rows: Array.from({ length: n }, (_, i) => [`r${i}`]) }) },
    { kind: "decision", list: "options", max: MAX_OPTIONS, data: (n) => ({ question: "Which?", options: Array.from({ length: n }, (_, i) => ({ label: `o${i}` })) }) },
    { kind: "steps", list: "steps", max: MAX_STEPS, data: (n) => ({ steps: Array.from({ length: n }, (_, i) => ({ label: `s${i}` })) }) },
  ];

  for (const { kind, list, max, data } of counts) {
    test(`${kind} ${list}: all ${max} shown, ${max + 1} refused by name`, () => {
      ok(parseComponent(kind, data(max)));
      const error = refused(parseComponent(kind, data(max + 1)));
      assert.match(error, new RegExp(`^${kind} not shown, and nothing in it was cut: ${list} has ${max + 1}, over its limit of ${max}\\.`));
    });
  }

  test("one refusal names every field to fix, not just the first", () => {
    const long = "x".repeat(MAX_CELL + 1);
    const error = refused(parseComponent("table", { title: "t".repeat(MAX_LABEL + 1), columns: ["A", "B"], rows: [[long, "ok"], ["ok", long]] }));
    assert.match(error, new RegExp(`title has ${MAX_LABEL + 1} characters`));
    assert.match(error, /rows\[0\]\[0\] has 301 characters as shown/);
    assert.match(error, /rows\[1\]\[1\] has 301 characters as shown/);
  });

  test("a table with every cell too long names ten and counts the rest", () => {
    const long = "x".repeat(MAX_CELL + 1);
    const error = refused(parseComponent("table", { columns: ["A"], rows: Array.from({ length: 25 }, () => [long]) }));
    assert.match(error, /rows\[9\]\[0\] has 301/);
    assert.doesNotMatch(error, /rows\[10\]\[0\]/);
    assert.match(error, /; and 15 more\./);
    assert.ok(error.length < 1_500, "the refusal is longer than the table it refused");
  });

  test("a field over its limit and one of the wrong shape are both said, each with what to do", () => {
    const error = refused(parseComponent("chart", { title: "t".repeat(MAX_LABEL + 1), bars: [{ label: "A", value: "lots" }] }));
    assert.match(error, /title has 121 characters, over its limit of 120; bars\[0\]\.value is not a number\./);
    assert.match(error, /split the bars across more than one chart, and show it again\. Each bar needs a label and a number/);
  });
});

describe("which agent may use which", () => {
  test("everything, until something is withheld", () => {
    assert.equal(mayRender("chart", undefined), true);
    assert.equal(mayRender("chart", []), true);
  });

  test("withholding one leaves the rest", () => {
    assert.equal(mayRender("decision", ["decision"]), false);
    assert.equal(mayRender("chart", ["decision"]), true);
  });
});

describe("what the agent is told", () => {
  test("the line lists what it may use, and how", () => {
    const prompt = galleryPrompt([], "run `bloks show <kind> <json>`")!;
    assert.match(prompt, /chart, for comparing a handful of numbers/);
    assert.match(prompt, /bloks show/);
    assert.match(prompt, /Do not repeat the component's own contents in prose/);
  });

  test("it says the limits, and that text over one is refused rather than cut", () => {
    const prompt = galleryPrompt([], "how")!;
    assert.match(prompt, new RegExp(`${MAX_LABEL} characters for a title or a label, ${MAX_CELL} for a table cell as shown, ${MAX_TEXT} for a quote`));
    assert.match(prompt, /Text over a limit is refused, never cut, and the refusal names the field/);
  });

  test("what is withheld is not offered", () => {
    const prompt = galleryPrompt(["decision", "chart"], "how")!;
    assert.doesNotMatch(prompt, /- chart,/);
    assert.doesNotMatch(prompt, /- decision,/);
    assert.match(prompt, /- table,/);
  });

  test("an agent allowed none of them is told nothing at all", () => {
    assert.equal(galleryPrompt([...KINDS], "how"), null);
  });
});
