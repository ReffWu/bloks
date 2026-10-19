// Moving around in a conversation from outside it: the starters an empty
// conversation offers, and the asks the ⌘K palette leaves for the
// conversation it opens (landing on a message, find, the terminal).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AGENT_TEMPLATES } from "../src/lib/agentTemplates.ts";
import { startersFor } from "../src/lib/starters.ts";
import { ASK_TTL, askChat, onAsk, peekAsk, takeAsk } from "../src/lib/chatAsk.ts";

describe("starters for an empty conversation", () => {
  test("every role has three of its own, short and plain", () => {
    const generic = startersFor({ name: "Zed", title: "", description: "" });
    for (const role of AGENT_TEMPLATES) {
      const starters = startersFor({ name: role.name, title: role.title, description: role.description });
      assert.equal(starters.length, 3, role.id);
      assert.notDeepEqual(starters, generic, `${role.id} fell back to the generic three`);
      for (const s of starters) {
        assert.ok(s.label.split(" ").length <= 4, `${role.id}: "${s.label}" is long for a card`);
        assert.ok(s.prompt.length <= 140, `${role.id}: a starter is a nudge, not an essay`);
        assert.doesNotMatch(`${s.label} ${s.prompt}`, /[\u2013\u2014]/, `${role.id} has a dash`);
      }
    }
  });

  test("a renamed agent is still known by what it does", () => {
    const writer = AGENT_TEMPLATES.find((t) => t.id === "writer")!;
    const starters = startersFor({ name: "Quill", title: writer.title, description: writer.description });
    assert.deepEqual(starters, startersFor({ name: "Writer" }));
  });

  test("an agent like no role gets three that suit any job", () => {
    const starters = startersFor({ name: "Zed", title: "Odd jobs", description: "" });
    assert.equal(starters.length, 3);
    assert.ok(starters.every((s) => s.prompt.trim()));
  });
});

describe("asks for a conversation", () => {
  test("a landing waits for its agent, and is taken once", () => {
    askChat({ kind: "land", botId: "a", threadId: "t", messageId: "m" }, 1000);
    assert.equal(peekAsk("b", 1000), null, "another agent never takes it");
    const ask = peekAsk("a", 1500);
    assert.deepEqual(ask && { ...ask, at: undefined }, { kind: "land", botId: "a", threadId: "t", messageId: "m", at: undefined });
    takeAsk(ask!);
    assert.equal(peekAsk("a", 1500), null);
  });

  test("taking an old ask never clears a newer one", () => {
    askChat({ kind: "find", botId: "a" }, 1000);
    const old = peekAsk("a", 1000)!;
    askChat({ kind: "terminal", botId: "a" }, 1001);
    takeAsk(old);
    assert.equal(peekAsk("a", 1002)?.kind, "terminal");
    takeAsk(peekAsk("a", 1002)!);
  });

  test("an ask nobody takes is forgotten", () => {
    askChat({ kind: "find", botId: "a" }, 1000);
    assert.equal(peekAsk("a", 1000 + ASK_TTL + 1), null);
    assert.equal(peekAsk("a", 1000), null, "and stays forgotten");
  });

  test("listeners hear each ask until they stop", () => {
    let heard = 0;
    const stop = onAsk(() => heard++);
    askChat({ kind: "find", botId: "a" });
    stop();
    askChat({ kind: "find", botId: "a" });
    assert.equal(heard, 1);
    takeAsk(peekAsk("a")!);
  });
});
