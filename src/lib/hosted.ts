// Where an agent may act, as the computer settings offer it.
//
// The agent's settings card and the Computer panel both list these, and
// they must never disagree, so both read this. On a Mac it is the four
// homes the app has always offered. A hosted workspace sends its own,
// shorter list (server/hosted.ts): this machine and off, since the
// machine is the agents' computer already and a box or a VM would be a
// computer inside it. Windows and Linux send three: their own screen is
// not something an agent can work there.
//
// Every one of them is a screen the agent can see and click. None is
// where the agent runs: its engine, its commands and its files are on
// the machine Bloks runs on whichever is picked (GitHub 388), and the
// words beside the choices say so.
import { t, type MessageKey } from "./i18n.ts";

export type ComputerMode = "cloud" | "sandbox" | "local" | "off";

// Keys, not words, so the list reads in the language it is drawn in.
const MAC_COMPUTERS: ReadonlyArray<readonly [ComputerMode, MessageKey]> = [
  ["cloud", "hosted.computer.cloud"],
  ["sandbox", "hosted.computer.sandbox"],
  ["local", "hosted.computer.local"],
  ["off", "hosted.computer.off"],
];

/** The choices to show: the server's when it sent any, else a Mac's. The
 * server's labels are its own words and are shown as they came. */
export function computerOptions(fromServer?: Array<{ id: ComputerMode; label: string }> | null): ReadonlyArray<readonly [ComputerMode, string]> {
  return fromServer?.length
    ? fromServer.map((choice) => [choice.id, choice.label] as const)
    : MAC_COMPUTERS.map(([mode, key]) => [mode, t(key)] as const);
}

/** Whether an agent can be given the computer Bloks runs on. Off a Mac
 * the server leaves "This computer" out, since nothing there can work
 * its screen (GitHub 377), so Automatic must not promise it either. */
export function offersThisComputer(fromServer?: Array<{ id: ComputerMode; label: string }> | null): boolean {
  return computerOptions(fromServer).some(([mode]) => mode === "local");
}

/** What turning Automatic off picks first: this computer where it is
 * offered, else Off. 3.0.9 picked the Local VM off a Mac, so turning
 * Automatic off sent the agent to a VM that may never have been set up
 * (GitHub 388). Off changes nothing about where it runs. */
export function firstPickedComputer(fromServer?: Array<{ id: ComputerMode; label: string }> | null): ComputerMode {
  return offersThisComputer(fromServer) ? "local" : "off";
}

/** What the Computer setting is, said beside it, so it never reads as
 * where the agent runs (GitHub 388). `where` is this machine's name, as
 * thisComputer() gives it. An agent on the cloud engine runs on its box,
 * and is told so instead. */
export function computerMeaning(where: string, onBox: boolean, elsewhere?: string | null): string {
  if (onBox) return t("hosted.meaning.onBox");
  return elsewhere ? t("hosted.meaning.elsewhere", { place: elsewhere }) : t("hosted.meaning.here", { where });
}

/** Said under the choices when an agent is saved on "This computer" off
 * a Mac, which 3.0.8 offered there. It is kept, not rewritten, and means
 * no screen here. */
export function savedOwnScreenNote(where: string): string {
  return t("hosted.savedOwnScreen", { where });
}
