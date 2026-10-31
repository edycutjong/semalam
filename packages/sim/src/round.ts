// One night, from chain logs to resultHash: admission cap, latest commit per account, void reasons, policySetHash,
// the house set, the sim, and the settled artifact (ranking + ≤ 30 keyframes per agent). Decryption is injected so the
// CLI, the settler and the tests share this exact code.
import { encodeAbiParameters, keccak256, hexToBytes, getAddress, type Hex, type Address } from "viem";
import { Policy, canonical } from "@semalam/policy";
import { run, replayOf, points, SIM_VERSION, type Agent, type NightResult, type AgentReplay } from "./index.ts";
import { HOUSE, HOUSE_SET_HASH, houseAgents, type HouseSet } from "./house.ts";
import { QUICKNET, seedRoundAt, stanzaOf } from "@semalam/beacon";

export const ADMISSION_CAP = 1000;
export const MAX_SEALED = 1536;
export const DAY = 86400;

/** Round clock — same integer formulas as RoundClock.sol / Results.seedRound. */
export const closeTime = (genesis: number, round: number) => genesis + round * DAY;
export const season = (round: number) => (round < 2 ? 0 : Math.floor((round - 2) / 3) + 1);
export const seedRound = (genesis: number, round: number) => seedRoundAt(closeTime(genesis, round));

export type CommitLog = { account: Address; policyHash: Hex; sealedBlob: Hex; blockNumber: bigint; logIndex: number; txHash?: Hex };
export type VoidReason = "UNDECRYPTABLE" | "WRONG_ROUND" | "HASH_MISMATCH" | "SCHEMA_INVALID";
export type Beacon = { round: number; randomness: string; signature: string };

const pos = (l: CommitLog) => [l.blockNumber, BigInt(l.logIndex)] as const;
const before = (a: CommitLog, b: CommitLog) => { const [x, y] = pos(a), [u, v] = pos(b); return x < u || (x === u && y < v); };

/**
 * The first ADMISSION_CAP distinct accounts by their FIRST commit's (blockNumber, logIndex); for each, the LATEST
 * commit counts. Later accounts are "over capacity". Input order never matters.
 */
export function selectCommits(logs: CommitLog[], cap = ADMISSION_CAP) {
  const sorted = [...logs].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  const first: Address[] = [];
  const latest = new Map<string, CommitLog>();
  for (const l of sorted) {
    const k = l.account.toLowerCase();
    if (!latest.has(k)) first.push(getAddress(l.account));
    latest.set(k, l);
  }
  const admitted = first.slice(0, cap);
  return { latest: admitted.map((a) => latest.get(a.toLowerCase())!), overCapacity: first.slice(cap) };
}

/**
 * policySetHash = keccak256(abi.encode((address account, bytes32 policyHash)[])) over EVERY admitted account's latest
 * commit — void ones included (the hash pins the input set; voids are then excluded from play) — sorted by address
 * ascending (lowercase hex). Over-capacity accounts are not in it.
 */
export function policySetHash(latest: { account: Address; policyHash: Hex }[]): Hex {
  const key = (r: { account: Address }) => r.account.toLowerCase();
  const rows = [...latest].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return keccak256(
    encodeAbiParameters([{ type: "tuple[]", components: [{ type: "address" }, { type: "bytes32" }] }], [rows.map((r) => [getAddress(r.account), r.policyHash] as const)]),
  );
}

