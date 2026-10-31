// The values the chain pins must equal the values this code computes: HOUSE_SET_HASH and SIM_VERSION in Deploy.s.sol.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, toBytes } from "viem";
import { HOUSE, HOUSE_SET_HASH, houseSetHash, parseHouseSet } from "../src/house.ts";
import { SIM_VERSION } from "../src/index.ts";

const deploy = readFileSync(new URL("../../../contracts/script/Deploy.s.sol", import.meta.url), "utf8");

test("Deploy.s.sol pins HOUSE_SET_HASH = keccak(canonical(house-set.json)) and SIM_VERSION", () => {
  assert.match(deploy, new RegExp(`houseSetHash = ${HOUSE_SET_HASH}`));
  assert.match(deploy, new RegExp(`keccak256\\(bytes\\("${SIM_VERSION}"\\)\\)`));
});

test("house set: 30 labelled agents, ids 0x…01–0x…1e; whitespace/key order never changes the hash; any policy edit does", () => {
  const raw = readFileSync(new URL("../../../house/house-set.json", import.meta.url), "utf8");
  assert.equal(houseSetHash(JSON.parse(raw)), HOUSE_SET_HASH);
  assert.equal(houseSetHash(JSON.parse(JSON.stringify(JSON.parse(raw)))), HOUSE_SET_HASH);
  assert.equal(HOUSE.agents.length, 30);
  const edited = JSON.parse(raw);
  edited.agents[0].policy.grudge = 1;
  assert.notEqual(houseSetHash(edited), HOUSE_SET_HASH);
  const badId = JSON.parse(raw);
  badId.agents[3].id = "0x5b84F1A4E8037107a2B0aAcf3381005633A8f74e";
  assert.throws(() => parseHouseSet(badId));
  assert.equal(keccak256(toBytes(SIM_VERSION)), keccak256(toBytes("semalam-sim/1")));
});
