// Drafting an agent from a sentence, including the replies models
// actually send rather than the one we asked for.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DRAFT_LIMITS, DraftCache, draftKey, draftPrompt, parseDraft } from "../server/draft.ts";

describe("parseDraft", () => {
  test("the shape we asked for", () => {
    const draft = parseDraft(
      [
        "NAME: Shopper",
        "TITLE: Finds the best price on anything",
        "PERSONA: You are my shopper. You watch prices across the stores I care about and tell me when something is genuinely worth buying. You never pad a recommendation to look busy.",
        "SKILL: Price sweep: check the usual stores and report the real current price, not the list price",
        "SKILL: Deal check: say plainly whether a discount is real against its 90 day history",
      ].join("\n"),
    );
    assert.equal(draft.name, "Shopper");
    assert.equal(draft.title, "Finds the best price on anything");
    assert.match(draft.description!, /^You are my shopper\./);
    assert.equal(draft.skills.length, 2);
    assert.match(draft.skills[0], /^Price sweep:/);
  });

  test("a persona wrapped over several lines is joined", () => {
    const draft = parseDraft("PERSONA: You are careful.\nYou check twice.\nSKILL: Checking: twice");
    assert.equal(draft.description, "You are careful. You check twice.");
    assert.deepEqual(draft.skills, ["Checking: twice"]);
  });

  test("a chatty preamble is dropped", () => {
    const draft = parseDraft("Sure! Here you go:\n\nNAME: Scout\nTITLE: Reads the market");
    assert.equal(draft.name, "Scout");
    assert.equal(draft.title, "Reads the market");
  });

  test("quotes and a trailing full stop are trimmed", () => {
    const draft = parseDraft('NAME: "Shopper"\nTITLE: Finds deals.');
    assert.equal(draft.name, "Shopper");
    assert.equal(draft.title, "Finds deals");
  });

  test("a numbered skill loses its number", () => {
    const draft = parseDraft("SKILL: 1. Sweeping: do the sweep");
    assert.deepEqual(draft.skills, ["Sweeping: do the sweep"]);
  });

  test("lower case labels still parse", () => {
    assert.equal(parseDraft("name: Shopper").name, "Shopper");
  });

  test("a partial reply is still useful", () => {
    const draft = parseDraft("NAME: Shopper");
    assert.equal(draft.name, "Shopper");
    assert.equal(draft.title, undefined);
    assert.deepEqual(draft.skills, []);
  });

  test("nothing usable gives empty skills and no fields", () => {
    assert.deepEqual(parseDraft("I cannot help with that"), { skills: [] });
  });

  test("every field is cut to its limit, at a word where there is one", () => {
    const words = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");
    const draft = parseDraft(
      `NAME: ${"n".repeat(80)}\nTITLE: ${words(40, "title")}\nPERSONA: ${words(600, "persona")}\n` +
        Array.from({ length: 12 }, (_, i) => `SKILL: Skill ${i}: ${"s".repeat(400)}`).join("\n"),
    );
    // eighty letters is not anybody's name, so the screen keeps its own
    assert.equal(draft.name, undefined);
    assert.ok(draft.title!.length <= DRAFT_LIMITS.title);
    assert.match(draft.title!, /title$/, "a title was cut through a word");
    assert.ok(draft.description!.length <= DRAFT_LIMITS.description);
    assert.match(draft.description!, /persona$/);
    assert.equal(draft.skills.length, DRAFT_LIMITS.skills);
    assert.equal(draft.skills[0].length, DRAFT_LIMITS.skill);
  });
});

