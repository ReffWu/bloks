// Code in a reply, coloured, without a highlighting library.
//
// Agents write a handful of languages over and over: the TypeScript they
// are editing, the shell commands they ran, the JSON they read back, a
// diff of what changed. A real grammar for each would be a dependency the
// size of the rest of the transcript, and a reply only needs to be easier
// to read, not to be parsed. So each language here is a short list of
// patterns tried in order at each position, and whatever none of them
// claims is left as plain text.
//
// The output is a flat list of pieces that add back up to the input,
// character for character. The renderer relies on that: the copy button,
// the find highlight and the text a screen reader hears all come from the
// same string the model wrote.

export type TokenKind =
  | "keyword"
  | "string"
  | "number"
  | "literal"
  | "comment"
  | "function"
  | "type"
  | "property"
  | "tag"
  | "variable"
  | "punct"
  | "meta"
  | "inserted"
  | "deleted";

export interface Token {
  kind: TokenKind | null;
  text: string;
}

/** Past this, a block is drawn plain. Colour is a nicety, and a pasted
 * log a megabyte long should scroll, not stall the transcript. */
const LIMIT = 60_000;

interface State {
  code: string;
  /** Where the current match starts. */
  at: number;
  /** The last word that was not whitespace or punctuation. */
  word: string;
  /** A shell word in command position: start of a line, or after a pipe. */
  command: boolean;
}

type Rule = [RegExp, TokenKind | null | ((match: string, state: State) => TokenKind | null)];

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

/** The next character after a match that is not a space. */
const nextChar = (state: State, end: number) => {
  const rest = state.code.slice(end, end + 40).match(/^[ \t]*(\S)/);
  return rest ? rest[1] : "";
};

/** Runs the rules over the code, first match wins at each position. */
function scan(code: string, rules: Rule[]): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind | null, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  const state: State = { code, at: 0, word: "", command: true };
  let pos = 0;
  outer: while (pos < code.length) {
    for (const [pattern, kind] of rules) {
      pattern.lastIndex = pos;
      const m = pattern.exec(code);
      if (!m || m[0].length === 0) continue;
      state.at = pos;
      const resolved = typeof kind === "function" ? kind(m[0], state) : kind;
      push(resolved, m[0]);
      if (/^[\w$]+$/.test(m[0])) state.word = m[0];
      pos += m[0].length;
      continue outer;
    }
    push(null, code[pos]);
    pos += 1;
  }
  return out;
}

const sticky = (source: string, flags = "") => new RegExp(source, `y${flags}`);

const NUMBER = sticky(String.raw`(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)\b`);
const DQ = sticky(String.raw`"(?:\\.|[^"\\\n])*"?`);
const SQ = sticky(String.raw`'(?:\\.|[^'\\\n])*'?`);
const WS = sticky(String.raw`\s+`);

// ── JavaScript and TypeScript ────────────────────────────────────────

const JS_KEYWORDS = words(`
  abstract as async await break case catch class const continue debugger declare default delete do else
  enum export extends finally for from function get if implements import in infer instanceof interface
  is keyof let namespace new of override private protected public readonly return satisfies set static
  switch throw try type typeof unique var void while with yield
`);
const JS_LITERALS = words("true false null undefined NaN Infinity this super");

function jsWord(word: string, state: State): TokenKind | null {
  if (JS_LITERALS.has(word)) return "literal";
  // a property named like a keyword (`obj.default`, `{ type: 1 }`) is a property
  const before = state.code[state.at - 1];
  if (before === ".") return nextChar(state, state.at + word.length) === "(" ? "function" : null;
  if (JS_KEYWORDS.has(word)) return "keyword";
  if (nextChar(state, state.at + word.length) === "(") return "function";
  if (state.word === "function") return "function";
  if (/^[A-Z]/.test(word)) return "type";
  return null;
}

const JS: Rule[] = [
  [WS, null],
  [sticky(String.raw`\/\/[^\n]*`), "comment"],
  [sticky(String.raw`\/\*[\s\S]*?(?:\*\/|$)`), "comment"],
  [DQ, "string"],
  [SQ, "string"],
  [sticky(String.raw`\x60(?:\\.|[^\x60\\])*\x60?`), "string"],
  [sticky(String.raw`@[\w$.]+`), "meta"],
  [NUMBER, "number"],
  [sticky(String.raw`[A-Za-z_$][\w$]*`), jsWord],
  [sticky(String.raw`[{}()\[\];,.:?<>=!+\-*/%&|^~]+`), "punct"],
];

