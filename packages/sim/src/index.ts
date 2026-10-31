// SEMALAM night-market simulator — plain code, no LLM. Same inputs → same ranking → same resultHash.
// Rule set v1. Payoffs tuned against the house set and frozen (below); SIM_VERSION pins them.
// resultHash = keccak256(abi.encode(string SIM_VERSION, round, drandRound, randomness, policySetHash, houseSetHash,
// (address, coins)[] ranking)); Results.SIM_VERSION on chain stores keccak256(bytes(SIM_VERSION)).
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
// Frozen 2026-10-31 after tuning over 48 seeds (scripts/sim/tune.ts → evidence/sim-tuning.json): a pure action wins
// 1 of 48 house+preset nights (first draft table: 5) and 5 of 48 random 238-agent fields (draft: 6); 15 distinct
// winners on the thin nights. Its digest is pinned in test/pins.test.ts: any change must also bump SIM_VERSION.
export const PAYOFF: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([2, 2, 4, -2]),
  Object.freeze([1, 1, 2, 3]),
  Object.freeze([2, 2, 5, -3]),
  Object.freeze([4, -3, 6, -1]),
]);
export const ALONE = 3; // odd N: the unpaired stall gathers alone for +3, whatever its policy says

export type Agent = { id: Hex; policy: Policy; house?: boolean };
export type Standing = { id: Hex; coins: number; steals: number; house: boolean };
/** Per-turn record (only with opts.trace): field order = agents sorted by id. fired: -2 opening, -1 default, 0..2 rule. */
export type Turn = { act: Uint8Array; fired: Int8Array; partner: Int32Array; coins: Int32Array; rank: Int32Array };
export type NightResult = { ranking: Standing[]; resultHash: Hex; turns: number; agents: number; field: Agent[]; trace?: Turn[] };

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

/**
 * Fisher–Yates over the CURRENT seat order (the permutation carries from block to block), with unbiased draws.
 * Called at turns 1, 51, 101, … — 6 market blocks of 50 turns.
 */
export function reseat(seat: number[], next: () => number) {
  for (let i = seat.length - 1; i > 0; i--) {
    const j = below(next, i + 1);
    [seat[i], seat[j]] = [seat[j], seat[i]];
  }
  return seat;
}