describe("what a draft has to be to be shown", () => {
  test("a name is a person's, and one already taken is left to the screen", () => {
    assert.equal(parseDraft("NAME: maya").name, "Maya");
    assert.equal(parseDraft("NAME: Mary Jane").name, "Mary Jane");
    assert.equal(parseDraft("NAME: **Theo**").name, "Theo");
    assert.equal(parseDraft("NAME: Inbox Manager").name, undefined);
    assert.equal(parseDraft("NAME: Deal Hunter Bot").name, undefined);
    assert.equal(parseDraft("NAME: R2-D2").name, undefined);
    assert.equal(parseDraft("NAME: Maya", { taken: ["maya"] }).name, undefined);
    assert.equal(parseDraft("NAME: Maya", { avoid: ["Maya"] }).name, undefined);
  });

  test("a persona too short to be one is dropped, a title starts with a capital", () => {
    const draft = parseDraft("TITLE: keeps the inbox at zero.\nPERSONA: You help.");
    assert.equal(draft.title, "Keeps the inbox at zero");
    assert.equal(draft.description, undefined);
  });

  test("the same skill twice is one skill, and bullets are not part of it", () => {
    const draft = parseDraft("SKILL: - Triage: sort the inbox\nSKILL: * triage: sort the inbox\nSKILL: 2) Reply: draft answers\nSKILL: 3D renders: for product shots");
    assert.deepEqual(draft.skills, ["Triage: sort the inbox", "Reply: draft answers", "3D renders: for product shots"]);
  });

  test("library picks are only ids the library has, three at most", () => {
    const library = ["daily-brief", "inbox-triage", "meeting-prep", "weekly-review"].map((id) => ({ id, name: id, description: "" }));
    const draft = parseDraft("LIBRARY: inbox-triage, made-up, Daily-Brief, meeting-prep, weekly-review", { library });
    assert.deepEqual(draft.skillIds, ["inbox-triage", "daily-brief", "meeting-prep"]);
    assert.equal(parseDraft("LIBRARY: none", { library }).skillIds, undefined);
    // nothing offered, nothing taken
    assert.equal(parseDraft("LIBRARY: inbox-triage").skillIds, undefined);
  });
});

describe("the prompt", () => {
  test("carries the description and asks for the labels", () => {
    const prompt = draftPrompt("  browse digital stores  ");
    assert.match(prompt, /"browse digital stores"/);
    for (const label of ["NAME:", "TITLE:", "PERSONA:", "SKILL:"]) assert.ok(prompt.includes(label));
    assert.ok(!prompt.includes("LIBRARY:"), "asked for library picks with no library to pick from");
  });

  test("offers the library and names the names to avoid", () => {
    const prompt = draftPrompt("triage my inbox", {
      taken: ["Nova"],
      avoid: ["Maya"],
      library: [{ id: "inbox-triage", name: "Inbox triage", description: "Sort the inbox\ninto now, later and never" }],
    });
    assert.match(prompt, /LIBRARY:/);
    assert.match(prompt, /- inbox-triage: Inbox triage\. Sort the inbox into now, later and never/);
    assert.match(prompt, /must not be any of: Nova, Maya/);
  });

  test("names the letter the name starts with, and only a letter", () => {
    assert.match(draftPrompt("triage my inbox", { initial: "M" }), /starts with the letter M\./);
    assert.ok(!draftPrompt("triage my inbox", { initial: "Mx" }).includes("starts with the letter"));
  });
});

describe("DraftCache", () => {
  const draft = { name: "Maya", skills: [] };

  test("one call for the same job, whether asked together or after", async () => {
    const cache = new DraftCache();
    let calls = 0;
    const make = () => (calls++, new Promise<typeof draft>((r) => setTimeout(() => r(draft), 10)));
    const [a, b] = await Promise.all([cache.get("k", make), cache.get("k", make)]);
    assert.equal(a, b);
    await cache.get("k", make);
    assert.equal(calls, 1);
    // asked for another, it calls again
    await cache.get("k", make, true);
    assert.equal(calls, 2);
  });

  test("an empty draft or a failed call is not kept", async () => {
    const cache = new DraftCache();
    let calls = 0;
    await cache.get("k", async () => (calls++, { skills: [] }));
    await cache.get("k", async () => (calls++, { skills: [] }));
    await assert.rejects(cache.get("j", async () => (calls++, Promise.reject(new Error("down")))));
    await cache.get("j", async () => (calls++, draft));
    assert.equal(calls, 4);
  });

  test("it holds only so many, dropping the longest unused", async () => {
    const cache = new DraftCache(2);
    let calls = 0;
    const make = async () => (calls++, draft);
    await cache.get("a", make);
    await cache.get("b", make);
    await cache.get("a", make);
    await cache.get("c", make);
    assert.equal(calls, 3);
    await cache.get("a", make);
    assert.equal(calls, 3, "the one just read was dropped");
    await cache.get("b", make);
    assert.equal(calls, 4);
  });

  test("the key ignores spacing and capitals", () => {
    assert.equal(draftKey("  Triage   my\nInbox "), "triage my inbox");
  });
});
