// The disk image's two hidden files, staged where electron-builder and the
// dmg settings can both name them.
//
// A disk image carries its background and its own icon as hidden files,
// .background.tiff and .VolumeIcon.icns. Finder only shows them to someone
// who shows hidden files, but then they sit in the window's top left, over
// the drag-to-Applications picture. dmgbuild places a file wherever the
// settings say, so electron-builder.yml lists both, below the window, and
// for that the settings need real paths to them. electron-builder makes
// the volume icon in a temporary folder of its own, so it is made here
// instead, from the same build/icon.png, never by hand: a hand-made icon
// is how the app's art once drifted from the mark. Both files are
// generated, and ignored by git.
//
// macOS only; the other platforms build no disk image.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, "build");

// The window's art, drawn from the mark by scripts/render-dmg-background.mjs
// at one and two pixels a point. One TIFF holding both is what Finder
// wants: it picks the sharp one on a Retina screen.
execFileSync("tiffutil", [
  "-cathidpicheck",
  path.join(build, "dmg-background.png"),
  path.join(build, "dmg-background@2x.png"),
  "-out",
  path.join(build, "background.tiff"),
]);

// the volume icon, from the app icon, at every size an .icns holds
const work = mkdtempSync(path.join(tmpdir(), "bloks-volume-"));
const set = path.join(work, "volume.iconset");
mkdirSync(set);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = size * scale;
    const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
    execFileSync("sips", ["-z", String(px), String(px), path.join(build, "icon.png"), "--out", path.join(set, name)], { stdio: "ignore" });
  }
}
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(build, "volume.icns")]);
rmSync(work, { recursive: true, force: true });
