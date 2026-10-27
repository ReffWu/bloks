// The catalogue of teams and skills (server/catalog.ts and
// server/catalog-source.ts): the index and the files it lists, what a
// download is checked against, what is kept for offline, what a review
// says an install would create, what an update says changed, and what a
// shared file leaves out.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildIndex,
  detectKind,
  normalizeLink,
  parseIndex,
  parseSkillFile,
  scrubForSharing,
  serializeIndex,
  sha256Hex,
  skillItemStanding,
  skillPlan,
  teamChanges,
  teamForSharing,
  teamItemStanding,
  teamPlan,
  verifyItem,
  writeSkillFile,
  type CatalogFile,
  type CatalogItem,
  type HeldSkill,
  type SkillFile,
} from "../server/catalog.ts";
import { CatalogSource, checkSourceUrl, StagedReviews } from "../server/catalog-source.ts";
import { hashBody } from "../server/skill-registry.ts";
import { parseMarkdown } from "../server/skills.ts";
import { parseRoutineLine, parseTeamFile, TeamFileError, writeRoutineLine, writeTeamFile } from "../server/team-file.ts";
import { installLink, teamLink } from "../electron/links.mjs";
import { filterCatalog, tagsOf, type CatalogRow } from "../src/lib/catalog.ts";
import { initialState, reducer } from "../src/state/reducer.ts";

const ROOT = fileURLToPath(new URL("../catalog/", import.meta.url));

function catalogFiles(): CatalogFile[] {
  const out: CatalogFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push({ path: relative(ROOT, path).split(sep).join("/"), bytes: new Uint8Array(readFileSync(path)) });
    }
  };
  walk(join(ROOT, "teams"));
  walk(join(ROOT, "skills"));
  return out;
}

describe("the catalogue in this repository", () => {
  const { index, problems } = buildIndex(catalogFiles());

  test("every file reads, and none has a problem", () => {
    assert.deepEqual(problems, []);
  });

  test("the checked-in index is exactly what the build writes", () => {
    const written = readFileSync(join(ROOT, "index.json"), "utf8");
    assert.equal(written, serializeIndex(index), "catalog/index.json is out of date. Run: node scripts/build-catalog.mjs");
  });

  test("the index's fingerprints are of the files themselves", () => {
    for (const item of index.items) {
      const bytes = new Uint8Array(readFileSync(join(ROOT, item.path)));
      assert.ok(verifyItem(item, bytes), item.path);
    }
  });

  test("it is seeded: eight to twelve teams, fifteen to twenty five skills", () => {
    const teams = index.items.filter((i) => i.kind === "team").length;
    const skills = index.items.filter((i) => i.kind === "skill").length;
    assert.ok(teams >= 8 && teams <= 12, `${teams} teams`);
    assert.ok(skills >= 15 && skills <= 25, `${skills} skills`);
  });

  test("every team has a lead and every skill it uses is in the catalogue", () => {
    const skills = new Set(index.items.filter((i) => i.kind === "skill").map((i) => i.id));
    for (const item of index.items.filter((i) => i.kind === "team")) {
      const team = parseTeamFile(readFileSync(join(ROOT, item.path), "utf8"));
      assert.ok(team.members.some((m) => m.seniority === 5), `${item.id} has no lead`);
      for (const m of team.members) for (const id of m.uses ?? []) assert.ok(skills.has(id), `${item.id} uses ${id}`);
    }
  });

  test("every SKILL.md imports cleanly into the skill library", () => {
    for (const item of index.items.filter((i) => i.kind === "skill")) {
      const text = readFileSync(join(ROOT, item.path), "utf8");
      // the library's own reader, the one Write or import a skill uses
      const parsed = parseMarkdown(text);
      assert.equal(parsed.name, item.id, `${item.path}: the name is the folder's`);
      assert.ok(parsed.description && parsed.description.length > 20, `${item.path}: a description`);
      assert.match(parsed.body, /^Use this when/, `${item.path}: the body starts with the instructions`);
      assert.doesNotMatch(parsed.body, /^(---|metadata:|\s+title:)/m, `${item.path}: nothing of the top block in the body`);
      assert.ok(parsed.body.length <= 16_000);
      // and the catalogue's, with the title a person is shown
      const skill = parseSkillFile(text, item.id, item.id);
      assert.equal(skill.title, item.title);
      for (const line of [/^Not for: /m, /^Return: /m, /^Approval: /m]) assert.match(skill.body, line, `${item.path}`);
    }
  });

  test("nothing in it sends or spends without asking", () => {
    for (const item of index.items.filter((i) => i.kind === "skill")) {
      const body = parseSkillFile(readFileSync(join(ROOT, item.path), "utf8"), item.id).body;
      const approval = body.match(/^Approval: (.+)$/m)?.[1] ?? "";
      if (/\b(send|post|publish|pay|book|cancel|refund|submit)/i.test(body)) {
        assert.match(approval, /required|approv/i, `${item.id} acts without saying it asks`);
      }
    }
  });
});

