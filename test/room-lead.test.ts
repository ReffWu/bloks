// A room's lead, chosen per room. Seniority is an agent's everywhere, so
// the person crowns a member for one room instead, and every part of the
// room that means "the lead" follows the crown: who a lead-only room
// wakes, what the briefing tells each member, who speaks last. Without a
// crown, or with the crowned member gone, the room is on seniority as it
// always was.
import { test } from "node:test";
import assert from "node:assert/strict";

import { leadOf, ranksForExport } from "../server/bloks.ts";
import { roomLead } from "../src/lib/roomLead.ts";
import { startHarness } from "./helpers/server.ts";
import { agentOn, fakeProvider, waitFor } from "./helpers/turns.ts";

const ada = { id: "ada", seniority: 3 };
const bo = { id: "bo", seniority: 5 };
const cy = { id: "cy", seniority: 5 };
const di = { id: "di" };

test("with no crown the most senior leads, ties to whoever is listed first", () => {
  for (const rule of [leadOf, roomLead]) {
    assert.equal(rule([ada, bo, cy])?.id, "bo");
    assert.equal(rule([ada, cy, bo])?.id, "cy");
    assert.equal(rule([di, ada])?.id, "ada");
    assert.equal(rule<typeof ada>([]), null);
    assert.equal(rule([ada, bo], null)?.id, "bo");
  }
});

test("a crown outranks seniority, and a crown on someone absent falls through", () => {
  for (const rule of [leadOf, roomLead]) {
    assert.equal(rule([ada, bo, cy], "ada")?.id, "ada");
    assert.equal(rule([ada, bo, cy], "di")?.id, "bo");
    // the caller passes only who can answer: an archived lead is absent
    assert.equal(rule([bo, cy], "ada")?.id, "bo");
  }
});

test("a team file carries the crown as seniority, and a room on seniority as it is", () => {
  assert.deepEqual([...ranksForExport([ada, bo, cy], "ada")], [["ada", 5], ["bo", 4], ["cy", 4]]);
  assert.deepEqual([...ranksForExport([ada, bo, cy], null)], [["ada", 3], ["bo", 5], ["cy", 5]]);
  // crowning the one seniority already picks changes nothing
  assert.deepEqual([...ranksForExport([ada, bo, cy], "bo")], [["ada", 3], ["bo", 5], ["cy", 5]]);
});

test("the room API takes a lead on a member, refuses one elsewhere, and drops it with its member", async (t) => {
  const h = await startHarness();
  t.after(() => h.stop());
  const hire = async (name: string, seniority?: number) =>
    (await h.json("/api/bots", { method: "POST", body: JSON.stringify({ name, ...(seniority ? { seniority } : {}) }) })).bot.id as string;
  const senior = await hire("Senior", 5);
  const junior = await hire("Junior");
  const third = await hire("Third");
  const outsider = await hire("Outsider");

  const plain = await h.json("/api/bloks", { method: "POST", body: JSON.stringify({ name: "Plain", memberIds: [senior, junior] }) });
  assert.equal(plain.blok.leadId, null, "a room says it has no crown rather than leaving it out");

  for (const leadId of [outsider, "nobody", 7, { id: junior }]) {
    const refused = await h.fetch("/api/bloks", {
      method: "POST",
      body: JSON.stringify({ name: "Refused", memberIds: [senior, junior], leadId }),
    });
    assert.equal(refused.status, 400, `a lead of ${JSON.stringify(leadId)} was taken`);
  }

  const made = await h.json("/api/bloks", {
    method: "POST",
    body: JSON.stringify({ name: "Crowned", memberIds: [senior, junior, third], leadId: junior }),
  });
  assert.equal(made.blok.leadId, junior);
  const listed = (await h.json("/api/bloks")).bloks;
  assert.equal(listed.find((b: any) => b.id === made.blok.id).leadId, junior);
  assert.equal(listed.find((b: any) => b.id === plain.blok.id).leadId, null);

  const room = `/api/bloks/${made.blok.id}`;
  assert.equal((await h.fetch(room, { method: "PATCH", body: JSON.stringify({ leadId: outsider }) })).status, 400);
  // a lead checked against the roster the same request leaves behind
  assert.equal(
    (await h.fetch(room, { method: "PATCH", body: JSON.stringify({ memberIds: [senior, junior], leadId: third }) })).status,
    400,
  );
  assert.equal((await h.json(room, { method: "PATCH", body: JSON.stringify({ leadId: third }) })).blok.leadId, third);
  assert.equal((await h.json(room, { method: "PATCH", body: JSON.stringify({ leadId: null }) })).blok.leadId, null);
  assert.equal((await h.json(room, { method: "PATCH", body: JSON.stringify({ leadId: junior }) })).blok.leadId, junior);
  // an edit that says nothing of the lead leaves it alone
  assert.equal((await h.json(room, { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) })).blok.leadId, junior);

  // taking the lead out of the room takes the crown with it
  const after = await h.json(room, { method: "PATCH", body: JSON.stringify({ memberIds: [senior, third] }) });
  assert.equal(after.blok.leadId, null);

  // and so does deleting the agent that wore it
  const again = await h.json("/api/bloks", {
    method: "POST",
    body: JSON.stringify({ name: "Again", memberIds: [senior, third], leadId: third }),
  });
  assert.equal((await h.fetch(`/api/bots/${third}?forget=1`, { method: "DELETE" })).status, 200);
  const gone = (await h.json("/api/bloks")).bloks.find((b: any) => b.id === again.blok.id);
  assert.equal(gone.leadId, null);

  // the team file crowns whoever the room crowned
  const crowned = await h.json("/api/bloks", {
    method: "POST",
    body: JSON.stringify({ name: "Export", memberIds: [senior, junior], leadId: junior }),
  });
  const manifest = await h.json(`/api/bloks/${crowned.blok.id}/manifest`);
  assert.deepEqual(manifest.members.map((m: any) => [m.name, m.seniority]), [["Senior", 4], ["Junior", 5]]);
});

