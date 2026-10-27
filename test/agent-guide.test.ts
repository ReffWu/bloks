// An agent that can explain Bloks, point the person at the right place,
// and change an everyday setting for them on their yes.
//
// Three things are held here. The guide to how Bloks works names every
// Settings page, so a page added to the app cannot go unexplained. `where`
// and `open` answer from the app's own index, so the place an agent names
// is one the app opens. And a proposed change is only ever a card: the
// short list of what may be proposed is pinned, everything the person
// alone decides is refused by name with the way to send them there, and
// nothing changes until the person's Change, which is recorded as theirs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { allows, NEVER, RULES } from "../server/agent-cli.ts";
import { PLACE_INDEX, SETTINGS_PAGE_INDEX } from "../server/settings-index.ts";
import { PROPOSABLE, proposable, readValue, refusal, type ProposalState } from "../server/settings-proposals.ts";
import { openCard, placeOf, where } from "../server/where.ts";
import { SETTINGS_PAGE_LIST } from "../src/lib/settingsPages.ts";
import { initialState, reducer } from "../src/state/reducer.ts";
import { controlledChain, type ChainTurn } from "./helpers/agent-chain.ts";
import { waitFor } from "./helpers/turns.ts";

// The skills folder is fixed when the module loads, so a throwaway one is
// named first: reading the library must never read the person's own.
process.env.BLOKS_DATA_DIR = mkdtempSync(join(tmpdir(), "bloks-agent-guide-"));
const { builtinSkill, BLOKS_EXPLAINER, BLOKS_GUIDE, MAX_SKILL_CHARS, countChars } = await import("../server/skills.ts");

const CLI = fileURLToPath(new URL("../bin/bloks.mjs", import.meta.url));

async function bloks(url: string, turn: ChainTurn, home: string, args: string[]) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { HOME: home, BLOKS_URL: url, BLOKS_TOKEN: turn.token } });
  let out = "", err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  const exit = await new Promise<number | null>((resolve) => child.once("close", resolve));
  clearTimeout(timer);
  return { exit, err, body: out.trim() ? JSON.parse(out) : null };
}

describe("the guide to how Bloks works", () => {
  const guide = builtinSkill(BLOKS_EXPLAINER)!;

  test("ships, fits a skill, and has no dashes", () => {
    assert.ok(guide, "the guide ships with Bloks");
    assert.ok(countChars(guide.body) <= MAX_SKILL_CHARS, `${countChars(guide.body)} characters is over the limit`);
    assert.doesNotMatch(guide.body, /[\u2014\u2013]/);
    assert.doesNotMatch(guide.description, /[\u2014\u2013]/);
    assert.match(guide.body, /^Not for: /m);
  });

  test("names every Settings page, so a new page cannot go unexplained", () => {
    const missing = SETTINGS_PAGE_LIST.map((p) => p.id).filter((id) => !guide.body.includes("`" + id + "`"));
    assert.deepEqual(missing, [], `the guide does not say what these pages are: ${missing.join(", ")}`);
  });

  test("names every place it can send the person to", () => {
    const missing = PLACE_INDEX.map((p) => p.id).filter((id) => !guide.body.includes("`" + id + "`"));
    assert.deepEqual(missing, []);
  });

  test("the guide to using Bloks points at where, open and propose rather than only naming pages", () => {
    const using = builtinSkill(BLOKS_GUIDE)!;
    const only = using.body.slice(using.body.indexOf("## What only the person can do"));
    assert.match(only, /`where <words>`/);
    assert.match(only, /`open <page-id>`/);
    assert.match(only, /`settings propose`/);
    assert.match(only, /how-bloks-works/);
  });
});

