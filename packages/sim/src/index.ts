// SEMALAM night-market simulator — plain code, no LLM. Same inputs → same ranking → same resultHash.
// v1 skeleton (P1a): rule set and payoffs as specified; P1b tunes payoffs against the house set, then freezes.
import { encodeAbiParameters, keccak256, concat, toBytes, type Hex } from "viem";
import type { Policy } from "@semalam/policy";

export const SIM_VERSION = "semalam-sim/1";
export const TURNS = 300;
export const BLOCK = 50;
export const START_COINS = 20;
export const OPENING_TURNS = 10;
export const TOP = 10;
export const MEMORY = 10; // partner_is_thief / partner_shared_with_me look-back

export type Act = "GATHER" | "GUARD" | "SHARE" | "STEAL";
const IDX: Record<Act, number> = { GATHER: 0, GUARD: 1, SHARE: 2, STEAL: 3 };
const ACTS: Act[] = ["GATHER", "GUARD", "SHARE", "STEAL"];
// PAYOFF[me][partner] — coins to the row agent
export const PAYOFF: number[][] = [
  [3, 3, 5, -1],
  [1, 1, 3, 3],
  [2, 2, 4, -2],
  [5, -3, 7, -1],
];
export const ALONE = 3; // unpaired stall gathers alone

export type Agent = { id: Hex; policy: Policy; house?: boolean };
export type Standing = { id: Hex; coins: number; steals: number; house: boolean };
export type NightResult = { ranking: Standing[]; resultHash: Hex; turns: number; agents: number; trace?: Act[][] };

/** sfc32 seeded from the 32-byte drand randomness (first four big-endian words), warmed up. */
export function sfc32(randomness: Hex) {
  const b = toBytes(randomness);
  const w = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  let a = w(0), bb = w(4), c = w(8), d = w(12);
  const next = () => {
    a >>>= 0; bb >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + bb + d) >>> 0;
    d = (d + 1) >>> 0;
    a = bb ^ (bb >>> 9);
    bb = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}

/** Unbiased integer in [0, n). */
function below(next: () => number, n: number) {
  const limit = Math.floor(0x100000000 / n) * n;
  let x: number;
  do x = next(); while (x >= limit);
  return x % n;
}

