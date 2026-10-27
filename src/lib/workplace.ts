// Where an agent works, as the app says it (server/workplace.ts has the
// shapes). One place for the words, so the header and the settings card
// can never describe the same container two ways.

export type PlaceState = "idle" | "starting" | "ready" | "working" | "stopped" | "removed" | "dropped" | "reconnecting" | "unreachable";

export interface WorkplaceStatus {
  kind: "docker" | "ssh";
  /** "container bloks-scout", "build-box" */
  label: string;
  state: PlaceState;
  detail?: string;
  at: number;
}

export type Workplace =
  | {
      kind: "docker";
      source: "image";
      image: string;
      name: string;
      folder: "mount" | "copy";
      path: string;
      cpus?: number | null;
      memoryGb?: number | null;
      network: boolean;
      idleMinutes: number;
      autoRemove: boolean;
      command?: string | null;
    }
  | { kind: "docker"; source: "container"; name: string; path: string; command?: string | null }
  | { kind: "ssh"; host: string; port?: number | null; path: string; command?: string | null };

/** "in container bloks-scout", "on build-box over SSH" */
export function placePhrase(status: Pick<WorkplaceStatus, "kind" | "label">): string {
  return status.kind === "ssh" ? `on ${status.label} over SSH` : `in ${status.label}`;
}

/** The header's line for an agent that works elsewhere, or null for one
 * on this computer. `busy` is the agent's own: a turn running there. */
export function placeLine(status: WorkplaceStatus | null | undefined, busy: boolean): string | null {
  if (!status) return null;
  const ssh = status.kind === "ssh";
  const name = ssh ? status.label : status.label.replace(/^container /, "");
  switch (status.state) {
    case "starting":
      return ssh ? `Connecting to ${name}` : `Starting container ${name}`;
    case "dropped":
      return ssh ? `Lost ${name}, reconnecting` : `Container ${name} stopped`;
    case "reconnecting":
      return `Reconnecting to ${name}`;
    case "unreachable":
      return ssh ? `Cannot reach ${name}` : `Cannot use container ${name}`;
    case "stopped":
      return busy ? `Starting container ${name}` : `Container ${name} is stopped`;
    case "removed":
      return busy ? `Starting container ${name}` : `Container ${name} starts fresh next time`;
    default:
      return busy ? `Working ${placePhrase(status)}` : `${ssh ? "On" : "In"} ${status.label}${ssh ? " over SSH" : ""}`;
  }
}

/** Whether the line is a problem the person should see as one. */
export function placeTrouble(status: WorkplaceStatus | null | undefined): boolean {
  return Boolean(status && (status.state === "dropped" || status.state === "unreachable" || status.state === "reconnecting"));
}