/** The briefing a member's turn carries names the lead, so which member
 * a call was for, and whom it was told leads, can both be read off it. */
const briefedAs = (body: string, room: string) => {
  if (!body.includes(`You are in \\"${room}\\"`)) return null;
  const you = body.match(/- (\w+) \(you\)/)?.[1];
  const lead = body.match(/- (\w+)(?: \(you\))?: [^\\]*, lead\\n/)?.[1];
  return { you, lead, leading: body.includes("You lead this room") };
};

test("a lead-only room wakes its crowned lead, and seniority when there is none", async (t) => {
  const provider = await fakeProvider(t);
  provider.state.answerAtOnce = true;
  const h = await startHarness();
  t.after(() => h.stop());
  const senior = await agentOn(h, provider.port, "Senior");
  const junior = await agentOn(h, provider.port, "Junior");
  assert.equal((await h.fetch(`/api/bots/${senior.id}`, { method: "PATCH", body: JSON.stringify({ seniority: 5 }) })).status, 200);

  const ask = async (room: string, leadId?: string) => {
    const { blok } = await h.json("/api/bloks", {
      method: "POST",
      body: JSON.stringify({ name: room, memberIds: [senior.id, junior.id], ...(leadId ? { leadId } : {}) }),
    });
    await h.json(`/api/bloks/${blok.id}`, { method: "PATCH", body: JSON.stringify({ leadOnly: true }) });
    await h.fetch(`/api/bloks/${blok.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Where are we?" }) });
    const heard = () => provider.state.calls.map((c) => briefedAs(c, room)).filter(Boolean);
    await waitFor(() => (heard().length ? true : null));
    // a moment for anyone else it might wrongly have woken
    await new Promise((r) => setTimeout(r, 400));
    return heard();
  };

  const ranked = await ask("Ranked");
  assert.deepEqual(ranked.map((b) => b!.you), ["Senior"], "a room with no crown woke someone other than the most senior");
  assert.equal(ranked[0]!.lead, "Senior");
  assert.ok(ranked[0]!.leading);

  const crowned = await ask("Crowned", junior.id);
  assert.deepEqual(crowned.map((b) => b!.you), ["Junior"], "the crowned lead was not the one woken");
  assert.equal(crowned[0]!.lead, "Junior", "the briefing named someone else as the lead");
  assert.ok(crowned[0]!.leading, "the crowned lead was not told it leads");
});
