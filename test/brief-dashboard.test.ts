// The morning brief as a daily dashboard (GitHub 378): it leads with what
// the routines and watchers the person set up reported, the person
// arranges it, and it is the one notification of the morning.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  arrangeSections,
  briefNotice,
  briefSettings,
  composeBrief,
  excerpt,
  parseLayout,
  routineResult,
  watcherResult,
  type BriefResult,
  type RoutineSource,
} from "../server/brief.ts";
import { briefNotice as desktopBrief, desktopNotice, noticeKey } from "../server/desktop-notice.ts";
import { briefNoticeFor } from "../src/lib/notify.ts";
import { layoutOf, moveSection, toggleHidden, togglePin, type LayoutSection } from "../src/lib/briefLayout.ts";

const hour = 60 * 60 * 1000;
const now = new Date(2026, 9, 23, 9, 0).getTime();
const since = now - 14 * hour;

describe("arranging the sections", () => {
  const available = ["routine:health", "routine:github", "watcher:feed", "waiting", "failed", "agents", "memory"];
  const none = parseLayout(undefined);

  test("nothing arranged is the default order, nothing pinned or hidden", () => {
    const out = arrangeSections(available, none);
    assert.deepEqual(out.map((s) => s.key), available);
    assert.ok(out.every((s) => !s.pinned && !s.hidden));
    // someone with no routines or watchers sees the brief's own order,
    // which is the order it always had
    assert.deepEqual(arrangeSections(["waiting", "failed", "agents", "memory"], none).map((s) => s.key), ["waiting", "failed", "agents", "memory"]);
  });

  test("the person's order is kept, and pinned sections come first in it", () => {
    const layout = parseLayout({ order: ["agents", "waiting", "routine:github", "routine:health", "watcher:feed", "failed", "memory"], pinned: ["routine:health"], hidden: ["memory"] });
    const out = arrangeSections(available, layout);
    assert.deepEqual(out.map((s) => s.key), ["routine:health", "agents", "waiting", "routine:github", "watcher:feed", "failed", "memory"]);
    assert.equal(out[0].pinned, true);
    assert.equal(out.find((s) => s.key === "memory")!.hidden, true, "hidden is said, not dropped, so it can be offered back");
  });

  test("a routine made since joins the other cards, not the bottom of the page", () => {
    const layout = parseLayout({ order: ["waiting", "routine:health", "failed", "agents", "memory"] });
    const out = arrangeSections(["routine:health", "routine:new", "waiting", "failed", "agents", "memory"], layout);
    assert.deepEqual(out.map((s) => s.key), ["waiting", "routine:health", "routine:new", "failed", "agents", "memory"]);
  });

  test("a routine that is gone drops out of the order without moving the rest", () => {
    const layout = parseLayout({ order: ["routine:gone", "agents", "waiting"], pinned: ["routine:gone"] });
    const out = arrangeSections(["waiting", "agents"], layout);
    assert.deepEqual(out.map((s) => s.key), ["agents", "waiting"]);
    assert.ok(!out.some((s) => s.pinned));
  });

  test("a layout from a file edited by hand keeps only real section keys", () => {
    const layout = parseLayout({ order: ["waiting", "waiting", 7, "../etc", "routine:ok-1", "routine:"], pinned: "agents", hidden: [null, "memory"] });
    assert.deepEqual(layout, { order: ["waiting", "routine:ok-1"], pinned: [], hidden: ["memory"] });
    assert.deepEqual(parseLayout("nonsense"), { order: [], pinned: [], hidden: [] });
  });
});

describe("the settings, read with their defaults", () => {
  test("on, at eight, one notification on a morning with news, nothing arranged", () => {
    assert.deepEqual(briefSettings(undefined), { enabled: true, time: "08:00", notify: true, allClear: false, layout: { order: [], pinned: [], hidden: [] } });
    const kept = briefSettings({ enabled: false, time: "07:15", notify: false, allClear: true, layout: { order: ["agents"], pinned: [], hidden: [] } });
    assert.equal(kept.time, "07:15");
    assert.equal(kept.notify, false);
    assert.equal(kept.allClear, true);
    assert.deepEqual(kept.layout.order, ["agents"]);
  });
});

