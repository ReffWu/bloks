// Codex speed, as the settings and the chat need it.
//
// The server owns the rule (server/codex-speed.ts); the desktop keeps its
// own copy of the few shapes and answers it shows, rather than reaching
// into the server's code. test/codex-speed-shared.test.ts holds the two
// to the same answers.

export type CodexSpeed = "standard" | "fast";

export interface CodexSpeedChoice {
  default: CodexSpeed;
  override: CodexSpeed | null;
  resolved: CodexSpeed;
  source: "workspace" | "agent";
}

/** What a running turn asked for, while it runs. */
export interface CodexSpeedStatus {
  choice: CodexSpeedChoice;
  /** The tier Codex said it configured, or null when it did not say. */
  configuredTier: string | null;
  actualTier: null;
}

export const isCodexSpeed = (value: unknown): value is CodexSpeed => value === "standard" || value === "fast";

/** The same answer as resolveCodexSpeed in server/codex-speed.ts. */
export function resolveCodexSpeed(config: { codex?: { speed?: unknown } }, bot?: { codexSpeed?: unknown } | null): CodexSpeedChoice {
  const workspace = isCodexSpeed(config.codex?.speed) ? config.codex.speed : "standard";
  const override = isCodexSpeed(bot?.codexSpeed) ? bot.codexSpeed : null;
  return { default: workspace, override, resolved: override ?? workspace, source: override ? "agent" : "workspace" };
}

/** The same answer as codexSpeedRoute in server/codex-speed.ts. */
export function codexSpeedRoute(driver: string | undefined, model: string): "native" | "remote" | "not-codex" {
  if (driver === "codex") return "native";
  return driver === "boxAgent" && model.startsWith("gpt") ? "remote" : "not-codex";
}

/** Whether the running turn's speed is worth a line in the chat: Fast,
 * which costs more, or an agent's own choice, which differs from the
 * workspace's. Standard by the workspace default is how Codex always ran,
 * and says nothing. */
export function showsSpeedStatus(status: CodexSpeedStatus | undefined): boolean {
  return Boolean(status && (status.choice.resolved === "fast" || status.choice.source === "agent"));
}

/** The line above a running turn's conversation, or null when there is
 * nothing to say. Codex reports the tier it configured, not the one that
 * served, so the line never claims more than that. */
export function speedStatusLine(status: CodexSpeedStatus | undefined): string | null {
  if (!status || !showsSpeedStatus(status)) return null;
  const speed = status.choice.resolved === "fast" ? "Fast" : "Standard";
  const why = status.choice.source === "agent" ? "this agent" : "workspace default";
  const tier = status.configuredTier ? `, ${status.configuredTier} tier` : "";
  return `Codex speed: ${speed} (${why})${tier}`;
}
