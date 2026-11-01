import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readArtifact, settledRounds, namedState, statusLabel } from "../lib/artifact.ts";
import { closeTime, SEED_DELAY } from "../lib/clock.ts";
import { seedRoundAt, roundTimeOf } from "@semalam/beacon/consts";

const G = 1793293200;

function inTempCwd(fn: (root: string) => Promise<void>) {
  return async () => {
    const prev = process.cwd();
    const root = mkdtempSync(path.join(tmpdir(), "artifact-cov-"));
    process.chdir(root);
    try { await fn(root); } finally { process.chdir(prev); rmSync(root, { recursive: true, force: true }); }
  };
}

test("readArtifact parses data/rounds/<round>.json", inTempCwd(async (root) => {
  mkdirSync(path.join(root, "data", "rounds"), { recursive: true });
  writeFileSync(path.join(root, "data", "rounds", "7.json"), JSON.stringify({ v: 1, round: 7, status: "posted" }));
  const a = await readArtifact(7);
  assert.equal(a?.round, 7);
  assert.equal(a?.status, "posted");
}));
test("readArtifact returns null for a missing file", inTempCwd(async () => {
  assert.equal(await readArtifact(1), null);
}));
test("readArtifact returns null for malformed JSON", inTempCwd(async (root) => {
  mkdirSync(path.join(root, "data", "rounds"), { recursive: true });
  writeFileSync(path.join(root, "data", "rounds", "2.json"), "{not json");
  assert.equal(await readArtifact(2), null);
}));
test("settledRounds lists numeric round files sorted numerically and ignores others", inTempCwd(async (root) => {
  const d = path.join(root, "data", "rounds");
  mkdirSync(d, { recursive: true });
  for (const f of ["10.json", "2.json", "1.json", "notes.txt", "3.json.bak", "x.json"]) writeFileSync(path.join(d, f), "{}");
  assert.deepEqual(await settledRounds(), [1, 2, 10]);
}));
test("settledRounds returns [] when the rounds directory does not exist", inTempCwd(async () => {
  assert.deepEqual(await settledRounds(), []);
}));

test("statusLabel names a clean post and the unposted fallback", () => {
  assert.equal(statusLabel("posted"), "posted");
  assert.equal(statusLabel("unposted"), "not posted yet — waiting for the runner");
});
test("namedState: before the drand round the label carries a countdown detail", () => {
  const close = closeTime(2, G);
  const dr = seedRoundAt(close);
  const at = roundTimeOf(dr);
  const s = namedState(2, close + 10, 3, false);
  assert.equal(s.code, "waiting-drand");
  assert.equal(s.label, `waiting for drand round ${dr}`);
  assert.equal(s.detail, `the beacon is published ${at - (close + 10)} s from now; the sealed orders open with it`);
});
test("namedState: open only while now is before the close of the current round", () => {
  const close = closeTime(3, G);
  assert.equal(namedState(3, close - 1, 3, false).code, "open");
  assert.notEqual(namedState(3, close, 3, false).code, "open");
});
test("namedState: unposted detail names the replay command with the round", () => {
  const close = closeTime(2, G);
  const s = namedState(2, close + SEED_DELAY + 3600, 3, false);
  assert.equal(s.code, "unposted");
  assert.match(s.detail!, /npx semalam replay 2 --chain <id>/);
});
test("namedState: once the beacon is out and the hash is posted, the replay data is pending", () => {
  const close = closeTime(2, G);
  const s = namedState(2, close + SEED_DELAY + 3600, 3, true);
  assert.equal(s.code, "artifact-pending");
  assert.match(s.detail!, /\/verify works now/);
});
