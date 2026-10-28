// One message the page cannot draw costs that message, not the window
// (src/lib/rowGuard.ts). The runner has no DOM, so the guard's contract is
// held directly: what it keeps when a row throws, what it draws then, and
// when it tries the row again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RowGuard, type RowGuardProps } from "../src/lib/rowGuard.ts";

const props = (over: Partial<RowGuardProps> = {}): RowGuardProps => ({
  render: () => createElement("p", null, "hello"),
  fallback: (details) => createElement("em", null, details),
  ...over,
});

test("a row that draws is drawn as it is, inside the guard", () => {
  const html = renderToStaticMarkup(createElement(RowGuard, props()));
  assert.equal(html, "<p>hello</p>");
});

test("the row is worked out inside the guard, so a throw there is the guard's to catch", () => {
  // nothing runs the row until the guard draws it
  let ran = false;
  const guard = new RowGuard(props({ render: () => ((ran = true), null) }));
  const drawn = guard.render();
  assert.equal(ran, false);
  assert.ok(isValidElement(drawn));
});

test("a throw becomes the stand-in, with the error named for a bug report", () => {
  const state = RowGuard.getDerivedStateFromError(new TypeError("Cannot read properties of undefined (reading 'to')"));
  assert.match(state.details, /^TypeError: Cannot read properties of undefined \(reading 'to'\)/);

  const guard = new RowGuard(props());
  guard.state = { ...guard.state, details: state.details };
  const drawn = guard.render();
  assert.ok(isValidElement<{ children: string }>(drawn));
  assert.equal(drawn.type, "em");
  assert.equal(drawn.props.children, state.details);
});

test("where it failed is told once, for the app's log", () => {
  const told: string[] = [];
  const guard = new RowGuard(props({ onError: (details) => told.push(details) }));
  guard.setState = () => {};
  guard.componentDidCatch(new Error("boom"), { componentStack: "\n    at RouteLine\n    at RoomView" });
  assert.equal(told.length, 1);
  assert.match(told[0], /^Error: boom/);
  assert.match(told[0], /Where in the interface:\nat RouteLine/);
});

test("a row whose data changes is tried again; the same data keeps the stand-in", () => {
  const was = { details: "Error: boom", key: "v1" };
  assert.deepEqual(RowGuard.getDerivedStateFromProps(props({ resetKey: "v2" }), was), { details: null, key: "v2" });
  assert.equal(RowGuard.getDerivedStateFromProps(props({ resetKey: "v1" }), was), null);
});