describe("the one notification", () => {
  const news = { id: "b1", headline: "2 reports in, nothing waiting on you.", quiet: false };
  const quiet = { id: "b2", headline: "A quiet night: nothing new, and nothing waiting on you.", quiet: true };

  test("a morning with news notifies once, with what came in", () => {
    assert.deepEqual(briefNotice(news, { notify: true, allClear: false }), { title: "Your morning brief is ready", body: news.headline });
  });

  test("a quiet morning says nothing unless the person asked to hear all is clear", () => {
    assert.equal(briefNotice(quiet, { notify: true, allClear: false }), null);
    assert.match(briefNotice(quiet, { notify: true, allClear: true })!.body, /^All clear/);
  });

  test("turned off, it never notifies, whatever came in", () => {
    assert.equal(briefNotice(news, { notify: false, allClear: true }), null);
  });

  test("a background workspace's banner opens that brief, as news not a question", () => {
    const frame = { kind: "brief.ready", id: "b1", title: "Your morning brief is ready", body: news.headline };
    const notice = desktopBrief(frame)!;
    assert.equal(notice.level, "activity", "a workspace set to notify only when it needs you keeps it to the page");
    assert.equal(notice.target, "brief:b1");
    assert.deepEqual(desktopNotice(frame, { bot: () => null, room: () => null, goalRunning: () => false }), notice);
    assert.equal(noticeKey(frame), "brief:b1", "the same brief twice is said once");
    assert.equal(desktopBrief({ kind: "brief.ready" }), null);
  });

  test("the window on screen says it, except while Overview is in front of you", () => {
    const frame = { id: "b1", title: "Your morning brief is ready", body: "2 reports in." };
    assert.deepEqual(briefNoticeFor(frame, { focused: true, onOverview: false }), { title: "Your morning brief is ready", body: "2 reports in.", target: "brief:b1", urgent: false });
    assert.equal(briefNoticeFor(frame, { focused: true, onOverview: true }), null);
    assert.ok(briefNoticeFor(frame, { focused: false, onOverview: true }), "Overview behind another app is not in front of you");
  });
});

describe("a routine's card", () => {
  const base: RoutineSource = { id: "r1", name: "Home Lab Health", botId: "a1", agent: "Sentry", runs: [] };
  const report = "⛔️ 0 errors | ⚠️ 2 warnings | ℹ️ 3 info\n\n- Docker & Apps: warning\n- Home Assistant: warning";

  test("its report, as the agent wrote it, when it reported this morning", () => {
    const at = now - hour;
    const r = routineResult({ ...base, runs: [{ startedAt: at - 60_000, endedAt: at, state: "ok", summary: report.slice(0, 300), threadId: "t1" }], lastReport: { at, summary: report }, lastRunAt: at - 60_000, dueAt: at - 60_000 }, since, now);
    assert.equal(r.state, "reported");
    assert.equal(r.text, report, "the whole report, not the run's short summary, lists and tally kept");
    assert.equal(r.fresh, true);
    assert.equal(r.threadId, "t1");
    assert.equal(r.key, "routine:r1");
  });

  test("a report from before the brief's stretch of time is not this morning's", () => {
    const at = since - 10 * hour;
    const r = routineResult({ ...base, runs: [{ startedAt: at, endedAt: at, state: "ok", summary: "Old" }], lastReport: { at, summary: "Old" }, lastRunAt: at }, since, now);
    assert.equal(r.state, "reported");
    assert.equal(r.fresh, false);
  });

  test("a run that was due and did not happen is a gap, said with when it was due", () => {
    const old = since - 10 * hour;
    const due = now - 2 * hour;
    const r = routineResult({ ...base, runs: [{ startedAt: old, endedAt: old, state: "ok", summary: "Yesterday's" }], lastReport: { at: old, summary: "Yesterday's" }, lastRunAt: old, dueAt: due }, since, now);
    assert.equal(r.state, "late");
    assert.equal(r.dueAt, due);
    assert.equal(r.text, "Yesterday's", "what was known is kept, as the earlier run's");
    assert.equal(r.at, old);
    // due a moment ago is on its way, not late
    assert.equal(routineResult({ ...base, lastRunAt: old, dueAt: now - 60_000 }, since, now).state, "none");
  });

  test("failed and quiet runs say so; a run that went fine never says healthy", () => {
    const at = now - hour;
    const failed = routineResult({ ...base, runs: [{ startedAt: at, endedAt: at, state: "failed", error: "The engine is out of credits." }], lastRunAt: at, dueAt: at }, since, now);
    assert.equal(failed.state, "failed");
    assert.equal(failed.error, "The engine is out of credits.");
    const quiet = routineResult({ ...base, runs: [{ startedAt: at, endedAt: at, state: "ok", quiet: true }], lastRunAt: at, dueAt: at }, since, now);
    assert.equal(quiet.state, "quiet");
    assert.equal(quiet.text, undefined);
    const stopped = routineResult({ ...base, failing: { at, error: "kept failing" }, runs: [], lastRunAt: at }, since, now);
    assert.equal(stopped.state, "failed");
  });

  test("a long report is cut where a line ends, and says there is more", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `- item ${i} is something to read`).join("\n");
    const cut = excerpt(lines);
    assert.equal(cut.more, true);
    assert.ok(cut.text.length <= 700);
    assert.match(cut.text, /is something to read$/, "never half a line");
  });
});

