// Re-runs a settled bot-playtest night's exact field (30 house agents + the decrypted player policies) under N other
// random seeds, so one night's rank is not mistaken for a trend. Internal QA; prints median/best/worst rank per bot.
//   tsx playtest/seeds.ts <round> <night> [seeds=100]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex, type Hex } from "viem";
import { run, PAYOFF, type Agent } from "../../packages/sim/src/index.ts";
import { houseAgents, HOUSE_SET_HASH } from "../../packages/sim/src/house.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [round, night, n = "100"] = process.argv.slice(2);
const art = JSON.parse(readFileSync(path.join(root, `apps/web/data/rounds/${round}.json`), "utf8"));
const commits = JSON.parse(readFileSync(path.join(root, `evidence/playtest/commits-n${night}.json`), "utf8")).commits;
const who: Record<string, string> = Object.fromEntries(commits.filter((c: any) => c.entered).map((c: any) => [c.account.toLowerCase(), c.id]));
const players: Agent[] = art.policies.map((p: any) => ({ id: p.id, policy: p.policy }));
const label = (id: string) => who[id.toLowerCase()] ?? "other";
const ranks: Record<string, number[]> = {}, wins: Record<string, number> = {};
let steal = 0;
for (let i = 0; i < Number(n); i++) {
  const s = keccak256(toHex(`semalam-p1e-seed-${round}-${i}`)) as Hex;
  const res = run([...houseAgents(), ...players], s, { round: 1n, drandRound: 1n, policySetHash: s, houseSetHash: HOUSE_SET_HASH, payoff: PAYOFF });
  res.ranking.forEach((st: any, k: number) => { const l = label(st.id); if (l !== "other" || players.some((p) => p.id === st.id)) (ranks[l] ??= []).push(k + 1); });
  const w = res.ranking[0].id; const wl = who[w.toLowerCase()] ?? (players.some((p) => p.id === w) ? "other-player" : "house");
  wins[wl] = (wins[wl] ?? 0) + 1;
  if (who[res.ranking[0].id.toLowerCase()] === "p02") steal++;
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = Object.entries(ranks).map(([k, v]) => ({ bot: k, median: med(v), best: Math.min(...v), worst: Math.max(...v), top10: v.filter((r) => r <= 10).length })).sort((a, b) => a.median - b.median);
console.log(`field: ${houseAgents().length} house + ${players.length} players · ${n} seeds\n`);
console.log("| bot | median rank | best | worst | top-10 in N seeds |\n|---|---|---|---|---|");
out.forEach((r) => console.log(`| ${r.bot} | ${r.median} | ${r.best} | ${r.worst} | ${r.top10} |`));
console.log("\nwinners:", JSON.stringify(wins));
writeFileSync(path.join(root, `evidence/playtest/seeds-r${round}.json`), JSON.stringify({ what: "re-runs of the settled night's field under other seeds (internal QA)", round: Number(round), seeds: Number(n), table: out, winners: wins }, null, 1));
