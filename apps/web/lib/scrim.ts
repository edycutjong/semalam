// Scrimmage = the same sim as the settled night, run in the browser against yesterday's top 30 (no plaintext draft ever
// reaches the server). The seed is a pure function of the payment (paid) or of (round, account, policyHash) (free).
import { encodePacked, keccak256, type Address, type Hex } from "viem";
import { policyHash, type Policy } from "@semalam/policy";
import { run, replayOf, type Agent } from "@semalam/sim";
import type { AgentRep, Trace } from "@/components/ReplayPlayer";
import type { Opponent } from "./artifact";

export const draftHash = (p: Policy): Hex => policyHash(p);
export const freeSeed = (round: number, account: Address, policyHash: Hex): Hex => keccak256(encodePacked(["uint256", "address", "bytes32"], [BigInt(round), account, policyHash]));
export const paidSeed = (tx: Hex): Hex => keccak256(tx);

export type ScrimResult = { rank: number; of: number; coins: number; steals: number; replays: AgentRep[]; houseIds: string[]; resultHash: Hex; opponents: number; trace: Trace | null };
export function scrimmage(me: { id: Address; policy: Policy }, opponents: Opponent[], seed: Hex, round: number): ScrimResult {
  const rivals: Agent[] = opponents.filter((o) => o.id.toLowerCase() !== me.id.toLowerCase()).map((o) => ({ id: o.id as Hex, policy: o.policy, house: o.house }));
  const field: Agent[] = [{ id: me.id, policy: me.policy }, ...rivals];
  const z = keccak256("0x73637269726d616765"); // "scrimmage" — these hash inputs never reach Results
  const res = run(field, seed, { round: BigInt(round), drandRound: 0n, policySetHash: z, houseSetHash: z, trace: true });
  const i = res.ranking.findIndex((r) => r.id.toLowerCase() === me.id.toLowerCase());
  return {
    rank: i + 1, of: res.agents, coins: res.ranking[i].coins, steals: res.ranking[i].steals, resultHash: res.resultHash, opponents: rivals.length,
    replays: res.field.map((a) => replayOf(res, a.id) as unknown as AgentRep), houseIds: rivals.filter((r) => r.house).map((r) => r.id.toLowerCase()),
    trace: res.trace ? { ids: res.field.map((a) => a.id), turns: res.trace } : null, // the run itself, so the replay draws its real moves
  };
}
