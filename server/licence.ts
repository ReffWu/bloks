// One Bloks Cloud licence for every workspace on this computer, as a
// workspace's server sees it: its own (typed here, or Personal's from
// before workspaces), else the one the desktop app keeps for all of them
// and hands over as the server starts. The app's side is electron/main.mjs.

/** A Bloks Cloud licence, exactly as bloks.dev mints it. */
export const CLOUD_KEY = /^blok_live_[0-9a-f]{32}$/;

/** The licence a message from the desktop app carries, or null. Anything
 * else on that line is not a licence, whatever it says it is. */
export function licenceFrom(message: unknown): string | null {
  const data = (message as { data?: { kind?: unknown; key?: unknown } } | null)?.data;
  return data?.kind === "licence" && typeof data.key === "string" && CLOUD_KEY.test(data.key) ? data.key : null;
}

/** Which licence puts this workspace online: its own wins, so a person
 * who typed a different one here keeps it; else the app's. */
export function licenceToUse(own: string | null | undefined, shared: string | null | undefined): string | null {
  if (own && CLOUD_KEY.test(own)) return own;
  return shared && CLOUD_KEY.test(shared) ? shared : null;
}