describe("a watcher's card", () => {
  test("a change this morning, with what its agent said about it", () => {
    const fired = now - 3 * hour;
    const r = watcherResult({ id: "w1", name: "GitHub tracker", botId: "a2", agent: "Ivy", fires: [{ at: fired, summary: "2 new entries" }], lastCheck: now - hour, reply: { text: "1 reply needed on #12.", at: fired + 30_000, threadId: "t2" } }, since, now);
    assert.equal(r.state, "changed");
    assert.equal(r.text, "1 reply needed on #12.");
    assert.equal(r.threadId, "t2");
  });

  test("an unchanged item is not new activity because the watcher looked again", () => {
    const r = watcherResult({ id: "w1", name: "GitHub tracker", botId: "a2", agent: "Ivy", fires: [{ at: since - 30 * hour, summary: "old" }], lastCheck: now - hour }, since, now);
    assert.equal(r.state, "unchanged");
    assert.equal(r.checkedAt, now - hour);
  });

  test("a look that failed since its last change is where it stands", () => {
    const r = watcherResult({ id: "w1", name: "Feed", botId: "a2", agent: "Ivy", fires: [], lastCheck: now - hour, lastError: "The feed did not load." }, since, now);
    assert.equal(r.state, "failed");
    assert.equal(r.error, "The feed did not load.");
  });
});

