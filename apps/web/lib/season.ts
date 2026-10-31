// Season table — the same rule as `semalam season <s>` (packages/cli): operators and house never score;
// crown-eligible = paid in that season + > 0 points + a top-half finish of the full field at least once.
// Order: points desc, coins desc, keccak256(account) asc. test/season.test.ts pins this against the CLI's own function.
import { getAddress, keccak256, type Address } from "viem";
import type { Row } from "./rank";

export type Night = { agents: number; ranking: Row[] };
export function seasonBoard(nights: Night[], payers: Set<string>) {
  const tally = new Map<string, { points: number; topHalf: boolean; coins: number }>();
  for (const st of nights)
    for (const row of st.ranking) {
      if (row.house || row.operator) continue;
      const t = tally.get(row.id.toLowerCase()) ?? { points: 0, topHalf: false, coins: 0 };
      t.points += row.points; t.coins += row.coins; t.topHalf ||= row.rank <= st.agents / 2;
      tally.set(row.id.toLowerCase(), t);
    }
  const board = [...tally.entries()]
    .map(([id, t]) => ({ id: getAddress(id) as Address, ...t, eligible: payers.has(id) && t.topHalf && t.points > 0 }))
    .sort((x, y) => y.points - x.points || y.coins - x.coins || (keccak256(x.id) < keccak256(y.id) ? -1 : 1));
  return { board, champion: board.find((b) => b.eligible) ?? null };
}
