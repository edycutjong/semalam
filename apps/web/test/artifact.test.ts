import test from "node:test";
import assert from "node:assert/strict";
import { namedState, statusLabel } from "../lib/artifact.ts";
import { closeTime } from "../lib/clock.ts";

const G = 1793293200;
test("A20: every pre-settle state of a closed round has a name, never a bare 'settling'", () => {
  const close = closeTime(2, G);
  assert.equal(namedState(5, close, 3, false).code, "future");
  assert.equal(namedState(3, close, 3, false).code, "open");
  assert.match(namedState(2, close + 10, 3, false).label, /^waiting for drand round \d+$/);
  assert.equal(namedState(2, close + 400, 3, true).code, "artifact-pending");
  assert.match(namedState(2, close + 400, 3, false).label, /^not posted yet — waiting for the runner$/);
});
test("A20: artifact statuses carry the spec's names", () => {
  assert.equal(statusLabel("hash-mismatch-not-posted"), "hash mismatch — not posted");
  assert.equal(statusLabel("poster-reverted"), "poster reverted");
});
