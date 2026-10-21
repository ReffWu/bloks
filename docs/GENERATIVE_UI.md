# Generative UI

Agents in Bloks can answer with interface instead of paragraphs: cards,
tables, charts, metrics, steps, tabs, forms and buttons. They write it in
[OpenUI Lang](https://openui.com) inside a fenced block, and the chat
draws it as the reply streams. This document is the contract for anyone
drawing those answers somewhere else, first of all the iPhone app.

## Where it lives

| Piece | File |
| --- | --- |
| The shapes (zod schemas, no React, no Node) | `server/genui-library.ts` |
| The prompt, and the tree kept on each message | `server/genui.ts` |
| The same shapes, read by the app | `src/lib/genui/schema.ts` |
| What a click does | `src/lib/genui/actions.ts` |
| The renderers | `src/components/genui/` |
| Where a fence is handed to them | `src/components/Markdown.tsx` |
| The reply rule that asks for it, last in the briefing | `server/house-style.ts` (`replyRules`) |

The reply rules close every briefing. Where the agent's answers can carry
interface, they add that a comparison, prices or numbers, or options to
choose between are answered in the chat with an openui block, not a file
and not a list in prose, even if earlier replies in the conversation did
it another way.

The prompt is generated with `@openuidev/lang-core` from the very library
the chat renders with, so the two cannot drift. Telemetry in lang-core is
opt in and Bloks never opts in: the server sets `OPENUI_TELEMETRY_DISABLED`
before the first parse, and the package's install script is switched off
in `pnpm-workspace.yaml`.

## In the text

A reply is stored as written. Interface sits in fences that open with
` ```openui ` (` ```openui-lang `, OpenUI's own tag, is read too) and the
prose around them is ordinary markdown:

````text
Porto is cheaper, and the commute is shorter.

```openui
root = Card([head, rents, next])
head = CardHeader("Lisbon or Porto")
rents = Table([Col("City", ["Lisbon", "Porto"]), Col("Rent", [1450, 980])])
next = FollowUpBlock([FollowUpItem("Show me Porto listings")])
```
````

A fence is found the way the chat finds any code fence: a line of three
backticks or three tildes with an optional language, closed by the same
marker on a line of its own, consumed whole whatever its language, and
running to the end of the text if never closed. Fences are counted from 0
in the order they appear, counting only openui ones.

## On the message: `message.ui`

When a bot reply is stored, each openui fence is parsed against the
library, evaluated once at its starting state, and kept as plain JSON:

```ts
message.ui?: Array<{
  fence: number;                     // which openui fence in message.text
  tree: Node;                        // always a Card at the root in practice
  state?: Record<string, Value>;     // the $variables it declared, at their start
  truncated?: true;                  // something was over a limit and left out
}>;
```

`ui` is absent when the reply has no fence that parsed. A fence that does
not parse, or parses to nothing, has no entry, and the next one keeps its
own index; a client draws what it has and may show the rest as text or
not at all. `ui` is written by the server from the reply's text, never
taken from a client, and is cleared when the message is taken back.

### Nodes and values

```ts
type Node = { type: string; props: Record<string, Value> };

type Value =
  | string | number | boolean | null
  | Value[]
  | { [key: string]: Value }          // plain data, like a Sources item
  | Node                              // has "type" and "props"
  | { $binding: string }              // two way: "$name", see State
  | { actions: Action[] };            // see Actions
```

A value with `type` and `props` is a node. Props a model left out are
absent; read every prop as optional and draw what is there.

### Actions

The shape OpenUI's conformance fixtures use:

```ts
type Action =
  | { action: "ToAssistant"; args: [message: string, context?: Value] }
  | { action: "OpenUrl"; args: [url: string] }          // always http or https
  | { action: "Set"; args: [variable: string, value?: Value]; dynamic?: true }
  | { action: "Reset"; args: string[] };                 // "$a", "$b", ...
```

- A `Button` with no `action` prop sends its label, as `ToAssistant` would.
  An `action` of `{ actions: [] }` does nothing: it is what is left when
  every step was refused, for example a `javascript:` link.
- `ToAssistant` sends a new message from the person to the same agent, in
  the same conversation. In a room it is addressed `@AgentName ` so the
  agent that drew it is the one that answers. Inside a `Form` the filled
  fields are written under the message, one `Label: value` line each, in
  the order the form shows them (see `saidBack` in
  `src/lib/genui/actions.ts`, which the phone should match). A `context`
  value goes last, as JSON.
- `OpenUrl` opens the address in the browser. Anything that is not http or
  https is dropped by the server and refused again by the desktop.
- `Set` with a value sets that variable. `dynamic: true` means the value
  was an expression the server did not keep; a client may ignore the step.
- `Reset` puts variables back to their values in `state`.
- There is no `Run`, `Query` or `Mutation`. Nothing in an answer fetches.

### State

`state` holds the `$variables` a fence declared, at their starting values.
A prop given as `{ "$binding": "$name" }` reads and writes that variable.
Everything else in the tree was worked out at the starting state, so an
expression such as `$tab == "a" ? x : y` arrives already chosen.

### Limits

At most 6 fences per reply, 24,000 characters per fence, 300 components,
12 levels deep, 200 items in a list, 4,000 characters in a string, and
64,000 bytes of JSON per entry (a larger one is dropped). Over a limit,
the rest is left out and the entry says `truncated: true`.

## On the iPhone

With the iPhone and Apple Watch update, the iPhone draws each fence
natively from `message.ui`, in its own type and colours, with no parser
of its own. The desktop draws from the text as it streams; the tree is the
same answer, settled. Where there is no tree to draw, the phone falls
back, and never to the source, which is for the agent and not the person:

- A fence with no tree yet, while the reply is still arriving, is a quiet
  "Drawing" in its place.
- A fence whose tree never came, because it did not parse or this build
  of the phone cannot read its entry, is drawn as its readable words, the
  strings in its source. One entry it cannot read costs that fence, not
  the reply.
- A component type the phone does not know is drawn as its readable
  words, so a newer Mac never blanks an older phone.
- An entry with `truncated: true` is drawn with a line saying part of the
  answer was too long to show.
- An `Image` is drawn only from inline `data:image` (png, jpeg, gif or
  webp). One at a web address is offered as a link that opens in Safari,
  never fetched.
- In a Markdown file opened on the phone, a fence is an example and is
  shown as written.

A click does what it does on the desktop (see Actions), and a form's
answer is written the way `saidBack` writes it.

## The components

Props are listed in positional order, which is also the order an agent
writes them in. `?` marks an optional prop. Kinds marked "inner" only
appear inside their parent.

### The answer

| Component | Props | Notes |
| --- | --- | --- |
| `Card` | `children: Node[]` | The root. Children stack top to bottom. Adjacent `MetricIndicator`s sit side by side. |
| `CardHeader` | `title?`, `subtitle?` | A title for the answer. |
| `TextContent` | `text`, `size?: small \| default \| large \| small-heavy \| large-heavy` | Markdown. |
| `Callout` | `variant: info \| warning \| error \| success \| neutral`, `title`, `description` | Description is inline markdown. |
| `Separator` | | A rule. |
| `Image` | `alt`, `src?` | Drawn only from the app's own addresses (`/api/...`) or inline `data:image`. Any other http(s) image is offered as a link, never fetched: fetching an address an agent wrote is a way to send what it read there. |
| `CodeBlock` | `language`, `codeString` | |
| `Quote` | `text`, `from?`, `where?` | |
| `TagBlock` | `tags: string[]` | |
| `Tag` | `text`, `variant?: neutral \| info \| success \| warning \| danger` | |

### Numbers

| Component | Props | Notes |
| --- | --- | --- |
| `MetricIndicator` | `label`, `value`, `change?`, `trend?: up \| down \| flat`, `tone?: positive \| negative \| neutral` | `tone` defaults from `trend` (up is positive). |
| `Table` | `columns: Col[]` | Column by column; rows are as long as the longest column. An empty first column label means the first column names the rows. |
| `Col` (inner) | `label`, `data: (string \| number \| boolean \| null)[]`, `type?: string \| number` | String cells are inline markdown. |
| `BarChart` | `labels: string[]`, `series: Series[]`, `variant?: grouped \| stacked`, `xLabel?`, `yLabel?` | |
| `LineChart` | `labels`, `series`, `variant?: linear \| natural \| step`, `xLabel?`, `yLabel?` | |
| `PieChart` | `labels: string[]`, `values: number[]`, `variant?: pie \| donut` | Donut unless `pie`. |
| `Series` (inner) | `category`, `values: number[]` | One value per label. |

Series colours are five fixed slots, in order: the brand, then orange,
aqua, yellow, magenta (`--series-1` to `--series-5` in `src/styles.css`,
with their dark steps). A sixth series is not drawn. Values are written
beside their marks.

### Steps, lists and choices

| Component | Props | Notes |
| --- | --- | --- |
| `Steps` | `items: StepsItem[]` | |
| `StepsItem` (inner) | `title`, `details?`, `state?: done \| doing \| todo \| failed` | No state: a numbered step. |
| `ListBlock` | `items: ListItem[]`, `variant?: plain \| number` | |
| `ListItem` (inner) | `title`, `subtitle?`, `image?: {src, alt}`, `actionLabel?`, `action?` | With an action the row is clickable. The image follows the `Image` rule. |
| `OptionCards` | `items: OptionCard[]`, `title?`, `note?` | A decision. A click sends the card's title as the person's answer, then the choice stays shown and the others are locked. |
| `OptionCard` (inner) | `value`, `title`, `subtitle?`, `recommended?: boolean` | At most one recommended is shown as such. |
| `Sources` | `items: {title, url, sourceName?}[]` | Numbered, for `[1]` citations in text. |

### Layout

| Component | Props | Notes |
| --- | --- | --- |
| `Tabs` | `items: TabItem[]` | |
| `TabItem` (inner) | `value`, `trigger`, `content: Node[]` | `trigger` is the label. |
| `Accordion` | `items: AccordionItem[]` | Closed to start. |
| `AccordionItem` (inner) | `value`, `trigger`, `content: Node[]` | |

### Buttons and follow-ups

| Component | Props | Notes |
| --- | --- | --- |
| `Buttons` | `buttons: Button[]`, `direction?: row \| column` | |
| `Button` | `label`, `action?`, `variant?: primary \| secondary \| tertiary` | Default: primary in a form, secondary elsewhere. |
| `FollowUpBlock` | `items: FollowUpItem[]` | Last in an answer. A click sends the text. |
| `FollowUpItem` (inner) | `text` | |

### Forms

| Component | Props | Notes |
| --- | --- | --- |
| `Form` | `name`, `buttons: Buttons`, `fields: FormControl[]` | A button that sends checks the rules first; once sent the form is locked and says so. |
| `FormControl` (inner) | `label`, `input`, `hint?` | The label is what the answer line says. |
| `Input` | `name`, `placeholder?`, `type?: text \| email \| number \| url`, `rules?`, `value?` | No password type, on purpose. |
| `TextArea` | `name`, `placeholder?`, `rows?`, `rules?`, `value?` | |
| `Select` | `name`, `items: SelectItem[]`, `placeholder?`, `rules?`, `value?` | Answers say the option's label. |
| `SelectItem` (inner) | `value`, `label` | |
| `RadioGroup` | `name`, `items: RadioItem[]`, `defaultValue?`, `rules?`, `value?` | |
| `RadioItem` (inner) | `label`, `description`, `value` | |
| `CheckBoxGroup` | `name`, `items: CheckBoxItem[]`, `rules?`, `value?` | Value is `{ [itemName]: boolean }`; answers list the ticked labels, or "None". |
| `CheckBoxItem` (inner) | `label`, `description`, `name`, `defaultChecked?` | |
| `Slider` | `name`, `variant: continuous \| discrete`, `min`, `max`, `step?`, `defaultValue?: number[]`, `label?`, `rules?`, `value?` | Value is `[n]`. |
| `DatePicker` | `name`, `mode?: single \| range`, `rules?`, `value?` | `YYYY-MM-DD`; a range is `[from, to]` and reads "from to to". |

`rules` is an object with any of `required`, `email`, `url`, `numeric`
(booleans), `min`, `max`, `minLength`, `maxLength` (numbers) and `pattern`
(a regular expression), checked as OpenUI's spec section 5.4 describes.
`value` is a binding when given.

## Keeping old answers working

A shape's props are positional, so a prop is only ever added at the end,
never removed or reordered. The gallery that came before (` ```bloks `
fences, `bloks show`, the `/api/bots/:id/show` route, `kind: "component"`
messages) is unchanged and still drawn. An agent with interactive answers
switched off (`withoutComponents` includes `"openui"`) is taught the
gallery instead, and the gallery's own switches (`chart`, `table`,
`decision`, `steps`, `quote`) also take the matching shapes out of what an
agent is taught.
