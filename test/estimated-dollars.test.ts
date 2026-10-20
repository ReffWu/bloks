// A dollar figure worked out from tokens is written as an estimate, "~$",
// wherever it shows outside the Usage page too: the Brief, the composer's
// spend line and Activity's "spent where known".
import { test } from "node:test";
import assert from "node:assert/strict";

import { composeBrief } from "../server/brief.ts";
import { assemble as assembleActivity } from "../server/activity.ts";
import { spendPhrase } from "../src/lib/contextCard.ts";

const brief = (spend: { turns: number; cost: number; costKnown: boolean; estimated?: number }) =>
  composeBrief(
    {
      since: Date.now() - 3_600_000,
      now: Date.now(),
      person: "Hamed",
      agents: [],
      waiting: [],
      spend,
      ready: [],
    },
    "b",
  );

test("the Brief writes a cost estimated from tokens with a tilde, and a priced one as before", () => {
  assert.match(brief({ turns: 3, cost: 0.42, costKnown: true, estimated: 0.1 }).parts[0].script, /~\$0\.42, estimated in part/);
  assert.match(brief({ turns: 3, cost: 0.42, costKnown: true }).parts[0].script, /about \$0\.42 where the provider reports a price/);
});

test("the composer's spend line marks an estimate", () => {
  assert.equal(spendPhrase({ turns: 2, input: 1, output: 1, cost: 1.5, estimated: 1.5 }, true), "~$1.50");
  assert.equal(spendPhrase({ turns: 2, input: 1, output: 1, cost: 1.5 }, true), "$1.50");
  assert.equal(spendPhrase({ turns: 2, input: 1, output: 1, cost: 0.001, estimated: 0.001 }, true), "Under ~$0.01");
});

test("Activity's tally carries the estimated part of today's cost", () => {
  const said = assembleActivity({
    paused: [],
    lanes: [],
    routines: new Map(),
    jobs: new Map(),
    workflows: new Map(),
    spend: [
      { botId: "a", turns: 1, input: 10, output: 10, cost: 0.5, estimated: 0.5 },
      { botId: "b", turns: 1, input: 10, output: 10, cost: 0.25 },
    ],
    costKnown: true,
    at: Date.now(),
  } as unknown as Parameters<typeof assembleActivity>[0]);
  assert.equal(said.today.cost, 0.75);
  assert.equal(said.today.estimated, 0.5);
});