describe("where things are", () => {
  test("one id opens one place", () => {
    const ids = [...SETTINGS_PAGE_INDEX.map((p) => p.id), ...PLACE_INDEX.map((p) => p.id)];
    assert.equal(new Set(ids).size, ids.length);
    for (const place of PLACE_INDEX) {
      if ("parent" in place) assert.ok(PLACE_INDEX.some((p) => p.id === place.parent), `${place.id} is a tab of nothing`);
    }
  });

  test("words find the page and the row they live on, in the app's own words", () => {
    const tidy = where("turn off the nightly memory tidy");
    assert.equal(tidy[0]?.id, "behaviour");
    assert.equal(tidy[0]?.path, "Settings, Behaviour");
    assert.deepEqual(tidy[0]?.matched.slice(0, 1), ["Tidy memory every night"]);
    assert.equal(tidy[0]?.open, 'bloks open behaviour --row "Tidy memory every night"');

    assert.equal(where("where do I change my API key")[0]?.kind, "settings");
    assert.ok(where("api key").some((m) => m.id === "engines" || m.id === "apps"));
    assert.equal(where("watchers")[0]?.id, "automations:watchers");
    assert.equal(where("watchers")[0]?.path, "Automations on the main rail, then Watchers");
    assert.equal(where("monthly spending limit")[0]?.id, "usage");
    assert.deepEqual(where("   "), []);
  });

  test("a card opens a real page, scrolls to a real row, and says the way in words", () => {
    const me = { id: "bot-1", name: "Ada" };
    const made = openCard(me, "behaviour", "tidy memory every night");
    assert.ok(made.ok);
    assert.deepEqual(made.card.open, { kind: "settings", page: "behaviour", row: "Tidy memory every night", name: "Behaviour", path: "Settings, Behaviour, Tidy memory every night" });
    assert.equal(made.card.title, "Open Behaviour");
    assert.match(made.card.subtitle, /Settings, Behaviour, Tidy memory every night/);
    // an old id lands where the page went
    assert.equal(placeOf("billing")?.id, "plan");
    // an agent's own settings name the agent
    const own = openCard(me, "agent", undefined);
    assert.ok(own.ok);
    assert.equal(own.card.open.botId, "bot-1");
    assert.match(own.card.open.path, /Ada's settings/);
    // a workspace's page says it is one, for a window without workspaces
    const members = openCard(me, "workspace:members", undefined);
    assert.ok(members.ok && members.card.open.workspace);

    const nowhere = openCard(me, "secret-page", undefined);
    assert.ok(!nowhere.ok && /bloks where/.test(nowhere.error));
    const norow = openCard(me, "behaviour", "Make everything free");
    assert.ok(!norow.ok && /Tidy memory every night/.test(norow.error));
  });

  test("the card's button opens the page at its row, the way a search result does", () => {
    const opened = reducer(initialState, { type: "toggleAppSettings", open: true, page: "behaviour", row: "Tidy memory every night" });
    assert.equal(opened.settingsPage, "behaviour");
    assert.equal(opened.settingsRow?.page, "behaviour");
    assert.equal(opened.settingsRow?.row, "Tidy memory every night");
    // a row rides only with the page it is on: opening Settings plainly asks for none
    assert.equal(reducer(opened, { type: "toggleAppSettings", open: true }).settingsRow, null);
    assert.equal(reducer(opened, { type: "toggleAppSettings", open: false }).settingsRow, null);
  });

  test("where and open are an agent's; reading and one card", () => {
    assert.equal(allows("bot-1", "GET", "/api/agent/where").ok, true);
    assert.equal(allows("bot-1", "POST", "/api/agent/open").ok, true);
    assert.equal(allows("bot-1", "POST", "/api/agent/where").ok, false);
    assert.ok(RULES.some((r) => r.path === "/api/agent/where" && r.why.length > 20));
  });
});

const STATE: ProposalState = {
  config: { agentDefaults: { cwd: "/work", approvals: "ask" } },
  brief: { enabled: true, time: "08:00", notify: true, allClear: false, layout: { order: [], pinned: [], hidden: [] } },
  agent: { id: "bot-1", notifications: true, model: { instanceId: "claude", model: "claude-sonnet-5", options: [{ id: "claude-sonnet-5" }, { id: "claude-opus-5", label: "Opus" }] } },
};

describe("what an agent may propose", () => {
  test("the list is exactly these everyday preferences", () => {
    // Adding one is adding to what a tap on a card can change: do it here,
    // on purpose, after reading the refused list below.
    assert.deepEqual(PROPOSABLE.map((p) => p.id), [
      "recall.beforeTurn",
      "memory.tidy",
      "compaction.micro",
      "changes.showShared",
      "skills.learn",
      "brief.enabled",
      "brief.time",
      "brief.notify",
      "brief.allClear",
      "brief.section.waiting",
      "brief.section.failed",
      "brief.section.agents",
      "brief.section.memory",
      "agent.notifications",
      "agent.effort",
      "agent.model",
      "newAgents.effort",
    ]);
    for (const setting of PROPOSABLE) {
      assert.equal(refusal(setting.id), null, setting.id);
      assert.ok(placeOf(setting.page), `${setting.id} lives on a page that opens`);
    }
  });

  test("everything that is the person's alone is refused by name, with the way to send them there", () => {
    const refused: Record<string, string[]> = {
      rules: ["approvals", "agent.approvals", "agentDefaults.approvals", "newAgents.approvals", "rules", "full access", "permissions"],
      apps: ["apiKey", "composio.key", "secrets", "saved secret", "password", "sign in", "oauth token"],
      engines: ["engines", "provider", "custom endpoint", "codex speed"],
      "workspace:members": ["members", "invites", "role", "admins"],
      devices: ["phone access", "pairing", "location", "paired device"],
      "workspace:online": ["remote access", "Bloks Cloud", "reachable online", "relay"],
      plan: ["plan", "billing", "licence", "subscription", "Bloks AI"],
      usage: ["spending limit", "monthly budget", "allowance"],
      behaviour: ["agents.turnLimit", "agent to agent limit", "chain limit", "agents.taskBudget"],
      backups: ["backups", "restore", "backup passphrase", "move workspace", "export workspace", "training export"],
      "workspace:general": ["delete workspace"],
      "plugins:skills": ["remove skill"],
      memory: ["forget memory", "clear notes"],
      agent: ["delete agent", "archive agent", "wipe"],
      browser: ["browser sites", "site permissions", "downloads"],
      home: ["Home Assistant", "home.entities"],
      security: ["security", "docker container", "ssh workplace", "working folder"],
    };
    for (const [page, names] of Object.entries(refused)) {
      for (const name of names) {
        const why = refusal(name);
        assert.ok(why, `${name} was not refused`);
        assert.match(why!, /bloks open /, `${name}: the refusal says how to send the person there`);
        assert.ok(why!.includes(`bloks open ${page}\``), `${name} should send the person to ${page}: ${why}`);
        assert.match(why!, /Nothing has changed/);
      }
    }
    // and anything else not on the list is refused with the list and the way
    const other = refusal("delivery.mode")!;
    assert.match(other, /not a setting an agent can propose/);
    assert.match(other, /bloks where/);
    assert.match(other, /bloks open/);
    assert.match(other, /memory\.tidy/);
  });

  test("a value is read the way the setting takes it, and the request is the Settings page's own", () => {
    const tidy = proposable("Tidy memory every night")!;
    assert.equal(tidy.id, "memory.tidy");
    const off = readValue(tidy, "false", STATE);
    assert.deepEqual(off, { ok: true, value: "off" });
    assert.deepEqual(tidy.request("off", STATE), { method: "PUT", path: "/api/config", body: { memory: { tidy: false } } });
    assert.equal(readValue(tidy, "sometimes", STATE).ok, false);

    const time = proposable("brief.time")!;
    assert.deepEqual(readValue(time, "7:30", STATE), { ok: true, value: "07:30" });
    assert.equal(readValue(time, "25:00", STATE).ok, false);

    const model = proposable("agent.model")!;
    assert.deepEqual(readValue(model, "opus", STATE), { ok: true, value: "claude-opus-5" });
    assert.equal(readValue(model, "gpt-9", STATE).ok, false);
    assert.deepEqual(model.request("claude-opus-5", STATE).body, { modelSelection: { instanceId: "claude", model: "claude-opus-5" } });

    // the whole section goes back, the approvals in it untouched
    const effort = proposable("newAgents.effort")!;
    assert.deepEqual(effort.request("high", STATE).body, { agentDefaults: { cwd: "/work", approvals: "ask", effort: "high" } });

    const hidden = proposable("brief.section.memory")!.request("hidden", STATE);
    assert.deepEqual(hidden, { method: "PATCH", path: "/api/briefs/settings", body: { layout: { order: [], pinned: [], hidden: ["memory"] } } });
  });

  test("proposing is an agent's; the Change is the person's alone", () => {
    assert.equal(allows("bot-1", "GET", "/api/agent/settings/proposals").ok, true);
    assert.equal(allows("bot-1", "POST", "/api/agent/settings/proposals").ok, true);
    assert.equal(allows("bot-1", "GET", "/api/agent/settings/proposals/abc-123").ok, true);
    assert.ok(NEVER.includes("/api/settings-proposals"));
    assert.equal(allows("bot-1", "POST", "/api/settings-proposals/lane-1/msg-1/change").ok, false);
    assert.equal(allows("bot-1", "POST", "/api/config").ok, false);
  });
});

describe("over the wire", () => {
  test("an agent finds a place, opens it for the person, and proposes a change they answer", async (t) => {
    const f = await controlledChain(t, {}, { BLOKS_SETTINGS_WAIT_MS: "400" });
    const ada = await f.hire("Ada");
    const turn = await f.begin(ada);

    const found = await bloks(f.h.url, turn, f.home, ["where", "nightly", "memory", "tidy"]);
    assert.equal(found.exit, 0, JSON.stringify(found.body));
    assert.equal(found.body.matches[0].id, "behaviour");

    const opened = await bloks(f.h.url, turn, f.home, ["open", "behaviour", "--row", "Tidy memory every night"]);
    assert.equal(opened.exit, 0, JSON.stringify(opened.body));
    assert.equal(opened.body.path, "Settings, Behaviour, Tidy memory every night");
    const card = (await f.messages(ada)).find((m) => m.card?.open);
    assert.equal(card?.card.open.page, "behaviour");
    assert.equal(card?.card.open.row, "Tidy memory every night");

    // refused: the person's alone, and the way to send them there
    const approvals = await bloks(f.h.url, turn, f.home, ["settings", "propose", "approvals", "full"]);
    assert.equal(approvals.exit, 1);
    assert.match(approvals.body.error, /bloks open rules/);

    const listed = await bloks(f.h.url, turn, f.home, ["settings", "propose"]);
    assert.equal(listed.exit, 0, JSON.stringify(listed.body));
    assert.equal(listed.body.settings.find((s: any) => s.setting === "memory.tidy")?.current, "on");

    const proposed = await bloks(f.h.url, turn, f.home, ["settings", "propose", "memory.tidy", "off", "--why", "You asked for no overnight changes."]);
    assert.equal(proposed.exit, 0, JSON.stringify(proposed.body));
    assert.equal(proposed.body.pending, true, "nothing changes until the person answers");
    const id = proposed.body.proposal as string;
    assert.equal((await f.h.json("/api/config")).memory.tidy, true);

    const proposal = (await f.messages(ada)).find((m) => m.card?.settingsProposal?.id === id);
    assert.ok(proposal, "the card is in the conversation");
    const plan = proposal.card.settingsProposal;
    assert.equal(plan.current.text, "On");
    assert.equal(plan.proposed.text, "Off");
    assert.equal(plan.why, "You asked for no overnight changes.");

    // the agent cannot press it for them
    const pressed = await f.agent(turn, `/api/settings-proposals/${plan.laneId}/${proposal.id}/change`, {});
    assert.equal(pressed.status, 403);
    assert.equal((await f.h.json("/api/config")).memory.tidy, true);

    // the person can, and it is the Settings page's own change, recorded as theirs
    const waiting = bloks(f.h.url, turn, f.home, ["settings", "proposal", id]);
    const change = await f.h.fetch(`/api/settings-proposals/${plan.laneId}/${proposal.id}/change`, { method: "POST", body: "{}" });
    assert.equal(change.status, 200, await change.clone().text());
    assert.equal((await f.h.json("/api/config")).memory.tidy, false);
    const heard = await waiting;
    assert.equal(heard.exit, 0, JSON.stringify(heard.body));
    assert.equal(heard.body.ok, true);
    assert.equal(heard.body.changed, "memory.tidy");
    const ledger = await waitFor(async () => (await f.h.json("/api/ledger")).entries.find((e: any) => e.kind === "settings.changed") ?? null);
    assert.equal(ledger.actor, "you");
    assert.match(ledger.summary, /as Ada proposed/);
    // answered once only
    const again = await f.h.fetch(`/api/settings-proposals/${plan.laneId}/${proposal.id}/keep`, { method: "POST", body: "{}" });
    assert.equal(again.status, 409);

    // one the person keeps, answered after the agent stopped waiting, is
    // told at the start of its next turn here, once
    const second = await bloks(f.h.url, turn, f.home, ["settings", "propose", "compaction.micro", "on"]);
    assert.equal(second.body.pending, true);
    const kept = (await f.messages(ada)).find((m) => m.card?.settingsProposal?.id === second.body.proposal);
    const keep = await f.h.fetch(`/api/settings-proposals/${kept.card.settingsProposal.laneId}/${kept.id}/keep`, { method: "POST", body: "{}" });
    assert.equal(keep.status, 200);
    assert.equal((await f.h.json("/api/config")).compaction?.micro ?? false, false);
    await f.finish(turn, ada);
    const next = await f.begin(ada, "Carry on");
    assert.match(next.text, /the person kept Summarise as you go as it is/);
    assert.doesNotMatch(next.text, /Tidy memory every night/, "the change it already heard is not told twice");
  });
});
