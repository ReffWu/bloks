// The helper an update hands over to (server/server-update.ts).
//
// Started by the server that is stopping, in a session of its own so it
// outlives that server, with the environment the next server should
// have. It reads its orders, waits for the old server to go, switches
// versions, starts the new one and sees it answer, or switches back and
// starts the old one again. Then it exits, and the server it started
// carries on without it.
//
// Its own entry file rather than a mode of the server or of bin/, for the
// reason permission-proxy.ts gives: an entry point that dispatched on
// argv would be one bad argument away from a process starting copies of
// itself.
import { readFileSync, rmSync } from "node:fs";

import { finishUpdate, type UpdatePlan } from "./server-update.ts";

const planFile = process.argv[2] ?? "";
let plan: UpdatePlan;
try {
  plan = JSON.parse(readFileSync(planFile, "utf8")) as UpdatePlan;
} catch {
  console.error("[bloks update] no orders to follow, so nothing was changed");
  process.exit(1);
}
// read once: a second helper on the same orders would switch twice
rmSync(planFile, { force: true });
try {
  await finishUpdate(plan);
} catch (e) {
  console.error(`[bloks update] stopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
process.exit(0);
