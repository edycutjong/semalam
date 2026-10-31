// Rank wording (A11): a displayed rank always says which pool it is in.
export type Row = { rank: number; id: string; house: boolean; operator: boolean; coins: number; steals: number; points: number; label: string | null };
export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
/** "4th of 212 players · 7th of 242 agents"; operators and house agents say what they are instead. */
export function rankLine(ranking: Row[], id: string, players: number, agents: number): string | null {
  const me = ranking.find((r) => r.id.toLowerCase() === id.toLowerCase());
  if (!me) return null;
  if (me.house) return `HOUSE · ${ordinal(me.rank)} of ${agents} agents`;
  if (me.operator) return `operator address (not a player) · ${ordinal(me.rank)} of ${agents} agents`;
  const ahead = ranking.filter((r) => !r.house && !r.operator && r.rank < me.rank).length;
  return `${ordinal(ahead + 1)} of ${players} player${players === 1 ? "" : "s"} · ${ordinal(me.rank)} of ${agents} agents`;
}
