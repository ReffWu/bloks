// The guard against English written inline in a component
// (test/i18n.test.ts): text in JSX, a string on a prop a person reads,
// and a string drawn through ?:, && or ??. Anything it finds belongs in
// src/locales/en.json, or, if it is never translated (a product's name,
// a symbol), in test/i18n-allowlist.json.
//
// Run on its own to list what it finds:
//   node test/helpers/i18n-scan.ts [src/components/Composer.tsx ...]
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** The props a person reads, on our components as well as the DOM's. */
export const READ_PROPS = new Set([
  "aria-label", "aria-description", "aria-roledescription", "aria-placeholder", "aria-valuetext", "alt", "title", "placeholder",
  "label", "description", "hint", "says", "info", "footnote", "note", "detail", "noneLabel", "empty", "aside", "lead",
  "blurb", "eyebrow", "body", "stopLabel", "what", "confirmLabel", "cancelLabel", "heading", "subtitle", "caption",
]);

export interface Allowlist {
  /** Words never translated, wherever they are drawn: names, symbols. */
  anywhere: string[];
  /** A file's own exceptions. */
  files: Record<string, string[]>;
}

export function readAllowlist(root: string): Allowlist {
  return JSON.parse(fs.readFileSync(path.join(root, "test", "i18n-allowlist.json"), "utf8"));
}

/** JSX's own rule for the text between tags: lines trimmed where they
 * meet, blank ones dropped, the rest joined by a space. */
function jsxValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  return lines
    .map((line, i) => {
      let l = line;
      if (i > 0) l = l.replace(/^[ \t]+/, "");
      if (i < lines.length - 1) l = l.replace(/[ \t]+$/, "");
      return l;
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

const AND_OR = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken];

/** English the person would read, written inline in a component. */
export function inlineEnglish(file: string, source: ts.SourceFile, allow: Allowlist): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  const anywhere = new Set(allow.anywhere);
  const own = new Set(allow.files[file] ?? []);
  const words = (text: string) => /[A-Za-z]{2,}/.test(text) && !anywhere.has(text.trim()) && !own.has(text.trim());
  const push = (node: ts.Node, text: string) => found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = jsxValue(node.getText(source));
      if (text && words(text)) push(node, text);
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      if (READ_PROPS.has(node.name.getText(source)) && words(node.initializer.text)) push(node, node.initializer.text);
    } else if (ts.isStringLiteralLike(node)) {
      let child: ts.Node = node;
      let parent = node.parent;
      let drawn = true;
      while (parent && !ts.isJsxExpression(parent)) {
        if (ts.isConditionalExpression(parent)) {
          if (parent.condition === child) drawn = false;
        } else if (ts.isBinaryExpression(parent) && AND_OR.includes(parent.operatorToken.kind)) {
          if (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.left === child) drawn = false;
        } else if (!ts.isParenthesizedExpression(parent)) drawn = false;
        if (!drawn) break;
        child = parent;
        parent = parent.parent;
      }
      if (drawn && parent && ts.isJsxExpression(parent)) {
        const host = parent.parent;
        const shown = ts.isJsxElement(host) || ts.isJsxFragment(host) || (ts.isJsxAttribute(host) && READ_PROPS.has(host.name.getText(source)));
        if (shown && words(node.text)) push(node, node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function components(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? components(full) : e.name.endsWith(".tsx") ? [full] : [];
  });
}

if (import.meta.main) {
  const root = process.cwd();
  const allow = readAllowlist(root);
  const asked = process.argv.slice(2);
  const files = (asked.length ? asked.flatMap((p) => (fs.statSync(p).isDirectory() ? components(p) : [p])) : components(path.join(root, "src"))).map((f) => path.relative(root, path.resolve(f)));
  let n = 0;
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const hit of inlineEnglish(file, source, allow)) {
      console.log(`${file}:${hit.line} ${JSON.stringify(hit.text)}`);
      n++;
    }
  }
  console.log(`${n} found`);
}
