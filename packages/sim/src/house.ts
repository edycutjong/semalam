// The frozen house set: 30 public, labelled agents (house/house-set.json). HOUSE_SET_HASH is pinned in Results.
import { keccak256, toBytes, type Hex } from "viem";
import { Policy, canonical } from "@semalam/policy";
import houseFile from "../../../house/house-set.json" with { type: "json" };
import type { Agent } from "./index.ts";

export type HouseEntry = { n: number; id: Hex; label: string; style: string; policy: Policy };
export type HouseSet = { v: 1; note: string; agents: HouseEntry[] };

/** keccak256(utf8(canonical(houseSet))) — whitespace and key order never change it. */
export const houseSetHash = (h: unknown): Hex => keccak256(toBytes(canonical(h)));

/** Validates a house file: 30 agents, ids address(uint160(1..30)) in order, every policy schema-valid. */
export function parseHouseSet(h: unknown): HouseSet {
  const set = h as HouseSet;
  if (set?.v !== 1 || !Array.isArray(set.agents) || set.agents.length !== 30) throw new Error("house set: need v=1 and 30 agents");
  set.agents.forEach((a, i) => {
    if (a.n !== i + 1 || a.id !== `0x${(i + 1).toString(16).padStart(40, "0")}` || a.label !== `house-${String(i + 1).padStart(2, "0")}`)
      throw new Error(`house set: bad id/label at ${i + 1}`);
    Policy.parse(a.policy);
  });
  return set;
}

export const HOUSE: HouseSet = parseHouseSet(houseFile);
export const HOUSE_SET_HASH: Hex = houseSetHash(houseFile);
export const houseAgents = (set: HouseSet = HOUSE): Agent[] => set.agents.map((a) => ({ id: a.id, policy: a.policy, house: true }));
