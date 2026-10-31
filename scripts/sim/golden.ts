// Writes fixtures/golden/round-{a,b,c}.json: real quicknet beacons (BLS-verified), real tlock-sealed policies, synthetic
// commit logs, and the expected outputs. resultHash does not depend on the (randomized) ciphertext bytes, so
// regenerating keeps every expected hash. Usage: tsx scripts/sim/golden.ts  (network: drand only)
import { mkdirSync, writeFileSync } from "node:fs";
import { keccak256, toHex, toBytes, bytesToHex, getAddress, type Hex, type Address } from "viem";
import { PRESETS, canonical, policyHash, ACTIONS, CONDITIONS, type Policy } from "@semalam/policy";
import { fetchBeacon, seal } from "../../packages/beacon/src/index.ts";
import { open } from "../../packages/beacon/src/index.ts";
import { settle, seedRound, type CommitLog } from "../../packages/sim/src/round.ts";
import { sfc32 } from "../../packages/sim/src/index.ts";

export const GOLDEN_GENESIS = 1793120400; // 2026-10-27 17:00 UTC → rounds 1–3 closed 28–30 Oct
const acct = (tag: string): Address => getAddress(`0x${keccak256(toHex(tag)).slice(-40)}`);
const enc = (p: unknown) => toBytes(typeof p === "string" ? p : canonical(p));

function generated(seed: string, n: number): Policy[] {
  const r = sfc32(keccak256(toHex(seed)));
  const pick = <T,>(xs: readonly T[]) => xs[r() % xs.length];
  return Array.from({ length: n }, (_, i) => ({
    v: 1 as const, name: `${seed}-${i}`, opening: pick(ACTIONS), default: pick(ACTIONS), grudge: r() % 21,
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

async function main() {
  mkdirSync(new URL("../../fixtures/golden/", import.meta.url), { recursive: true });
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
