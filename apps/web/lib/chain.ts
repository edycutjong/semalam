// Server-side chain reads and the relayer. Never imported by client components.
import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, DEP, ORDERS, RESULTS, SCRIMMAGE } from "./config";
import { ORDERS_ABI, RESULTS_ABI, SCRIMMAGE_ABI } from "./abi";

export const publicClient: PublicClient = createPublicClient({
  chain: CHAIN,
  transport: http(DEP.rpcs[0], { retryCount: 2, retryDelay: 400, timeout: 15_000 }),
}) as PublicClient;

/** The L2 clock: chain time, not the server's. */
export async function chainNow(): Promise<number> {
  const b = await publicClient.getBlock({ blockTag: "latest" });
  return Number(b.timestamp);
}

const COMMIT_WINDOW = 420_000n; // ≈ one day of blocks; the quota only needs the current round's logs
export async function commitsOf(account: Address, round: number) {
  const head = await publicClient.getBlockNumber();
  const from = head > COMMIT_WINDOW ? head - COMMIT_WINDOW : 0n;
  const logs = await publicClient.getLogs({
    address: ORDERS, event: ORDERS_ABI[4], args: { round: BigInt(round), account },
    fromBlock: from < BigInt(DEP.fromBlock) ? BigInt(DEP.fromBlock) : from, toBlock: head,
  });
  return logs.map((l) => ({ tx: l.transactionHash as Hex, block: Number(l.blockNumber), logIndex: l.logIndex, policyHash: l.args.policyHash as Hex, sealedBytes: ((l.args.sealedBlob as Hex).length - 2) / 2 }));
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
export const RELAY_FLOOR_WEI = 300_000_000_000_000n; // 0.0003 ETH

/** Everyone who paid for a scrimmage, with the round they paid in (for season crown-eligibility). */
export async function paidLogs() {
  const head = await publicClient.getBlockNumber();
  const out: { payer: string; round: number; draftHash: Hex; burned: bigint; tx: Hex }[] = [];
  let lo = BigInt(DEP.fromBlock), span = 2_000_000n;
  while (lo <= head) {
    const hi = lo + span - 1n > head ? head : lo + span - 1n;
    try {
      const logs = await publicClient.getLogs({ address: SCRIMMAGE, event: SCRIMMAGE_ABI[2], fromBlock: lo, toBlock: hi });
      for (const l of logs) out.push({ payer: l.args.payer as string, round: Number(l.args.round), draftHash: l.args.draftHash as Hex, burned: l.args.burned as bigint, tx: l.transactionHash as Hex });
      lo = hi + 1n;
    } catch (e) { if (span <= 1000n) throw e; span /= 2n; }
  }
  return out;
}
