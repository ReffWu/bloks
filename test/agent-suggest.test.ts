// POST /api/agents/suggest over real HTTP, against a stand-in engine
// that answers with a draft: what the route refuses, what it checks in
// a reply before showing it, and that the same job is drafted once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { startHarness } from "./helpers/server.ts";

const REPLY = [
  "Sure, here it is.",
  "NAME: Nova",
  "TITLE: Chases unpaid invoices.",
  "PERSONA: You own the unpaid invoices. You check what is overdue each morning and draft a polite nudge for each.",
  "You never send anything without approval.",
  "SKILL: Overdue sweep: each morning, list invoices past due with amount and days late",
  "SKILL: Nudge draft: write a short, polite reminder for one invoice",
  "SKILL: 1. Overdue sweep: each morning, list invoices past due with amount and days late",
  "LIBRARY: outreach-draft, not-a-skill",
].join("\n");

test("the suggest route refuses bad asks, checks the reply, and drafts a job once", async (t) => {
  const asked: string[] = [];
  const provider = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "grok-4" }] }));
      asked.push(body);
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: REPLY } }] }));
    });
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", () => r()));
  t.after(() => {
    provider.closeAllConnections();
    provider.close();
  });
  const port = (provider.address() as { port: number }).port;

  const h = await startHarness();
  t.after(() => h.stop());
  const suggest = (body: unknown) => h.fetch("/api/agents/suggest", { method: "POST", body: JSON.stringify(body) });

  assert.equal((await suggest({ description: "   " })).status, 400);
  assert.equal((await suggest({ description: 7 })).status, 400);
  assert.equal((await suggest({ description: "x".repeat(2_001) })).status, 413);
  // no engine that can draft: an empty answer, never an error
  assert.deepEqual(await (await suggest({ description: "chase my invoices" })).json(), { skills: [] });

  await h.json("/api/providers/grok/connect", { method: "POST", body: JSON.stringify({ key: "test-key", url: `http://127.0.0.1:${port}` }) });
  // somebody already has the name the stand-in always offers
  await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name: "Nova" }) });
  // the engine pick is kept briefly; let the empty one lapse
  await new Promise((r) => setTimeout(r, 5_100));

  const res = await suggest({ description: "Chase my unpaid invoices" });
  assert.equal(res.status, 200);
  const draft = (await res.json()) as any;
  assert.equal(draft.name, undefined, "a name already in use was offered");
  assert.equal(draft.title, "Chases unpaid invoices");
  assert.match(draft.description, /^You own the unpaid invoices\..*without approval\.$/);
  assert.deepEqual(draft.skills, [
    "Overdue sweep: each morning, list invoices past due with amount and days late",
    "Nudge draft: write a short, polite reminder for one invoice",
  ]);
  assert.deepEqual(draft.skillIds, ["outreach-draft"]);
  assert.equal(asked.length, 1);
  // the prompt offered the library and named the name in use
  assert.match(asked[0], /outreach-draft/);
  assert.match(asked[0], /must not be any of: [^"]*Nova/);

  // the same job, typed differently, is the draft already written
  await suggest({ description: "  chase my UNPAID   invoices " });
  assert.equal(asked.length, 1);
  // another is another call, avoiding what was offered
  await suggest({ description: "Chase my unpaid invoices", again: true, avoid: ["Theo"] });
  assert.equal(asked.length, 2);
  assert.match(asked[1], /must not be any of: [^"]*Theo/);
});
