// The new agent screen's draft, client side (src/lib/agentDraft.ts): a
// draft only ever fills what the person has not typed into, and asking
// while typing costs one call per settled job, never one per keystroke.
import { test } from "node:test";
import assert from "node:assert/strict";

import { asDraft, createDrafter, mergeDraft, worthDrafting, type DraftFields } from "../src/lib/agentDraft.ts";

const guess: DraftFields = {
  name: "Inbox",
  title: "Keep my inbox at zero",
  description: "",
  skills: ["Triage: sort it"],
  skillIds: [],
};

test("a draft fills every field the person has not touched", () => {
  const { fields, filled } = mergeDraft(
    guess,
    { name: "Maya", title: "Keeps the inbox at zero", description: "You own the inbox.", skills: ["Sweep: daily"], skillIds: ["inbox-triage"] },
    new Set(),
  );
  assert.deepEqual(fields, {
    name: "Maya",
    title: "Keeps the inbox at zero",
    description: "You own the inbox.",
    skills: ["Sweep: daily"],
    skillIds: ["inbox-triage"],
  });
  assert.deepEqual(filled.sort(), ["description", "name", "skillIds", "skills", "title"]);
});

test("what the person typed stays theirs, and silence keeps the guess", () => {
  const { fields, filled } = mergeDraft(
    { ...guess, name: "Pat", skills: ["Mine: my way"] },
    { name: "Maya", skills: ["Sweep: daily"] },
    new Set(["name", "skills"]),
  );
  assert.equal(fields.name, "Pat");
  assert.deepEqual(fields.skills, ["Mine: my way"]);
  // the draft said nothing of the title, so the guess stands, unhinted
  assert.equal(fields.title, guess.title);
  assert.deepEqual(filled, []);
});

test("only the shapes asked for come off the wire", () => {
  assert.deepEqual(asDraft({ name: " Maya ", title: 4, skills: ["a", 2, ""], skillIds: "x", extra: true }), {
    name: "Maya",
    skills: ["a"],
  });
  assert.deepEqual(asDraft(null), { skills: [] });
});

test("a single word is not worth a call yet", () => {
  assert.equal(worthDrafting("accountant"), false);
  assert.equal(worthDrafting("do it"), false);
  assert.equal(worthDrafting("chase my invoices"), true);
});

/** A fetcher the test answers by hand, recording what was asked. */
function fakeFetch() {
  const asked: Array<{ body: { description: string; again?: boolean; avoid?: string[] }; signal: AbortSignal; answer: (v: unknown) => void }> = [];
  const fetcher = (body: { description: string; again?: boolean; avoid?: string[] }, signal: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      asked.push({ body, signal, answer: resolve });
    });
  return { asked, fetcher };
}

test("newer words abort the call for older ones", async () => {
  const { asked, fetcher } = fakeFetch();
  const drafter = createDrafter(fetcher);
  const old = drafter.ask("chase my invoices");
  const now = drafter.ask("chase my invoices weekly");
  assert.equal(asked.length, 2);
  assert.equal(asked[0].signal.aborted, true);
  assert.equal(asked[1].signal.aborted, false);
  await assert.rejects(old, /aborted/);
  asked[1].answer({ name: "Maya", skills: [] });
  assert.equal((await now).name, "Maya");
});

test("the same job joins the call on its way, and is kept once answered", async () => {
  const { asked, fetcher } = fakeFetch();
  const drafter = createDrafter(fetcher);
  const a = drafter.ask("chase my invoices");
  const b = drafter.ask("  Chase my   invoices ");
  assert.equal(asked.length, 1);
  asked[0].answer({ name: "Maya", skills: [] });
  assert.equal(await a, await b);
  assert.equal(drafter.kept("chase my invoices")?.name, "Maya");
  await drafter.ask("chase my invoices");
  assert.equal(asked.length, 1, "a kept draft was asked for again");
});

test("another asks again, naming what to avoid, and an empty answer is not kept", async () => {
  const { asked, fetcher } = fakeFetch();
  const drafter = createDrafter(fetcher);
  const first = drafter.ask("chase my invoices");
  asked[0].answer({ skills: [] });
  await first;
  assert.equal(drafter.kept("chase my invoices"), undefined);
  const again = drafter.ask("chase my invoices", { again: true, avoid: ["Maya", ""] });
  assert.deepEqual(asked[1].body, { description: "chase my invoices", again: true, avoid: ["Maya"] });
  asked[1].answer({ name: "Theo", skills: [] });
  assert.equal((await again).name, "Theo");
});

test("stopping aborts what is out", () => {
  const { asked, fetcher } = fakeFetch();
  const drafter = createDrafter(fetcher);
  drafter.ask("chase my invoices").catch(() => {});
  drafter.stop();
  assert.equal(asked[0].signal.aborted, true);
});
