// Game-health summary of a settled bot-playtest night, from the settled artifact (internal QA).
//   node playtest/health.mjs <round> <night>   -> prints a markdown table + checks
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [round, night] = process.argv.slice(2);
const art = JSON.parse(readFileSync(path.join(root, `apps/web/data/rounds/${round}.json`), "utf8"));
const commits = JSON.parse(readFileSync(path.join(root, `evidence/playtest/commits-n${night}.json`), "utf8")).commits;
const personas = JSON.parse(readFileSync(path.join(root, "scripts/playtest/personas.json"), "utf8")).personas;
const who = Object.fromEntries(commits.filter((c) => c.entered).map((c) => [c.account.toLowerCase(), c.id]));
const style = Object.fromEntries(personas.map((p) => [p.id, p.style]));
const pol = Object.fromEntries(art.policies.map((p) => [p.id.toLowerCase(), p.policy]));
const S = art.settled;
const rows = S.ranking.map((r) => {
  const id = r.id.toLowerCase(), p = pol[id];
  return { rank: r.rank, who: r.house ? r.label : who[id] ? `${who[id]} ${style[who[id]]}` : r.operator ? "operator" : "unknown player", name: p?.name ?? "", coins: r.coins, steals: r.steals, pure: p ? p.rules.length === 0 && p.opening === p.default : null, action: p ? (p.rules.length === 0 && p.opening === p.default ? p.default : "") : "" };
});
console.log(`round ${round} · hash ${S.resultHash} · agents ${S.agents} (players ${S.players}) · voids ${S.voids.length} · overCapacity ${S.overCapacity.length}\n`);
console.log("| rank | who | policy | coins | steals |\n|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.rank} | ${r.who} | ${r.name}${r.action ? ` (pure ${r.action})` : ""} | ${r.coins} | ${r.steals} |`);
const top10 = rows.filter((r) => r.rank <= 10), players = rows.filter((r) => r.pure !== null);
const ranks = rows.map((r) => r.rank), ties = ranks.length - new Set(ranks).size;
console.log(`\ntop-10 pure-action player policies: ${top10.filter((r) => r.pure).map((r) => `${r.who} (${r.action})`).join(", ") || "none"}`);
console.log(`tied ranks: ${ties} · winner: ${rows[0].who} (${rows[0].name || "house"}) · best player: ${players.sort((a, b) => a.rank - b.rank)[0]?.who} #${players[0]?.rank}`);
console.log(`players by pure STEAL: ${players.filter((r) => r.action === "STEAL").map((r) => `${r.who} #${r.rank}`).join(", ") || "none"}`);
