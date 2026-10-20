// What the app says about Bloks credits, kept apart from the screens so it
// can be held to what the server sends (server/credits.ts).
//
// Nothing here prices anything. The balance, its currency and what counts
// as low are the service's; this only says them, and says whether an
// agent's runs are paid from them, which is what decides whether a
// refusal for an empty balance is this agent's business.

export const CREDITS_ENGINE = "bloks";

interface EngineLike {
  instanceId: string;
  driverKind: string;
}

interface AgentLike {
  modelSelection?: { instanceId: string } | null;
  engineAccess?: "credits" | null;
}

/** Whether this agent's runs spend credits: the Bloks engine, or Claude
 * Code with its access set to credits. */
export function runsOnCredits(bot: AgentLike, instances: EngineLike[]): boolean {
  const id = bot.modelSelection?.instanceId;
  if (!id) return false;
  if (id === CREDITS_ENGINE) return true;
  const engine = instances.find((i) => i.instanceId === id);
  return engine?.driverKind === "claudeAgent" && bot.engineAccess === "credits";
}

export interface CreditsRefusal {
  at: number;
  message: string;
}

/**
 * The refusal to show in this agent's composer, or null: one standing,
 * on an agent that spends credits, and not one the person already put
 * away. A later refusal is a new one and shows again.
 */
export function refusalToShow(
  refused: CreditsRefusal | null | undefined,
  onCredits: boolean,
  dismissedAt: number | null,
): CreditsRefusal | null {
  if (!refused || !onCredits) return null;
  if (dismissedAt !== null && dismissedAt >= refused.at) return null;
  return refused;
}

/** A balance as the service gave it, in its own currency. */
export function balanceText(balance: number, currency: string | null | undefined, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD" }).format(balance);
  } catch {
    return `${balance.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** What the balance line says under the number. */
export function balanceNote(status: { low: boolean; autoReload: boolean }): string | null {
  if (status.autoReload) return "Tops itself up when it runs low.";
  if (status.low) return "Running low.";
  return null;
}
