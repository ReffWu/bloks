// The morning brief as the one notification (GitHub 378), against the
// real server and a stand-in engine: a routine set to report in the
// brief says nothing when it runs, one that is not still does, both
// land on the brief's cards, and the brief itself notifies once.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness, type Harness } from "./helpers/server.ts";

// A Claude Code stand-in that answers each turn from a plan file.
const CLI = String.raw`#!__NODE__
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const dir=__DIR__;
const out=x=>console.log(JSON.stringify(x));
if(process.argv.includes('--version')){console.log('2.1.299 (Claude Code)');process.exit();}
if(process.argv.includes('auth')){out({loggedIn:true});process.exit();}
const run=()=>{
 const path=dir+'/plan.json', plans=JSON.parse(readFileSync(path,'utf8')), p=plans.shift()??{text:'ok'};writeFileSync(path,JSON.stringify(plans));
 out({type:'system',subtype:'init',session_id:'fixture',model:'claude-sonnet-5'});
 out({type:'assistant',message:{id:'m'+Date.now(),model:'claude-sonnet-5',content:[{type:'text',text:p.text}],usage:{input_tokens:1,output_tokens:1}}});
 writeFileSync(dir+'/ran-'+Date.now(),'yes');
 out({type:'result',subtype:'success',is_error:false,num_turns:1,duration_api_ms:1,total_cost_usd:0,result:'ok'});
};
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='user')run();});
`;

let h: Harness, home: string, controller: AbortController, reading: Promise<void>;
const frames: any[] = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function wait(check: () => boolean | Promise<boolean>, why: string) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(25);
  }
  assert.fail(`${why}\n${h.logs().slice(-1500)}`);
}
const plan = (texts: string[]) => writeFileSync(join(home, "plan.json"), JSON.stringify(texts.map((text) => ({ text }))));
const idle = (id: string) => wait(async () => !(await h.json("/api/bots")).bots.find((b: any) => b.id === id).busy, "turn never settled");

before(async () => {
  home = mkdtempSync(join(tmpdir(), "bloks-brief-fixture-"));
  mkdirSync(join(home, ".bloks"));
  const cli = join(home, "claude.mjs");
  writeFileSync(cli, CLI.replaceAll("__NODE__", process.execPath).replaceAll("__DIR__", JSON.stringify(home)), { mode: 0o755 });
  plan([]);
  writeFileSync(join(home, ".bloks/config.json"), JSON.stringify({ instances: { claudeAgent: { driver: "claudeAgent", config: { cli } } } }));
  h = await startHarness({ HOME: home, USERPROFILE: home });
  controller = new AbortController();
  const res = await h.fetch("/api/events", { signal: controller.signal });
  assert.ok(res.ok);
  const reader = res.body!.getReader();
  reading = (async () => {
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) return;
        buffer += decoder.decode(r.value, { stream: true });
        let at;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const data = block.split("\n").find((s) => s.startsWith("data: "));
          if (data) frames.push(JSON.parse(data.slice(6)));
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) throw e;
    }
  })();
  await wait(() => frames.some((f) => f.kind === "hello"), "no stream hello");
});

after(async () => {
  controller?.abort();
  await reading;
  await h?.stop();
  rmSync(home, { recursive: true, force: true });
});

test("the brief's settings: defaults, the arrangement kept clean, and its notification switches", async () => {
  let list = await h.json("/api/briefs");
  assert.deepEqual(list.settings, { enabled: true, time: "08:00", notify: true, allClear: false, layout: { order: [], pinned: [], hidden: [] } });
  assert.deepEqual(list.sections.map((s: any) => s.key), ["waiting", "failed", "agents", "memory"], "nothing feeding it is the brief as it always was");

  const saved = await h.json("/api/briefs/settings", { method: "PATCH", body: JSON.stringify({ layout: { order: ["agents", "bogus", "waiting"], pinned: ["agents"], hidden: ["memory", 3] } }) });
  assert.deepEqual(saved.settings.layout, { order: ["agents", "waiting"], pinned: ["agents"], hidden: ["memory"] });
  list = await h.json("/api/briefs");
  // what was left out of the order goes beside its neighbour from the
  // default order: memory after agents, failed after waiting
  assert.deepEqual(list.sections.map((s: any) => [s.key, s.pinned, s.hidden]), [["agents", true, false], ["memory", false, true], ["waiting", false, false], ["failed", false, false]]);
  const bad = await h.fetch("/api/briefs/settings", { method: "PATCH", body: JSON.stringify({ layout: "agents first" }) });
  assert.equal(bad.status, 400);

  // a quiet morning notifies only when asked to say all is clear
  const before = frames.length;
  await h.json("/api/briefs", { method: "POST", body: "{}" });
  await pause(150);
  assert.ok(!frames.slice(before).some((f) => f.kind === "brief.ready"), "a quiet brief must not notify by default");
  await h.json("/api/briefs/settings", { method: "PATCH", body: JSON.stringify({ allClear: true }) });
  const { brief } = await h.json("/api/briefs", { method: "POST", body: "{}" });
  await wait(() => frames.some((f) => f.kind === "brief.ready" && f.id === brief.id), "the all clear never came");
  const ready = frames.find((f) => f.kind === "brief.ready" && f.id === brief.id);
  assert.equal(ready.title, "Your morning brief is ready");
  assert.match(ready.body, /^All clear/);
  // and never when it is turned off
  await h.json("/api/briefs/settings", { method: "PATCH", body: JSON.stringify({ notify: false }) });
  const quietAgain = frames.length;
  await h.json("/api/briefs", { method: "POST", body: "{}" });
  await pause(150);
  assert.ok(!frames.slice(quietAgain).some((f) => f.kind === "brief.ready"), "turned off, it must not notify");
  await h.json("/api/briefs/settings", { method: "PATCH", body: JSON.stringify({ notify: true, allClear: false, layout: { order: [], pinned: [], hidden: [] } }) });
});

