// The accent, chosen from the eight colours of the Bloks mark and nothing
// else (Brand.tsx draws the same eight squares). The phone offers the
// same eight, with the same rules.
//
// A choice becomes four of the variables styles.css already uses, so
// nothing that reads them has to know a choice was made:
//   --brand            the fill: the logo colour exactly, in both modes
//   --brand-foreground words on the fill: white where white reads, a
//                      near-black ink where it does not
//   --brand-ink        the accent as words or marks on the page: the same
//                      hue, made darker on light pages or lighter on dark
//                      ones until it reads against them
//   --brand-soft       a quiet wash of it, for a selected row or a tag
// The numbers behind "reads" are WCAG's: 4.5 to 1 for text, measured
// against the card as well as the page, since the card is the harder of
// the two in dark mode.

import { t, type MessageKey } from "./i18n.ts";

export interface Accent {
  id: string;
  /** What the colour is called, read in the language of the moment. */
  readonly name: string;
  hex: string;
}

/** One accent, its name looked up each time it is read, so a picker
 * drawn after a change of language says the new words. */
const accent = (id: string, key: MessageKey, hex: string): Accent => ({
  id,
  hex,
  get name() {
    return t(key);
  },
});

export const ACCENTS: Accent[] = [
  accent("deepBlue", "accent.deepBlue", "#004aad"),
  accent("orange", "accent.orange", "#ff751f"),
  accent("orchid", "accent.orchid", "#cb6ce6"),
  accent("red", "accent.red", "#ff3131"),
  accent("coral", "accent.coral", "#ff5757"),
  accent("cyan", "accent.cyan", "#5ce1e6"),
  accent("green", "accent.green", "#7ed957"),
  accent("amber", "accent.amber", "#ffbd59"),
];

export const DEFAULT_ACCENT = "deepBlue";
const STORAGE_KEY = "bloks-accent";

/** The surfaces accent words have to read on, from styles.css. */
const PAGES = {
  light: ["#ffffff", "#f7f7f8"],
  dark: ["#0e0e10", "#17171a", "#1a1a1e"],
};
const INK = "#14151f";

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: Rgb) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** RGB to HSL and back, so a colour can be moved in lightness only and
 * keep its hue. */
function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** The accent made readable as words on every page of a mode: the exact
 * colour when it already reads, otherwise the nearest lightness that does. */
export function readableOn(hex: string, mode: "light" | "dark", ratio = 4.5): string {
  const reads = (c: string) => PAGES[mode].every((page) => contrast(c, page) >= ratio);
  if (reads(hex)) return hex;
  const [h, s, l] = toHsl(toRgb(hex));
  for (let step = 1; step <= 100; step++) {
    const next = mode === "light" ? l - step / 100 : l + step / 100;
    if (next < 0 || next > 1) break;
    const candidate = toHex(fromHsl([h, s, next]));
    if (reads(candidate)) return candidate;
  }
  return mode === "light" ? "#000000" : "#ffffff";
}

/** APCA lightness contrast (Lc), the model behind WCAG 3 (0.0.98G):
 * positive for dark text on light, negative for light on dark. */
export function apca(text: string, background: string): number {
  const y = (hex: string) => {
    const [r, g, b] = toRgb(hex).map((v) => (v / 255) ** 2.4);
    return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  };
  const clamp = (v: number) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const t = clamp(y(text));
  const b = clamp(y(background));
  if (b > t) {
    const s = (b ** 0.56 - t ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (b ** 0.65 - t ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** Words on the fill: white or ink, whichever APCA says reads better.
 * Not WCAG 2's ratio, which misjudges saturated reds and oranges and picks
 * ink where anyone looking sees white reads better; APCA agrees with the
 * eye, and with the phone, which makes the same choice. */
export function onFill(hex: string): string {
  return Math.abs(apca("#ffffff", hex)) >= Math.abs(apca(INK, hex)) ? "#ffffff" : INK;
}

/** A quiet wash: the accent over the page at a small strength. */
function soft(hex: string, mode: "light" | "dark"): string {
  const [r, g, b] = toRgb(hex);
  if (mode === "dark") return `rgba(${r}, ${g}, ${b}, 0.16)`;
  return toHex([255 + (r - 255) * 0.12, 255 + (g - 255) * 0.12, 255 + (b - 255) * 0.12]);
}

export function tokensFor(hex: string) {
  return {
    light: { brand: hex, "brand-foreground": onFill(hex), "brand-ink": readableOn(hex, "light"), "brand-soft": soft(hex, "light") },
    dark: { brand: hex, "brand-foreground": onFill(hex), "brand-ink": readableOn(hex, "dark"), "brand-soft": soft(hex, "dark") },
  };
}

export function storedAccent(): Accent {
  let id = DEFAULT_ACCENT;
  try {
    id = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ACCENT;
  } catch {
    /* storage unavailable: the default */
  }
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

/** Writes the accent into its own style element. The selectors are a
 * step more specific than styles.css's own (:root:root over :root,
 * :root.dark over .dark), so they win in both modes whichever stylesheet
 * the browser happens to load last. */
export function applyAccent(accent: Accent) {
  const t = tokensFor(accent.hex);
  const block = (vars: Record<string, string>) =>
    Object.entries(vars)
      .map(([k, v]) => `--${k}: ${v};`)
      .join(" ");
  let el = document.getElementById("bloks-accent") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "bloks-accent";
    document.head.appendChild(el);
  }
  el.textContent = `:root:root { ${block(t.light)} } :root.dark { ${block(t.dark)} }`;
  // the picker shows what is drawn, whoever chose it
  window.dispatchEvent(new CustomEvent(ACCENT_EVENT, { detail: accent.id }));
}

/** Said on the window whenever the accent drawn changes. */
export const ACCENT_EVENT = "bloks-accent";

/** Draws an accent the app chose for this window (the shared one turned
 * on or off), keeping it in the page's storage, without telling the app
 * back what it just said. */
export function adoptAccent(id: string | null | undefined) {
  const accent = ACCENTS.find((a) => a.id === id);
  if (!accent) return;
  try {
    localStorage.setItem(STORAGE_KEY, accent.id);
  } catch {
    /* holds for this visit */
  }
  applyAccent(accent);
}

/** "Same accent in every workspace", from this window: on, what it shows
 * becomes everyone's; off, every workspace goes back to its own, which
 * this window then draws. Kept by the desktop app (electron/main.mjs),
 * which hands every workspace its accent before it draws. */
export async function setSameAccent(on: boolean): Promise<void> {
  const now = await window.bloks?.prefsSameAccent?.(on, storedAccent().id);
  if (now) adoptAccent(now);
}

export function chooseAccent(id: string) {
  const accent = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
  try {
    localStorage.setItem(STORAGE_KEY, accent.id);
  } catch {
    /* holds for this visit */
  }
  // The accent belongs to the workspace, so each can look like itself,
  // unless the person chose one for every workspace; either way the
  // desktop app keeps it, since a workspace's storage belongs to its port
  // and a port can move (electron/main.mjs prefs:accent).
  void window.bloks?.prefsAccent?.(accent.id)?.catch?.(() => {});
  applyAccent(accent);
  return accent;
}

/** Whether this origin has an accent of its own yet. */
export function hasStoredAccent(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    return true;
  }
}
