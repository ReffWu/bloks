// Where an agent works, as the app says it (server/workplace.ts has the
// shapes). One place for the words, so the header and the settings card
// can never describe the same container two ways.
import { t } from "./i18n.ts";

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
  return status.kind === "ssh" ? t("workplace.phraseSsh", { name: status.label }) : t("workplace.phraseContainer", { name: placeName(status) });
}

// The server labels a container "container bloks-scout"; the words around
// the name are ours, so they can be said in the reader's language.
function placeName(status: Pick<WorkplaceStatus, "kind" | "label">): string {
  return status.kind === "ssh" ? status.label : status.label.replace(/^container /, "");
}

/** The header's line for an agent that works elsewhere, or null for one
 * on this computer. `busy` is the agent's own: a turn running there. */
export function placeLine(status: WorkplaceStatus | null | undefined, busy: boolean): string | null {
  if (!status) return null;
  const ssh = status.kind === "ssh";
  const name = placeName(status);
  switch (status.state) {
    case "starting":
      return ssh ? t("workplace.connectingTo", { name }) : t("workplace.startingContainer", { name });
    case "dropped":
      return ssh ? t("workplace.lostReconnecting", { name }) : t("workplace.containerStopped", { name });
    case "reconnecting":
      return t("workplace.reconnectingTo", { name });
    case "unreachable":
      return ssh ? t("workplace.cannotReach", { name }) : t("workplace.cannotUseContainer", { name });
    case "stopped":
      return busy ? t("workplace.startingContainer", { name }) : t("workplace.containerIsStopped", { name });
    case "removed":
      return busy ? t("workplace.startingContainer", { name }) : t("workplace.containerStartsFresh", { name });
    default:
      if (busy) return ssh ? t("workplace.workingSsh", { name }) : t("workplace.workingContainer", { name });
      return ssh ? t("workplace.onSsh", { name }) : t("workplace.inContainer", { name });
  }
}

/** Whether the line is a problem the person should see as one. */
export function placeTrouble(status: WorkplaceStatus | null | undefined): boolean {
  return Boolean(status && (status.state === "dropped" || status.state === "unreachable" || status.state === "reconnecting"));
}
