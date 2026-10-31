import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "@semalam/policy";
import { HOUSE } from "@semalam/sim/house";
import { draftHash, freeSeed, paidSeed, scrimmage } from "../lib/scrim.ts";

const me = { id: "0x00000000000000000000000000000000000000a1" as const, policy: PRESETS[1] };
const opp = HOUSE.agents.slice(0, 30).map((h, i) => ({ id: h.id, label: h.label, house: true, rank: i + 1, coins: 0, policy: h.policy }));
test("a scrimmage is a pure function of its seed (A13)", () => {
  const seed = paidSeed("0x" + "ab".repeat(32) as `0x${string}`);
  const a = scrimmage(me, opp, seed, 2), b = scrimmage(me, opp, seed, 2);
  assert.equal(a.resultHash, b.resultHash);
  assert.equal(a.of, 31);
  const c = scrimmage(me, opp, paidSeed("0x" + "cd".repeat(32) as `0x${string}`), 2);
  assert.notEqual(a.resultHash, c.resultHash);
});
test("free seed binds round, account and policy", () => {
  const h = draftHash(me.policy);
  assert.notEqual(freeSeed(2, me.id, h), freeSeed(3, me.id, h));
  assert.equal(h, draftHash(PRESETS[1]));
  assert.notEqual(h, draftHash(PRESETS[0]));
});
