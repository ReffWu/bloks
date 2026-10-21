// Hand-written twin of the parts of remote.mjs the tests use, so they
// typecheck against the same shapes the main process uses.

export interface RemoteProfile {
  relayUrl: string;
  relayToken: string;
  deviceId: string;
  deviceToken: string;
  host?: string;
}

export function startRemoteProxy(
  profile: RemoteProfile,
  options?: { staticDir?: string; port?: number; onState?: (state: Record<string, unknown>) => void; client?: string },
): Promise<{ port: number; stop: () => void }>;

export interface JoinedProfile {
  relayUrl?: string | null;
  relayToken?: string | null;
  deviceId: string;
  deviceToken: string;
  lan?: string | null;
}

/** The two keys a paired device seals and opens with, from its token. */
export function deviceKeys(deviceToken: string): { seal: Buffer; open: Buffer };

/** Spends a pairing link on this app; answers the profile to keep. */
export function claimPairLink(link: string, name: string): Promise<RemoteProfile & { host: string }>;

/** The most a request's body may be through Bloks Cloud. */
export const MAX_REQUEST_BYTES: number;

/** Where a hosted workspace's desktop answers from outside, or null. */
export function doorOf(value: unknown): string | null;

/** A pairing link's fragment, or null when it is not one. */
export function parsePairLink(link: string): { relayUrl: string; relayToken: string; linkId: string; secret: string; host: string } | null;

export function reachOf(profile: Partial<JoinedProfile> | null | undefined): "relay" | "lan" | null;

export function startLanProxy(
  profile: JoinedProfile,
  options?: { staticDir?: string; port?: number; client?: string; fetcher?: typeof fetch },
): Promise<{ port: number; stop: () => void }>;
