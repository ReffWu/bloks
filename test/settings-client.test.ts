import { test } from "node:test";
import assert from "node:assert/strict";
import { answerSettingsRequest, consumeSettingsRequest, observeCommittedSettings } from "../src/lib/settings-client.ts";

function withStorage(values: Record<string, string>) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values[key] ?? null,
    setItem: () => { throw Error("answering wrote a preference"); },
  } });
  return () => {
    if (before) Object.defineProperty(globalThis, "localStorage", before);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

test("registering an owner and rendering do nothing: no fetch, no timer, until a request arrives", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("unexpected work"); };
  const restore = withStorage({});
  try {
    const detach = observeCommittedSettings(() => ({ "theme.applied": { status: "observed", value: "light" } }));
    detach();
    assert.equal(consumeSettingsRequest({ kind: "hello" }), false, "an ordinary frame passes through");
    for (const bad of [{}, { request: "short" }, { request: 7 }]) assert.equal(consumeSettingsRequest({ kind: "settings-request", ...bad }), true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 0, "a malformed request is consumed and answered by nothing");
  } finally { restore(); globalThis.fetch = previous; }
});

test("one request gets one answer: stored and mounted values kept apart, unmounted owners unknown, no native bridge said as unsupported", async () => {
  const restore = withStorage({ "bloks-theme": "dark" });
  const sent: any[] = [];
  const detach = observeCommittedSettings(() => ({ "theme.applied": { status: "observed", value: "light" } }));
  try {
    const request = "r".repeat(43);
    await answerSettingsRequest(request, async (body) => { sent.push(body); });
    await answerSettingsRequest(request, async (body) => { sent.push(body); });
    assert.equal(sent.length, 1, "the same request is answered once");
    const { snapshot, label, kind } = sent[0];
    assert.equal(kind, "window");
    assert.match(label, /^[0-9a-f]{32}$/);
    assert.deepEqual(snapshot.values["theme.applied"], { status: "observed", value: "light" });
    assert.deepEqual(snapshot.values["theme.saved"], { status: "observed", value: "dark" }, "stored and committed preference stay separate");
    assert.deepEqual(snapshot.values["room.lens"], { status: "unknown", reason: "unmounted" });
    assert.deepEqual(snapshot.values["native.mode"], { status: "unknown", reason: "unsupported" });
    detach();
    await answerSettingsRequest("s".repeat(43), async (body) => { sent.push(body); });
    assert.deepEqual(sent[1].snapshot.values["theme.applied"], { status: "unknown", reason: "unmounted" }, "an owner gone is unmounted, not remembered");
    assert.equal(sent[1].label, label, "one window keeps one name");
    assert.ok(sent[1].snapshot.revision > snapshot.revision);
  } finally { detach(); restore(); }
});

test("a failed send is not retried, and a broken owner does not cost the others", async () => {
  const restore = withStorage({});
  const detachBroken = observeCommittedSettings(() => { throw Error("broken owner"); });
  const detach = observeCommittedSettings(() => ({ "room.lens": { status: "observed", value: "forum" } }));
  let attempts = 0; let body: any;
  try {
    await answerSettingsRequest("t".repeat(43), async () => { attempts++; throw Error("offline"); });
    assert.equal(attempts, 1);
    await answerSettingsRequest("u".repeat(43), async (sent) => { body = sent; });
    assert.deepEqual(body.snapshot.values["room.lens"], { status: "observed", value: "forum" });
  } finally { detachBroken(); detach(); restore(); }
});
