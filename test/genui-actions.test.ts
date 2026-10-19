// What a click in an interface answer does. Three things can happen, or
// nothing: words back to the same agent, a web page opened, or (in the
// renderer) the answer's own state changed. Everything else is refused.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formLines, routeAction, safeHttpUrl, saidBack, type GenUiEvent, type GenUiLabels } from "../src/lib/genui/actions.ts";

const ask = (message: string, extra: Partial<GenUiEvent> = {}): GenUiEvent => ({
  type: "continue_conversation",
  humanFriendlyMessage: message,
  params: {},
  ...extra,
});

describe("words back to the agent", () => {
  test("in a chat, to the agent that drew the answer", () => {
    assert.deepEqual(routeAction(ask("Show me Porto"), { kind: "chat", botId: "b1" }), {
      kind: "send",
      botId: "b1",
      text: "Show me Porto",
    });
  });

  test("in a room, addressed to the agent that drew it, so it is that agent who answers", () => {
    assert.deepEqual(routeAction(ask("Show me Porto"), { kind: "room", roomId: "r1", agentName: "Nova" }), {
      kind: "room",
      roomId: "r1",
      text: "@Nova Show me Porto",
    });
  });

  test("where nobody can hear it (a preview, a forwarded quote), nothing is sent", () => {
    assert.deepEqual(routeAction(ask("hello"), null), { kind: "none" });
  });

  test("an empty message sends nothing", () => {
    assert.deepEqual(routeAction(ask("  "), { kind: "chat", botId: "b1" }), { kind: "none" });
  });

  test("Run, custom actions and anything else do nothing", () => {
    for (const type of ["run", "custom_action", "Mutation", "CopyToClipboard"]) {
      assert.deepEqual(routeAction({ type, params: {} }, { kind: "chat", botId: "b1" }), { kind: "none" }, type);
    }
  });
});

describe("what a form sends", () => {
  const labels: GenUiLabels = {
    field: (n) => ({ date: "Date", people: "People", extras: "Extras" })[n],
    option: (n, v) => (n === "people" && v === "4" ? "Four" : n === "extras" && v === "wine" ? "Wine pairing" : undefined),
    order: (n) => ["date", "people", "extras", "budget", "note"].indexOf(n),
  };
  const event = ask("Book it", {
    formName: "booking",
    formState: {
      booking: {
        // stored in the order they were touched, not the order shown
        people: { value: "4", componentType: "Select" },
        note: { value: "", componentType: "TextArea" },
        date: { value: "2026-10-24", componentType: "DatePicker" },
        extras: { value: { cake: false, wine: true }, componentType: "CheckBoxGroup" },
        budget: { value: [40], componentType: "Slider" },
      },
      $tab: "a",
    },
  });

  test("the answers come with the message, readable, in the order they were asked", () => {
    assert.equal(
      saidBack(event, labels),
      "Book it\n\nDate: 2026-10-24\nPeople: Four\nExtras: Wine pairing\nBudget: 40",
    );
  });

  test("empty fields are left out, and the page's own state is not the person's words", () => {
    const lines = formLines(event.formState, "booking", labels);
    assert.ok(!lines.some((l) => l.startsWith("Note")));
    assert.ok(!saidBack(event, labels).includes("tab"));
  });

  test("outside a form only the message goes", () => {
    assert.equal(saidBack(ask("Hi", { formState: { other: { x: { value: "y" } } } })), "Hi");
  });

  test("a range reads as one", () => {
    const range = ask("Go", { formName: "f", formState: { f: { when: { value: ["2026-10-20", "2026-10-25"] } } } });
    assert.equal(saidBack(range), "Go\n\nWhen: 2026-10-20 to 2026-10-25");
  });

  test("context the agent attached comes last, and one click cannot send a novel", () => {
    assert.equal(saidBack(ask("Details", { params: { context: { orderId: 42 } } })), 'Details\n\n{"orderId":42}');
    assert.ok(saidBack(ask("x".repeat(9_000))).length <= 4_000);
  });
});

describe("opening a page", () => {
  test("http and https open", () => {
    assert.deepEqual(routeAction({ type: "open_url", params: { url: "https://example.com/a" } }, null), {
      kind: "open",
      url: "https://example.com/a",
    });
  });

  test("nothing else does, whatever the model wrote", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "bloks://settings", "data:text/html,hi", "//evil.example", "", 42]) {
      assert.deepEqual(routeAction({ type: "open_url", params: { url } }, { kind: "chat", botId: "b1" }), { kind: "none" }, String(url));
      assert.equal(safeHttpUrl(url), null);
    }
  });
});
