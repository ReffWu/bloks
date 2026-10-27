// Generates the disk image's window art from the brand mark.
//
// The first thing anyone sees of Bloks on a Mac is this window, and for a
// long time it was electron-builder's stock dashed arrow. This draws it
// from the same mark the icon comes from: the mark's own coloured bars
// step from the app toward Applications and turn into the arrowhead, so
// the window says what to do in the brand's own shapes.
//
// Two outputs, both committed: build/dmg-background.png and its @2x.
// scripts/stage-dmg-art.mjs joins them into the multi-resolution
// background.tiff at package time, so packaging needs no browser.
//
// Finder draws the icons and their names itself, over this picture, at
// the places electron-builder.yml gives. LAYOUT below and that file must
// agree; the halos and name plates here are drawn where Finder will put
// each icon and its name.
//
// The names: Finder writes them white in Dark mode and black in Light,
// whatever the picture is. Over a dark window black would vanish, and
// over a light plate white would. The plates are a neutral grey that
// both read on at about 4.5:1, so the window works in either mode.
//
// Run after any change to the mark or the layout:
//   node scripts/render-dmg-background.mjs
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** In points. electron-builder.yml's dmg window, iconSize and contents
 * repeat these numbers. */
export const LAYOUT = {
  width: 660,
  height: 420,
  icon: 100,
  app: { x: 180, y: 222 },
  apps: { x: 480, y: 222 },
};

// The agents along the bottom: the faces the app draws, each a different
// shape and colour and in a different mood, so the line under them ("the
// agents that live on your Mac") has somebody to be about.
const CROWD = [
  { color: "blue", shape: "star", expression: "friendly" },
  { color: "orange", shape: "burst", expression: "excited" },
  { color: "green", shape: "invader", expression: "mischievous" },
  { color: "purple", shape: "cloud", expression: "thinking" },
  { color: "yellow", shape: "diamond", expression: "focused" },
  { color: "red", shape: "drop", expression: "friendly" },
  { color: "cyan", shape: "bit", expression: "sleepy" },
  { color: "pink", shape: "triangle", expression: "surprised" },
];
const FACE = 30;
// How each one stands: a point or two up or down and a few degrees off
// true, fixed so the art is the same every time it is drawn.
const STANCE = [
  [0, -4],
  [-3, 3],
  [1, -2],
  [-2, 4],
  [0, -3],
  [-3, 2],
  [1, -4],
  [-1, 3],
];

// The mark's colours, in the order its bars spiral in.
const BARS = ["#0b4fb3", "#5ce1e6", "#7ed957", "#ffbd59", "#ff7420", "#ff5757", "#cb6ce6"];

