// The interface an agent can answer with, as a closed library.
//
// "Nobody wants walls of text for every single prompt." The gallery in
// ./components.ts made six shapes possible; this goes the rest of the
// way. An agent writes OpenUI Lang (https://openui.com) in a fenced
// block, and the chat draws it as it streams: cards, tables, charts,
// metrics, steps, tabs, forms and buttons, in the Bloks design system.
//
// This file is only the shapes. Three things read it, which is why it
// has no React in it and nothing from Node either:
//
//   the server, to write the prompt from it and to check what an agent
//   wrote before storing it on the message (./genui.ts);
//
//   the app, which pairs each shape with a renderer
//   (src/lib/genui/schema.ts and src/components/genui/);
//
//   the iPhone app, by way of the tree the server stores, whose contract
//   is written down in docs/GENERATIVE_UI.md.
//
// It lives under server/ rather than src/ because the server is compiled
// on its own into a folder of its own (tsconfig.server.build.json), and
// a server import reaching into src/ would move every compiled file. The
// app can read from here without any of that.
//
// Four decisions, the same spirit as the gallery's.
//
//   Closed. The names follow OpenUI's own chat library wherever the shape
//   is the same, so a model that has seen OpenUI writes what we draw, but
//   nothing outside this list renders. An open set is a design system
//   nobody maintains.
//
//   Positional, like the language. The order of a component's props is
//   the order of its arguments, so a prop is only ever added at the end
//   and never removed or reordered: a stored answer has to keep meaning
//   what it meant (OpenUI spec/prompt.md, section 3.2).
//
//   Nothing fetches. There is no Query or Mutation here, and no tool is
//   handed to the interface. What it shows is what the agent wrote.
//
//   No passwords. An Input has no password type: a chat is not where a
//   secret should be typed, and the transcript keeps everything.
import { z } from "zod/v4";
import {
  action,
  createLibrary,
  defineComponent,
  markReactive,
  tagSchemaId,
  type ComponentGroup,
  type DefinedComponent,
} from "@openuidev/lang-core";

/** The library's root, the container every answer starts from. */
export const GENUI_ROOT = "Card";

/** A prop a `$variable` can bind to, both ways. */
function reactive<T extends object>(schema: T): T {
  markReactive(schema);
  return schema;
}

/** One shape. The renderer is attached later, by whoever draws it. */
function shape<T extends z.ZodObject>(name: string, description: string, props: T): DefinedComponent<T, null> {
  return defineComponent({ name, description, props, component: null });
}

const actionProp = () => action().optional();