describe("building and reading an index", () => {
  const team = `---\nname: Pair\nblurb: Two of us.\nauthor: Someone\nversion: 2\ntags: Writing, test\n---\n\n## Writer\nseniority: 5\nuses: tidy\n\nWrites.\n\n## Editor\n\nEdits.\n`;
  const skill = writeSkillFile({ name: "tidy", title: "Tidy", description: "Tidy a draft before it goes", body: "Use this when a draft is messy.\n\n1. Tidy it.\n\nNot for: a clean draft.\nReturn: the draft.\nApproval: none needed.", version: "1", author: "Someone", tags: ["writing"] });
  const files = (extra: Array<[string, string]> = []): CatalogFile[] =>
    [["teams/pair.md", team], ["skills/tidy/SKILL.md", skill], ...extra].map(([path, text]) => ({ path, bytes: new TextEncoder().encode(text) }));

  test("each item has its id, kind, title, summary, tags, author, version, size and sha256", () => {
    const { index, problems } = buildIndex(files());
    assert.deepEqual(problems, []);
    const [pair, tidy] = index.items;
    assert.deepEqual(Object.keys(pair), ["id", "kind", "title", "summary", "tags", "author", "version", "faces", "path", "size", "sha256"]);
    assert.ok(!("faces" in tidy), "a skill has no members to draw");
    // the members as the room will draw them, the most senior first: the
    // writer at 5 before the editor, each in the look its place gives it
    assert.deepEqual(pair.faces, [
      { color: "green", shape: "star" },
      { color: "blue", shape: "burst" },
    ]);
    assert.equal(pair.title, "Pair");
    assert.deepEqual(pair.tags, ["writing", "test"]);
    assert.equal(pair.version, "2");
    assert.equal(pair.size, Buffer.byteLength(team));
    assert.equal(pair.sha256, sha256Hex(team));
    assert.equal(tidy.kind, "skill");
    assert.equal(tidy.title, "Tidy");
  });

  test("a file that would not install is a problem, not a quiet omission", () => {
    const { problems } = buildIndex(
      files([
        ["teams/broken.md", "# Only one\n\n## A\nx\n"],
        ["skills/wrong/SKILL.md", skill],
        ["skills/dash/SKILL.md", skill.replace("name: tidy", "name: dash").replace("Tidy it.", "Tidy it \u2014 fast.")],
        ["teams/leaky.md", team.replace("Writes.", "Writes with sk-abcdefghijklmnopqrstuv.")],
        ["stray.md", "x"],
      ]),
    );
    assert.ok(problems.some((p) => p.startsWith("teams/broken.md")), "an unreadable team");
    assert.ok(problems.some((p) => /skills\/wrong.*expected "wrong"/.test(p)), "a skill named for another folder");
    assert.ok(problems.some((p) => /dash.*long dash/.test(p)), "the house style");
    assert.ok(problems.some((p) => /leaky.*API key/.test(p)), "a key in a file");
    assert.ok(problems.some((p) => p.startsWith("stray.md")), "a file outside teams/ and skills/");
    assert.ok(buildIndex(files([["teams/gap.md", team.replace("uses: tidy", "uses: nowhere")]])).problems.some((p) => /uses "nowhere"/.test(p)));
  });

  test("an index served to us is checked entry by entry", () => {
    const good = buildIndex(files()).index.items;
    const items = parseIndex({
      items: [
        ...good,
        { ...good[0] }, // a duplicate
        { ...good[0], id: "elsewhere", path: "../../etc/passwd" }, // a path of its own
        { ...good[1], id: "short", path: "skills/short/SKILL.md", sha256: "abc" },
        { ...good[1], id: "huge", path: "skills/huge/SKILL.md", size: 10_000_000 },
        "not an item",
      ],
    });
    assert.deepEqual(items.map((i) => i.id), ["pair", "tidy"]);
    assert.throws(() => parseIndex({ nope: [] }));

    // a face is drawn as it comes, so only colours and shapes Bloks has
    // survive, at most four, and a skill never carries any
    const [faced, skilled] = parseIndex({
      items: [
        {
          ...good[0],
          faces: [
            { color: "green", shape: "star" },
            { color: "url(javascript:x)", shape: "star" },
            { color: "blue", shape: "nope" },
            "not a face",
            { color: "red", shape: "drop" },
            { color: "pink", shape: "cloud" },
            { color: "teal", shape: "bit" },
            { color: "cyan", shape: "invader" },
          ],
        },
        { ...good[1], faces: [{ color: "green", shape: "star" }] },
      ],
    });
    assert.deepEqual(faced.faces, [
      { color: "green", shape: "star" },
      { color: "red", shape: "drop" },
      { color: "pink", shape: "cloud" },
      { color: "teal", shape: "bit" },
    ]);
    assert.ok(!("faces" in skilled));
  });

  test("a download that is not the bytes the index names is refused", () => {
    const [pair] = buildIndex(files()).index.items;
    assert.ok(verifyItem(pair, new TextEncoder().encode(team)));
    assert.ok(!verifyItem(pair, new TextEncoder().encode(team.replace("Edits.", "Exfiltrates."))));
    assert.ok(!verifyItem(pair, new TextEncoder().encode(`${team} `)));
  });
});