test("a routine set to report in the brief sends no notification of its own; the brief carries it once", async () => {
  const { bot } = await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Sentry" }) });
  await h.json(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-5" } }) });
  const make = async (name: string, briefOnly: boolean) =>
    (await h.json("/api/routines", { method: "POST", body: JSON.stringify({ targetKind: "agent", targetId: bot.id, name, prompt: `Check ${name}`, time: "23:59", days: [], ...(briefOnly ? { briefOnly: true } : {}) }) })).routine;
  const health = await make("Home Lab Health", true);
  const tracker = await make("GitHub tracker", false);
  assert.equal(health.briefOnly, true);
  assert.equal(tracker.briefOnly, undefined);

  const settled = (since: number) => frames.slice(since).filter((f) => f.kind === "reply.settled" && f.botId === bot.id);
  const run = async (routine: any, text: string) => {
    plan([text]);
    const since = frames.length;
    const r = await h.fetch(`/api/routines/${routine.id}/run`, { method: "POST" });
    assert.ok(r.ok, await r.text());
    await wait(async () => (await h.json("/api/routines")).routines.find((x: any) => x.id === routine.id).runs?.[0]?.state === "ok", "the run never ended");
    await idle(bot.id);
    await pause(150);
    return since;
  };

  const quietSince = await run(health, "⛔️ 0 errors | ⚠️ 2 warnings | ℹ️ 3 info\n\n- Docker & Apps: warning");
  assert.equal(settled(quietSince).length, 0, "a brief-only routine's reply must not notify");
  // the turn it ran was told where its answer goes
  const said = (await h.json(`/api/bots/${bot.id}/messages`)).messages;
  assert.ok(said.some((m: any) => m.role === "user" && m.routine?.brief === true), "its prompt is marked as the brief's");

  const loudSince = await run(tracker, "1 reply needed on #12.");
  assert.equal(settled(loudSince).length, 1, "a routine that is not brief-only still says its reply once");

  // both are cards, the brief-only one marked so
  const list = await h.json("/api/briefs");
  const cards = new Map(list.live.map((r: any) => [r.key, r]));
  const healthCard: any = cards.get(`routine:${health.id}`);
  assert.equal(healthCard.state, "reported");
  assert.match(healthCard.text, /⛔️ 0 errors \| ⚠️ 2 warnings/);
  assert.match(healthCard.text, /- Docker & Apps: warning/, "the card keeps the report's own lines");
  assert.equal(healthCard.briefOnly, true);
  assert.equal((cards.get(`routine:${tracker.id}`) as any).state, "reported");
  // the cards come first; both run at 23:59, so by name
  assert.deepEqual(list.sections.slice(0, 2).map((s: any) => s.key), [`routine:${tracker.id}`, `routine:${health.id}`]);
  assert.equal(list.sections.find((s: any) => s.key === `routine:${health.id}`).briefOnly, true);

  // hiding one keeps it off the brief and out of its headline
  await h.json("/api/briefs/settings", { method: "PATCH", body: JSON.stringify({ layout: { order: [], pinned: [], hidden: [`routine:${tracker.id}`] } }) });
  const since = frames.length;
  const { brief } = await h.json("/api/briefs", { method: "POST", body: "{}" });
  assert.deepEqual(brief.results.map((r: any) => r.key), [`routine:${health.id}`]);
  assert.match(brief.headline, /^1 report in, /);
  await wait(() => frames.slice(since).some((f) => f.kind === "brief.ready"), "the brief never notified");
  const ready = frames.slice(since).filter((f) => f.kind === "brief.ready");
  assert.equal(ready.length, 1, "one notification for the brief");
  assert.equal(ready[0].id, brief.id, "it names the brief it is about");
  assert.equal(ready[0].body, brief.headline);

  // switched back, the routine notifies again
  const patched = await h.json(`/api/routines/${health.id}`, { method: "PATCH", body: JSON.stringify({ briefOnly: false }) });
  assert.equal(patched.routine.briefOnly, undefined);
  const backSince = await run(health, "All good.");
  assert.equal(settled(backSince).length, 1);

  // and with the brief off, a brief-only routine is not silenced: a report
  // nobody is told about would be lost
  await h.json(`/api/routines/${health.id}`, { method: "PATCH", body: JSON.stringify({ briefOnly: true }) });
  await h.json("/api/briefs/settings", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  const offSince = await run(health, "Still fine.");
  assert.equal(settled(offSince).length, 1);
  assert.ok(existsSync(join(home, "plan.json")));
});