describe("a brief that leads with outcomes", () => {
  const card = (over: Partial<BriefResult>): BriefResult => ({ key: "routine:r1", kind: "routine", id: "r1", name: "Home Lab Health", state: "reported", text: "⛔️ 0 | ⚠️ 2 | ℹ️ 3. No action needed.", at: now - hour, fresh: true, ...over });
  const input = {
    since,
    now,
    agents: [{ id: "a1", name: "Scout", lanes: [{ threadId: "t1", title: "General", messages: [
      { at: now - 3 * hour, role: "user" as const, kind: "text", text: "Hi" },
      { at: now - 3 * hour + 1, role: "bot" as const, kind: "text", text: "Hello there." },
    ] }] }],
    waiting: [],
    spend: { turns: 1, cost: 0, costKnown: false },
  };

  test("the headline is what came in and what is owed, not who talked", () => {
    const brief = composeBrief({ ...input, results: [card({}), card({ key: "watcher:w1", kind: "watcher", id: "w1", name: "GitHub tracker", state: "changed", text: "1 reply needed." })] }, "b");
    assert.equal(brief.headline, "2 reports in, nothing waiting on you.");
    // a sentence a card, said in the opening of the round
    assert.match(brief.parts[0].script, /2 reports in, nothing waiting on you\. Home Lab Health: ⛔️ 0 ⚠️ 2 ℹ️ 3\. GitHub tracker: 1 reply needed\./);
    assert.equal(brief.results?.length, 2);
    assert.equal(brief.quiet, false);
  });

  test("a report that did not come in is said in the headline", () => {
    const brief = composeBrief({ ...input, agents: [], results: [card({ state: "late", text: undefined, dueAt: now - 2 * hour })] }, "b");
    assert.equal(brief.headline, "No new reports, 1 report missing, nothing waiting on you.");
    assert.equal(brief.quiet, false, "a gap is news: the morning it is missing is the morning to say so");
  });

  test("quiet and unchanged cards, and old ones, are a quiet morning", () => {
    const brief = composeBrief({ ...input, agents: [], results: [card({ state: "quiet", text: undefined }), card({ key: "routine:r2", fresh: false })] }, "b");
    assert.equal(brief.quiet, true);
    assert.match(brief.headline, /quiet night/);
  });

  test("a routine's turn is on its card, not said again as the agent's night", () => {
    const lanes = [{ threadId: "t1", title: "General", messages: [
      { at: now - 5 * hour, role: "user" as const, kind: "text", text: "Run the check.", via: "routine" },
      { at: now - 5 * hour + 1, role: "bot" as const, kind: "text", text: "⛔️ 0 | ⚠️ 2 | ℹ️ 3." },
      { at: now - 3 * hour, role: "user" as const, kind: "text", text: "Move the dentist" },
      { at: now - 3 * hour + 1, role: "bot" as const, kind: "text", text: "Moved it to Thursday." },
    ] }];
    const withCards = composeBrief({ ...input, agents: [{ id: "a1", name: "Scout", lanes }], results: [card({})] }, "b");
    assert.deepEqual(withCards.parts.find((p) => p.botId === "a1")!.items.map((i) => i.text), ["Moved it to Thursday."]);
    // with no cards shown, the agent's night is told as it always was
    const without = composeBrief({ ...input, agents: [{ id: "a1", name: "Scout", lanes }] }, "b");
    assert.deepEqual(without.parts.find((p) => p.botId === "a1")!.items.map((i) => i.text), ["Moved it to Thursday."], "the lane's last word is still the person's turn");
    const routineLast = composeBrief({ ...input, agents: [{ id: "a1", name: "Scout", lanes: [{ ...lanes[0], messages: [...lanes[0].messages.slice(2), ...lanes[0].messages.slice(0, 2).map((m) => ({ ...m, at: m.at + 4 * hour }))] }] }], results: [card({})] }, "b");
    assert.deepEqual(routineLast.parts.find((p) => p.botId === "a1")!.items.map((i) => i.text), ["Moved it to Thursday."], "a report that came last is still the card's");
  });

  test("with nothing feeding it, the headline is the one it always was", () => {
    const brief = composeBrief(input, "b");
    assert.equal(brief.headline, "1 agent worked on 1 thing, nothing waiting on you.");
    assert.equal(brief.results, undefined);
  });
});

describe("editing the arrangement on the page", () => {
  const list: LayoutSection[] = [
    { key: "routine:a", pinned: true, hidden: false },
    { key: "routine:b", pinned: false, hidden: false },
    { key: "waiting", pinned: false, hidden: false },
    { key: "agents", pinned: false, hidden: false },
  ];

  test("a step stays inside its group", () => {
    assert.deepEqual(moveSection(list, "routine:b", -1).map((s) => s.key), ["routine:a", "routine:b", "waiting", "agents"], "it cannot step above a pinned one");
    assert.deepEqual(moveSection(list, "routine:b", 1).map((s) => s.key), ["routine:a", "waiting", "routine:b", "agents"]);
    assert.deepEqual(moveSection(list, "agents", 1).map((s) => s.key), ["routine:a", "routine:b", "waiting", "agents"]);
  });

  test("pinning takes it to the end of the pinned group, unpinning to the top of the rest", () => {
    const pinned = togglePin(list, "agents");
    assert.deepEqual(pinned.map((s) => [s.key, s.pinned]), [["routine:a", true], ["agents", true], ["routine:b", false], ["waiting", false]]);
    const unpinned = togglePin(pinned, "routine:a");
    assert.deepEqual(unpinned.map((s) => s.key), ["agents", "routine:a", "routine:b", "waiting"]);
  });

  test("the layout sent back is the whole list as it stands", () => {
    assert.deepEqual(layoutOf(toggleHidden(list, "waiting")), {
      order: ["routine:a", "routine:b", "waiting", "agents"],
      pinned: ["routine:a"],
      hidden: ["waiting"],
    });
  });
});
