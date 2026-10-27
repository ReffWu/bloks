// A small workspace on disk for the training export (server/run-export.ts):
// two agents, a Claude Code lane and a Codex lane, each with its
// transcript, its events file and its native log, written the way the
// harness writes them, plus a member's private conversation and a team
// conversation with a member's words in it.
//
// The Claude lane has a turn that went well and got a thumbs up, one
// that failed, one the person stopped, one they steered, and one they
// rewound. The Codex lane has a turn with a command whose output came
// back and a web search whose result never does, and a turn somebody
// else asked from Telegram.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const T0 = Date.parse("2026-10-20T10:00:00.000Z");
export const MINUTE = 60_000;
export const SECRET = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";
export const SAVED_SECRET = "stripe-saved-value-QX7v9Lm2Pq";
// built at run time, so test/no-secrets.test.ts never reads one in the source
export const GITHUB_TOKEN = `${"ghp"}_abcdefghijklmnopqrstuvwxyz0123456789`;
/** A result long enough to be shortened at the default. */
export const LONG_LINES = 400;

const iso = (at: number) => new Date(at).toISOString();

function ndjson(file: string, rows: unknown[]) {
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

export function writeExportFixture(data: string, home: string, { privateReadable = false }: { privateReadable?: boolean } = {}) {
  mkdirSync(join(data, "events"), { recursive: true });
  mkdirSync(join(data, "native"), { recursive: true });
  mkdirSync(join(data, "workspaces", "ada"), { recursive: true });
  const lane = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, resumeCursors: {}, createdAt: T0 - MINUTE, ...extra });
  const bot = (id: string, name: string, tasks: unknown[], instanceId: string) => ({
    id,
    threadId: (tasks[0] as { id: string }).id,
    name,
    title: "Engineer",
    description: "Keeps the build green.",
    notifications: true,
    color: "blue",
    unread: false,
    modelSelection: { instanceId, model: "default" },
    resumeCursors: {},
    activeTaskId: (tasks[0] as { id: string }).id,
    createdAt: T0 - 2 * MINUTE,
    tasks,
  });
  writeFileSync(
    join(data, "bots.json"),
    JSON.stringify([
      bot("ada", "Ada", [lane("lane-claude", "Build fixes"), lane("lane-member", "Private", { personId: "p-sam" }), lane("lane-team", "Team", { team: true })], "claude"),
      bot("cody", "Cody", [lane("lane-codex", "Repo chores")], "codex"),
    ]),
  );
  writeFileSync(
    join(data, "people.json"),
    JSON.stringify({ version: 3, people: [{ id: "p-sam", name: "Sam Lee", role: "member", createdAt: 1, joinedAt: 1, device: "mac" }], memberships: [], invites: [], knocks: [] }),
  );
  writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "Hamed Rahimi" }, secrets: { STRIPE_KEY: SAVED_SECRET } }));
  writeFileSync(join(data, "joining.json"), JSON.stringify({ approveEach: true, ...(privateReadable ? { privateReadable: true } : {}) }));
  writeFileSync(join(data, "workspaces", "ada", "MEMORY.md"), "The build runs with npm test.\n");

  // ── the Claude lane ──
  const A = T0;
  const B = T0 + 10 * MINUTE;
  const C = T0 + 20 * MINUTE;
  const D = T0 + 30 * MINUTE;
  const E = T0 + 40 * MINUTE;
  const user = (id: string, at: number, text: string, extra: Record<string, unknown> = {}) => ({ id, role: "user", kind: "text", text, at, ...extra });
  const bot2 = (id: string, at: number, text: string, extra: Record<string, unknown> = {}) => ({ id, role: "bot", kind: "text", text, at, ...extra });
  const activity = (id: string, at: number, name: string, command?: string) => ({ id, role: "bot", kind: "activity", tool: { name, ...(command ? { command } : {}), ok: true }, at });
  writeFileSync(
    join(data, "messages-lane-claude.json"),
    JSON.stringify([
      bot2("hello", A - MINUTE, "I'm ready."),
      user(
        "a1",
        A,
        `Fix the failing test in ${home}/proj/app. Mail sam@example.com or call +1 415 555 0134. Sam Lee asked for it. The key is ${SECRET} and the saved one is ${SAVED_SECRET}.`,
      ),
      activity("a2", A + 600, "Bash", "npm test"),
      bot2("a3", A + 4_000, "Fixed: the test now passes.", { reactions: { "\u{1F44D}": ["user"] } }),
      user("b1", B, "Deploy it."),
      { id: "b2", role: "bot", kind: "notice", text: "The deploy failed.", at: B + 2_000 },
      user("c1", C, "Refactor everything."),
      activity("c2", C + 500, "Bash", "rm -rf build"),
      user("d1", D, "Write the docs."),
      user("d2", D + 1_000, "Shorter, please.", { midTurn: true }),
      bot2("d3", D + 3_000, "Docs written."),
      user("e1", E, "An old ask.", { deleted: true, rewound: E + 5 * MINUTE }),
      bot2("e2", E + 1_000, "An old answer.", { deleted: true, rewound: E + 5 * MINUTE }),
    ]),
  );
  const ev = (type: string, at: number, turnId: string, extra: Record<string, unknown> = {}) => ({
    eventId: `${turnId}-${type}-${at}`,
    provider: "claudeAgent",
    providerInstanceId: "claude",
    threadId: "lane-claude",
    createdAt: iso(at),
    turnId,
    type,
    ...extra,
  });
  const tool = (id: string, at: number, end: number, turnId: string, title: string, command?: string) => [
    ev("item.started", at, turnId, { itemType: "tool", itemId: id, title, ...(command ? { command } : {}) }),
    ev("item.completed", end, turnId, { itemType: "tool", itemId: id, ok: true }),
  ];
  ndjson(join(data, "events", "lane-claude.ndjson"), [
    ev("turn.started", A + 100, "t-a"),
    ev("session.started", A + 150, "t-a", { sessionId: "s1", model: "claude-sonnet-5" }),
    ev("item.completed", A + 500, "t-a", { itemType: "assistant_text", text: "Running the tests." }),
    ...tool("toolu_1", A + 600, A + 2_600, "t-a", "Bash", "npm test"),
    ev("thread.token-usage.updated", A + 600, "t-a", { input: 1000, output: 20 }),
    ...tool("toolu_2", A + 2_700, A + 2_800, "t-a", "Read"),
    ...tool("toolu_3", A + 2_900, A + 3_000, "t-a", "Read"),
    ev("item.completed", A + 4_000, "t-a", { itemType: "assistant_text", text: "Fixed: the test now passes." }),
    ev("thread.token-usage.updated", A + 4_000, "t-a", { input: 1100, output: 30 }),
    ev("turn.completed", A + 4_500, "t-a", { ok: true, stopReason: null, cost: 0.25 }),

    ev("turn.started", B + 100, "t-b"),
    ev("runtime.error", B + 1_500, "t-b", { message: "deploy failed" }),
    ev("turn.completed", B + 2_000, "t-b", { ok: false, stopReason: "error" }),

    ev("turn.started", C + 100, "t-c"),
    ev("item.started", C + 500, "t-c", { itemType: "tool", itemId: "toolu_9", title: "Bash", command: "rm -rf build" }),
    ev("turn.completed", C + 3_000, "t-c", { ok: false, stopReason: "interrupted" }),

    ev("turn.started", D + 100, "t-d"),
    ev("item.completed", D + 3_000, "t-d", { itemType: "assistant_text", text: "Docs written." }),
    ev("turn.completed", D + 3_100, "t-d", { ok: true, stopReason: null, cost: 0.05 }),

    ev("turn.started", E + 100, "t-e"),
    ev("item.completed", E + 1_000, "t-e", { itemType: "assistant_text", text: "An old answer." }),
    ev("turn.completed", E + 1_100, "t-e", { ok: true, stopReason: null }),
  ]);
  const long = Array.from({ length: LONG_LINES }, (_, i) => `PASS test ${i} in ${home}/proj/app/test.js`).join("\n");
  const frame = (at: number, msg: unknown, dir = "in") => ({ at: iso(at), dir, source: "claude.sdk.message", msg });
  ndjson(join(data, "native", "lane-claude.ndjson"), [
    frame(A + 120, { type: "user", message: { role: "user", content: "the prompt as the engine was sent it, recall and all" } }, "out"),
    frame(A + 600, { type: "assistant", message: { content: [{ type: "text", text: "Running the tests." }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm test" } }] } }),
    frame(A + 2_600, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: `${long}\nGITHUB_TOKEN=${GITHUB_TOKEN}\n` }] } }),
    frame(A + 2_700, { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: `${home}/proj/app/README.md` } }] } }),
    frame(A + 2_800, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_2", content: [{ type: "text", text: "# App\nHello" }] }] } }),
    frame(A + 2_900, { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_3", name: "Read", input: { file_path: `${home}/proj/app/README.md` } }] } }),
    frame(A + 3_000, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_3", content: [{ type: "text", text: "# App\nHello" }] }] } }),
    // a sub-agent's own call, inside the parent's: never the parent's step
    frame(A + 3_100, { type: "assistant", parent_tool_use_id: "toolu_1", message: { content: [{ type: "tool_use", id: "toolu_1", name: "Grep", input: { pattern: "child" } }] } }),
    frame(C + 500, { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_9", name: "Bash", input: { command: "rm -rf build" } }] } }),
  ]);

  // ── the Codex lane ──
  const F = T0 + 5 * MINUTE;
  const G = T0 + 15 * MINUTE;
  writeFileSync(
    join(data, "messages-lane-codex.json"),
    JSON.stringify([
      user("f1", F, "List the files."),
      activity("f2", F + 500, "shell", "ls -la"),
      bot2("f3", F + 2_000, "There are three files."),
      user("g1", G, "Hi from Telegram.", {
        telegramPerson: { botId: "cody", bindingGeneration: "g", personId: "tp-1", userId: 42, name: "Kim Park", grant: "x", requester: "Kim Park", chatId: 42 },
      }),
      bot2("g2", G + 1_000, "Hello Kim."),
    ]),
  );
  const cx = (type: string, at: number, turnId: string, extra: Record<string, unknown> = {}) => ({
    eventId: `${turnId}-${type}-${at}`,
    provider: "codex",
    providerInstanceId: "codex",
    threadId: "lane-codex",
    createdAt: iso(at),
    turnId,
    type,
    ...extra,
  });
  ndjson(join(data, "events", "lane-codex.ndjson"), [
    cx("turn.started", F + 100, "c-1"),
    cx("session.started", F + 150, "c-1", { sessionId: "codex-thread", model: "gpt-5.5-codex" }),
    cx("item.started", F + 500, "c-1", { itemType: "tool", itemId: "item_1", title: "shell", command: "ls -la" }),
    cx("item.completed", F + 900, "c-1", { itemType: "tool", itemId: "item_1", ok: true }),
    cx("item.started", F + 1_000, "c-1", { itemType: "tool", itemId: "item_2", title: "web_search" }),
    cx("item.completed", F + 2_000, "c-1", { itemType: "assistant_text", text: "There are three files." }),
    cx("thread.token-usage.updated", F + 1_500, "c-1", { input: 400, output: 10 }),
    cx("thread.token-usage.updated", F + 2_000, "c-1", { input: 500, output: 40 }),
    cx("turn.completed", F + 2_100, "c-1", { ok: true, stopReason: null, unpriced: { model: "gpt-5.5-codex", input: 500, output: 40, cachedInput: 0 } }),
    cx("turn.started", G + 100, "c-2"),
    cx("item.completed", G + 1_000, "c-2", { itemType: "assistant_text", text: "Hello Kim." }),
    cx("turn.completed", G + 1_100, "c-2", { ok: true, stopReason: null }),
  ]);
  const rpc = (at: number, method: string, item: unknown) => ({ at: iso(at), dir: "in", source: "codex.app-server", msg: { method, params: { threadId: "codex-thread", turnId: "x", item } } });
  ndjson(join(data, "native", "lane-codex.ndjson"), [
    rpc(F + 500, "item/started", { id: "item_1", type: "commandExecution", command: "ls -la", cwd: `${home}/proj`, status: "inProgress" }),
    rpc(F + 900, "item/completed", { id: "item_1", type: "commandExecution", command: "ls -la", cwd: `${home}/proj`, aggregatedOutput: "a.txt\nb.txt\nc.txt\n", exitCode: 0, status: "completed" }),
    rpc(F + 1_000, "item/started", { id: "item_2", type: "webSearch", query: "bloks docs" }),
  ]);

  // ── a member's private conversation, and the team's ──
  writeFileSync(join(data, "messages-lane-member.json"), JSON.stringify([user("m1", T0 + 50 * MINUTE, "A private thing."), bot2("m2", T0 + 50 * MINUTE + 1_000, "Noted.")]));
  ndjson(join(data, "events", "lane-member.ndjson"), [
    { ...ev("turn.started", T0 + 50 * MINUTE + 100, "m-1"), threadId: "lane-member" },
    { ...ev("item.completed", T0 + 50 * MINUTE + 1_000, "m-1", { itemType: "assistant_text", text: "Noted." }), threadId: "lane-member" },
    { ...ev("turn.completed", T0 + 50 * MINUTE + 1_100, "m-1", { ok: true, stopReason: null }), threadId: "lane-member" },
  ]);
  writeFileSync(join(data, "messages-lane-team.json"), JSON.stringify([user("t1", T0 + 55 * MINUTE, "A team ask.", { author: "p-sam" }), bot2("t2", T0 + 55 * MINUTE + 1_000, "On it.")]));
  ndjson(join(data, "events", "lane-team.ndjson"), [
    { ...ev("turn.started", T0 + 55 * MINUTE + 100, "tm-1"), threadId: "lane-team" },
    { ...ev("item.completed", T0 + 55 * MINUTE + 1_000, "tm-1", { itemType: "assistant_text", text: "On it." }), threadId: "lane-team" },
    { ...ev("turn.completed", T0 + 55 * MINUTE + 1_100, "tm-1", { ok: true, stopReason: null }), threadId: "lane-team" },
  ]);
}