// ── JSON ─────────────────────────────────────────────────────────────

const JSON_RULES: Rule[] = [
  [WS, null],
  [sticky(String.raw`\/\/[^\n]*`), "comment"],
  [sticky(String.raw`\/\*[\s\S]*?(?:\*\/|$)`), "comment"],
  // a string with a colon after it is a key
  [DQ, (text, state) => (nextChar(state, state.at + text.length) === ":" ? "property" : "string")],
  [sticky(String.raw`-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`), "number"],
  [sticky(String.raw`\b(?:true|false|null)\b`), "literal"],
  [sticky(String.raw`[{}\[\],:]`), "punct"],
];

// ── Shell ────────────────────────────────────────────────────────────

const SH_KEYWORDS = words("if then else elif fi for while until do done case esac in function return local export select time");

const SH: Rule[] = [
  // a new line is a new command
  [sticky(String.raw`\n[ \t]*`), (_t, state) => ((state.command = true), null)],
  [sticky(String.raw`[ \t]+`), null],
  // a prompt pasted along with the command it ran
  [sticky(String.raw`[$%❯](?=[ \t])`), (_t, state) => (state.at === lineStart(state) ? "meta" : null)],
  // a comment starts a word, so `a#b` is still a word
  [sticky(String.raw`#[^\n]*`), (_t, state) => (state.at === 0 || /\s/.test(state.code[state.at - 1]) ? "comment" : null)],
  [sticky(String.raw`'[^']*'?`), (_t, state) => ((state.command = false), "string")],
  [DQ, (_t, state) => ((state.command = false), "string")],
  [sticky(String.raw`\$\(`), (_t, state) => ((state.command = true), "variable")],
  [sticky(String.raw`\$\{[^}\n]*\}?|\$[A-Za-z_]\w*|\$[0-9@#?*!$-]`), (_t, state) => ((state.command = false), "variable")],
  [sticky(String.raw`&&|\|\||[|;&(]`), (_t, state) => ((state.command = true), "punct")],
  [sticky(String.raw`\d*[<>]+&?\d?-?|\)`), "punct"],
  [sticky(String.raw`--?[A-Za-z0-9][\w-]*`), (text, state) => (state.command ? shWord(text, state) : "property")],
  [sticky(String.raw`[^\s|;&()<>'"$#]+`), shWord],
];

/** Where the current line's text begins, after its indent. */
function lineStart(state: State): number {
  const nl = state.code.lastIndexOf("\n", state.at - 1);
  return nl + 1 + (state.code.slice(nl + 1, state.at).match(/^[ \t]*/)?.[0].length ?? 0);
}

/** A shell word: a keyword, the command being run, or an argument. */
function shWord(text: string, state: State): TokenKind | null {
  if (SH_KEYWORDS.has(text)) {
    // `then`, `do` and friends are followed by another command
    state.command = text !== "in" && text !== "function";
    return "keyword";
  }
  if (state.command) {
    // `FOO=bar cmd`: the assignment is not the command
    if (/^[A-Za-z_]\w*=/.test(text)) return "variable";
    state.command = text === "sudo" || text === "env" || text === "time" || text === "exec" || text === "xargs";
    return "function";
  }
  return /^\d+$/.test(text) ? "number" : null;
}

// ── Python ───────────────────────────────────────────────────────────

const PY_KEYWORDS = words(`
  and as assert async await break class continue def del elif else except finally for from global if
  import in is lambda match case nonlocal not or pass raise return try while with yield
`);
const PY_LITERALS = words("True False None self cls");

const PY: Rule[] = [
  [WS, null],
  [sticky(String.raw`#[^\n]*`), "comment"],
  [sticky(String.raw`[rRbBuUfF]{0,2}"""[\s\S]*?(?:"""|$)`), "string"],
  [sticky(String.raw`[rRbBuUfF]{0,2}'''[\s\S]*?(?:'''|$)`), "string"],
  [sticky(String.raw`[rRbBuUfF]{1,2}(?=["'])`), "string"],
  [DQ, "string"],
  [SQ, "string"],
  [sticky(String.raw`@[\w.]+`), "meta"],
  [NUMBER, "number"],
  [
    sticky(String.raw`[A-Za-z_]\w*`),
    (w, state) => {
      if (state.code[state.at - 1] === ".") return nextChar(state, state.at + w.length) === "(" ? "function" : null;
      if (PY_LITERALS.has(w)) return "literal";
      if (PY_KEYWORDS.has(w)) return "keyword";
      if (state.word === "def") return "function";
      if (state.word === "class") return "type";
      if (nextChar(state, state.at + w.length) === "(") return "function";
      return null;
    },
  ],
  [sticky(String.raw`[{}()\[\];,.:<>=!+\-*/%&|^~]+`), "punct"],
];

