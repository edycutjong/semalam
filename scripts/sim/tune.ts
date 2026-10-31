// Payoff tuning for rule set v1: runs candidate payoff matrices against the frozen house set + the 8 presets + 200
// generated players over 48 seeds. Goal: no pure action wins the field; no single style dominates.
// Usage: tsx scripts/sim/tune.ts [--write]  → evidence/sim-tuning.json
import { writeFileSync } from "node:fs";
import { keccak256, toHex, pad, type Hex } from "viem";
import { PRESETS, ACTIONS, CONDITIONS, type Policy } from "@semalam/policy";
import { run, sfc32, PAYOFF, type Agent } from "../../packages/sim/src/index.ts";
import { HOUSE, houseAgents, HOUSE_SET_HASH } from "../../packages/sim/src/house.ts";

const SEEDS = Array.from({ length: 48 }, (_, i) => keccak256(toHex(`semalam-tune-${i}`)));
const isPure = (p: Policy) => p.rules.length === 0 && p.opening === p.default;

function players(seed: Hex, n = 200): Agent[] {
  const r = sfc32(seed);
  const pick = <T,>(xs: readonly T[]) => xs[r() % xs.length];
  const gen = (name: string): Policy => ({
    v: 1, name, opening: pick(ACTIONS), default: pick(ACTIONS), grudge: r() % 21,
    rules: Array.from({ length: r() % 4 }, () => {
      const c = pick(CONDITIONS);
      return c === "turn_after" ? { if: c, n: 1 + (r() % 300), then: pick(ACTIONS) } : { if: c, then: pick(ACTIONS) };
    }),
  });
  const presets = PRESETS.map((p, i) => ({ id: pad(toHex(0xbeef00 + i), { size: 20 }), policy: p }));
  const gens = Array.from({ length: n }, (_, i) => ({ id: pad(toHex(BigInt(r()) * 0x100000000n + BigInt(r()) + 0x1000000n), { size: 20 }), policy: gen(`g${i}`) }));
  return [...presets, ...gens];
}

function evaluate(payoff: readonly (readonly number[])[], gen = 200) {
  const style: Record<string, number[]> = {};
  const label: Record<string, number[]> = {};
  let pureWins = 0, pureTop10 = 0;
  const pureTop10By: Record<string, number> = {};
  const winners: string[] = [];
  for (const s of SEEDS) {
    const field = [...houseAgents(), ...players(keccak256(s), gen)];
    const byId = new Map(field.map((a) => [a.id, a]));
    const res = run(field, s, { round: 1n, drandRound: 1n, policySetHash: s, houseSetHash: HOUSE_SET_HASH, payoff });
    const N = res.ranking.length;
    res.ranking.forEach((st, k) => {
      const a = byId.get(st.id)!;
      const pct = k / (N - 1); // 0 = first
      const h = HOUSE.agents.find((x) => x.id === st.id);
      const key = h ? `house:${h.policy.name}` : PRESETS.includes(a.policy) ? `preset:${a.policy.name}` : null;
      if (key) (label[key] ??= []).push(pct);
      const st2 = isPure(a.policy) ? `pure-${a.policy.default}` : h ? `house-${h.style}` : "mixed";
      (style[st2] ??= []).push(pct);
      if (k < 10 && isPure(a.policy) && a.policy.default !== "COPY_LEADER") { pureTop10++; pureTop10By[a.policy.default] = (pureTop10By[a.policy.default] ?? 0) + 1; }
      if (k === 0) { winners.push(key ?? `gen:${a.policy.name}`); if (isPure(a.policy) && a.policy.default !== "COPY_LEADER") pureWins++; }
    });
  }
  const mean = (xs: number[]) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
  const labels = Object.fromEntries(Object.entries(label).map(([k, v]) => [k, mean(v)]).sort((a, b) => (a[1] as number) - (b[1] as number)));
  const styles = Object.fromEntries(Object.entries(style).map(([k, v]) => [k, mean(v)]).sort((a, b) => (a[1] as number) - (b[1] as number)));
  const distinctWinners = new Set(winners).size;
  return { pureWins, pureTop10, pureTop10By, distinctWinners, winners, styles, labels };
}

const CANDIDATES: Record<string, readonly (readonly number[])[]> = JSON.parse(process.env.CANDIDATES ?? "null") ?? { "first-draft": [[3, 3, 5, -1], [1, 1, 3, 3], [2, 2, 4, -2], [5, -3, 7, -1]], frozen: PAYOFF };
const out: Record<string, unknown> = {};
for (const [name, m] of Object.entries(CANDIDATES)) {
  const e = evaluate(m);
  const thin = evaluate(m, 0); // house + presets only (a thin night)
  out[name] = { payoff: m, ...e, thin: { pureWins: thin.pureWins, pureTop10: thin.pureTop10, pureTop10By: thin.pureTop10By, winners: thin.winners, labels: thin.labels } };
  console.log(name, JSON.stringify(m), "pureWins", e.pureWins, "pureTop10", e.pureTop10, JSON.stringify(e.pureTop10By), "distinctWinners", e.distinctWinners,
    "| thin: pureWins", thin.pureWins, "pureTop10", thin.pureTop10, JSON.stringify(thin.pureTop10By), "winners", JSON.stringify(thin.winners.reduce((m: Record<string, number>, w) => ((m[w] = (m[w] ?? 0) + 1), m), {})));
  console.log("  styles", JSON.stringify(e.styles));
  console.log("  top labels", JSON.stringify(Object.entries(e.labels).slice(0, 8)));
  console.log("  winners", e.winners.join(" "));
}
if (process.argv.includes("--write"))
  writeFileSync(new URL("../../evidence/sim-tuning.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), seeds: SEEDS.length, field: "30 house + 8 presets + 200 generated", houseSetHash: HOUSE_SET_HASH, candidates: out }, null, 1) + "\n");
