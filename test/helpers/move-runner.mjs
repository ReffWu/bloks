// A move carried by a process of its own, so a test can kill it in the
// middle of sending, the way a quit or a crash ends the app, and carry
// the same move on from what it kept on disk (test/hosting-move.test.ts).
//
// Reads MOVE_START (a move, as JSON), MOVE_SOURCE, MOVE_TARGET and
// MOVE_STATE, where it keeps the move as it goes. Each part waits a
// moment first, so there is a middle to be killed in.
import { writeFileSync, renameSync } from "node:fs";

import { runMove } from "../../electron/hosting-move.mjs";

const state = process.env.MOVE_STATE;
const start = JSON.parse(process.env.MOVE_START ?? "null");
if (!state || !start) throw new Error("move-runner needs MOVE_START and MOVE_STATE");

await runMove(start, {
  source: () => process.env.MOVE_SOURCE,
  target: () => process.env.MOVE_TARGET,
  lanes: 1,
  onPart: () => new Promise((resolve) => setTimeout(resolve, 400)),
  save: (move) => {
    writeFileSync(`${state}.tmp`, JSON.stringify(move));
    renameSync(`${state}.tmp`, state);
  },
});