const asData = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
// the wordmark with light letters, for a dark ground
const wordmark = asData(path.join(root, "public", "brand", "bloks-wordmark-dark.png"), "image/png");
const inter = asData(path.join(root, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2"), "font/woff2");

const { width: W, height: H, icon: I, app, apps } = LAYOUT;

// The faces come from the app's own component (src/components/Avatar.tsx),
// bundled here and rendered to plain SVG, so the installer's agents can
// never drift from the ones in the app.
const bundled = await build({
  stdin: {
    contents: `
      import { renderToStaticMarkup } from "react-dom/server";
      import { createElement } from "react";
      import { BlokAvatar } from "@/components/Avatar";
      export const faces = (crowd, size) =>
        crowd.map((c) => renderToStaticMarkup(createElement(BlokAvatar, { ...c, size })));
    `,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  alias: { "@": path.join(root, "src") },
  define: { "process.env.NODE_ENV": '"production"' },
  // React ships as CommonJS, which asks for require inside the bundle
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  logLevel: "silent",
});
const work = mkdtempSync(path.join(tmpdir(), "bloks-faces-"));
const entry = path.join(work, "faces.mjs");
writeFileSync(entry, bundled.outputFiles[0].text);
const { faces } = await import(pathToFileURL(entry).href);
rmSync(work, { recursive: true, force: true });
const crowdSvg = faces(CROWD, FACE)
  .map((svg, i) => `<span class="face" style="transform:translateY(${STANCE[i][0]}px) rotate(${STANCE[i][1]}deg)">${svg}</span>`)
  .join("");

// The bars of the arrow: each a little longer than the one before, the
// gaps closing up, as if gathering speed toward the folder.
const from = app.x + I / 2 + 30;
const to = apps.x - I / 2 - 30;
const lengths = [8, 11, 14, 17, 20, 23];
const gap = (to - from - 24 - lengths.reduce((a, b) => a + b, 0)) / lengths.length;
let at = from;
const bars = lengths
  .map((len, i) => {
    const bar = `<span class="bar" style="left:${at.toFixed(1)}px;width:${len}px;background:${BARS[i]}"></span>`;
    at += len + gap;
    return bar;
  })
  .join("");
// the head: two bars meeting at a point, in the mark's last colour
const head = `<span class="head" style="left:${(to - 24).toFixed(1)}px"><i></i><i></i></span>`;

// Where Finder writes each name: centred under the icon, its 13 point
// line starting about four points below the icon's bottom edge. The plate
// is centred on that line and a little taller than it, so a point or two
// of difference between macOS versions still lands the name inside.
const plate = (x, word) =>
  `<span class="plate" style="left:${x}px;top:${app.y + I / 2 + 1}px;width:${Math.round(word.length * 7.6 + 26)}px"></span>`;

const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:Inter;src:url(${inter}) format("woff2");font-weight:100 900}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  body{position:relative;font-family:Inter,system-ui;-webkit-font-smoothing:antialiased;
       background:
         radial-gradient(120% 90% at 0% 0%, #26262c 0%, rgba(38,38,44,0) 55%),
         radial-gradient(90% 80% at 100% 100%, #1b1b20 0%, rgba(27,27,32,0) 60%),
         linear-gradient(160deg,#18181c 0%,#0e0e11 100%)}
  /* a hairline under the title bar, so the art starts on purpose */
  .rule{position:absolute;left:0;right:0;top:0;height:1px;background:rgba(255,255,255,.06)}
  .word{position:absolute;left:40px;top:38px;height:30px}
  .lede{position:absolute;left:41px;top:80px;color:#a1a1aa;font-size:14px;font-weight:450;letter-spacing:-.005em}
  .lede b{color:#e4e4e7;font-weight:550}
  .halo{position:absolute;width:${I + 64}px;height:${I + 64}px;border-radius:50%;transform:translate(-50%,-50%)}
  .halo.app{left:${app.x}px;top:${app.y}px;
    background:radial-gradient(closest-side,rgba(255,116,32,.20),rgba(203,108,230,.12) 55%,rgba(11,79,179,0) 100%)}
  .halo.apps{left:${apps.x}px;top:${apps.y}px;
    background:radial-gradient(closest-side,rgba(92,225,230,.16),rgba(92,225,230,0) 100%)}
  .bar{position:absolute;top:${app.y - 4}px;height:8px;border-radius:4px}
  /* two bars that meet at the point: each turns about its right end,
     which sits on the line the bars run along */
  .head{position:absolute;top:${app.y - 4}px;width:24px;height:8px}
  .head i{position:absolute;left:0;top:0;width:24px;height:8px;border-radius:4px;background:${BARS[6]};transform-origin:20px 4px}
  .head i:first-child{transform:rotate(40deg)}
  .head i:last-child{transform:rotate(-40deg)}
  .plate{position:absolute;height:22px;border-radius:11px;transform:translateX(-50%);
    background:#76767c;box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 1px 2px rgba(0,0,0,.35)}
  /* the crowd: a little uneven, the way people stand, and a soft shadow
     so the faces sit on the window rather than float on it */
  .crowd{position:absolute;left:0;right:0;top:${H - 92}px;display:flex;justify-content:center;gap:9px}
  .face{display:block;width:${FACE}px;height:${FACE}px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.5))}
  .face svg{display:block;width:100%;height:100%}
  .foot{position:absolute;left:0;right:0;bottom:24px;text-align:center;color:#6b6b73;font-size:11.5px;font-weight:450;letter-spacing:.01em}
</style>
<span class="rule"></span>
<img class="word" src="${wordmark}">
<p class="lede">Drag <b>Bloks</b> into <b>Applications</b> to install.</p>
<span class="halo app"></span><span class="halo apps"></span>
${bars}${head}
${plate(app.x, "Bloks")}${plate(apps.x, "Applications")}
<div class="crowd">${crowdSvg}</div>
<p class="foot">Personal AI agents that live on your Mac.</p>`;

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
for (const scale of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const out = path.join(root, "build", scale === 1 ? "dmg-background.png" : "dmg-background@2x.png");
  await page.screenshot({ path: out });
  await page.close();
  console.log(`wrote ${path.relative(root, out)}`);
}
await browser.close();
