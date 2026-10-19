// Interface answers: the library, the parse, and the tree the phone
// draws. What arrives is OpenUI Lang a model wrote, so the interesting
// cases are the ones that must not get through, or must not break.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createParser } from "@openuidev/lang-core";
import {
  GENUI_FOR_KIND,
  GENUI_NAMES,
  GENUI_ROOT,
  GENUI_SHAPES,
  genuiShapes,
  openUiFences,
} from "../server/genui-library.ts";
import {
  extractUi,
  genuiPrompt,
  MAX_FENCES,
  MAX_NODES,
  MAX_STRING,
  withheldShapes,
  withoutDashes,
  withoutUi,
  type UiNode,
} from "../server/genui.ts";
import { splitBlocks } from "../src/lib/markdownTable.ts";
import { withoutInterface } from "../src/lib/preview.ts";

const fence = (code: string) => "```openui\n" + code + "\n```";
const parser = createParser(genuiShapes.toJSONSchema(), GENUI_ROOT);

describe("the library", () => {
  test("is closed and modest: every name once, and Card at the root", () => {
    assert.equal(new Set(GENUI_NAMES).size, GENUI_NAMES.length);
    assert.equal(genuiShapes.root, "Card");
    // the families a person sees, not counting the rows inside them
    const families = GENUI_SHAPES.filter((s) => !/Item$|^Col$|^Series$|^OptionCard$|^FormControl$/.test(s.name));
    assert.ok(families.length >= 20 && families.length <= 34, `${families.length} families`);
  });

  test("uses OpenUI's own chat names, so a model that knows OpenUI writes what we draw", () => {
    for (const name of ["Card", "TextContent", "Callout", "Table", "Col", "BarChart", "LineChart", "PieChart", "Series",
      "Steps", "StepsItem", "TagBlock", "Tag", "Accordion", "Tabs", "Image", "Separator", "CodeBlock", "ListBlock",
      "ListItem", "Buttons", "Button", "FollowUpBlock", "FollowUpItem", "Form", "FormControl", "Input", "TextArea",
      "Select", "SelectItem", "RadioGroup", "CheckBoxGroup", "Slider", "DatePicker"]) {
      assert.ok(GENUI_NAMES.includes(name), name);
    }
  });

  test("never takes a reserved name", () => {
    for (const name of ["Query", "Mutation", "Action"]) assert.ok(!GENUI_NAMES.includes(name));
  });

  test("required props come before optional ones, as positional arguments need", () => {
    const schema = genuiShapes.toJSONSchema() as { $defs: Record<string, { properties?: object; required?: string[] }> };
    for (const name of GENUI_NAMES) {
      const def = schema.$defs[name];
      const keys = Object.keys(def.properties ?? {});
      const required = new Set(def.required ?? []);
      const firstOptional = keys.findIndex((k) => !required.has(k));
      if (firstOptional === -1) continue;
      assert.ok(keys.slice(firstOptional).every((k) => !required.has(k) || k === "fields"), `${name}: ${keys.join(", ")}`);
    }
  });

  test("an Input cannot be a password field: a chat keeps everything", () => {
    const schema = genuiShapes.toJSONSchema() as any;
    const types = schema.$defs.Input.properties.type;
    assert.ok(!JSON.stringify(types).includes("password"));
  });

  test("every gallery switch names shapes that exist", () => {
    for (const names of Object.values(GENUI_FOR_KIND)) for (const n of names) assert.ok(GENUI_NAMES.includes(n), n);
  });
});

