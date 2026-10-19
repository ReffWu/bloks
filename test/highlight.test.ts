// Code in a reply, coloured: what gets which colour, and the promise the
// renderer leans on, that the pieces always add back up to the code.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { highlight, knowsLanguage, type TokenKind } from "../src/lib/highlight.ts";

const kindOf = (code: string, lang: string, text: string): TokenKind | null | undefined =>
  highlight(code, lang).find((t) => t.text.includes(text))?.kind;

const SAMPLES: Record<string, string> = {
  ts: `import { x } from "./y";\n// a comment\nexport async function go(n: number): Promise<void> {\n  const s = \`n is \${n}\`;\n  if (n > 0x1f) return obj.default(null);\n}\n`,
  json: `{\n  "name": "bloks",\n  "count": -12.5e3,\n  "ok": true,\n  "list": [null, "a"]\n}`,
  bash: `$ pnpm install --frozen-lockfile\nexport FOO="bar" # set it\nif [ -f "$HOME/.x" ]; then echo \${PATH} | grep -c bin; fi\nFOO=1 node server/index.ts 2>&1`,
  py: `@dataclass\nclass Thing(Base):\n    """Docs."""\n    def go(self, n=3):\n        return f"{n}" if n else None  # done\n`,
  css: `@media (max-width: 600px) {\n  .card:hover > a { color: var(--brand); margin: 0 auto !important; }\n}\n/* end */`,
  html: `<!doctype html>\n<!-- note -->\n<div class="a" data-x='1' hidden>Hi &amp; bye</div>\n<br/>`,
  diff: `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old line\n+new line\n same`,
  yaml: `# config\nname: bloks\nlist:\n  - one: 1\n    two: "2"\nflag: true\n`,
  sql: `SELECT id, count(*) FROM bots WHERE name = 'a''b' -- trailing\nORDER BY id DESC;`,
};

describe("highlight", () => {
  test("the pieces add back up to the code, in every language", () => {
    for (const [lang, code] of Object.entries(SAMPLES)) {
      assert.equal(highlight(code, lang).map((t) => t.text).join(""), code, lang);
    }
  });

  test("an unknown or missing language comes back as one plain piece", () => {
    assert.deepEqual(highlight("just some text", ""), [{ kind: null, text: "just some text" }]);
    assert.deepEqual(highlight("x = 1", "brainfuck"), [{ kind: null, text: "x = 1" }]);
    assert.deepEqual(highlight("", "ts"), []);
    assert.equal(knowsLanguage("TypeScript"), true);
    assert.equal(knowsLanguage("cobol"), false);
  });

  test("a very long block is drawn plain rather than stalling the page", () => {
    const code = "const a = 1;\n".repeat(10_000);
    assert.equal(highlight(code, "ts").length, 1);
  });

  test("TypeScript", () => {
    const code = SAMPLES.ts;
    assert.equal(kindOf(code, "ts", "import"), "keyword");
    assert.equal(kindOf(code, "ts", '"./y"'), "string");
    assert.equal(kindOf(code, "ts", "// a comment"), "comment");
    assert.equal(kindOf(code, "ts", "go"), "function");
    assert.equal(kindOf(code, "ts", "Promise"), "type");
    assert.equal(kindOf(code, "ts", "0x1f"), "number");
    assert.equal(kindOf(code, "ts", "null"), "literal");
    // a keyword used as a property name is not a keyword
    assert.equal(kindOf(code, "ts", "default"), "function");
  });

  test("JSON keys and values", () => {
    const code = SAMPLES.json;
    assert.equal(kindOf(code, "json", '"name"'), "property");
    assert.equal(kindOf(code, "json", '"bloks"'), "string");
    assert.equal(kindOf(code, "json", "-12.5e3"), "number");
    assert.equal(kindOf(code, "json", "true"), "literal");
  });

  test("shell: the prompt, the command, its flags and variables", () => {
    const code = SAMPLES.bash;
    const tokens = highlight(code, "bash");
    assert.deepEqual(tokens[0], { kind: "meta", text: "$" });
    assert.equal(kindOf(code, "bash", "pnpm"), "function");
    assert.equal(kindOf(code, "bash", "--frozen-lockfile"), "property");
    assert.equal(kindOf(code, "bash", "# set it"), "comment");
    assert.equal(kindOf(code, "bash", "${PATH}"), "variable");
    assert.equal(kindOf(code, "bash", "grep"), "function");
    assert.equal(kindOf(code, "bash", "then"), "keyword");
    assert.equal(kindOf(code, "bash", "FOO=1"), "variable");
    assert.equal(kindOf(code, "bash", "node"), "function");
    // an argument is not a command
    assert.equal(kindOf(code, "bash", "install"), null);
    // a # inside a word is not a comment
    assert.equal(kindOf("echo a#b", "sh", "a#b"), null);
  });

  test("Python", () => {
    const code = SAMPLES.py;
    assert.equal(kindOf(code, "py", "@dataclass"), "meta");
    assert.equal(kindOf(code, "py", "Thing"), "type");
    assert.equal(kindOf(code, "py", '"""Docs."""'), "string");
    assert.equal(kindOf(code, "py", "go"), "function");
    assert.equal(kindOf(code, "py", "None"), "literal");
    assert.equal(kindOf(code, "py", "# done"), "comment");
  });

  test("CSS: selectors outside a rule, properties inside", () => {
    const code = SAMPLES.css;
    assert.equal(kindOf(code, "css", "@media"), "keyword");
    assert.equal(kindOf(code, "css", ".card"), "type");
    assert.equal(kindOf(code, "css", "color"), "property");
    assert.equal(kindOf(code, "css", "--brand"), "variable");
    assert.equal(kindOf(code, "css", "!important"), "keyword");
    assert.equal(kindOf(code, "css", "/* end */"), "comment");
  });

  test("HTML: tags, attributes and their values", () => {
    const code = SAMPLES.html;
    assert.equal(kindOf(code, "html", "<!doctype html>"), "meta");
    assert.equal(kindOf(code, "html", "<!-- note -->"), "comment");
    assert.equal(kindOf(code, "html", "div"), "tag");
    assert.equal(kindOf(code, "html", "class"), "property");
    assert.equal(kindOf(code, "html", '"a"'), "string");
    assert.equal(kindOf(code, "html", "&amp;"), "literal");
    assert.equal(kindOf(code, "html", "Hi "), null);
  });

  test("a diff, a line at a time", () => {
    const code = SAMPLES.diff;
    assert.equal(kindOf(code, "diff", "+++ b/x"), "meta");
    assert.equal(kindOf(code, "diff", "@@ -1,2"), "keyword");
    assert.equal(kindOf(code, "diff", "-old line"), "deleted");
    assert.equal(kindOf(code, "diff", "+new line"), "inserted");
    assert.equal(kindOf(code, "diff", " same"), null);
  });

  test("YAML and SQL", () => {
    assert.equal(kindOf(SAMPLES.yaml, "yaml", "name"), "property");
    assert.equal(kindOf(SAMPLES.yaml, "yaml", "# config"), "comment");
    assert.equal(kindOf(SAMPLES.yaml, "yml", '"2"'), "string");
    assert.equal(kindOf(SAMPLES.sql, "sql", "SELECT"), "keyword");
    assert.equal(kindOf(SAMPLES.sql, "sql", "'a''b'"), "string");
    assert.equal(kindOf(SAMPLES.sql, "sql", "count"), "function");
    assert.equal(kindOf(SAMPLES.sql, "sql", "-- trailing"), "comment");
  });
});