/** Any one of these shapes, for a slot that holds several kinds. */
function oneOf(parts: readonly unknown[]) {
  return z.union(parts as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

// Validation for a form field, the same keys OpenUI's own library uses,
// so the renderer can show what is missing before anything is sent.
// Named, so the prompt says `Rules` once in a note instead of spelling
// out all nine keys on every field.
const ruleShape = z.object({
  required: z.boolean().optional(),
  email: z.boolean().optional(),
  url: z.boolean().optional(),
  numeric: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
});
tagSchemaId(ruleShape, "Rules");
const rules = ruleShape.optional();

// ── words ──────────────────────────────────────────────────────────────

const CardHeader = shape(
  "CardHeader",
  "A title for the answer, with an optional line under it. Once, first.",
  z.object({ title: z.string().optional(), subtitle: z.string().optional() }),
);

const TextContent = shape(
  "TextContent",
  "Markdown text: a sentence or a short paragraph, bold, links, a short list. Keep it brief.",
  z.object({
    text: z.string(),
    size: z.enum(["small", "default", "large", "small-heavy", "large-heavy"]).optional(),
  }),
);

const Callout = shape(
  "Callout",
  "A note set apart: info for context, warning for a caveat, error for what failed or was refused, success for what is done.",
  z.object({
    variant: z.enum(["info", "warning", "error", "success", "neutral"]),
    title: z.string(),
    description: z.string(),
  }),
);

const Separator = shape("Separator", "A quiet line between two parts of the answer.", z.object({}));

const Image = shape(
  "Image",
  "An image from a real address you were given or found. Never invent one.",
  z.object({ alt: z.string(), src: z.string().optional() }),
);

const CodeBlock = shape(
  "CodeBlock",
  "Code, kept exactly, with a copy button.",
  z.object({ language: z.string(), codeString: z.string() }),
);

const Quote = shape(
  "Quote",
  "A passage worth reading exactly, with who said it and where.",
  z.object({ text: z.string(), from: z.string().optional(), where: z.string().optional() }),
);

const Tag = shape(
  "Tag",
  "A small label.",
  z.object({
    text: z.string(),
    variant: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
  }),
);

const TagBlock = shape("TagBlock", "A row of small labels.", z.object({ tags: z.array(z.string()) }));

// ── numbers ────────────────────────────────────────────────────────────

const MetricIndicator = shape(
  "MetricIndicator",
  'One headline number: label, value, change, e.g. MetricIndicator("Revenue", "$48.2k", "+8% on May", "up"). tone says whether the change is good (an up in costs is "negative"). Several in a row sit side by side.',
  z.object({
    label: z.string(),
    value: z.string(),
    change: z.string().optional(),
    trend: z.enum(["up", "down", "flat"]).optional(),
    tone: z.enum(["positive", "negative", "neutral"]).optional(),
  }),
);

const Col = shape(
  "Col",
  "One column of a Table: its heading and its values, in row order.",
  z.object({
    label: z.string(),
    data: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    type: z.enum(["string", "number"]).optional(),
  }),
);

const Table = shape(
  "Table",
  "Rows and columns, written column by column. A cell can hold a markdown link.",
  z.object({ columns: z.array(Col.ref) }),
);

const Series = shape(
  "Series",
  "One named line or set of bars: a value for every label.",
  z.object({ category: z.string(), values: z.array(z.number()) }),
);

const BarChart = shape(
  "BarChart",
  "Bars, for comparing amounts across a handful of categories.",
  z.object({
    labels: z.array(z.string()),
    series: z.array(Series.ref),
    variant: z.enum(["grouped", "stacked"]).optional(),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
);

const LineChart = shape(
  "LineChart",
  "Lines, for a trend over time.",
  z.object({
    labels: z.array(z.string()),
    series: z.array(Series.ref),
    variant: z.enum(["linear", "natural", "step"]).optional(),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
);

const PieChart = shape(
  "PieChart",
  "Shares of a whole, two to six slices.",
  z.object({
    labels: z.array(z.string()),
    values: z.array(z.number()),
    variant: z.enum(["pie", "donut"]).optional(),
  }),
);

// ── sequences and lists ────────────────────────────────────────────────

const StepsItem = shape(
  "StepsItem",
  "One step: what it is, a line of detail, and where it stands.",
  z.object({
    title: z.string(),
    details: z.string().optional(),
    state: z.enum(["done", "doing", "todo", "failed"]).optional(),
  }),
);

const Steps = shape(
  "Steps",
  "What you did or are about to do, in order.",
  z.object({ items: z.array(StepsItem.ref) }),
);

const ListItem = shape(
  "ListItem",
  "One row of a ListBlock. With an action it can be clicked: @OpenUrl for a link, @ToAssistant to ask about it.",
  z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    image: z.object({ src: z.string(), alt: z.string() }).optional(),
    actionLabel: z.string().optional(),
    action: actionProp(),
  }),
);

const ListBlock = shape(
  "ListBlock",
  'Rows of things: places, files, people, results. variant "number" for a ranking.',
  z.object({ items: z.array(ListItem.ref), variant: z.enum(["plain", "number"]).optional() }),
);

const OptionCard = shape(
  "OptionCard",
  "One choice in OptionCards. recommended marks your pick.",
  z.object({
    value: z.string(),
    title: z.string(),
    subtitle: z.string().optional(),
    recommended: z.boolean().optional(),
  }),
);

const OptionCards = shape(
  "OptionCards",
  "A decision for the person: two to five choices, at most one recommended. Picking one sends it back to you as their answer.",
  z.object({
    items: z.array(OptionCard.ref),
    title: z.string().optional(),
    note: z.string().optional(),
  }),
);

const Sources = shape(
  "Sources",
  "Where the answer came from, last. Cite them in TextContent as [1], [2].",
  z.object({
    items: z.array(z.object({ title: z.string(), url: z.string(), sourceName: z.string().optional() })),
  }),
);

// ── buttons ────────────────────────────────────────────────────────────

const Button = shape(
  "Button",
  "A button. Without an action it sends its label back to you as the person's next message.",
  z.object({
    label: z.string(),
    action: actionProp(),
    variant: z.enum(["primary", "secondary", "tertiary"]).optional(),
  }),
);

const Buttons = shape(
  "Buttons",
  "A row of buttons, or a column.",
  z.object({ buttons: z.array(Button.ref), direction: z.enum(["row", "column"]).optional() }),
);

const FollowUpItem = shape("FollowUpItem", "One suggested next question, in the person's words.", z.object({ text: z.string() }));

const FollowUpBlock = shape(
  "FollowUpBlock",
  "Two to four suggested next questions, last. Clicking one asks it.",
  z.object({ items: z.array(FollowUpItem.ref) }),
);

// ── forms ──────────────────────────────────────────────────────────────

const Input = shape(
  "Input",
  "A one line field.",
  z.object({
    name: z.string(),
    placeholder: z.string().optional(),
    type: z.enum(["text", "email", "number", "url"]).optional(),
    rules,
    value: reactive(z.string().optional()),
  }),
);

const TextArea = shape(
  "TextArea",
  "A field for a few lines.",
  z.object({
    name: z.string(),
    placeholder: z.string().optional(),
    rows: z.number().optional(),
    rules,
    value: reactive(z.string().optional()),
  }),
);

const SelectItem = shape("SelectItem", "One option of a Select.", z.object({ value: z.string(), label: z.string() }));

const Select = shape(
  "Select",
  "A dropdown, for one of many.",
  z.object({
    name: z.string(),
    items: z.array(SelectItem.ref),
    placeholder: z.string().optional(),
    rules,
    value: reactive(z.string().optional()),
  }),
);

const RadioItem = shape(
  "RadioItem",
  "One option of a RadioGroup.",
  z.object({ label: z.string(), description: z.string(), value: z.string() }),
);

const RadioGroup = shape(
  "RadioGroup",
  "One of a few, all visible.",
  z.object({
    name: z.string(),
    items: z.array(RadioItem.ref),
    defaultValue: z.string().optional(),
    rules,
    value: reactive(z.string().optional()),
  }),
);

const CheckBoxItem = shape(
  "CheckBoxItem",
  "One box of a CheckBoxGroup.",
  z.object({
    label: z.string(),
    description: z.string(),
    name: z.string(),
    defaultChecked: z.boolean().optional(),
  }),
);

const CheckBoxGroup = shape(
  "CheckBoxGroup",
  "Any of a few.",
  z.object({
    name: z.string(),
    items: z.array(CheckBoxItem.ref),
    rules,
    value: reactive(z.record(z.string(), z.boolean()).optional()),
  }),
);

const Slider = shape(
  "Slider",
  "An amount between two ends.",
  z.object({
    name: z.string(),
    variant: z.enum(["continuous", "discrete"]),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    defaultValue: z.array(z.number()).optional(),
    label: z.string().optional(),
    rules,
    value: reactive(z.array(z.number()).optional()),
  }),
);

const DatePicker = shape(
  "DatePicker",
  "A date, or a range of two.",
  z.object({
    name: z.string(),
    mode: z.enum(["single", "range"]).optional(),
    rules,
    value: reactive(z.unknown().optional()),
  }),
);

const FormControl = shape(
  "FormControl",
  "A labelled field inside a Form.",
  z.object({
    label: z.string(),
    input: oneOf([Input.ref, TextArea.ref, Select.ref, RadioGroup.ref, CheckBoxGroup.ref, Slider.ref, DatePicker.ref]),
    hint: z.string().optional(),
  }),
);

const Form = shape(
  "Form",
  "Questions for the person to fill in. What they enter comes back to you in their next message.",
  z.object({ name: z.string(), buttons: Buttons.ref, fields: z.array(FormControl.ref).default([]) }),
);

// ── containers ─────────────────────────────────────────────────────────

// What a container may hold. Kept as a list rather than built from the
// shapes above so a new shape has to be placed somewhere on purpose.
const content = [
  TextContent,
  Callout,
  Separator,
  Image,
  CodeBlock,
  Quote,
  TagBlock,
  MetricIndicator,
  Table,
  BarChart,
  LineChart,
  PieChart,
  Steps,
  ListBlock,
  OptionCards,
  Buttons,
  Button,
  FollowUpBlock,
  Form,
  Sources,
].map((part) => part.ref);

const AccordionItem = shape(
  "AccordionItem",
  "One section of an Accordion: an id, its heading, and what it holds.",
  z.object({ value: z.string(), trigger: z.string(), content: z.array(oneOf(content)) }),
);

const Accordion = shape(
  "Accordion",
  "Sections that open on a click, for detail most people will not need.",
  z.object({ items: z.array(AccordionItem.ref) }),
);

const TabItem = shape(
  "TabItem",
  "One tab: an id, its label, and what it holds.",
  z.object({
    value: z.string(),
    trigger: z.string(),
    content: z.array(oneOf([...content, Accordion.ref])),
  }),
);

const Tabs = shape(
  "Tabs",
  "Alternative views of the same thing, side by side: one tab each.",
  z.object({ items: z.array(TabItem.ref) }),
);

const Card = shape(
  "Card",
  "The answer. Everything goes in it, top to bottom.",
  z.object({
    children: z.array(oneOf([CardHeader.ref, ...content, Accordion.ref, Tabs.ref])),
  }),
);

/** Every shape, in the order the prompt lists them. */
export const GENUI_SHAPES = [
  Card,
  CardHeader,
  TextContent,
  Callout,
  Separator,
  Image,
  CodeBlock,
  Quote,
  TagBlock,
  Tag,
  MetricIndicator,
  Table,
  Col,
  BarChart,
  LineChart,
  PieChart,
  Series,
  Steps,
  StepsItem,
  ListBlock,
  ListItem,
  OptionCards,
  OptionCard,
  Sources,
  Tabs,
  TabItem,
  Accordion,
  AccordionItem,
  Buttons,
  Button,
  FollowUpBlock,
  FollowUpItem,
  Form,
  FormControl,
  Input,
  TextArea,
  Select,
  SelectItem,
  RadioGroup,
  RadioItem,
  CheckBoxGroup,
  CheckBoxItem,
  Slider,
  DatePicker,
] as const;

export type GenUiShapeName = (typeof GENUI_SHAPES)[number]["name"];

export const GENUI_NAMES: string[] = GENUI_SHAPES.map((part) => part.name);

/** The prompt's sections, with what each needs saying that a signature
 * cannot. */
export const GENUI_GROUPS: ComponentGroup[] = [
  {
    name: "The answer",
    components: ["Card", "CardHeader", "TextContent", "Callout", "Separator", "Quote", "Image", "CodeBlock", "TagBlock", "Tag"],
    notes: [
      "- Card is always the root. Its children stack top to bottom.",
      "- TextContent takes markdown. Keep each one short; split long prose into parts with structure.",
    ],
  },
  {
    name: "Numbers",
    components: ["MetricIndicator", "Table", "Col", "BarChart", "LineChart", "PieChart", "Series"],
    notes: [
      '- A Table is column by column: Table([Col("City", ["Lisbon", "Porto"]), Col("Rent", ["€1,450", "€980"])]).',
      "- Keep cells to short values and put longer notes after the table.",
      '- Charts take labels and one Series per line or set of bars: BarChart(["Q1", "Q2"], [Series("Sales", [12, 19])]).',
      "- Write the real numbers. Never invent data you do not have.",
    ],
  },
  {
    name: "Steps, lists and choices",
    components: ["Steps", "StepsItem", "ListBlock", "ListItem", "OptionCards", "OptionCard", "Sources"],
    notes: [
      '- ListItem("Title", "subtitle", null, "Open", @OpenUrl("https://example.com")) is a row with a link.',
      "- OptionCards is for a decision the person makes; a click sends the choice to you.",
    ],
  },
  {
    name: "Layout",
    components: ["Tabs", "TabItem", "Accordion", "AccordionItem"],
    notes: ["- Use Tabs only for real alternatives, and Accordion only for detail that can stay closed."],
  },
  {
    name: "Buttons and follow-ups",
    components: ["Buttons", "Button", "FollowUpBlock", "FollowUpItem"],
    notes: [
      "- A FollowUpBlock goes last, with two to four questions the person is likely to ask next, written as they would say them.",
    ],
  },
  {
    name: "Forms",
    components: [
      "Form",
      "FormControl",
      "Input",
      "TextArea",
      "Select",
      "SelectItem",
      "RadioGroup",
      "RadioItem",
      "CheckBoxGroup",
      "CheckBoxItem",
      "Slider",
      "DatePicker",
    ],
    notes: [
      "- Form(name, buttons, fields), with one FormControl reference per field.",
      '- Give the Form a submit button: Buttons([Button("Send", @ToAssistant("Here are my answers"), "primary")]). Its fields come with the message.',
      "- Rules is an optional object with any of required, email, url, numeric (booleans) and min, max, minLength, maxLength (numbers), pattern (a regex string), like { required: true, email: true }. The form shows what is missing by itself.",
      "- Never ask for a password, a card number or any other secret in a form.",
    ],
  },
];

/**
 * Which shapes each of the old gallery's switches covers. Withholding
 * "chart" from an agent withholds charts in either form, so the
 * switches a person has already set keep meaning what they said.
 */
export const GENUI_FOR_KIND: Record<string, GenUiShapeName[]> = {
  chart: ["BarChart", "LineChart", "PieChart", "Series"],
  table: ["Table", "Col"],
  decision: ["OptionCards", "OptionCard"],
  steps: ["Steps", "StepsItem"],
  quote: ["Quote"],
  refused: [],
};

/** The library itself: shapes, no renderers. The server reads this one. */
export const genuiShapes = createLibrary<null>({
  root: GENUI_ROOT,
  componentGroups: GENUI_GROUPS,
  components: [...GENUI_SHAPES],
});

// ── fences ─────────────────────────────────────────────────────────────

/** The fence languages that mean OpenUI. `openui-lang` is what OpenUI's
 * own prompt teaches, so a model that learned it there is understood. */
export function isOpenUiLang(lang: string): boolean {
  const name = lang.trim().toLowerCase();
  return name === "openui" || name === "openui-lang";
}

const FENCE_OPEN = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;

/**
 * The OpenUI fences in a message, in order.
 *
 * Read exactly the way the chat reads code fences (splitBlocks in
 * src/lib/markdownTable.ts): any fence is consumed whole, whatever its
 * language, and one still open at the end runs to the end. The two have
 * to agree, because the index of a fence here is how the phone matches a
 * stored tree to the place in the text the desktop draws it.
 */
export function openUiFences(text: string): Array<{ code: string; closed: boolean }> {
  const lines = text.split("\n");
  const found: Array<{ code: string; closed: boolean }> = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE_OPEN);
    if (!open) continue;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && lines[j].trim() !== open[1]; j++) body.push(lines[j]);
    if (isOpenUiLang(open[2])) found.push({ code: body.join("\n"), closed: j < lines.length });
    i = j;
  }
  return found;
}
