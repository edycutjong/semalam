// Settled-round artifacts: written by scripts/settle (one JSON per round, committed), read here. No sim on the request path.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Settled } from "@semalam/sim/round";
import type { Policy } from "@semalam/policy";
import { SEED_DELAY, closeTime } from "./clock";
import { seedRoundAt, roundTimeOf } from "@semalam/beacon";

export type Opponent = { id: string; label: string | null; house: boolean; rank: number; coins: number; policy: Policy };
export type RoundArtifact = {
  v: 1; chainId: number; round: number; settledAt: string;
  /** posted = on chain and equal to the CLI hash; the failure states are named, never "endless settling" (A20). */
  status: "posted" | "hash-mismatch-not-posted" | "poster-reverted" | "unposted";
  onchain: { resultHash: string; drandRound: number; tx: string | null } | null;
  cli: { version: string; resultHash: string; match: boolean };
  commitTxs: { account: string; tx: string }[];
  settled: Settled;
  opponents: Opponent[];
  /** every decrypted player policy (public once the night is settled) — the breakfast "what if" re-runs the night from these */
  policies: { id: string; policy: Policy }[];
};
/** A20 strings for a round that HAS an artifact but is not a clean post. */
export const statusLabel = (st: RoundArtifact["status"]): string =>
  st === "posted" ? "posted" : st === "hash-mismatch-not-posted" ? "hash mismatch — not posted" : st === "poster-reverted" ? "poster reverted" : "not posted yet — waiting for the runner";
export type Named = { code: string; label: string; detail?: string };

const dir = () => path.join(process.cwd(), "data", "rounds");
export async function readArtifact(round: number): Promise<RoundArtifact | null> {
  try { return JSON.parse(await readFile(path.join(dir(), `${round}.json`), "utf8")) as RoundArtifact; } catch { return null; }
}
export async function settledRounds(): Promise<number[]> {
  try { return (await readdir(dir())).map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b); } catch { return []; }
}

/** The named public state of a round that has no artifact yet (A20). */
export function namedState(round: number, now: number, current: number, posted: boolean): Named {
  if (round > current) return { code: "future", label: `round ${round} has not opened yet` };
  if (round === current && now < closeTime(round)) return { code: "open", label: `open — orders are accepted until the close` };
  const dr = seedRoundAt(closeTime(round));
  const at = roundTimeOf(dr);
  if (now < at) return { code: "waiting-drand", label: `waiting for drand round ${dr}`, detail: `the beacon is published ${Math.max(0, at - now)} s from now; the sealed orders open with it` };
  if (now < closeTime(round) + SEED_DELAY) return { code: "waiting-drand", label: `waiting for drand round ${dr}` };
  if (posted) return { code: "artifact-pending", label: "settled on chain — the replay data is landing", detail: "the result hash is already on chain; /verify works now" };
  return { code: "unposted", label: "not posted yet — waiting for the runner", detail: `any machine can run: npx semalam replay ${round} --chain <id>; the runner posts only when its hash equals the CLI's` };
}
