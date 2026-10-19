// Check-ins in the routine editor and on the calendar: the editor says no
// to what the server would refuse, a check-in is one band with a tick per
// run rather than a card per run, and a stretch of quiet runs is one row.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHECK_IN_EVERY,
  checkInBand,
  checkInProblem,
  dateKey,
  everyMinutes,
  foldQuietRuns,
  intervalLabel,
  intervalPhrase,
  intervalShort,
  nextRuns,
  runsOnDay,
  type DraftSchedule,
} from "../src/lib/checkIns.ts";
import { checkInsOn, nextScheduledAfter, type Routine } from "../server/routines.ts";

test("the editor reads an interval in minutes or hours, within the server's bounds", () => {
  assert.equal(everyMinutes("30", "min"), 30);
  assert.equal(everyMinutes("2", "hour"), 120);
  assert.equal(everyMinutes("1.5", "hour"), 90);
  assert.equal(everyMinutes("", "min"), null);
  assert.equal(everyMinutes("soon", "min"), null);
  assert.equal(everyMinutes("-5", "min"), null);

  assert.equal(checkInProblem(30, { from: "09:00", to: "18:00" }), null);
  assert.equal(checkInProblem(1440, null), null);
  assert.match(checkInProblem(10, null) ?? "", /15 minutes/);
  assert.match(checkInProblem(25 * 60, null) ?? "", /24 hours/);
  assert.match(checkInProblem(null, null) ?? "", /15 minutes/);
  assert.match(checkInProblem(30, { from: "18:00", to: "09:00" }) ?? "", /End time must be after start time\./);
  assert.match(checkInProblem(30, { from: "09:00", to: "09:00" }) ?? "", /End time must be after start time\./);
});

test("a check-in is one band over its hours, with a tick for each run the column draws", () => {
  const halfHourly = { every: 30, activeHours: { from: "09:00", to: "18:00" } };
  const band = checkInBand(halfHourly, 6, 23)!;
  assert.equal(band.top, 3 * 60, "starts three hours below a 6:00 top");
  assert.equal(band.height, 9 * 60);
  assert.equal(band.ticks.length, 19);
  assert.equal(band.ticks[0], 0);
  assert.equal(band.ticks[18], 9 * 60);

  // its ticks are the server's own slots, so the calendar and the
  // scheduler never disagree about when it runs
  const day = new Date(2026, 2, 17);
  const slots = checkInsOn({ ...halfHourly, days: [] }, day).map((at) => at.getHours() * 60 + at.getMinutes() - 9 * 60);
  assert.deepEqual(band.ticks, slots);

  // all day is clipped to what the column draws
  const allDay = checkInBand({ every: 120 }, 6, 23)!;
  assert.equal(allDay.top, 0);
  assert.equal(allDay.height, 17 * 60);
  assert.deepEqual(allDay.ticks, [0, 120, 240, 360, 480, 600, 720, 840, 960]);

  // hours the column does not draw leave nothing to draw
  assert.equal(checkInBand({ every: 30, activeHours: { from: "01:00", to: "05:00" } }, 6, 23), null);
  assert.equal(checkInBand({}, 6, 23), null, "a time of day is a card, not a band");
});

test("an interval fits a month cell in a few characters", () => {
  assert.equal(intervalShort(30), "30m");
  assert.equal(intervalShort(90), "90m");
  assert.equal(intervalShort(120), "2h");
  assert.equal(intervalShort(1440), "24h");
});

test("a stretch of quiet runs is one row in the history, between the runs that said something", () => {
  const runs = [
    { id: "a", quiet: true },
    { id: "b", quiet: true },
    { id: "c" },
    { id: "d", quiet: true },
    { id: "e" },
    { id: "f" },
  ];
  assert.deepEqual(
    foldQuietRuns(runs).map((row) => ("quiet" in row ? row.quiet.map((r) => r.id).join("") : row.run.id)),
    ["ab", "c", "d", "e", "f"],
  );
  assert.deepEqual(foldQuietRuns([]), []);
});

test("the editor's next runs are the scheduler's own, for every shape a routine can take", () => {
  // a Tuesday morning, so today, tomorrow and the weekend all come up
  const now = new Date(2026, 2, 17, 10, 20);
  const shapes: DraftSchedule[] = [
    { days: [1, 2, 3, 4, 5], time: "09:00" },
    { days: [5], time: "16:00" },
    { days: [], time: "23:30" },
    { days: [1, 2, 3, 4, 5], time: "09:00", every: 60, activeHours: { from: "09:00", to: "18:00" } },
    { days: [0, 6], time: "00:00", every: 240 },
  ];
  for (const shape of shapes) {
    const runs = nextRuns(shape, now, 3);
    assert.equal(runs.length, 3);
    // each one is the very next the server would pick after the one before
    const routine = { id: "r", targetId: "a", targetKind: "agent", prompt: "p", enabled: true, ...shape, repeat: undefined } as Routine;
    let after = now;
    for (const at of runs) {
      assert.equal(at.getTime(), nextScheduledAfter(routine, after)?.getTime(), JSON.stringify(shape));
      after = at;
    }
  }
});

test("a once runs on its day and never again, and one already past has no next run", () => {
  const now = new Date(2026, 2, 17, 10, 20);
  const later = nextRuns({ days: [], time: "09:00", repeat: "once", date: "2026-03-30" }, now, 3);
  assert.equal(later.length, 1);
  assert.equal(dateKey(later[0]), "2026-03-30");
  assert.deepEqual(nextRuns({ days: [], time: "09:00", repeat: "once", date: "2026-03-17" }, now, 3), []);
  assert.equal(nextRuns({ days: [], time: "11:00", repeat: "once", date: "2026-03-17" }, now, 3).length, 1);
  // a day draws its runs, or none
  assert.deepEqual(runsOnDay({ days: [5], time: "16:00" }, new Date(2026, 2, 20)), [16 * 60]);
  assert.deepEqual(runsOnDay({ days: [5], time: "16:00" }, new Date(2026, 2, 19)), []);
});

test("an interval reads short under a slider and whole in a sentence", () => {
  assert.equal(intervalLabel(15), "15 min");
  assert.equal(intervalLabel(60), "1 hr");
  assert.equal(intervalLabel(180), "3 hrs");
  assert.equal(intervalLabel(1440), "1 day");
  assert.equal(intervalPhrase(30), "every 30 min");
  assert.equal(intervalPhrase(60), "every hour");
  assert.equal(intervalPhrase(120), "every 2 hours");
  assert.equal(intervalPhrase(1440), "once a day");
  for (const every of CHECK_IN_EVERY) assert.equal(checkInProblem(every, null), null, `${every} is a stop the server takes`);
});
