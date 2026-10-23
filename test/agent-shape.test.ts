// The shape an agent is drawn with, read the same on the server as in the
// app. A phone's Live Activity started by the server draws the shape the
// server names, so one made before shapes existed must get the shape the
// agent list hashes for it, not a default (GitHub 362).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeOf } from "../server/store.ts";
import { shapeForBot } from "../src/lib/mascot.ts";

test("an agent with no saved shape gets the same hashed shape the app draws", () => {
  for (const id of ["b1", "a3f9c2", "agent-with-a-long-id-0001", "x", "7f4e2c1d-9b0a-4c3e-8f21-0a6b5c4d3e2f"]) {
    assert.equal(shapeOf({ id, name: "N" }), shapeForBot({ id, name: "N" }), id);
    assert.equal(shapeOf({ id, name: "N", shape: "" }), shapeForBot({ id, name: "N" }), id);
  }
});

test("a saved shape is kept, and one that is not a shape is not believed", () => {
  assert.equal(shapeOf({ id: "b1", name: "N", shape: "cloud" }), "cloud");
  assert.equal(shapeOf({ id: "b1", name: "N", shape: "hexagon" }), shapeForBot({ id: "b1", name: "N" }));
});