/** Opens each latest commit or name why it is void. `decrypt` gets a blob already checked to target `drandRound`. */
export async function openCommits(latest: CommitLog[], drandRound: number, decrypt: (sealed: Uint8Array) => Promise<Uint8Array>) {
  const agents: (Agent & { policyHash: Hex })[] = [];
  const voids: { account: Address; policyHash: Hex; reason: VoidReason }[] = [];
  const cache = new Map<string, Uint8Array | Error>();
  for (const l of latest) {
    const v = (reason: VoidReason) => voids.push({ account: getAddress(l.account), policyHash: l.policyHash, reason });
    const sealed = hexToBytes(l.sealedBlob);
    const st = stanzaOf(sealed);
    if (!st || sealed.length > MAX_SEALED) { v("UNDECRYPTABLE"); continue; }
    if (st.round !== drandRound || st.chain !== QUICKNET.hash) { v("WRONG_ROUND"); continue; }
    const key = keccak256(sealed);
    if (!cache.has(key)) cache.set(key, await decrypt(sealed).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))));
    const plain = cache.get(key)!;
    if (plain instanceof Error) { v("UNDECRYPTABLE"); continue; }
    if (keccak256(plain) !== l.policyHash.toLowerCase()) { v("HASH_MISMATCH"); continue; }
    let policy: Policy;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(plain);
      policy = Policy.parse(JSON.parse(text));
      if (canonical(policy) !== text) throw new Error("not canonical");
    } catch { v("SCHEMA_INVALID"); continue; }
    agents.push({ id: getAddress(l.account), policy, policyHash: l.policyHash });
  }
  return { agents, voids };
}

export type RoundInput = { round: number; genesis: number; logs: CommitLog[]; beacon: Beacon; house?: HouseSet; houseSetHash?: Hex };
export type Settled = {
  sim: string; round: number; drandRound: number; randomness: Hex; policySetHash: Hex; houseSetHash: Hex; resultHash: Hex;
  /** players = non-house agents that played, minus operator addresses; playersAll counts operators too. */
  players: number; playersAll: number; agents: number; overCapacity: Address[];
  voids: { account: Address; policyHash: Hex; reason: VoidReason }[];
  ranking: { rank: number; id: Hex; label: string | null; house: boolean; operator: boolean; coins: number; steals: number; points: number; policyHash: Hex | null }[];
  replays: AgentReplay[];
};

/**
 * Settles one round. Beacon must already be BLS-verified by the caller (packages/beacon) — this function refuses any
 * drand round but seedRound(round). `excluded` (operator addresses) only changes the player count, never the hash.
 */
export async function settle(input: RoundInput, decrypt: (sealed: Uint8Array, beacon: Beacon) => Promise<Uint8Array>, excluded: Address[] = []): Promise<Settled> {
  const need = seedRound(input.genesis, input.round);
  if (input.beacon.round !== need) throw new Error(`drand round ${input.beacon.round} != seedRound(${input.round}) = ${need}`);
  const house = input.house ?? HOUSE;
  const hHash = input.houseSetHash ?? HOUSE_SET_HASH;
  const { latest, overCapacity } = selectCommits(input.logs);
  const { agents, voids } = await openCommits(latest, need, (s) => decrypt(s, input.beacon));
  const psHash = policySetHash(latest);
  const randomness = `0x${input.beacon.randomness.replace(/^0x/, "")}` as Hex;
  const res: NightResult = run([...houseAgents(house), ...agents], randomness, {
    round: BigInt(input.round), drandRound: BigInt(need), policySetHash: psHash, houseSetHash: hHash, trace: true,
  });
  const label = new Map(house.agents.map((a) => [a.id.toLowerCase(), a.label]));
  const ph = new Map(agents.map((a) => [a.id.toLowerCase(), a.policyHash]));
  const ex = new Set(excluded.map((a) => a.toLowerCase()));
  return {
    sim: SIM_VERSION, round: input.round, drandRound: need, randomness, policySetHash: psHash, houseSetHash: hHash, resultHash: res.resultHash,
    players: agents.filter((a) => !ex.has(a.id.toLowerCase())).length, playersAll: agents.length, agents: res.agents, overCapacity, voids,
    ranking: res.ranking.map((r, k) => ({
      rank: k + 1, id: r.id, label: label.get(r.id.toLowerCase()) ?? null, house: r.house, operator: ex.has(r.id.toLowerCase()), coins: r.coins, steals: r.steals,
      points: points(k + 1, r.house || ex.has(r.id.toLowerCase())), policyHash: ph.get(r.id.toLowerCase()) ?? null,
    })),
    replays: res.field.map((a) => replayOf(res, a.id)),
  };
}
