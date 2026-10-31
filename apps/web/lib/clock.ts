// Round clock — the same integer arithmetic as RoundClock.sol, so the page and the chain never disagree.
import { GENESIS } from "./config";

export const DAY = 86400;
export const WIB = 7 * 3600;
export const SEED_DELAY = 300;

export const currentRound = (now: number, genesis = GENESIS) => (now < genesis ? 0 : Math.floor((now - genesis) / DAY) + 1);
export const closeTime = (round: number, genesis = GENESIS) => genesis + round * DAY;
export const seasonOf = (round: number) => (round < 2 ? 0 : Math.floor((round - 2) / 3) + 1);

/** "05:42:10" until the close, or null once closed. */
export function countdown(now: number, round: number, genesis = GENESIS): string | null {
  const left = closeTime(round, genesis) - now;
  if (left <= 0) return null;
  const p = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${p(left / 3600)}:${p((left % 3600) / 60)}:${p(left % 60)}`;
}
export function wibLabel(unix: number): string {
  const d = new Date((unix + WIB) * 1000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} WIB`;
}
