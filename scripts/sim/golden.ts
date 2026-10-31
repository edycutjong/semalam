// Writes fixtures/golden/round-{a,b,c}.json: real quicknet beacons (BLS-verified), real tlock-sealed policies, synthetic
// commit logs, and the expected outputs. resultHash does not depend on the (randomized) ciphertext bytes, so
// regenerating keeps every expected hash. Usage: tsx scripts/sim/golden.ts  (network: drand only)
import { mkdirSync, writeFileSync } from "node:fs";
import { keccak256, toHex, toBytes, bytesToHex, getAddress, type Hex, type Address } from "viem";
import { PRESETS, canonical, policyHash, ACTIONS, CONDITIONS, type Policy } from "@semalam/policy";
import { fetchBeacon, seal } from "../../packages/beacon/src/index.ts";
import { open } from "../../packages/beacon/src/index.ts";
import { settle, seedRound, policySetHash, type CommitLog } from "../../packages/sim/src/round.ts";
import { HOUSE_SET_HASH } from "../../packages/sim/src/house.ts";
import { sfc32, reseat, tieKey, run, SIM_VERSION, PAYOFF } from "../../packages/sim/src/index.ts";
import { encodeAbiParameters } from "viem";

export const GOLDEN_GENESIS = 1793120400; // 2026-10-27 17:00 UTC → rounds 1–3 closed 28–30 Oct
const acct = (tag: string): Address => getAddress(`0x${keccak256(toHex(tag)).slice(-40)}`);
const enc = (p: unknown) => toBytes(typeof p === "string" ? p : canonical(p));

function generated(seed: string, n: number): Policy[] {
  const r = sfc32(keccak256(toHex(seed)));
  const pick = <T,>(xs: readonly T[]) => xs[r() % xs.length];
  return Array.from({ length: n }, (_, i) => ({
    v: 1 as const, name: `${seed}-${i}`, opening: pick(ACTIONS), default: pick(ACTIONS), grudge: 1 + (r() % 20),
    rules: Array.from({ length: r() % 4 }, () => {
      const c = pick(CONDITIONS);
      return c === "turn_after" ? { if: c, n: 1 + (r() % 300), then: pick(ACTIONS) } : { if: c, then: pick(ACTIONS) };
    }),
  }));
}

type Entry = { account: Address; plain: Uint8Array; hash?: Hex; target?: "seed" | "next" | "garbage" };

async function build(name: string, round: number, entries: Entry[], spam?: { count: number; plain: Uint8Array }) {
  const sr = seedRound(GOLDEN_GENESIS, round);
  const beacon = await fetchBeacon(sr);
  const blobs: Hex[] = [];
  const blobOf = new Map<string, number>();
  const sealOnce = async (plain: Uint8Array, target: Entry["target"] = "seed") => {
    const key = `${target}:${bytesToHex(plain)}`;
    if (!blobOf.has(key)) {
      let b = await seal(plain, target === "next" ? sr + 1 : sr);
      if (target === "garbage") b = Uint8Array.from(b, (x, i) => (i > b.length - 40 ? x ^ 0x5a : x)); // corrupt the body
      blobOf.set(key, blobs.push(bytesToHex(b)) - 1);
    }
    return blobOf.get(key)!;
  };
  const logs: { account: Address; policyHash: Hex; blob: number; blockNumber: number; logIndex: number }[] = [];
  let block = 1000;
  for (const e of entries)
    logs.push({ account: e.account, policyHash: e.hash ?? keccak256(e.plain), blob: await sealOnce(e.plain, e.target), blockNumber: block++, logIndex: 0 });
  if (spam) {
    const b = await sealOnce(spam.plain);
    for (let i = 0; i < spam.count; i++)
      logs.push({ account: acct(`${name}-spam-${i}`), policyHash: keccak256(spam.plain), blob: b, blockNumber: block + Math.floor(i / 4), logIndex: i % 4 });
  }
  const chainLogs: CommitLog[] = logs.map((l) => ({ account: l.account, policyHash: l.policyHash, sealedBlob: blobs[l.blob], blockNumber: BigInt(l.blockNumber), logIndex: l.logIndex }));
  const s = await settle({ round, genesis: GOLDEN_GENESIS, logs: chainLogs, beacon }, (blob, b) => open(blob, b));
  const fixture = {
    name, note: "Golden round: real quicknet beacon + real tlock blobs, synthetic commit logs. `semalam replay --fixture golden` re-derives expect.*",
    genesis: GOLDEN_GENESIS, round, beacon, blobs, logs,
    expect: {
      resultHash: s.resultHash, policySetHash: s.policySetHash, houseSetHash: s.houseSetHash, drandRound: s.drandRound, players: s.players,
      agents: s.agents, overCapacity: s.overCapacity.length, voids: s.voids.map((v) => ({ account: v.account, reason: v.reason })),
      top3: s.ranking.slice(0, 3).map((r) => ({ id: r.id, label: r.label, coins: r.coins })),
    },
  };
  writeFileSync(new URL(`../../fixtures/golden/${name}.json`, import.meta.url), JSON.stringify(fixture, null, 1) + "\n");
  console.log(name, "round", round, "drand", sr, "agents", s.agents, "players", s.players, "voids", s.voids.length, "over", s.overCapacity.length, s.resultHash);
}

