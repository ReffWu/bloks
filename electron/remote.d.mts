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

export function reachOf(profile: Partial<JoinedProfile> | null | undefined): "relay" | "lan" | null;

export function startLanProxy(
  profile: JoinedProfile,
  options?: { staticDir?: string; port?: number; client?: string; fetcher?: typeof fetch },
): Promise<{ port: number; stop: () => void }>;
