// An agent's terminal in a window of its own: which agent, and the
// address that window loads. Plain Node, like links.mjs, so the tests can
// read it without starting Electron.
//
// The page asks for one by the agent's id, and an id is all it can ask
// with: anything else in the request is refused rather than pasted into
// an address the window will load.

/** The agent id, if it is one, or null. */
export function terminalAgent(raw) {
  return typeof raw === "string" && /^[\w-]{1,64}$/.test(raw) ? raw : null;
}

/** The query that makes the app's page draw only that agent's terminal
 * (App.tsx), or null for an id that is not one. */
export function terminalQuery(raw) {
  const id = terminalAgent(raw);
  return id ? `terminal=${encodeURIComponent(id)}` : null;
}