export function run(
  agents: Agent[],
  randomness: Hex,
  opts: { round?: bigint; drandRound?: bigint; policySetHash?: Hex; houseSetHash?: Hex; trace?: boolean } = {},
): NightResult {
  const field = [...agents].sort((x, y) => (x.id.toLowerCase() < y.id.toLowerCase() ? -1 : 1));
  const N = field.length;
  const rand = sfc32(randomness);
  const tie = field.map((a) => keccak256(concat([randomness, a.id])));
  const coins = new Array<number>(N).fill(START_COINS);
  const steals = new Array<number>(N).fill(0);
  const lastAct = new Array<Act>(N).fill("GATHER");
  const lastThiefTurn = new Array<number>(N).fill(-1e9); // last turn i stole from anyone
  const stoleFromMe: Map<number, number>[] = field.map(() => new Map()); // partner → last turn they stole from me
  const sharedWithMe: Map<number, number>[] = field.map(() => new Map());
  let rank = rankOf(coins, steals, tie); // rank[i] = 1-based
  let leader = rank.indexOf(1);
  const seat = field.map((_, i) => i);
  const trace: Act[][] = [];

  for (let t = 1; t <= TURNS; t++) {
    if ((t - 1) % BLOCK === 0) {
      for (let i = N - 1; i > 0; i--) {
        const j = below(rand, i + 1);
        [seat[i], seat[j]] = [seat[j], seat[i]];
      }
    }
    // pairing on the ring
    const partner = new Array<number>(N).fill(-1);
    const s = t % 2;
    // even N: s=1 wraps (N-1, 0); odd N: stall N-1 (s=0) or stall 0 (s=1) sits out
    const lim = (N % 2 === 0 ? N - 1 : N - 2) + s;
    for (let k = s; k < lim; k += 2) {
      const a = seat[k % N], b = seat[(k + 1) % N];
      partner[a] = b;
      partner[b] = a;
    }
    // decide on the snapshot of the previous turn
    const act = new Array<Act>(N);
    for (let i = 0; i < N; i++) act[i] = decide(i, partner[i], t);
    // payoffs
    const delta = new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) {
      const p = partner[i];
      delta[i] = p < 0 ? ALONE : PAYOFF[IDX[act[i]]][IDX[act[p]]];
    }
    for (let i = 0; i < N; i++) {
      coins[i] = Math.max(0, coins[i] + delta[i]);
      const p = partner[i];
      if (p < 0) continue;
      if (act[i] === "STEAL") {
        steals[i]++;
        lastThiefTurn[i] = t;
        stoleFromMe[p].set(i, t);
      }
      if (act[i] === "SHARE") sharedWithMe[p].set(i, t);
    }
    for (let i = 0; i < N; i++) lastAct[i] = partner[i] < 0 ? "GATHER" : act[i];
    rank = rankOf(coins, steals, tie);
    leader = rank.indexOf(1);
    if (opts.trace) trace.push([...act]);
  }

  function resolve(i: number, a: Policy["default"], t: number, pol: Policy): Act {
    if (a !== "COPY_LEADER") return a;
    if (t === 1) return "GATHER";
    if (i === leader) return pol.default === "COPY_LEADER" ? "GATHER" : pol.default;
    return lastAct[leader];
  }

  function decide(i: number, p: number, t: number): Act {
    const pol = field[i].policy;
    if (t <= OPENING_TURNS) return resolve(i, pol.opening, t, pol);
    for (const r of pol.rules) {
      let hit: boolean;
      switch (r.if) {
        case "partner_stole_from_me": hit = p >= 0 && t - (stoleFromMe[i].get(p) ?? -1e9) <= pol.grudge; break;
        case "partner_is_thief": hit = p >= 0 && t - lastThiefTurn[p] <= MEMORY; break;
        case "partner_shared_with_me": hit = p >= 0 && t - (sharedWithMe[i].get(p) ?? -1e9) <= MEMORY; break;
        case "partner_richer": hit = p >= 0 && coins[p] > coins[i]; break;
        case "partner_poorer": hit = p >= 0 && coins[p] < coins[i]; break;
        case "partner_is_leader": hit = p >= 0 && rank[p] <= TOP; break;
        case "i_am_leading": hit = rank[i] <= TOP; break;
        case "i_am_behind": hit = rank[i] > N / 2; break;
        case "turn_after": hit = t > (r.n ?? TURNS); break;
      }
      if (r.not) hit = !hit;
      if (hit) return resolve(i, r.then, t, pol);
    }
    return resolve(i, pol.default, t, pol);
  }

  const order = field.map((_, i) => i).sort((x, y) => rank[x] - rank[y]);
  const ranking: Standing[] = order.map((i) => ({ id: field[i].id, coins: coins[i], steals: steals[i], house: !!field[i].house }));
  const zero = ("0x" + "00".repeat(32)) as Hex;
  const resultHash = keccak256(
    encodeAbiParameters(
      [
        { type: "string" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
        { type: "tuple[]", components: [{ type: "address" }, { type: "uint256" }] },
      ],
      [
        SIM_VERSION, opts.round ?? 0n, opts.drandRound ?? 0n, randomness, opts.policySetHash ?? zero, opts.houseSetHash ?? zero,
        ranking.map((r) => [r.id, BigInt(r.coins)] as const),
      ],
    ),
  );
  return { ranking, resultHash, turns: TURNS, agents: N, trace: opts.trace ? trace : undefined };
}

/** coins desc, fewer steals, keccak(randomness, id) asc → 1-based rank per agent. */
function rankOf(coins: number[], steals: number[], tie: Hex[]): number[] {
  const idx = coins.map((_, i) => i);
  idx.sort((a, b) => coins[b] - coins[a] || steals[a] - steals[b] || (tie[a] < tie[b] ? -1 : tie[a] > tie[b] ? 1 : 0));
  const r = new Array<number>(coins.length);
  idx.forEach((i, k) => (r[i] = k + 1));
  return r;
}

export { ACTS };
