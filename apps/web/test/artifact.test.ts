import test from "node:test";
import assert from "node:assert/strict";
import { namedState } from "../lib/artifact.ts";
import { closeTime } from "../lib/clock.ts";

const G = 1793293200;
test("A20: every pre-settle state of a closed round has a name, never a bare 'settling'", () => {
  const close = closeTime(2, G);
  assert.equal(namedState(5, close, 3, false).code, "future");
  assert.equal(namedState(3, close, 3, false).code, "open");
  assert.match(namedState(2, close + 10, 3, false).label, /^waiting for drand round \d+$/);
  assert.equal(namedState(2, close + 400, 3, true).code, "artifact-pending");
  assert.match(namedState(2, close + 400, 3, false).label, /^settling — the runner has not posted yet$/);
});
