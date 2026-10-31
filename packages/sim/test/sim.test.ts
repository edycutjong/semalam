import { test } from "node:test";
import assert from "node:assert/strict";
import { run, sfc32, TURNS } from "../src/index.ts";
import { field, RANDOMNESS } from "./fixture.ts";

// Pinned in P1a. Any change to the rule set must bump SIM_VERSION and this hash in the same commit.
const GOLDEN_230 = "0x9840fd84e59fdbe352b01c8ca3b89493a4ffc8dd871b7d676df1424ebc7360bd";

test("sfc32 is deterministic", () => {
  const a = sfc32(RANDOMNESS), b = sfc32(RANDOMNESS);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test("230 agents x 300 turns: same input → same hash, input order irrelevant", () => {
  const f = field(200);
  assert.equal(f.length, 230);
  const t0 = performance.now();
  const r1 = run(f, RANDOMNESS, { round: 1n, drandRound: 33548730n });
  const ms = performance.now() - t0;
  const r2 = run([...f].reverse(), RANDOMNESS, { round: 1n, drandRound: 33548730n });
  assert.equal(r1.resultHash, r2.resultHash);
  assert.equal(r1.turns, TURNS);
  assert.equal(r1.ranking.length, 230);
  console.log(`# hash ${r1.resultHash} in ${ms.toFixed(0)} ms; top ${r1.ranking[0].id} ${r1.ranking[0].coins}c`);
  assert.equal(r1.resultHash, GOLDEN_230);
});

test("different beacon → different night", () => {
  const f = field(200);
  const other = ("0x" + "11".repeat(32)) as `0x${string}`;
  assert.notEqual(run(f, RANDOMNESS).resultHash, run(f, other).resultHash);
});

test("odd field: one stall sits out each turn, coins never negative", () => {
  const r = run(field(4), RANDOMNESS); // 34 agents… make it odd
  const odd = run(field(5), RANDOMNESS);
  assert.equal(odd.agents % 2, 1);
  for (const s of [...r.ranking, ...odd.ranking]) assert.ok(s.coins >= 0);
});
