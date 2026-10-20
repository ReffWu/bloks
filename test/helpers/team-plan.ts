// A licence on Bloks Team, as far as a harness can tell: a local stand-in
// for bloks.dev's hosting status (what server/owner-plan.ts asks about a
// licence when the workspace is not online), and the licence to ask with.
// Members are Team's, so any test that lets people into a workspace runs
// with one of these; `setTeam(false)` is the plan lapsing.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const TEAM_LICENCE = `blok_live_${"7".repeat(32)}`;

export async function teamPlan(team = true) {
  const state = { team, asked: 0 };
  const server = createServer((req, res) => {
    if (req.url === "/api/hosting/status") {
      state.asked++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ team: state.team }));
      return;
    }
    // the credits service beside it is not part of any test here
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    /** For startHarness: where the licence is checked. */
    env: { BLOKS_CREDITS_URL: `${base}/api/ai` },
    /** For config.json: the licence the workspace holds. */
    config: { credits: { licence: TEAM_LICENCE } },
    setTeam(on: boolean) {
      state.team = on;
    },
    asked: () => state.asked,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
