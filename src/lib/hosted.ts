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

export type ComputerMode = "cloud" | "sandbox" | "local" | "off";

const MAC_COMPUTERS: ReadonlyArray<readonly [ComputerMode, string]> = [
  ["cloud", "Cloud box"],
  ["sandbox", "Local VM"],
  ["local", "This computer"],
  ["off", "Off"],
];

/** The choices to show: the server's when it sent any, else a Mac's. */
export function computerOptions(fromServer?: Array<{ id: ComputerMode; label: string }> | null): ReadonlyArray<readonly [ComputerMode, string]> {
  return fromServer?.length ? fromServer.map((choice) => [choice.id, choice.label] as const) : MAC_COMPUTERS;
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
  return onBox
    ? "The desktop it can see and click. This engine runs on its cloud box."
    : `The desktop it can see and click. Its commands and files run ${elsewhere ?? `on ${where}`} either way.`;
}

/** Said under the choices when an agent is saved on "This computer" off
 * a Mac, which 3.0.8 offered there. It is kept, not rewritten, and means
 * no screen here. */
export function savedOwnScreenNote(where: string): string {
  return `Saved as This computer by an earlier version. Agents can see and click a computer's own screen only when Bloks runs on a Mac, so this agent has no screen. Its commands and files still run on ${where}. Choose Local VM or Cloud box to give it a screen.`;
}