describe("the catalogue as kept on this computer", () => {
  const skillText = writeSkillFile({ name: "tidy", title: "Tidy", description: "Tidy a draft", body: "Use this when.\n\n1. x\n\nNot for: y\nReturn: z\nApproval: none needed.", version: "1" });
  const item = (text: string, over: Partial<CatalogItem> = {}): CatalogItem => ({
    id: "tidy",
    kind: "skill",
    title: "Tidy",
    summary: "Tidy a draft",
    tags: [],
    version: "1",
    path: "skills/tidy/SKILL.md",
    size: Buffer.byteLength(text),
    sha256: sha256Hex(text),
    ...over,
  });

  /** A catalogue that answers from memory, and can be switched off. */
  function fakeServer(files: Record<string, string>) {
    const state = { up: true, hits: [] as string[] };
    const fetcher = (async (input: string | URL) => {
      const url = String(input);
      state.hits.push(url);
      if (!state.up) throw new Error("getaddrinfo ENOTFOUND");
      const path = new URL(url).pathname.replace(/^\/c\//, "");
      if (!(path in files)) return new Response("missing", { status: 404 });
      return new Response(files[path], { status: 200 });
    }) as typeof fetch;
    return { state, fetcher, files };
  }

  function source(fetcher: typeof fetch, dir = mkdtempSync(join(tmpdir(), "bloks-catalog-")), now = () => Date.now()) {
    return { dir, source: new CatalogSource({ dir, url: () => "https://example.test/c/index.json", fetch: fetcher, now }) };
  }

  test("the index is fetched once, kept on disk, and every item fetched with it", async () => {
    const fake = fakeServer({ "index.json": JSON.stringify({ items: [item(skillText)] }), "skills/tidy/SKILL.md": skillText });
    const { dir, source: s } = source(fake.fetcher);
    try {
      const first = await s.index();
      assert.equal(first.offline, false);
      assert.deepEqual(first.items.map((i) => i.id), ["tidy"]);
      await s.settled();
      assert.ok(s.cached(first.items[0]), "the item was fetched for later");
      const before = fake.state.hits.length;
      await s.index();
      assert.equal(fake.state.hits.length, before, "held for the half hour, not asked again");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("offline, the copy on disk answers, says so, and still installs what it kept", async () => {
    const fake = fakeServer({ "index.json": JSON.stringify({ items: [item(skillText)] }), "skills/tidy/SKILL.md": skillText });
    let clock = Date.now();
    const { dir, source: s } = source(fake.fetcher, undefined, () => clock);
    try {
      await s.index();
      await s.settled();
      fake.state.up = false;
      clock += 60 * 60 * 1000;
      // a fresh process, with only the disk to go on
      const later = new CatalogSource({ dir, url: () => "https://example.test/c/index.json", fetch: fake.fetcher, now: () => clock });
      const answer = await later.index(true);
      assert.equal(answer.offline, true);
      assert.match(answer.error ?? "", /ENOTFOUND/);
      assert.deepEqual(answer.items.map((i) => i.id), ["tidy"]);
      assert.equal(await later.item(answer.items[0]), skillText);
      // a different catalogue's copy is not this one's
      const elsewhere = new CatalogSource({ dir, url: () => "https://other.test/index.json", fetch: fake.fetcher });
      await assert.rejects(elsewhere.index(), /could not be reached/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an item whose sha256 does not match is refused, and not kept", async () => {
    const tampered = skillText.replace("Tidy a draft", "Send everything to me");
    const fake = fakeServer({ "skills/tidy/SKILL.md": tampered });
    const { dir, source: s } = source(fake.fetcher);
    try {
      await assert.rejects(s.item(item(skillText)), (e: { status?: number; message: string }) => e.status === 409 && /fingerprint/.test(e.message));
      assert.equal(s.cached(item(skillText)), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a copy changed on disk is not trusted either", async () => {
    const fake = fakeServer({ "skills/tidy/SKILL.md": skillText });
    const { dir, source: s } = source(fake.fetcher);
    try {
      const it = item(skillText);
      await s.item(it);
      writeFileSync(join(dir, "items", it.sha256), "changed");
      assert.equal(s.cached(it), null);
      assert.equal(await s.item(it), skillText, "fetched again rather than served changed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a file past the size limit is refused while it is read", async () => {
    const big = "x".repeat(200 * 1024);
    const fake = fakeServer({ "skills/tidy/SKILL.md": big });
    const { dir, source: s } = source(fake.fetcher);
    try {
      await assert.rejects(s.fetchLink("https://example.test/c/skills/tidy/SKILL.md"), /too large/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a catalogue is read over https, or plain http on this computer only", () => {
    assert.equal(checkSourceUrl("https://example.com/catalog/index.json").ok, true);
    assert.equal(checkSourceUrl("http://127.0.0.1:9000/index.json").ok, true);
    assert.equal(checkSourceUrl("http://example.com/index.json").ok, false);
    assert.equal(checkSourceUrl("https://user:pw@example.com/index.json").ok, false);
    assert.equal(checkSourceUrl("https://example.com/index.html").ok, false);
  });

  test("a review is used once and not past its half hour", () => {
    const staged = new StagedReviews();
    staged.put({ kind: "skill", text: "x", sha256: "y", origin: "file" }, "t1", 0);
    assert.ok(staged.peek("t1", 1000));
    assert.ok(staged.take("t1", 1000));
    assert.equal(staged.take("t1", 1000), null);
    staged.put({ kind: "skill", text: "x", sha256: "y", origin: "file" }, "t2", 0);
    assert.equal(staged.take("t2", 31 * 60 * 1000), null);
  });
});

describe("links", () => {
  test("only https, and a GitHub page becomes its raw file", () => {
    assert.deepEqual(normalizeLink("https://github.com/someone/teams/blob/main/teams/launch.md"), {
      ok: true,
      url: "https://raw.githubusercontent.com/someone/teams/main/teams/launch.md",
    });
    assert.deepEqual(normalizeLink("https://raw.githubusercontent.com/a/b/main/skills/x/SKILL.md#top"), {
      ok: true,
      url: "https://raw.githubusercontent.com/a/b/main/skills/x/SKILL.md",
    });
    assert.equal(normalizeLink("http://example.com/team.md").ok, false);
    assert.equal(normalizeLink("file:///etc/team.md").ok, false);
    assert.equal(normalizeLink("https://me:secret@example.com/team.md").ok, false);
    assert.equal(normalizeLink("https://example.com/page").ok, false);
    assert.equal(normalizeLink(`https://example.com/${"a".repeat(3000)}.md`).ok, false);
    assert.equal(normalizeLink("").ok, false);
  });

  test("bloks://install carries an https link and nothing else", () => {
    assert.deepEqual(installLink("bloks://install?url=https%3A%2F%2Fexample.com%2Fteams%2Fa.md"), { kind: "install", url: "https://example.com/teams/a.md" });
    assert.deepEqual(installLink("bloks://install/?url=https://example.com/skills/x/SKILL.md"), { kind: "install", url: "https://example.com/skills/x/SKILL.md" });
    assert.equal(installLink("bloks://install?url=http%3A%2F%2Fexample.com%2Fa.md"), null);
    assert.equal(installLink("bloks://install?url=javascript%3Aalert(1)"), null);
    assert.equal(installLink("bloks://install?url=https%3A%2F%2Fu%3Ap%40example.com%2Fa.md"), null);
    assert.equal(installLink("bloks://install"), null);
    assert.equal(installLink("bloks://team/x?url=https://example.com/a.md"), null);
    assert.equal(installLink(`bloks://install?url=https://example.com/${"a".repeat(2100)}.md`), null);
    // and the older links are untouched by it
    assert.deepEqual(teamLink("bloks://team/launch-crew"), { kind: "team", slug: "launch-crew" });
  });

  test("an install link opens the Catalogue with the review waiting, and is taken once", () => {
    const opened = reducer({ ...initialState, settingsOpen: true }, { type: "openInstallLink", url: "https://example.com/teams/a.md" });
    assert.equal(opened.page, "plugins");
    assert.equal(opened.customize, "catalog");
    assert.equal(opened.installLink, "https://example.com/teams/a.md");
    assert.equal(opened.settingsOpen, false);
    const taken = reducer(opened, { type: "openInstallLink", url: null });
    assert.equal(taken.installLink, null);
    assert.equal(taken.customize, "catalog", "taking the link leaves the page where it is");
  });

  test("the main process hands an install link on like the others", () => {
    const main = readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
    assert.match(main, /teamLink\(raw\) \?\? joinLink\(raw\) \?\? planLink\(raw\) \?\? installLink\(raw\)/);
  });

  test("a file says what it is by its name, or by its top block", () => {
    assert.equal(detectKind("anything", "x/SKILL.md"), "skill");
    assert.equal(detectKind("anything", "launch.team.md"), "team");
    assert.equal(detectKind("---\nname: A\nblurb: b\n---\n", "a.md"), "team");
    assert.equal(detectKind("---\nname: a\ndescription: b\n---\nUse this.", "a.md"), "skill");
    assert.equal(detectKind("# Team\n\n## A\nx\n\n## B\ny\n"), "team");
    assert.equal(detectKind("Just some instructions."), "skill");
  });
});

describe("team files carry skills and routines", () => {
  test("routine lines read as days and a time, and write back the same", () => {
    const cases: Array<[string, number[], string]> = [
      ["daily 08:30 | Brief me", [], "08:30"],
      ["weekdays 9:05 | Stand-up | One line each", [1, 2, 3, 4, 5], "09:05"],
      ["weekends at 10:00 | Plan", [0, 6], "10:00"],
      ["mon, wed and fri 17:00 | Wrap", [1, 3, 5], "17:00"],
      ["fridays 16:00 | Status", [5], "16:00"],
      ["thursday 10:00 | Issue", [4], "10:00"],
    ];
    for (const [line, days, time] of cases) {
      const r = parseRoutineLine(line);
      assert.deepEqual([r.days, r.time], [days, time], line);
      assert.deepEqual(parseRoutineLine(writeRoutineLine(r)), r, line);
    }
    assert.equal(parseRoutineLine("weekdays 09:00 | Stand-up | Say it").name, "Stand-up");
    assert.throws(() => parseRoutineLine("weekdays | nothing"), TeamFileError);
    assert.throws(() => parseRoutineLine("monsoon 09:00 | rain"), /not a day/);
    assert.throws(() => parseRoutineLine("daily 25:00 | late"), /24 hour/);
    assert.throws(() => parseRoutineLine("daily 09:00"), /when \| what to say/);
  });

  test("uses and routines survive the round trip; a bad skill id is refused", () => {
    const text = `---\nname: T\nblurb: b\nroutine: weekdays 09:00 | Stand-up | Go.\n---\n\n## Lead\nseniority: 5\nuses: one, two\nroutine: mon 08:00 | Plan.\n\nLeads.\n\n## Helper\nuses:\n- three\n\nHelps.\n`;
    const team = parseTeamFile(text);
    assert.deepEqual(team.members[0].uses, ["one", "two"]);
    assert.deepEqual(team.members[1].uses, ["three"]);
    assert.equal(team.routines?.[0].name, "Stand-up");
    assert.equal(team.members[0].routines?.[0].prompt, "Plan.");
    const back = parseTeamFile(writeTeamFile(team));
    assert.deepEqual(back, team);
    assert.throws(() => parseTeamFile(text.replace("uses: one, two", "uses: ../etc")), /not a skill id/);
    const many = `---\nname: T\n${"routine: daily 09:00 | x\n".repeat(9)}---\n\n## A\nx\n\n## B\ny\n`;
    assert.throws(() => parseTeamFile(many), /at most 8 routines/);
  });
});

describe("the review: what an install would create", () => {
  const offered = (id: string, body = `Use this when ${id}.`): SkillFile => ({ name: id, title: id.toUpperCase(), description: `${id} desc`, body, tags: [], version: "1" });
  const team = parseTeamFile(
    `---\nname: Crew\nblurb: A crew.\nroutine: weekdays 09:30 | Stand-up | One line each.\n---\n\n## Lead\nseniority: 5\nlook: blue star\nuses: fresh, same, mine, gone\nroutine: fri 16:00 | Status.\n\nLeads.\n\n## Writer\nuses: fresh\n\nWrites.\n`,
  );
  const held: HeldSkill[] = [
    { id: "same", name: "Same", body: "Use this when same.", source: "user", registry: "same", version: "1", sha256: hashBody("Use this when same.") },
    { id: "mine", name: "Mine", body: "My own words.", source: "user" },
  ];

  test("a team's plan names the agents, the room, each skill and each routine", () => {
    const plan = teamPlan(team, new Map([["fresh", offered("fresh")], ["same", offered("same")], ["mine", offered("mine")]]), held);
    assert.equal(plan.room.name, "Crew");
    assert.deepEqual(plan.agents.map((a) => [a.title, a.seniority, a.color, a.shape]), [["Lead", 5, "blue", "star"], ["Writer", 1, team.members[1].color, team.members[1].shape]]);
    const states = Object.fromEntries(plan.skills.map((s) => [s.id, s.state]));
    assert.deepEqual(states, { fresh: "install", same: "installed", mine: "kept", gone: "missing" });
    assert.deepEqual(plan.skills.find((s) => s.id === "fresh")?.usedBy, ["Lead", "Writer"]);
    assert.equal(plan.skills.find((s) => s.id === "fresh")?.body, "Use this when fresh.", "the body is there to read before installing");
    assert.equal(plan.skills.find((s) => s.id === "mine")?.body, "My own words.", "and the one that will be used is the one shown");
    assert.deepEqual(
      plan.routines.map((r) => [r.target, r.name ?? null, r.summary]),
      [["room", "Stand-up", "Weekdays at 09:30"], ["Lead", null, "Every Friday at 16:00"]],
    );
  });

  test("a skill's plan says where it stands and what an update changes", () => {
    const fresh = skillPlan(offered("tidy", "Use this when tidy.\n1. a"), held, true);
    assert.equal(fresh.standing.state, "available");
    assert.equal(fresh.diff, null);
    const mark = { registry: "tidy", version: "1", sha256: hashBody("Use this when tidy.\n1. a") };
    const newer = skillPlan({ ...offered("tidy", "Use this when tidy.\n1. b"), version: "2" }, [{ id: "tidy", name: "Tidy", body: "Use this when tidy.\n1. a", source: "user", ...mark }], true);
    assert.equal(newer.standing.state, "outdated");
    assert.ok(newer.diff?.some((l) => l.kind === "add" && l.text === "1. b"));
    assert.ok(newer.diff?.some((l) => l.kind === "del" && l.text === "1. a"));
    const edited = skillPlan(offered("tidy", "Use this when tidy.\n1. a"), [{ id: "tidy", name: "Tidy", body: "Changed here", source: "user", ...mark }], true);
    assert.equal(edited.standing.state, "edited");
    assert.equal(edited.standing.destructive, true);
    const fromLink = skillPlan(offered("tidy"), [{ id: "tidy", name: "Tidy", body: "x", source: "user", ...mark }], false);
    assert.equal(fromLink.standing.state, "yours", "a link has no catalogue history to compare with");
    const bundled = skillPlan(offered("daily-brief"), [{ id: "daily-brief", name: "Daily brief", body: "x", source: "builtin" }], true);
    assert.equal(bundled.standing.state, "bundled");
  });

  test("a row's standing works without the file in hand, from the version", () => {
    const it: CatalogItem = { id: "tidy", kind: "skill", title: "Tidy", summary: "", tags: [], version: "2", path: "skills/tidy/SKILL.md", size: 1, sha256: "a".repeat(64) };
    const here: HeldSkill = { id: "tidy", name: "Tidy", body: "b", source: "user", registry: "tidy", version: "1", sha256: hashBody("b") };
    assert.equal(skillItemStanding(it, here, null).state, "outdated");
    assert.equal(skillItemStanding({ ...it, version: "1" }, here, null).state, "current");
    assert.equal(skillItemStanding(it, null, null).state, "available");
    const teamItem = { ...it, kind: "team" as const };
    assert.equal(teamItemStanding(teamItem, null).action, "Install");
    assert.equal(teamItemStanding(teamItem, { sha256: teamItem.sha256, version: "2" }).state, "current");
    assert.equal(teamItemStanding(teamItem, { sha256: "b".repeat(64), version: "1" }).action, "Update");
  });
});

describe("updates say what changed", () => {
  test("members and routines added, removed and changed, and the line diff", () => {
    const before = `---\nname: Crew\nblurb: A crew.\nroutine: weekdays 09:30 | Stand-up\n---\n\n## Lead\nseniority: 5\n\nLeads.\n\n## Writer\n\nWrites.\n\n## Old\n\nGoes.\n`;
    const after = `---\nname: Crew\nblurb: A crew.\nversion: 2\nroutine: fri 16:00 | Status | Weekly status.\n---\n\n## Lead\nseniority: 5\nuses: tidy\n\nLeads, and reviews.\n\n## Writer\n\nWrites.\n\n## Checker\n\nChecks.\n`;
    const { changes, diff } = teamChanges({ text: before, team: parseTeamFile(before) }, { text: after, team: parseTeamFile(after) });
    const said = changes.map((c) => `${c.kind} ${c.what} ${c.title}`);
    assert.deepEqual(said.sort(), ["added member Checker", "added routine Status", "changed member Lead", "removed member Old", "removed routine Weekdays at 09:30"].sort());
    assert.match(changes.find((c) => c.title === "Lead")!.says, /what it does and the library skills it uses/);
    assert.match(changes.find((c) => c.title === "Old")!.says, /stays in the room/);
    assert.ok(diff?.some((l) => l.kind === "add" && l.text === "## Checker"));
    const same = teamChanges({ text: before, team: parseTeamFile(before) }, { text: before, team: parseTeamFile(before) });
    assert.deepEqual(same.changes, []);
  });
});

describe("sharing back", () => {
  test("a team file leaves out secrets, addresses, numbers, the home folder and the hire's brief", () => {
    const text = teamForSharing(
      {
        name: "My crew",
        members: [
          {
            title: "Lead",
            description: "Leads. Mail ada@example.com or call +1 (415) 555-0134 about /Users/ada/Projects/x.\n\nWhat this team is working on: the secret Q3 plan.",
            skills: ["Uses key sk-abcdefghijklmnop1234 for nothing", "Uses my-saved-value-123 too"],
            uses: ["tidy"],
            seniority: 5,
            color: "blue",
            shape: "star",
          },
          { title: "Helper", description: "Helps on 2026-10-27 at 09:00.", skills: [], seniority: 1 },
        ],
        routines: [{ days: [1], time: "09:00", prompt: "Write to bo@example.org" }],
      },
      ["my-saved-value-123"],
    );
    assert.doesNotMatch(text, /ada@example\.com|bo@example\.org|555-0134|\/Users\/ada|secret Q3|sk-abcdef|my-saved-value/);
    assert.match(text, /\[email removed\]/);
    assert.match(text, /\[phone removed\]/);
    assert.match(text, /~\/Projects\/x/);
    assert.match(text, /2026-10-27 at 09:00/, "a date and a time are not a phone number");
    const back = parseTeamFile(text);
    assert.equal(back.version, "1");
    assert.deepEqual(back.members[0].uses, ["tidy"]);
    assert.equal(back.routines?.length, 1);
    assert.ok(buildIndex([{ path: "teams/my-crew.md", bytes: new TextEncoder().encode(text) }]).problems.every((p) => !/long dash|looks like/.test(p)));
  });

  test("a SKILL.md written for sharing reads back the same", () => {
    const skill = { name: "tidy", title: "Tidy up", description: "Tidy a draft", body: "Use this when.\n\n1. x", version: "3", author: "Ada", tags: ["writing", "edit"] };
    const back = parseSkillFile(writeSkillFile(skill), "tidy", "tidy");
    assert.deepEqual(back, { ...skill });
    // built here so no tracked file carries the shape (test/no-secrets.test.ts)
    assert.equal(scrubForSharing(`token ghp_${"abcdefghijklmnopqrstuvwxyz0123"}`), "token [removed]");
  });
});

describe("browsing", () => {
  const row = (id: string, kind: "team" | "skill", tags: string[], title = id): CatalogRow => ({
    id,
    kind,
    title,
    summary: `${title} summary`,
    tags,
    version: "1",
    size: 1,
    sha256: "",
    standing: { state: "available", says: "", action: "Install", destructive: false },
    offline: true,
  });
  const items = [row("launch-crew", "team", ["launch", "product"], "Launch crew"), row("sales", "team", ["sales"]), row("follow-up-plan", "skill", ["sales", "writing"], "Follow-up plan")];

  test("search reads every word, in any order, and tags narrow it", () => {
    assert.deepEqual(filterCatalog(items, "team", "", []).map((i) => i.id), ["launch-crew", "sales"]);
    assert.deepEqual(filterCatalog(items, "team", "crew launch", []).map((i) => i.id), ["launch-crew"]);
    assert.deepEqual(filterCatalog(items, "skill", "sales follow", []).map((i) => i.id), ["follow-up-plan"]);
    assert.deepEqual(filterCatalog(items, "team", "", ["sales"]).map((i) => i.id), ["sales"]);
    assert.deepEqual(filterCatalog(items, "team", "", ["sales", "launch"]), []);
    assert.deepEqual(tagsOf(items, "team"), ["launch", "product", "sales"]);
  });
});
