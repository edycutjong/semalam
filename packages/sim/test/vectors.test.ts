// Byte-level vectors (fixtures/golden/vectors.json — also checked by contracts/test/Vectors.t.sol), the frozen payoff
// digest, the rank rule, the coin floor and documented seating pairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, toBytes, type Hex } from "viem";
import { PRESETS } from "@semalam/policy";
import { sfc32, reseat, tieKey, run, rankOf, pairing, PAYOFF, SIM_VERSION, TURNS, START_COINS, type Agent } from "../src/index.ts";
import { policySetHash } from "../src/round.ts";
import { HOUSE_SET_HASH } from "../src/house.ts";

const V = JSON.parse(readFileSync(new URL("../../../fixtures/golden/vectors.json", import.meta.url), "utf8"));
// keccak256 of the frozen payoff table; changing PAYOFF without bumping SIM_VERSION fails here
const PINNED_PAYOFF = "0x9aea47ad81acbe5e2ef8ae89dd8923bd45553e6ef09390b2cd5f7663ecfc1417";

test("vectors: sfc32 first 8 words, block-1 reseat of 10, tie keys, policySetHash, resultHash preimage", () => {
  const next = sfc32(V.randomness);
  assert.deepEqual(Array.from({ length: 8 }, () => next()), V.sfc32First8);
  assert.deepEqual(reseat(Array.from({ length: 10 }, (_, i) => i), sfc32(V.randomness)), V.reseat10);
  for (const t of V.tieKeys) assert.equal(tieKey(V.randomness, t.id), t.hash);
  assert.equal(policySetHash(V.policySet.rows), V.policySet.hash);
  assert.equal(V.simVersion, SIM_VERSION);
  assert.deepEqual(V.payoff, PAYOFF);
});

test("vectors: a two-agent night through the real engine reproduces its ranking and resultHash", () => {
  const n = V.twoAgentNight;
  const agents: Agent[] = n.ids.map((id: Hex, i: number) => ({ id, policy: PRESETS.find((p) => p.name === n.policies[i])! }));
  const r = run(agents, V.randomness, { round: 7n, drandRound: 33548730n, policySetHash: V.policySet.hash, houseSetHash: HOUSE_SET_HASH });
  assert.deepEqual(r.ranking.map((x) => ({ id: x.id, coins: x.coins })), n.ranking);
  assert.equal(r.resultHash, n.resultHash);
});

test("payoff table is frozen: its digest is pinned with SIM_VERSION", () => {
  const digest = keccak256(toBytes(JSON.stringify(PAYOFF)));
  assert.equal(`${SIM_VERSION} ${digest}`, `semalam-sim/1 ${PINNED_PAYOFF}`);
  assert.throws(() => { (PAYOFF[0] as number[])[0] = 9; });
});

test("rank rule: coins desc, then fewer steals, then tie key asc (A11)", () => {
  const coins = [5, 5, 5, 7, 5];
  const steals = [1, 0, 0, 0, 0];
  const tie = ["0x02", "0x01", "0x03", "0x00", "0x01ff"] as Hex[];
  // agent 3 richest; among the 5-coin agents: fewer steals first (1, 2, 4), then tie key asc (0x01 < 0x01ff < 0x03), agent 0 last
  assert.deepEqual(rankOf(coins, steals, tie), [5, 2, 4, 1, 3]);
});

test("coin floor: a thief facing a guard every turn bottoms out at 0 and stays there", () => {
  const thief = { ...PRESETS[0], name: "thief", opening: "STEAL" as const, default: "STEAL" as const };
  const guard = { ...PRESETS[0], name: "guard", opening: "GUARD" as const, default: "GUARD" as const };
  const r = run([{ id: "0x0000000000000000000000000000000000000a01", policy: thief }, { id: "0x0000000000000000000000000000000000000a02", policy: guard }], V.randomness, {
    round: 1n, drandRound: 1n, policySetHash: V.policySet.hash, houseSetHash: HOUSE_SET_HASH, trace: true,
  });
  assert.equal(r.ranking[1].coins, 0);
  assert.equal(r.ranking[0].coins, START_COINS + TURNS * PAYOFF[1][3]);
  const tr = r.trace!;
  const i = r.field.findIndex((a) => a.policy.name === "thief");
  assert.equal(tr[5].coins[i], Math.max(0, START_COINS + 6 * PAYOFF[3][1]));
  assert.ok(tr.slice(10).every((row) => row.coins[i] === 0));
});

test("seating pairs, documented (A18): N=4 and N=5, both parities", () => {
  const pairsOf = (N: number, t: number) => {
    const p = pairing(Array.from({ length: N }, (_, i) => i), t);
    return p.map((q, i) => (q > i ? `${i}-${q}` : q < 0 ? `${i} alone` : null)).filter(Boolean);
  };
  assert.deepEqual(pairsOf(4, 2), ["0-1", "2-3"]);
  assert.deepEqual(pairsOf(4, 1), ["0-3", "1-2"]);
  assert.deepEqual(pairsOf(5, 2), ["0-1", "2-3", "4 alone"]);
  assert.deepEqual(pairsOf(5, 1), ["0 alone", "1-2", "3-4"]);
});