/** Byte-level vectors: sfc32 words, a reseat, tie keys, a policySetHash and a resultHash preimage — consumed by the TS
 * tests AND contracts/test/Vectors.t.sol, so a second implementation can check every encoding without the sim. */
function vectors() {
  const randomness = "0x3c11de15056c2178129fd057942ef8d0a826dc210e339a785390d50097e42f3e" as Hex; // quicknet 33548730
  const next = sfc32(randomness);
  const words = Array.from({ length: 8 }, () => next());
  const seats10 = reseat(Array.from({ length: 10 }, (_, i) => i), sfc32(randomness));
  const ids = ["0x0000000000000000000000000000000000000001", "0x5b84F1A4E8037107a2B0aAcf3381005633A8f74e"] as Hex[];
  const rows = [{ account: getAddress(ids[1]), policyHash: keccak256(toHex("policy-b")) }, { account: getAddress(ids[0]), policyHash: keccak256(toHex("policy-a")) }];
  const psh = policySetHash(rows);
  const ranking = [{ id: ids[1], coins: 412n }, { id: ids[0], coins: 377n }];
  const enc = encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "tuple[]", components: [{ type: "address" }, { type: "uint256" }] }],
    [SIM_VERSION, 7n, 33548730n, randomness, psh, HOUSE_SET_HASH, ranking.map((r) => [r.id, r.coins] as const)],
  );
  // a 2-agent night run by the real engine, so the vector also pins the engine's own encoding
  const two = run([{ id: ids[0], policy: PRESETS[0] }, { id: ids[1], policy: PRESETS[1] }], randomness, { round: 7n, drandRound: 33548730n, policySetHash: psh, houseSetHash: HOUSE_SET_HASH });
  return {
    note: "Byte-level vectors for semalam-sim/1. tieKey = keccak256(abi.encodePacked(bytes32 randomness, address id)); policySetHash = keccak256(abi.encode((address,bytes32)[] sorted by address)); resultHash = keccak256(abi.encode(string SIM_VERSION, uint256 round, uint64 drandRound, bytes32 randomness, bytes32 policySetHash, bytes32 houseSetHash, (address,uint256)[] ranking)).",
    simVersion: SIM_VERSION, payoff: PAYOFF, randomness, sfc32First8: words, reseat10: seats10,
    tieKeys: ids.map((id) => ({ id, hash: tieKey(randomness, id) })),
    policySet: { rows, hash: psh },
    resultHash: { round: 7, drandRound: 33548730, randomness, policySetHash: psh, houseSetHash: HOUSE_SET_HASH, ranking: ranking.map((r) => ({ id: r.id, coins: Number(r.coins) })), hash: keccak256(enc) },
    twoAgentNight: { ids, policies: [PRESETS[0].name, PRESETS[1].name], ranking: two.ranking.map((r) => ({ id: r.id, coins: r.coins })), resultHash: two.resultHash },
  };
}

async function main() {
  mkdirSync(new URL("../../fixtures/golden/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../../fixtures/golden/vectors.json", import.meta.url), JSON.stringify(vectors(), null, 1) + "\n");
  const nurse = PRESETS.find((p) => p.name === "night-nurse")!;
  const copy = PRESETS.find((p) => p.name === "copy-the-winner")!;
  // round-a: 8 presets + 28 generated + a re-commit (latest counts) + one void per reason
  const a: Entry[] = [
    ...PRESETS.map((p) => ({ account: acct(`a-${p.name}`), plain: enc(p) })),
    ...generated("ga", 28).map((p, i) => ({ account: acct(`a-gen-${i}`), plain: enc(p) })),
    { account: acct("a-recommit"), plain: enc(PRESETS[0]) },
    { account: acct("a-void-undecryptable"), plain: enc(PRESETS[1]), target: "garbage" },
    { account: acct("a-void-wrong-round"), plain: enc(PRESETS[2]), target: "next" },
    { account: acct("a-void-hash-mismatch"), plain: enc(PRESETS[3]), hash: policyHash(PRESETS[4]) },
    { account: acct("a-void-schema"), plain: enc('{"v":2,"name":"x"}') },
    { account: acct("a-recommit"), plain: enc({ ...nurse, name: "recommitted-nurse" }) },
  ];
  await build("round-a", 1, a);
  // round-b: a thin night — the hook pair only, plus one void
  await build("round-b", 2, [
    { account: acct("b-nurse"), plain: enc(nurse) },
    { account: acct("b-copy"), plain: enc(copy) },
    { account: acct("b-void"), plain: enc({ ...nurse, grudge: 99 }) },
  ]);
  // round-c: 10 genuine accounts, then 1,990 spam accounts with one identical blob → admission cap 1,000
  await build("round-c", 3, generated("gc", 10).map((p, i) => ({ account: acct(`c-gen-${i}`), plain: enc(p) })), { count: 1990, plain: enc(PRESETS[0]) });
}
main().catch((e) => { console.error(e); process.exit(1); });
