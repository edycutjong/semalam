// The return ritual, from public data only: the posted round artifacts (who committed, where they ranked) plus the rounds
// this browser remembers sealing. A streak counts nights played; it never threatens a loss and never asks for $WIF.
import type { Row } from "./rank";

export type Night = { round: number; committed: boolean; rank: number | null; playerRank: number | null; players: number; agents: number; coins: number | null };
export type Ritual = { played: number[]; streak: number; best: Night | null; last: Night | null; prev: Night | null; delta: number | null };

/** One posted night seen from one account: committed = a commit log from it was read; ranks only if it scored as a player. */
export function nightOf(round: number, ranking: Row[], commitAccounts: string[], players: number, agents: number, account: string): Night {
  const a = account.toLowerCase();
  const me = ranking.find((r) => r.id.toLowerCase() === a);
  const scored = me && !me.house && !me.operator ? me : null;
  const playerRank = scored ? ranking.filter((r) => !r.house && !r.operator && r.rank < scored.rank).length + 1 : null;
  return { round, committed: commitAccounts.some((c) => c.toLowerCase() === a), rank: scored?.rank ?? null, playerRank, players, agents, coins: scored?.coins ?? null };
}

/** Consecutive nights played, counted back from `latest` if it was played, else from the night before (no zero for an
 * evening that has not been sealed yet). */
export function streakOf(played: Iterable<number>, latest: number): number {
  const s = new Set(played);
  let r = s.has(latest) ? latest : latest - 1, n = 0;
  while (r >= 1 && s.has(r)) { n++; r--; }
  return n;
}

/** Placing as a share of the field (0 = first), so 2nd of 15 beats 2nd of 3. */
const place = (n: Night) => (n.playerRank! - 1) / Math.max(1, n.players - 1);

export function ritualOf(nights: Night[], localRounds: number[], latest: number): Ritual {
  const played = [...new Set([...nights.filter((n) => n.committed || n.playerRank !== null).map((n) => n.round), ...localRounds])].sort((a, b) => a - b);
  const ranked = nights.filter((n) => n.playerRank !== null).sort((a, b) => a.round - b.round);
  const best = ranked.reduce<Night | null>((b, n) => (!b || place(n) < place(b) || (place(n) === place(b) && n.playerRank! < b.playerRank!) ? n : b), null);
  const last = ranked.at(-1) ?? null, prev = ranked.length > 1 ? ranked[ranked.length - 2] : null;
  return { played, streak: streakOf(played, latest), best, last, prev, delta: last && prev ? prev.playerRank! - last.playerRank! : null };
}
