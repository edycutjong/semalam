// A5 (latest commit), A6 (void reasons), A7 (golden rounds, admission cap, one-byte sensitivity), A11 (excluded addresses).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, keccak256, toHex, type Hex, type Address } from "viem";
import { open, seedRoundAt } from "@semalam/beacon";
import { selectCommits, policySetHash, settle, seedRound, closeTime, season, type CommitLog } from "../src/round.ts";

type G = { round: number; genesis: number; beacon: { round: number; randomness: string; signature: string }; blobs: Hex[]; logs: { account: Address; policyHash: Hex; blob: number; blockNumber: number; logIndex: number }[]; expect: Record<string, unknown> & { resultHash: Hex; voids: { account: Address; reason: string }[] } };
const golden = (n: string): G => JSON.parse(readFileSync(new URL(`../../../fixtures/golden/${n}.json`, import.meta.url), "utf8"));
const logsOf = (g: G): CommitLog[] => g.logs.map((l) => ({ ...l, sealedBlob: g.blobs[l.blob], blockNumber: BigInt(l.blockNumber) }));
const dec = (b: Uint8Array, bc: G["beacon"]) => open(b, bc);
const acct = (i: number) => getAddress(`0x${keccak256(toHex(`t-${i}`)).slice(-40)}`);
const log = (i: number, block: number, idx = 0, ph: Hex = keccak256(toHex(i))): CommitLog => ({ account: acct(i), policyHash: ph, sealedBlob: "0x", blockNumber: BigInt(block), logIndex: idx });

test("A7: every golden round reproduces its resultHash, policy-set hash, players, voids and over-capacity count", async () => {
  for (const n of ["round-a", "round-b", "round-c"]) {
    const g = golden(n);
    const s = await settle({ round: g.round, genesis: g.genesis, logs: logsOf(g), beacon: g.beacon }, dec);
    assert.equal(s.resultHash, g.expect.resultHash, n);
    assert.equal(s.policySetHash, g.expect.policySetHash, n);
    assert.equal(s.players, g.expect.players, n);
    assert.equal(s.overCapacity.length, g.expect.overCapacity, n);
    assert.deepEqual(s.voids.map((v) => ({ account: v.account, reason: v.reason })), g.expect.voids, n);
    assert.ok(s.replays.every((r) => r.keyframes.length === 30), `${n}: 30 keyframes per agent`);
  }
});

test("A6: round-a carries one fixture per void reason, listed with the account", () => {
  assert.deepEqual(golden("round-a").expect.voids.map((v) => v.reason).sort(), ["HASH_MISMATCH", "SCHEMA_INVALID", "UNDECRYPTABLE", "WRONG_ROUND"]);
});

test("A5: only the latest commit per account counts (max blockNumber, logIndex), whatever the log order", () => {
  const logs = [log(1, 10), log(2, 11), log(1, 12, 0, keccak256(toHex("v2"))), log(1, 12, 3, keccak256(toHex("v3"))), log(3, 9)];
  for (const order of [logs, [...logs].reverse(), [logs[3], logs[0], logs[4], logs[2], logs[1]]]) {
    const { latest } = selectCommits(order);
    assert.deepEqual(latest.map((l) => l.account), [acct(3), acct(1), acct(2)]); // admission order = first commit
    assert.equal(latest.find((l) => l.account === acct(1))!.policyHash, keccak256(toHex("v3")));
  }
});

test("A7: a 2,000-account spammed round admits the first 1,000 by FIRST commit; a re-commit keeps an early seat", () => {
  const logs = Array.from({ length: 2000 }, (_, i) => log(i, 100 + i));
  logs.push(log(5, 99_999, 0, keccak256(toHex("late re-commit"))));
  const { latest, overCapacity } = selectCommits(logs);
  assert.equal(latest.length, 1000);
  assert.equal(overCapacity.length, 1000);
  assert.equal(overCapacity[0], acct(1000));
  assert.equal(latest[5].policyHash, keccak256(toHex("late re-commit")));
});

test("A7: one policy byte changes the policy-set hash; order of rows does not", () => {
  const rows = [log(1, 1), log(2, 2)];
  const h = policySetHash(rows);
  assert.equal(policySetHash([...rows].reverse()), h);
  assert.notEqual(policySetHash([rows[0], { ...rows[1], policyHash: (rows[1].policyHash.slice(0, -1) + (rows[1].policyHash.endsWith("0") ? "1" : "0")) as Hex }]), h);
});

test("A7: one changed policy byte in a sealed order changes the resultHash", async () => {
  const g = golden("round-b");
  const s0 = await settle({ round: g.round, genesis: g.genesis, logs: logsOf(g), beacon: g.beacon }, dec);
  const plain = await open(Buffer.from(g.blobs[g.logs[0].blob].slice(2), "hex"), g.beacon);
  const text = new TextDecoder().decode(plain).replace('"grudge":5', '"grudge":6');
  const { seal } = await import("@semalam/beacon");
  const blob = await seal(new TextEncoder().encode(text), g.beacon.round);
  const logs = logsOf(g);
  logs[0] = { ...logs[0], policyHash: keccak256(new TextEncoder().encode(text)), sealedBlob: `0x${Buffer.from(blob).toString("hex")}` };
  const s1 = await settle({ round: g.round, genesis: g.genesis, logs, beacon: g.beacon }, dec);
  assert.notEqual(s1.resultHash, s0.resultHash);
  assert.equal(s1.voids.length, s0.voids.length);
});

test("A8/A7: settle refuses any drand round but seedRound(round); clock helpers match the beacon package", async () => {
  const g = golden("round-b");
  await assert.rejects(settle({ round: g.round, genesis: g.genesis, logs: [], beacon: { ...g.beacon, round: g.beacon.round + 1 } }, dec), /seedRound/);
  for (let r = 1; r < 40; r++) assert.equal(seedRound(g.genesis + (r % 7), r), seedRoundAt(closeTime(g.genesis + (r % 7), r)));
  assert.deepEqual([1, 2, 4, 5, 7, 8].map(season), [0, 1, 1, 2, 2, 3]);
});

test("A11: excluded operator addresses drop out of the player count and points, never out of the hash", async () => {
  const g = golden("round-b");
  const base = await settle({ round: g.round, genesis: g.genesis, logs: logsOf(g), beacon: g.beacon }, dec);
  const someone = base.ranking.find((r) => !r.house)!.id as Address;
  const ex = await settle({ round: g.round, genesis: g.genesis, logs: logsOf(g), beacon: g.beacon }, dec, [someone]);
  assert.equal(ex.resultHash, base.resultHash);
  assert.equal(ex.players, base.players - 1);
  assert.equal(ex.ranking.find((r) => r.id === someone)!.points, 0);
});
