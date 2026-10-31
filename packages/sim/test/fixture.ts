// Deterministic synthetic field: 30 house agents (ids 0x…01–0x…1e) + 200 generated players.
import { ACTIONS, CONDITIONS, type Policy } from "@semalam/policy";
import { pad, toHex, type Hex } from "viem";
import { sfc32, type Agent } from "../src/index.ts";

export const RANDOMNESS = "0x3c11de15056c2178129fd057942ef8d0a826dc210e339a785390d50097e42f3e" as Hex; // quicknet round 33548730

export function field(players = 200, seed: Hex = "0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e"): Agent[] {
  const r = sfc32(seed);
  const pick = <T,>(xs: readonly T[]) => xs[r() % xs.length];
  const gen = (name: string): Policy => ({
    v: 1, name, opening: pick(ACTIONS), default: pick(ACTIONS), grudge: r() % 21,
    rules: Array.from({ length: r() % 4 }, () => {
      const c = pick(CONDITIONS);
      return c === "turn_after" ? { if: c, n: 1 + (r() % 300), then: pick(ACTIONS) } : { if: c, then: pick(ACTIONS) };
    }),
  });
  const house = Array.from({ length: 30 }, (_, i) => ({ id: pad(toHex(i + 1), { size: 20 }), policy: gen(`house-${i + 1}`), house: true }));
  const ps = Array.from({ length: players }, (_, i) => ({ id: pad(toHex(BigInt(r()) * 0x100000000n + BigInt(r()) + 0x1000n), { size: 20 }), policy: gen(`p${i}`) }));
  return [...house, ...ps];
}
