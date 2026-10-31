import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run, sfc32, pairing, TURNS, START_COINS, ALONE } from "../src/index.ts";
import { field, RANDOMNESS } from "./fixture.ts";

import { OPTS } from "./opts.ts";
// Pinned golden hash. Any change to the rule set must bump SIM_VERSION and this hash in the same commit.
const GOLDEN_230 = "0x71ce4bba01b76d5da6384d8aa4564a870ff99fe4988479663e64582450746a11";

test("sfc32 is deterministic", () => {
  const a = sfc32(RANDOMNESS), b = sfc32(RANDOMNESS);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test("230 agents x 300 turns: golden hash, input order irrelevant", () => {
  const f = field(200);
  assert.equal(f.length, 230);
  const r1 = run(f, RANDOMNESS, OPTS);
  const r2 = run([...f].reverse(), RANDOMNESS, OPTS);
  assert.equal(r1.resultHash, r2.resultHash);
  assert.equal(r1.turns, TURNS);
  assert.equal(r1.ranking.length, 230);
  assert.equal(r1.resultHash, GOLDEN_230);
});

test("golden hash reproduces in a fresh process", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const out = execFileSync(process.execPath, ["--import", "tsx", `${here}golden-cli.ts`], { encoding: "utf8" }).trim();
  assert.equal(out, GOLDEN_230);
});

test("max field (1,000 players + 30 house) settles in under 2 s", () => {
  const f = field(1000);
  const t0 = performance.now();
  const r = run(f, RANDOMNESS, OPTS);
  const ms = performance.now() - t0;
  assert.equal(r.ranking.length, 1030);
  assert.ok(ms < 2000, `took ${ms} ms`);
});

test("different beacon → different night", () => {
  const f = field(200);
  assert.notEqual(run(f, RANDOMNESS, OPTS).resultHash, run(f, ("0x" + "11".repeat(32)) as `0x${string}`, OPTS).resultHash);
});

test("hash inputs are required", () => {
  assert.throws(() => run(field(2), RANDOMNESS, { ...OPTS, houseSetHash: undefined as never }));
});

test("pairing: even N pairs everyone; odd N sits out seat N-1 on even turns, seat 0 on odd turns", () => {
  for (const N of [2, 6, 7, 31, 230, 231]) {
    const ring = Array.from({ length: N }, (_, i) => N - 1 - i); // any permutation of 0..N-1
    for (const t of [1, 2, 3, 50, 299, 300]) {
      const p = pairing(ring, t);
      const alone = p.map((x, i) => (x < 0 ? i : -1)).filter((i) => i >= 0);
      for (let i = 0; i < N; i++) if (p[i] >= 0) assert.equal(p[p[i]], i);
      if (N % 2 === 0) assert.deepEqual(alone, []);
      else assert.deepEqual(alone, [t % 2 === 1 ? ring[0] : ring[N - 1]]);
    }
  }
});

test("a lone stall gathers alone every turn", () => {
  const r = run(field(0).slice(0, 1), RANDOMNESS, OPTS);
  assert.equal(r.ranking[0].coins, START_COINS + ALONE * TURNS);
});
