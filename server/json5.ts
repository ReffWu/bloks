// A small JSON5 reader.
//
// OpenClaw writes its config as JSON5: comments, trailing commas, keys
// without quotes, strings in single quotes. Bringing a setup over needs a
// handful of strings out of that file and nothing else, so this reads the
// format here rather than adding a dependency, the same call the TOML
// reader in server/setup-import.ts made.
//
// It is a reader for a file written by a person or a program they trust,
// and it is still careful: keys that would reach an object's prototype
// are refused, nesting is capped, and anything it cannot read throws
// rather than guessing, so a caller can say the file was left out.

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 64;

class Reader {
  s: string;
  i = 0;
  depth = 0;
  constructor(text: string) {
    // a byte order mark is not part of the document
    this.s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }
  fail(): never {
    throw new Error(`unreadable JSON5 at ${this.i}`);
  }
  /** Spaces, line ends and both kinds of comment. */
  blank() {
    for (;;) {
      const c = this.s[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === " " || c === "﻿" || c === " " || c === " ") this.i++;
      else if (c === "/" && this.s[this.i + 1] === "/") {
        while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++;
      } else if (c === "/" && this.s[this.i + 1] === "*") {
        const end = this.s.indexOf("*/", this.i + 2);
        if (end < 0) this.fail();
        this.i = end + 2;
      } else return;
    }
  }
  value(): unknown {
    this.blank();
    const c = this.s[this.i];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'") return this.string();
    return this.word();
  }
  nest<T>(read: () => T): T {
    if (++this.depth > MAX_DEPTH) this.fail();
    try {
      return read();
    } finally {
      this.depth--;
    }
  }
  object(): Record<string, unknown> {
    return this.nest(() => {
      this.i++;
      const out: Record<string, unknown> = {};
      for (;;) {
        this.blank();
        if (this.s[this.i] === "}") {
          this.i++;
          return out;
        }
        const key = this.key();
        this.blank();
        if (this.s[this.i] !== ":") this.fail();
        this.i++;
        const value = this.value();
        if (UNSAFE_KEYS.has(key)) this.fail();
        out[key] = value;
        this.blank();
        if (this.s[this.i] === ",") this.i++;
        else if (this.s[this.i] !== "}") this.fail();
      }
    });
  }
  array(): unknown[] {
    return this.nest(() => {
      this.i++;
      const out: unknown[] = [];
      for (;;) {
        this.blank();
        if (this.s[this.i] === "]") {
          this.i++;
          return out;
        }
        out.push(this.value());
        this.blank();
        if (this.s[this.i] === ",") this.i++;
        else if (this.s[this.i] !== "]") this.fail();
      }
    });
  }
  key(): string {
    const c = this.s[this.i];
    if (c === '"' || c === "'") return this.string();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 256));
    if (!m) this.fail();
    this.i += m[0].length;
    return m[0];
  }
  string(): string {
    const quote = this.s[this.i++];
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) this.fail();
      const c = this.s[this.i++];
      if (c === quote) return out;
      if (c === "\n" || c === "\r") this.fail();
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.s[this.i++];
      const simple: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "0": "\0", "'": "'", '"': '"', "\\": "\\", "/": "/" };
      if (e in simple) out += simple[e];
      else if (e === "\n") continue;
      else if (e === "\r") {
        if (this.s[this.i] === "\n") this.i++;
      } else if (e === "x" || e === "u") {
        const width = e === "x" ? 2 : 4;
        const hex = this.s.slice(this.i, this.i + width);
        if (hex.length !== width || !/^[0-9A-Fa-f]+$/.test(hex)) this.fail();
        this.i += width;
        out += String.fromCharCode(parseInt(hex, 16));
      } else if (e === undefined) this.fail();
      else out += e;
    }
  }
  word(): unknown {
    const m = /^[+-]?(?:Infinity|NaN|0[xX][0-9A-Fa-f]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|^(?:true|false|null)/.exec(this.s.slice(this.i, this.i + 64));
    if (!m) this.fail();
    this.i += m[0].length;
    const token = m[0];
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    const sign = token.startsWith("-") ? -1 : 1;
    const bare = token.replace(/^[+-]/, "");
    if (bare === "Infinity") return sign * Infinity;
    if (bare === "NaN") return NaN;
    if (/^0[xX]/.test(bare)) return sign * parseInt(bare.slice(2), 16);
    return Number(token);
  }
}

/** The document, or a throw saying it could not be read. Plain JSON is
 * JSON5 too, so this reads either. */
export function parseJson5(text: string): unknown {
  const r = new Reader(text);
  const value = r.value();
  r.blank();
  if (r.i < r.s.length) r.fail();
  return value;
}