describe("parsing what an agent wrote", () => {
  test("a whole answer parses to a Card with its parts, in order", () => {
    const result = parser.parse([
      "root = Card([h, m])",
      'h = CardHeader("Q3")',
      'm = MetricIndicator("Revenue", "$48.2k", "+8%", "up")',
    ].join("\n"));
    assert.equal(result.root?.typeName, "Card");
    assert.deepEqual((result.root?.props.children as any[]).map((c) => c.typeName), ["CardHeader", "MetricIndicator"]);
    assert.equal(result.meta.errors.length, 0);
  });

  test("a shape outside the library is dropped and named, and the rest still renders", () => {
    const result = parser.parse('root = Card([TextContent("hi"), Dashboard("x")])');
    assert.deepEqual((result.root?.props.children as any[]).map((c) => c.typeName), ["TextContent"]);
    assert.ok(result.meta.errors.some((e) => e.code === "unknown-component"));
  });

  test("a value of the wrong kind is caught against the schema", () => {
    const result = parser.parse('root = Card([Callout("purple", "T", "D")])');
    assert.ok(result.meta.errors.some((e) => e.code === "type-mismatch" || e.code === "missing-required"));
  });

  test("half a reply still parses: the statement in flight is closed, not lost", () => {
    const result = parser.parse('root = Card([t])\nt = TextContent("Half a sen');
    assert.equal(result.root?.typeName, "Card");
  });
});

describe("the tree kept for the phone", () => {
  const answer = [
    "Intro.",
    "",
    fence([
      "root = Card([h, t, b, f])",
      '$tab = "a"',
      'h = CardHeader("Hi")',
      't = Table([Col("A", ["x", "y"]), Col("B", [1, 2])])',
      'b = Buttons([Button("Go", @ToAssistant("go", {id: 4})), Button("Web", @OpenUrl("https://example.com")), Button("Bad", @OpenUrl("javascript:alert(1)")), Button("Set", Action([@Set($tab, "b"), @Reset($tab)])), Button("Plain")])',
      'f = Form("f", Buttons([Button("Send")]), [FormControl("Name", Input("name", "you", "text", {required: true}, $name))])',
      'q = Query("tickets", {}, {rows: []})',
    ].join("\n")),
    "",
    "After.",
  ].join("\n");
  const [entry] = extractUi(answer)!;
  const children = (entry.tree.props.children as UiNode[]);
  const buttons = (children[2].props.buttons as UiNode[]).map((b) => b.props);

  test("is plain JSON: type and props, nothing of the parser's own", () => {
    assert.equal(entry.fence, 0);
    assert.equal(entry.tree.type, "Card");
    assert.deepEqual(children.map((c) => c.type), ["CardHeader", "Table", "Buttons", "Form"]);
    assert.ok(!JSON.stringify(entry).includes('"element"'));
    assert.ok(!JSON.stringify(entry).includes("statementId"));
  });

  test("actions are written the way OpenUI's fixtures write them", () => {
    assert.deepEqual(buttons[0].action, { actions: [{ action: "ToAssistant", args: ["go", { id: 4 }] }] });
    assert.deepEqual(buttons[1].action, { actions: [{ action: "OpenUrl", args: ["https://example.com/"] }] });
    assert.deepEqual(buttons[3].action, { actions: [{ action: "Set", args: ["$tab", "b"] }, { action: "Reset", args: ["$tab"] }] });
  });

  test("a link that is not http or https is kept out, and the button does nothing rather than its default", () => {
    // no action means "send the label"; an empty list means nothing at all
    assert.deepEqual(buttons[2].action, { actions: [] });
    assert.equal(buttons[4].action, undefined);
  });

  test("bindings and state are kept, Query is not", () => {
    const input = ((children[3].props.fields as UiNode[])[0].props.input as UiNode).props;
    assert.deepEqual(input.value, { $binding: "$name" });
    assert.deepEqual(entry.state, { $tab: "a", $name: null });
    assert.ok(!JSON.stringify(entry).includes("tickets"));
  });

  test("a reply with no openui fence keeps no tree", () => {
    assert.equal(extractUi("Just words.\n\n```ts\nconst x = 1;\n```"), undefined);
  });

  test("a fence that parses to nothing is left out, and the next one keeps its own index", () => {
    const ui = extractUi([fence("this is not openui at all"), fence('root = Card([TextContent("two")])')].join("\n\n"))!;
    assert.equal(ui.length, 1);
    assert.equal(ui[0].fence, 1);
  });

  test("limits hold: fences, nodes, strings", () => {
    const many = Array.from({ length: MAX_FENCES + 3 }, (_, i) => fence(`root = Card([TextContent("${i}")])`)).join("\n\n");
    assert.equal(extractUi(many)!.length, MAX_FENCES);

    const items = Array.from({ length: MAX_NODES + 50 }, (_, i) => `TextContent("${i}")`).join(", ");
    const big = extractUi(fence(`root = Card([${items}])`))!;
    assert.equal(big[0].truncated, true);
    assert.ok(JSON.stringify(big[0]).length < 64_000);

    const long = extractUi(fence(`root = Card([TextContent("${"y".repeat(MAX_STRING + 500)}")])`))!;
    assert.equal(((long[0].tree.props.children as UiNode[])[0].props.text as string).length, MAX_STRING);
    assert.equal(long[0].truncated, true);
  });

  test("junk does not throw", () => {
    for (const junk of ["root = ", "root = Card(", "))))", "root = Card([[[[[[[[", '"\\u', "root = Card([" + "@".repeat(500) + "])"]) {
      assert.doesNotThrow(() => extractUi(fence(junk)), junk);
    }
  });
});

