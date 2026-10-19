// The prose between a reply's tables and code fences, as blocks.
//
// markdownTable.ts takes out what only means something as a whole (a
// fence, a table). What is left used to be drawn a line at a time, which
// is why a reply read like a log: every line its own row, a list that
// was really three rows with dots, a paragraph that was one row per line
// the model happened to break. This groups those lines into what a
// reader sees: paragraphs, headings, lists that nest, quotes and rules.
//
// It is a reading of what models write, not a CommonMark parser. Where
// the two disagree, the model's intent wins: a plain line straight after
// a list ends the list rather than joining its last item, because that
// is nearly always what "Then run it again." under three steps means.

export interface ListItem {
  /** The item's own lines; more than one when it continues indented. */
  lines: string[];
  /** A task item's box: done, open, or not a task. */
  task: boolean | null;
  children: List[];
}

export interface List {
  kind: "list";
  ordered: boolean;
  /** The number the first item said, so a list split by a code block
   * carries on counting where it left off. */
  start: number;
  /** A blank line between items: the list breathes a little more. */
  loose: boolean;
  items: ListItem[];
}

export type ProseBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | List;

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

/** Leading whitespace as columns, a tab counted as four. */
const indentOf = (lead: string) => lead.replace(/\t/g, "    ").length;

function itemOf(text: string): ListItem {
  const task = text.match(TASK);
  return task
    ? { lines: [task[2]], task: task[1] !== " ", children: [] }
    : { lines: [text], task: null, children: [] };
}

/**
 * Lines from a list's first item on, read until the list ends. Returns
 * the list and how many lines it used. Nesting follows indentation: two
 * or more columns deeper than an item opens a list inside it.
 */
function readList(lines: string[], from: number): { list: List; used: number } {
  const first = lines[from].match(ITEM)!;
  const root: List = {
    kind: "list",
    ordered: /\d/.test(first[2]),
    start: /\d/.test(first[2]) ? parseInt(first[2], 10) : 1,
    loose: false,
    items: [],
  };
  // each level: the list, and the column its markers sit at
  const stack: Array<{ list: List; indent: number }> = [{ list: root, indent: indentOf(first[1]) }];
  let blank = false;
  let i = from;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      blank = true;
      continue;
    }
    const item = line.match(ITEM);
    if (item && !RULE.test(line)) {
      const indent = indentOf(item[1]);
      const ordered = /\d/.test(item[2]);
      let top = stack[stack.length - 1];
      const parent = top.list.items[top.list.items.length - 1];
      if (indent >= top.indent + 2 && parent) {
        // deeper than the item above it: a list inside that item
        const child: List = { kind: "list", ordered, start: ordered ? parseInt(item[2], 10) : 1, loose: false, items: [] };
        parent.children.push(child);
        stack.push({ list: child, indent });
        top = stack[stack.length - 1];
      } else {
        while (stack.length > 1 && indent < top.indent) {
          stack.pop();
          top = stack[stack.length - 1];
        }
        // a different kind of marker at the top level is a new list
        if (stack.length === 1 && ordered !== root.ordered) break;
      }
      if (blank && top.list.items.length) top.list.loose = true;
      top.list.items.push(itemOf(item[3]));
      blank = false;
      continue;
    }
    // indented under an item: more of that item, after a blank or not
    const top = stack[stack.length - 1];
    const last = top.list.items[top.list.items.length - 1];
    const lead = indentOf(line.match(/^\s*/)![0]);
    if (last && lead >= stack[0].indent + 2 && !QUOTE.test(line)) {
      if (blank) top.list.loose = true;
      last.lines.push(line.trim());
      blank = false;
      continue;
    }
    break;
  }
  // a blank line the list ended on belongs to whatever comes next
  while (i > from && !lines[i - 1].trim()) i--;
  return { list: root, used: i - from };
}

/** A run of prose lines as blocks, in order. */
export function proseBlocks(lines: string[]): ProseBlock[] {
  const out: ProseBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      out.push({ kind: "heading", level: Math.min(4, heading[1].length) as 1 | 2 | 3 | 4, text: heading[2] });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      out.push({ kind: "rule" });
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) quoted.push(lines[i].match(QUOTE)![1]);
      i--;
      out.push({ kind: "quote", text: quoted.join("\n") });
      continue;
    }
    if (ITEM.test(line)) {
      flush();
      const { list, used } = readList(lines, i);
      out.push(list);
      i += used - 1;
      continue;
    }
    // a run of lines is one paragraph; the breaks the model chose stay
    paragraph.push(line.trim());
  }
  flush();
  return out;
}
