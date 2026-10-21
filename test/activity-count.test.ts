// The rail's counts are asked for on a poll, not on every render.
//
// The rail renders on every frame the event stream brings, and React
// subscribes again whenever it is handed a new subscribe function. Written
// inline, each of those renders dropped the poll and started it over with
// a fresh pair of requests: hundreds a minute while agents worked, each
// one reading every conversation on the server.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const asked: string[] = [];
(globalThis as any).document = { visibilityState: "visible", addEventListener() {} };
mock.method(globalThis, "fetch", async (path: string) => {
  asked.push(path);
  return new Response(JSON.stringify(path.includes("proposals") ? { proposals: [] } : { running: [], waiting: [] }), {
    headers: { "content-type": "application/json" },
  });
});

const { subscribeActivityCount, POLL_MS } = await import("../src/lib/activityCount.ts");

test("subscribing again, as each render can, does not ask again; the poll still does", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  try {
    let off = subscribeActivityCount(() => {});
    assert.deepEqual(asked, ["/api/activity", "/api/skills/proposals"], "the first listener asks at once");
    for (let i = 0; i < 50; i++) {
      off();
      off = subscribeActivityCount(() => {});
    }
    assert.equal(asked.length, 2, "fifty renders later, still the one pair of requests");
    mock.timers.tick(POLL_MS);
    assert.equal(asked.length, 4, "and the poll asks again on time");
    off();
    mock.timers.tick(POLL_MS * 3);
    assert.equal(asked.length, 4, "nobody listening, nobody asking");
  } finally {
    mock.timers.reset();
  }
});
