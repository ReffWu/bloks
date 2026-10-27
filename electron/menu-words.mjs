// The menu bar's words, in the language the person chose.
//
// They come from the interface's own catalogues (src/locales, the
// `menu.` keys), so there is one place a translator works and the menus
// never say something the window words differently. A build run from
// source reads them where they are; the packaged app carries the folder
// in its Resources (electron-builder.yml). A language that lacks a word
// says the English one, the same rule the window keeps.
//
// Plain Node with no Electron in it, so a test can build the menu in any
// language without starting the app.
import fs from "node:fs";
import path from "node:path";

import { LANGUAGE_CODES } from "./workspaces.mjs";

/**
 * The language a choice comes to: a code as it is, and "System" (null)
 * the first of the system's languages Bloks speaks, matched the way the
 * window matches them (src/lib/i18n.ts matchLanguage).
 */
export function menuLanguage(choice, systemTags = []) {
  if (LANGUAGE_CODES.includes(choice)) return choice;
  for (const raw of systemTags) {
    if (typeof raw !== "string" || !raw) continue;
    const base = raw.replace(/_/g, "-").toLowerCase().split("-")[0];
    if (base === "en") return "en";
    if (base === "pt") return "pt-BR";
    if (base === "zh") return "zh-CN";
    if (LANGUAGE_CODES.includes(base)) return base;
  }
  return "en";
}

function read(dir, code) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), "utf8"));
  } catch {
    return {};
  }
}

/**
 * A `t` for the main process: `menu.` keys from `dir`, in `code`, with
 * English beneath. `{name}` is filled from `params`.
 */
export function menuWords(dir, code) {
  const english = read(dir, "en");
  const own = code === "en" ? english : read(dir, code);
  return (key, params = {}) => {
    const text = own[key] ?? english[key] ?? key;
    return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
  };
}