// ── CSS ──────────────────────────────────────────────────────────────

/** Whether the words here open a rule rather than sit in one: what comes
 * first after them, a brace that opens or the end of a declaration. Read
 * ahead rather than counted, so a rule nested in @media still knows its
 * selector from its properties. */
function selectorAhead(state: State, from: number): boolean {
  const m = state.code.slice(from, from + 2000).match(/[{};]/);
  if (!m || m[0] !== "{") return false;
  // inside the parentheses of an at-rule, `max-width: 600px` is a feature
  const { code, at } = state;
  const begin = Math.max(code.lastIndexOf("\n", at - 1), code.lastIndexOf("{", at - 1), code.lastIndexOf(";", at - 1)) + 1;
  const line = code.slice(begin, at);
  return (line.match(/\(/g)?.length ?? 0) <= (line.match(/\)/g)?.length ?? 0);
}

const CSS: Rule[] = [
  [WS, null],
  [sticky(String.raw`\/\*[\s\S]*?(?:\*\/|$)`), "comment"],
  [sticky(String.raw`\/\/[^\n]*`), (_t, state) => (state.code[state.at - 1] !== ":" ? "comment" : null)],
  [DQ, "string"],
  [SQ, "string"],
  [sticky(String.raw`@[\w-]+`), "keyword"],
  [sticky(String.raw`!important\b`), "keyword"],
  [sticky(String.raw`--[\w-]+`), "variable"],
  // a word before a colon is a property, unless it is a selector with a
  // pseudo-class (`a:hover {`)
  [
    sticky(String.raw`[A-Za-z-][\w-]*(?=\s*:(?!:))`),
    (t, state) => (selectorAhead(state, state.at + t.length) ? "tag" : "property"),
  ],
  [sticky(String.raw`#[\da-fA-F]{3,8}\b`), (t, state) => (selectorAhead(state, state.at + t.length) ? "type" : "number")],
  [sticky(String.raw`-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?`), "number"],
  [sticky(String.raw`[.#][\w-]+`), (t, state) => (selectorAhead(state, state.at + t.length) ? "type" : null)],
  [sticky(String.raw`::?[\w-]+`), (t, state) => (selectorAhead(state, state.at + t.length) ? "keyword" : null)],
  [sticky(String.raw`[A-Za-z-][\w-]*(?=\()`), "function"],
  [sticky(String.raw`[A-Za-z][\w-]*`), (t, state) => (selectorAhead(state, state.at + t.length) ? "tag" : null)],
  [sticky(String.raw`[{};:,()>+~*=\[\]]+`), "punct"],
];

// ── YAML ─────────────────────────────────────────────────────────────

const YAML: Rule[] = [
  [WS, null],
  [sticky(String.raw`#[^\n]*`), (_t, state) => (state.at === 0 || /\s/.test(state.code[state.at - 1]) ? "comment" : null)],
  [sticky(String.raw`---|\.\.\.`), "meta"],
  [sticky(String.raw`[^\s:#'"\-\[\]{},][^:#\n]*?(?=:(?:\s|$))`), "property"],
  [DQ, "string"],
  [SQ, "string"],
  [sticky(String.raw`[&*][\w-]+`), "variable"],
  [sticky(String.raw`\b(?:true|false|null|yes|no|on|off|~)\b`), "literal"],
  [sticky(String.raw`-?\d+(?:\.\d+)?\b`), "number"],
  [sticky(String.raw`[:\-\[\]{},|>]`), "punct"],
];

// ── SQL ──────────────────────────────────────────────────────────────

const SQL_KEYWORDS = words(`
  select from where join left right inner outer full cross on and or not null is in as insert into values
  update set delete create table index primary key foreign references drop alter add column order by
  group having limit offset union all distinct case when then else end returning with default unique if
  exists begin commit rollback transaction view trigger asc desc like ilike between using natural
  constraint check cascade replace pragma explain
`);

