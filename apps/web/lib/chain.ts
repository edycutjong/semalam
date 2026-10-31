// Server-side chain reads and the relayer. Never imported by client components.
import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, DEP, ORDERS, RESULTS, SCRIMMAGE } from "./config";
import { ORDERS_ABI, RESULTS_ABI, SCRIMMAGE_ABI } from "./abi";
import { memoized } from "./guard";

export const publicClient: PublicClient = createPublicClient({
  chain: CHAIN,
  transport: http(DEP.rpcs[0], { retryCount: 2, retryDelay: 400, timeout: 15_000 }),
}) as PublicClient;

/** The L2 clock: chain time, not the server's. */
export async function chainNow(): Promise<number> {
  const b = await publicClient.getBlock({ blockTag: "latest" });
  return Number(b.timestamp);
}

/** eth_getLogs over [from, head] in spans that halve on any provider error (the public RPC serves wide ranges; Alchemy Free does not). */
async function paged<T>(f: (lo: bigint, hi: bigint) => Promise<T[]>): Promise<T[]> {
  const head = await publicClient.getBlockNumber();
  const out: T[] = [];
  let lo = BigInt(DEP.fromBlock), span = 2_000_000n;
  while (lo <= head) {
    const hi = lo + span - 1n > head ? head : lo + span - 1n;
    try { out.push(...(await f(lo, hi))); lo = hi + 1n; } catch (e) { if (span <= 1000n) throw e; span /= 2n; }
  }
  return out;
}
export async function commitsOf(account: Address, round: number) {
  return memoized(`commitsOf:${account}:${round}`, 3_000, () => commitsOfUncached(account, round));
}
async function commitsOfUncached(account: Address, round: number) {
  const logs = await paged((lo, hi) => publicClient.getLogs({ address: ORDERS, event: ORDERS_ABI[4], args: { round: BigInt(round), account }, fromBlock: lo, toBlock: hi }));
  return logs.map((l) => ({ tx: l.transactionHash as Hex, block: Number(l.blockNumber), logIndex: l.logIndex, policyHash: l.args.policyHash as Hex, sealedBytes: ((l.args.sealedBlob as Hex).length - 2) / 2 }));
}
/** How many DISTINCT accounts have committed in the round so far — the relay's global per-round cap reads this (15 s memo; a few requests may overshoot it). */
export async function commitCountOf(round: number): Promise<number> {
  return memoized(`commits:${round}`, 15_000, async () => new Set((await paged((lo, hi) => publicClient.getLogs({ address: ORDERS, event: ORDERS_ABI[4], args: { round: BigInt(round) }, fromBlock: lo, toBlock: hi }))).map((l) => (l.args.account as string).toLowerCase())).size);
}

export async function postedOf(round: number): Promise<{ resultHash: Hex; drandRound: number } | null> {
  const h = (await publicClient.readContract({ address: RESULTS, abi: RESULTS_ABI, functionName: "resultOf", args: [BigInt(round)] })) as Hex;
  if (/^0x0+$/.test(h)) return null;
  const d = await publicClient.readContract({ address: RESULTS, abi: RESULTS_ABI, functionName: "drandRoundOf", args: [BigInt(round)] });
  return { resultHash: h, drandRound: Number(d) };
}

export async function paidReceipt(tx: Hex) {
  const r = await publicClient.getTransactionReceipt({ hash: tx });
  if (r.status !== "success") return null;
  for (const l of r.logs) {
    if (l.address.toLowerCase() !== SCRIMMAGE.toLowerCase()) continue;
    try {
      const { decodeEventLog } = await import("viem");
      const e = decodeEventLog({ abi: SCRIMMAGE_ABI, data: l.data, topics: l.topics });
      if (e.eventName === "Paid") return { payer: e.args.payer, round: Number(e.args.round), draftHash: e.args.draftHash, amount: e.args.amount, burned: e.args.burned, toCompute: e.args.toCompute };
    } catch { /* not a Paid log */ }
  }
  return null;
}

export function relayer() {
  const k = process.env.RELAYER_PRIVATE_KEY;
  if (!k) return null;
  const account = privateKeyToAccount(k as Hex);
  return { account, wallet: createWalletClient({ account, chain: CHAIN, transport: http(DEP.rpcs[0], { timeout: 20_000 }) }) };
}
/** Relayer stops below this balance (named state "relay empty — use your own wallet"). */
export const RELAY_FLOOR_WEI = BigInt(process.env.RELAY_FLOOR_WEI ?? "300000000000000"); // 0.0003 ETH
/**
 * Per-night ETH stop (spec: "daily ETH stop"). It reads only the chain, so it holds across serverless instances: the relay
 * keeps FLOOR + RELAY_NIGHT_WEI × (nights left after this one) back, so one night — or one script making fresh keys —
 * can spend at most the slice above that line. RELAY_NIGHT_WEI / RELAY_LAST_ROUND unset (testnet) = floor only.
 */
const NIGHT_WEI = BigInt(process.env.RELAY_NIGHT_WEI ?? "0");
const LAST_ROUND = Number(process.env.RELAY_LAST_ROUND ?? "0");
export const relayReserveWei = (round: number) => RELAY_FLOOR_WEI + NIGHT_WEI * BigInt(Math.max(0, LAST_ROUND - round));
export type RelayState = "ok" | "empty" | "spent-tonight";
export async function relayState(round: number): Promise<RelayState> {
  const r = relayer();
  if (!r) return "empty";
  const bal = await publicClient.getBalance({ address: r.account.address });
  if (bal < RELAY_FLOOR_WEI) return "empty";
  return bal < relayReserveWei(round) ? "spent-tonight" : "ok";
}
export const RELAY_SAYS: Record<Exclude<RelayState, "ok">, string> = {
  empty: "relay empty — use your own wallet",
  "spent-tonight": "relay spent for tonight — use your own wallet, or come back tomorrow",
};

/** Everyone who paid for a scrimmage, with the round they paid in (for season crown-eligibility). Memoised 30 s. */
export async function paidLogs() {
  return memoized("paid", 30_000, async () =>
    (await paged((lo, hi) => publicClient.getLogs({ address: SCRIMMAGE, event: SCRIMMAGE_ABI[2], fromBlock: lo, toBlock: hi }))).map((l) => ({
      payer: l.args.payer as string, round: Number(l.args.round), draftHash: l.args.draftHash as Hex, burned: l.args.burned as bigint, tx: l.transactionHash as Hex,
    })));
}