/** Tie-break key: keccak256(abi.encodePacked(bytes32 randomness, address id)) — 52 bytes, ascending wins. */
export const tieKey = (randomness: Hex, id: Hex) => keccak256(concat([randomness, id]));

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
  opts: { round: bigint; drandRound: bigint; policySetHash: Hex; houseSetHash: Hex; trace?: boolean; payoff?: readonly (readonly number[])[] },
): NightResult {
  const PAY = opts?.payoff ?? PAYOFF; // payoff override = tuning script only; the runner and the CLI never pass it
  if (!opts?.policySetHash || !opts?.houseSetHash || opts.round === undefined || opts.drandRound === undefined)
    throw new Error("run(): round, drandRound, policySetHash and houseSetHash are required");
  const field = [...agents].sort((x, y) => (x.id.toLowerCase() < y.id.toLowerCase() ? -1 : 1));
  const N = field.length;
  const rand = sfc32(randomness);
  const tie = field.map((a) => tieKey(randomness, a.id));
  const coins = new Array<number>(N).fill(START_COINS);
  const steals = new Array<number>(N).fill(0);
  const lastAct = new Array<Act>(N).fill("GATHER");
  const lastThiefTurn = new Array<number>(N).fill(-1e9); // last turn i stole from anyone
  const stoleFromMe: Map<number, number>[] = field.map(() => new Map()); // partner → last turn they stole from me
  const sharedWithMe: Map<number, number>[] = field.map(() => new Map());
  let rank = rankOf(coins, steals, tie); // rank[i] = 1-based
  let leader = rank.indexOf(1);
  const seat = field.map((_, i) => i);
  const trace: Turn[] = [];
  const fired = new Int8Array(N);

  for (let t = 1; t <= TURNS; t++) {
    if ((t - 1) % BLOCK === 0) {
      reseat(seat, rand);
    }
    const partner = pairing(seat, t);
    // decide on the snapshot of the previous turn
    const act = new Array<Act>(N);
    for (let i = 0; i < N; i++) act[i] = decide(i, partner[i], t);
    // payoffs
    const delta = new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) {
      const p = partner[i];
      delta[i] = p < 0 ? ALONE : PAY[IDX[act[i]]][IDX[act[p]]];
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
    if (opts.trace)
      trace.push({
        act: Uint8Array.from(act, (a) => IDX[a]),
        fired: fired.slice(),
        partner: Int32Array.from(partner),
        coins: Int32Array.from(coins),
        rank: Int32Array.from(rank),
      });
  }

  function resolve(i: number, a: Policy["default"], t: number, pol: Policy): Act {
    if (a !== "COPY_LEADER") return a;
    if (t === 1) return "GATHER";
    if (i === leader) return pol.default === "COPY_LEADER" ? "GATHER" : pol.default;
    return lastAct[leader];
  }

  function decide(i: number, p: number, t: number): Act {
    const pol = field[i].policy;
    if (t <= OPENING_TURNS) return (fired[i] = -2), resolve(i, pol.opening, t, pol);
    for (let k = 0; k < pol.rules.length; k++) {
      const r = pol.rules[k];
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
      if (hit) return (fired[i] = k), resolve(i, r.then, t, pol);
    }
    fired[i] = -1;
    return resolve(i, pol.default, t, pol);
  }

  const order = field.map((_, i) => i).sort((x, y) => rank[x] - rank[y]);
  const ranking: Standing[] = order.map((i) => ({ id: field[i].id, coins: coins[i], steals: steals[i], house: !!field[i].house }));
  const resultHash = keccak256(
    encodeAbiParameters(
      [
        { type: "string" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
        { type: "tuple[]", components: [{ type: "address" }, { type: "uint256" }] },
      ],
      [
        SIM_VERSION, opts.round, opts.drandRound, randomness, opts.policySetHash, opts.houseSetHash,
        ranking.map((r) => [r.id, BigInt(r.coins)] as const),
      ],
    ),
  );
  return { ranking, resultHash, turns: TURNS, agents: N, field, trace: opts.trace ? trace : undefined };
}

/**
 * Ring pairing for turn t: pairs (2k+s, 2k+1+s) mod N with s = t mod 2. Even N: s=1 wraps (N-1, 0).
 * Odd N: the stall at seat N-1 (s=0) or seat 0 (s=1) sits out and gathers alone. Returns partner[agent] (-1 = alone).
 */
export function pairing(seat: number[], t: number): number[] {
  const N = seat.length;
  const partner = new Array<number>(N).fill(-1);
  const s = t % 2;
  const lim = (N % 2 === 0 ? N - 1 : N - 2) + s;
  for (let k = s; k < lim; k += 2) {
    const a = seat[k % N], b = seat[(k + 1) % N];
    partner[a] = b;
    partner[b] = a;
  }
  return partner;
}

/** coins desc, fewer steals, keccak(randomness, id) asc → 1-based rank per agent. */
export function rankOf(coins: number[], steals: number[], tie: Hex[]): number[] {
  const idx = coins.map((_, i) => i);
  idx.sort((a, b) => coins[b] - coins[a] || steals[a] - steals[b] || (tie[a] < tie[b] ? -1 : tie[a] > tie[b] ? 1 : 0));
  const r = new Array<number>(coins.length);
  idx.forEach((i, k) => (r[i] = k + 1));
  return r;
}

export { ACTS };

/** Points for one night from the FULL-field rank; house agents never score. */
export const points = (fieldRank: number, house = false) => (house ? 0 : Math.max(0, 100 - fieldRank + 1));

export type Keyframe = { t: number; coins: number; rank: number };
export type Decisive = { t: number; action: Act; partner: Hex | null; partnerAction: Act | null; delta: number; rule: number; why: string };
export type AgentReplay = { id: Hex; keyframes: Keyframe[]; decisive: Decisive };

/**
 * ≤ 30 keyframes (every 10th turn) + the decisive turn for one agent: the turn where one of its own rules fired with the
 * largest coin swing (ties → earliest); if no rule ever fired, the largest swing of the night.
 */
export function replayOf(res: NightResult, id: Hex): AgentReplay {
  if (!res.trace) throw new Error("replayOf(): run with { trace: true }");
  const i = res.field.findIndex((a) => a.id.toLowerCase() === id.toLowerCase());
  if (i < 0) throw new Error(`replayOf(): ${id} not in this night`);
  const tr = res.trace;
  const keyframes: Keyframe[] = [];
  for (let t = 10; t <= tr.length; t += 10) keyframes.push({ t, coins: tr[t - 1].coins[i], rank: tr[t - 1].rank[i] });
  let best = -1, bestAbs = -1, bestRule = -1, bestRuleAbs = -1;
  for (let t = 1; t <= tr.length; t++) {
    const d = Math.abs(tr[t - 1].coins[i] - (t === 1 ? START_COINS : tr[t - 2].coins[i]));
    if (d > bestAbs) (bestAbs = d), (best = t);
    if (tr[t - 1].fired[i] >= 0 && d > bestRuleAbs) (bestRuleAbs = d), (bestRule = t);
  }
  const t = bestRule > 0 ? bestRule : best;
  const row = tr[t - 1];
  const p = row.partner[i];
  const delta = row.coins[i] - (t === 1 ? START_COINS : tr[t - 2].coins[i]);
  const pol = res.field[i].policy;
  const rule = row.fired[i];
  const action = ACTS[row.act[i]];
  const partnerAction = p >= 0 ? ACTS[row.act[p]] : null;
  const src = rule >= 0 ? `rule ${rule + 1} (${pol.rules[rule].not ? "not " : ""}${pol.rules[rule].if})` : rule === -2 ? "opening" : "default";
  const why = `turn ${t}: ${src} → ${action}${partnerAction ? ` vs ${partnerAction}` : " alone"}, ${delta >= 0 ? "+" : ""}${delta} coins`;
  return { id: res.field[i].id, keyframes, decisive: { t, action, partner: p >= 0 ? res.field[p].id : null, partnerAction, delta, rule, why } };
}
