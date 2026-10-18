// Codex speed: Standard or Fast, for the workspace and per agent.
//
// Standard is Codex as it always was here: Bloks says nothing about the
// tier, so a Codex that has never heard of one runs exactly as before.
// Fast asks for the priority tier, and only a Codex that confirms it gets
// the message: Fast costs more, so a Codex that quietly ran Standard, or
// one that cannot be asked at all, must not be mistaken for Fast.
//
// Settings, dispatch and the remote driver share these. No provider calls.
// The desktop keeps its own copy of the pure parts (src/lib/codexSpeed.ts),
// held to the same answers by test/codex-speed-shared.test.ts.

export type CodexSpeed = "standard" | "fast";

export interface CodexSpeedChoice {
  /** The workspace default. */
  default: CodexSpeed;
  /** This agent's own choice, or null to follow the workspace. */
  override: CodexSpeed | null;
  /** What a turn dispatched now would use. */
  resolved: CodexSpeed;
  source: "workspace" | "agent";
}

/** What the running turn asked for, while it runs. Never a message. */
export interface CodexSpeedStatus {
  choice: CodexSpeedChoice;
  /** The tier Codex said it configured, or null when it did not say. */
  configuredTier: string | null;
  /** Codex reports the configured tier, never the one that served. */
  actualTier: null;
}

/** The tier Fast asks Codex for. */
export const FAST_TIER = "priority";

export const isCodexSpeed = (value: unknown): value is CodexSpeed => value === "standard" || value === "fast";

/** The speed a turn uses: the agent's own choice, else the workspace's,
 * else Standard. Anything malformed reads as unset. */
export function resolveCodexSpeed(config: { codex?: { speed?: unknown } }, bot?: { codexSpeed?: unknown } | null): CodexSpeedChoice {
  const workspace = isCodexSpeed(config.codex?.speed) ? config.codex.speed : "standard";
  const override = isCodexSpeed(bot?.codexSpeed) ? bot.codexSpeed : null;
  return { default: workspace, override, resolved: override ?? workspace, source: override ? "agent" : "workspace" };
}

/** Whether a selection is Codex this computer drives, Codex on a Box or
 * Boat (gpt models there run Codex), or not Codex at all. */
export function codexSpeedRoute(driver: string | undefined, model: string): "native" | "remote" | "not-codex" {
  if (driver === "codex") return "native";
  return driver === "boxAgent" && model.startsWith("gpt") ? "remote" : "not-codex";
}

/** Box and Boat cannot ask their Codex for a tier yet. Standard runs
 * there as it always did; Fast is refused rather than run as Standard. */
export const REMOTE_FAST_REASON = "Fast is not available for Codex on a Box or Boat engine yet. Choose Standard for this agent to use it there.";

export interface CodexSpeedRefusal {
  kind: "codex-speed";
  reason: string;
}

/** Fast was asked for and could not be had. Thrown before the words reach
 * the model, so the message is unsent rather than lost or run slower. */
export class CodexSpeedUnavailable extends Error {
  readonly refusal: CodexSpeedRefusal;
  constructor(reason: string) {
    super(`The message was not sent to this engine: ${reason}`);
    this.name = "CodexSpeedUnavailable";
    this.refusal = { kind: "codex-speed", reason: this.message };
  }
}

const NOT_FAST = "This Codex did not confirm Fast. It may be too old to offer it (update Codex), or a managed policy may turn Fast off. Choose Standard to send this message as usual.";

/** Fast goes ahead only on a thread/start or thread/resume answer that
 * names the priority tier. */
export function requireFastTier(response: unknown): void {
  if (!response || typeof response !== "object" || (response as { serviceTier?: unknown }).serviceTier !== FAST_TIER) {
    throw new CodexSpeedUnavailable(NOT_FAST);
  }
}

/** A Fast thread/start or thread/resume that Codex refused over the tier,
 * said as a refusal with its remedy. Anything else is left alone. */
export function fastRefusal(error: unknown): CodexSpeedUnavailable | null {
  if (error instanceof CodexSpeedUnavailable) return error;
  const message = error instanceof Error ? error.message : String(error);
  // the older resume field has its own fallback, which Fast keeps
  if (/exclude_?turns/i.test(message) && !/service[_ -]?tier|fast[_ -]?mode/i.test(message)) return null;
  if (!/service[_ -]?tier|fast[_ -]?mode|unknown field|unknown variant/i.test(message)) return null;
  return new CodexSpeedUnavailable(`${NOT_FAST} (Codex said: ${message})`);
}
