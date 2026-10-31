// Simulator benchmark → evidence/bench.json. p50/p95 wall time for a full 300-turn night at three field sizes, plus
// a full settle of the 2,000-account golden spam round (admission cap, tlock decrypt, sim, keyframes).
// Usage: tsx scripts/sim/bench.ts
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { keccak256, toHex, pad, type Hex } from "viem";
import { ACTIONS, CONDITIONS, type Policy } from "@semalam/policy";
import { run, sfc32, TURNS, type Agent } from "../../packages/sim/src/index.ts";
import { houseAgents, HOUSE_SET_HASH } from "../../packages/sim/src/house.ts";
import { settle } from "../../packages/sim/src/round.ts";
import { open } from "../../packages/beacon/src/index.ts";

function players(n: number, seed: string): Agent[] {
  const r = sfc32(keccak256(toHex(seed)));
  const pick = <T,>(xs: readonly T[]) => xs[r() % xs.length];
  return Array.from({ length: n }, (_, i) => ({
    id: pad(toHex(0x1000000 + i), { size: 20 }),
    policy: { v: 1, name: `b${i}`, opening: pick(ACTIONS), default: pick(ACTIONS), grudge: r() % 21,
      rules: Array.from({ length: r() % 4 }, () => { const c = pick(CONDITIONS); return c === "turn_after" ? { if: c, n: 1 + (r() % 300), then: pick(ACTIONS) } : { if: c, then: pick(ACTIONS) }; }) } as Policy,
  }));
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(1); };
const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };

const rows: Record<string, unknown>[] = [];
for (const [label, n, runs] of [["200 players + 30 house", 200, 30], ["1,000 players + 30 house (admission cap)", 1000, 15]] as const) {
  const field = [...houseAgents(), ...players(n, label)];
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = keccak256(toHex(`bench-${i}`)) as Hex;
    ms.push(time(() => run(field, seed, { round: 1n, drandRound: 1n, policySetHash: seed, houseSetHash: HOUSE_SET_HASH })));
  }
  const traced = time(() => run(field, keccak256(toHex("t")), { round: 1n, drandRound: 1n, policySetHash: HOUSE_SET_HASH, houseSetHash: HOUSE_SET_HASH, trace: true }));
  rows.push({ case: label, agents: field.length, turns: TURNS, runs, p50_ms: pct(ms, 50), p95_ms: pct(ms, 95), max_ms: pct(ms, 100), traced_ms: +traced.toFixed(1) });
  console.log(label, "p50", pct(ms, 50), "ms p95", pct(ms, 95), "ms");
}
const g = JSON.parse(readFileSync(new URL("../../fixtures/golden/round-c.json", import.meta.url), "utf8"));
const logs = g.logs.map((l: { account: Hex; policyHash: Hex; blob: number; blockNumber: number; logIndex: number }) => ({ ...l, sealedBlob: g.blobs[l.blob], blockNumber: BigInt(l.blockNumber) }));
const sm: number[] = [];
let hash = "";
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  const s = await settle({ round: g.round, genesis: g.genesis, logs, beacon: g.beacon }, (b, bc) => open(b, bc));
  sm.push(performance.now() - t);
  hash = s.resultHash;
}
rows.push({ case: "settle golden round-c: 2,000 accounts → 1,000 admitted, decrypt + sim + 30 keyframes/agent", runs: 5, p50_ms: pct(sm, 50), p95_ms: pct(sm, 95), resultHash: hash, matchesFixture: hash === g.expect.resultHash });
console.log("settle round-c p50", pct(sm, 50), "ms", hash === g.expect.resultHash ? "hash ok" : "HASH MISMATCH");
writeFileSync(new URL("../../evidence/bench.json", import.meta.url), JSON.stringify({
  at: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, target: "200 agents × 300 turns < 10 s (spec)", rows,
}, null, 1) + "\n");
