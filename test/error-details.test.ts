// The panel the interface shows when it cannot draw copies details that
// fit a bug report, and sends the same to the app log
// (src/lib/errorDetails.ts, src/components/ErrorBoundary.tsx).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ERROR_DETAILS_MAX, errorDetails } from "../src/lib/errorDetails.ts";

test("the copied details name the error, where it happened, and stay short", () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'tasks')");
  const details = errorDetails(error, "\n    at ChatView\n    at App", { at: new Date(0), userAgent: "Bloks/3.0.0 Electron/44.7.0" });
  assert.match(details, /^TypeError: Cannot read properties of undefined/);
  assert.match(details, /When: 1970-01-01T00:00:00.000Z/);
  assert.match(details, /Running: Bloks\/3\.0\.0 Electron\/44\.7\.0/);
  assert.match(details, /Where in the interface:\nat ChatView/);
  assert.match(errorDetails("plain words", null), /^Thrown: plain words/);
  assert.equal(errorDetails(new Error("z".repeat(ERROR_DETAILS_MAX * 2)), null).length, ERROR_DETAILS_MAX);
});