describe("finding fences", () => {
  test("agrees with how the chat splits a reply, so a fence's index means the same on both", () => {
    const text = [
      "Words.",
      "```ts",
      "```openui inside code is code",
      "```",
      fence("root = Card([])"),
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "~~~openui-lang",
      'root = Card([TextContent("tilde")])',
      "~~~",
      "```openui",
      "root = Card([unfinished",
    ].join("\n");
    const ours = openUiFences(text).map((f) => f.code);
    const chat = splitBlocks(text)
      .filter((b): b is Extract<typeof b, { kind: "code" }> => b.kind === "code" && /^openui(-lang)?$/i.test(b.lang))
      .map((b) => b.code);
    assert.deepEqual(ours, chat);
    assert.equal(ours.length, 3);
    assert.equal(openUiFences(text)[2].closed, false);
  });
});

describe("what the agent is told", () => {
  test("the prompt teaches the library, with no em or en dashes", () => {
    const prompt = genuiPrompt([])!;
    assert.match(prompt, /```openui/);
    assert.match(prompt, /Never wrap a simple reply in interface/);
    assert.match(prompt, /OptionCards\(items: OptionCard\[\]/);
    assert.doesNotMatch(prompt, /[\u2014\u2013]/);
    assert.doesNotMatch(prompt, /## Query|## Mutation|@Run\(/);
  });

  test("switched off, nothing is taught", () => {
    assert.equal(genuiPrompt(["openui"]), null);
  });

  test("withheld shapes go with their notes and examples", () => {
    const prompt = genuiPrompt(["table", "decision"])!;
    assert.doesNotMatch(prompt, /Table\(|Col\(|OptionCards|OptionCard\(/);
    assert.match(prompt, /BarChart\(/);
    assert.deepEqual(withheldShapes(["table", "nonsense"]).sort(), ["Col", "Table"]);
  });

  test("the dash scrub turns the generator's separators into colons", () => {
    assert.equal(withoutDashes("Card(x) \u2014 The answer"), "Card(x): The answer");
  });
});

describe("where interface cannot be drawn", () => {
  test("a Telegram reply keeps the words around the interface", () => {
    assert.equal(withoutUi("Porto is cheaper.\n\n" + fence("root = Card([])") + "\n\nWant listings?"), "Porto is cheaper.\n\nWant listings?");
  });

  test("an answer that was all interface says where it is", () => {
    assert.equal(withoutUi(fence("root = Card([])")), "The answer is interactive. Open Bloks to see it.");
  });

  test("other code is left alone", () => {
    const text = "Run this:\n\n```sh\nls\n```";
    assert.equal(withoutUi(text), text);
  });

  test("the conversation list line skips the interface too", () => {
    assert.equal(withoutInterface("Hi\n" + fence("root = Card([])") + "\nBye").replace(/\s+/g, " "), "Hi Bye");
  });
});
