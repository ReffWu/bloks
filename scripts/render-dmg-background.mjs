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
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** In points. electron-builder.yml's dmg window, iconSize and contents
 * repeat these numbers. */
export const LAYOUT = {
  width: 660,
  height: 420,
  icon: 100,
  app: { x: 180, y: 244 },
  apps: { x: 480, y: 244 },
};

// The mark's colours, in the order its bars spiral in.
const BARS = ["#0b4fb3", "#5ce1e6", "#7ed957", "#ffbd59", "#ff7420", "#ff5757", "#cb6ce6"];

const asData = (file, type) => `data:${type};base64,${readFileSync(file).toString("base64")}`;
// the wordmark with light letters, for a dark ground
const wordmark = asData(path.join(root, "public", "brand", "bloks-wordmark-dark.png"), "image/png");
const inter = asData(path.join(root, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2"), "font/woff2");

const { width: W, height: H, icon: I, app, apps } = LAYOUT;

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
  .foot{position:absolute;left:0;right:0;bottom:22px;text-align:center;color:#6b6b73;font-size:11.5px;font-weight:450;letter-spacing:.01em}
</style>
<span class="rule"></span>
<img class="word" src="${wordmark}">
<p class="lede">Drag <b>Bloks</b> into <b>Applications</b> to install.</p>
<span class="halo app"></span><span class="halo apps"></span>
${bars}${head}
${plate(app.x, "Bloks")}${plate(apps.x, "Applications")}
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