const SQL: Rule[] = [
  [WS, null],
  [sticky(String.raw`--[^\n]*`), "comment"],
  [sticky(String.raw`\/\*[\s\S]*?(?:\*\/|$)`), "comment"],
  [sticky(String.raw`'(?:''|[^'])*'?`), "string"],
  [sticky(String.raw`"(?:""|[^"])*"?`), "property"],
  [NUMBER, "number"],
  [
    sticky(String.raw`[A-Za-z_]\w*`),
    (w, state) => {
      const lower = w.toLowerCase();
      if (lower === "true" || lower === "false" || lower === "null") return "literal";
      if (SQL_KEYWORDS.has(lower)) return "keyword";
      if (nextChar(state, state.at + w.length) === "(") return "function";
      return null;
    },
  ],
  [sticky(String.raw`[(),;.*=<>!+\-/%]+`), "punct"],
];

// ── HTML and XML ─────────────────────────────────────────────────────

/** Markup has two modes, inside a tag and between them, so it gets a
 * small loop of its own rather than one list of rules. */
function markup(code: string): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind | null, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  const re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[\s\S]*?(?:\?>|$)|<\/?[A-Za-z][\w:.-]*|&[#\w]+;/g;
  let pos = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    push(null, code.slice(pos, m.index));
    const text = m[0];
    pos = m.index + text.length;
    if (text.startsWith("<!--")) push("comment", text);
    else if (text.startsWith("<!") || text.startsWith("<?")) push("meta", text);
    else if (text.startsWith("&")) push("literal", text);
    else {
      const slash = text[1] === "/" ? 2 : 1;
      push("punct", text.slice(0, slash));
      push("tag", text.slice(slash));
      // the attributes, up to the end of the tag
      const attr = /\s+|[^\s=>/"']+|=|"[^"]*"?|'[^']*'?|\/?>/y;
      attr.lastIndex = pos;
      for (let a = attr.exec(code); a; a = attr.exec(code)) {
        const part = a[0];
        pos = attr.lastIndex;
        if (part.endsWith(">")) {
          push("punct", part);
          break;
        }
        if (/^\s/.test(part)) push(null, part);
        else if (part === "=") push("punct", part);
        else if (/^["']/.test(part)) push("string", part);
        else push("property", part);
      }
      re.lastIndex = pos;
    }
  }
  push(null, code.slice(pos));
  return out;
}

// ── Diffs ────────────────────────────────────────────────────────────

/** A diff is read a line at a time, so it is coloured a line at a time:
 * what went, what came, and where in the file. */
function diff(code: string): Token[] {
  const out: Token[] = [];
  const lines = code.split("\n");
  lines.forEach((line, i) => {
    let kind: TokenKind | null = null;
    if (/^(?:\+\+\+|---)(?:\s|$)/.test(line) || /^(?:diff |index |new file|deleted file|similarity |rename )/.test(line)) kind = "meta";
    else if (line.startsWith("@@")) kind = "keyword";
    else if (line.startsWith("+")) kind = "inserted";
    else if (line.startsWith("-")) kind = "deleted";
    if (line) out.push({ kind, text: line });
    if (i < lines.length - 1) out.push({ kind: null, text: "\n" });
  });
  return out;
}

// ── Which is which ───────────────────────────────────────────────────

const LANGUAGES: Record<string, (code: string) => Token[]> = {};
const register = (names: string, run: (code: string) => Token[]) => {
  for (const name of names.split(" ")) LANGUAGES[name] = run;
};
register("js jsx mjs cjs javascript ts tsx mts cts typescript node", (code) => scan(code, JS));
register("json jsonc json5 jsonl ndjson", (code) => scan(code, JSON_RULES));
register("sh bash zsh shell console terminal shellsession fish ksh", (code) => scan(code, SH));
register("py python python3 py3 ipython", (code) => scan(code, PY));
register("css scss less postcss", (code) => scan(code, CSS));
register("html htm xml svg xhtml vue svelte astro plist", markup);
register("diff patch udiff", diff);
register("yaml yml", (code) => scan(code, YAML));
register("sql psql pgsql mysql sqlite postgres postgresql", (code) => scan(code, SQL));

/** Whether a fence's language is one this file knows how to colour. */
export function knowsLanguage(lang: string): boolean {
  return Boolean(LANGUAGES[lang.trim().toLowerCase()]);
}

/**
 * Code as coloured pieces. An unknown language, or no language at all,
 * comes back as one plain piece: a guess that colours prose as code is
 * worse than no colour.
 */
export function highlight(code: string, lang: string): Token[] {
  const run = LANGUAGES[lang.trim().toLowerCase()];
  if (!run || !code || code.length > LIMIT) return code ? [{ kind: null, text: code }] : [];
  return run(code);
}
