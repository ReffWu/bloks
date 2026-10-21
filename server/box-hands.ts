// A person's hands on an agent's cloud computer.
//
// The agent works its box through its own tool (server/computer-proxy.ts).
// This is the person's side of the same box, from the computer view on a
// phone: a tap, some text, a key, a scroll, for the moments only a person
// can get past, like a sign-in or a code sent to their phone. Everything
// is xdotool on the box's display, the fallback the agent's tool uses too,
// because it is always there.
//
// A tap arrives as a fraction of the picture, so it lands on the same spot
// whatever size the picture was drawn at and whatever the box scaled its
// screenshot to.
import type { AppConfig } from "./config.ts";
import { execOnBox } from "./box.ts";

const WITH_DISPLAY = "export DISPLAY=${DISPLAY:-:0}; ";

/** The keys a phone can press, by the names it sends (the same names the
 * browser takes, server/browser-view.ts), as xdotool calls them. */
export const BOX_KEYS: Record<string, string> = {
  Enter: "Return",
  Backspace: "BackSpace",
  Tab: "Tab",
  Escape: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  PageUp: "Prior",
  PageDown: "Next",
};

/** Text as one shell word: the person's words are never a command. */
export function shellWord(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Each box's display, asked once: it does not change under a session. */
const displays = new Map<string, { width: number; height: number }>();

async function display(cfg: AppConfig, botId: string) {
  const known = displays.get(botId);
  if (known) return known;
  const result = await execOnBox(cfg, botId, `${WITH_DISPLAY}xdotool getdisplaygeometry`);
  const parsed = result.stdout.trim().match(/^(\d+)\s+(\d+)/);
  if (!parsed) throw new Error("could not tell the size of the agent's screen");
  const size = { width: Number(parsed[1]), height: Number(parsed[2]) };
  displays.set(botId, size);
  return size;
}

async function run(cfg: AppConfig, botId: string, command: string) {
  const result = await execOnBox(cfg, botId, `${WITH_DISPLAY}${command}`);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim().slice(0, 200) || "the agent's computer did not take that");
}

async function point(cfg: AppConfig, botId: string, fx: number, fy: number) {
  const { width, height } = await display(cfg, botId);
  return { x: Math.round(fx * (width - 1)), y: Math.round(fy * (height - 1)) };
}

export async function boxClick(cfg: AppConfig, botId: string, fx: number, fy: number): Promise<void> {
  const { x, y } = await point(cfg, botId, fx, fy);
  await run(cfg, botId, `xdotool mousemove ${x} ${y} click 1`);
}

export async function boxType(cfg: AppConfig, botId: string, text: string, enter: boolean): Promise<void> {
  const parts = [];
  if (text) parts.push(`xdotool type --delay 12 -- ${shellWord(text)}`);
  if (enter) parts.push("xdotool key Return");
  if (parts.length) await run(cfg, botId, parts.join(" && "));
}

export async function boxKey(cfg: AppConfig, botId: string, name: string): Promise<void> {
  const key = BOX_KEYS[name];
  if (!key) throw new Error("that key cannot be pressed from here");
  await run(cfg, botId, `xdotool key ${key}`);
}

/** The wheel at a spot, a few notches a screenful: up is negative. */
export async function boxScroll(cfg: AppConfig, botId: string, fx: number, fy: number, screens: number): Promise<void> {
  const { x, y } = await point(cfg, botId, fx, fy);
  const notches = Math.max(1, Math.min(30, Math.round(Math.abs(screens) * 5)));
  await run(cfg, botId, `xdotool mousemove ${x} ${y} click --repeat ${notches} ${screens < 0 ? 4 : 5}`);
}
