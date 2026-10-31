import { getAddress, isHex, keccak256, type Hex } from "viem";
import { ORDERS_ABI } from "@/lib/abi";
import { ORDERS, EXCLUDED, txUrl } from "@/lib/config";
import { MAX_SEALED } from "@semalam/sim/round";
import { closeTime, currentRound } from "@/lib/clock";
import { chainNow, commitCountOf, commitsOf, publicClient, relayer, relayState, RELAY_SAYS } from "@/lib/chain";
import { bump, forget, ipOf, reserve, serial, throttle } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MAX_PER_ROUND = 3;
/** New gasless accounts stop at 600 distinct accounts (60% of the 1,000-account admission cap) so a flood of fresh keys cannot fill the round; a few concurrent requests may overshoot. */
const ROUND_SPONSOR_CAP = 600;

const fail = (state: string, status = 400, extra: object = {}) => Response.json({ ok: false, state, ...extra }, { status });

// Self-relay: the player signs EIP-712, our relayer pays the gas via Orders.commitBySig.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail("request body is not JSON"); }
  if (!throttle(`relay:${ipOf(req)}`, 20, 60_000)) return fail("too many commits from this address — wait a minute", 429);
  const sealed = b.sealedBlob, sig = b.signature, ph = b.policyHash;
  if (typeof b.account !== "string" || !isHex(sealed) || !isHex(sig) || !isHex(ph) || ph.length !== 66) return fail("malformed commit");
  let account: ReturnType<typeof getAddress>, round: number, deadline: bigint;
  try { account = getAddress(b.account); round = Number(b.round); deadline = BigInt(String(b.deadline ?? "0")); } catch { return fail("malformed commit"); }
  if (!Number.isInteger(round)) return fail("malformed round");
  if ((sealed.length - 2) / 2 > MAX_SEALED) return fail(`sealed orders are larger than ${MAX_SEALED} bytes`);
  if (sig.length > 2 + 2 * 1024) return fail("signature too long"); // 65 B for a key; generous room for ERC-1271 wallets
  const r = relayer();
  if (!r) return fail("relay empty — use your own wallet", 503, { relay: false });
  const now = await chainNow();
  if (round !== currentRound(now) || now >= closeTime(round)) return fail(`round ${round} is not open for commits`, 409);
  if (EXCLUDED.includes(account.toLowerCase())) return fail("operator addresses cannot play");
  const rkey = `${account}:${round}`;
  forget(`commitsOf:${account}:${round}`); // never trust a cached count for the quota
  const have = { length: Math.max((await commitsOf(account, round)).length, reserve(rkey)) }; // chain count or in-flight sends, whichever is higher
  if (have.length >= MAX_PER_ROUND) return fail(`at most ${MAX_PER_ROUND} sponsored commits per account per round — use your own wallet`, 429, { relay: false });
  if (have.length === 0 && (await commitCountOf(round)) >= ROUND_SPONSOR_CAP) return fail("relay full for this round — use your own wallet", 429, { relay: false });
  const rs = await relayState(round);
  if (rs !== "ok") return fail(RELAY_SAYS[rs], 503, { relay: false });
  bump(rkey, 1); // reserved until the chain shows it (failures release it below)
  try {
    const args = [account, BigInt(round), ph as Hex, sealed as Hex, deadline, sig as Hex] as const;
    // one relayer key = one nonce stream: sends are serialised per instance; a cross-instance nonce clash retries once
    const send = () => serial("relayer", async () => {
      const { request } = await publicClient.simulateContract({ address: ORDERS, abi: ORDERS_ABI, functionName: "commitBySig", args, account: r.account });
      return r.wallet.writeContract(request);
    });
    let hash: Hex;
    try { hash = await send(); } catch (e) { if (!/nonce/i.test((e as Error).message)) throw e; await new Promise((x) => setTimeout(x, 700)); hash = await send(); }
    try {
      const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
      if (rc.status !== "success") { bump(rkey, -1); return fail("the commit transaction reverted", 502, { tx: hash }); }
    } catch {
      return Response.json({ ok: true, tx: hash, url: txUrl(hash), mode: "relay", pending: true }); // sent; the client reads the chain back
    }
    return Response.json({ ok: true, tx: hash, url: txUrl(hash), mode: "relay", sealedKeccak: keccak256(sealed as Hex) });
  } catch (e) {
    const m = (e as Error).message ?? "";
    bump(rkey, -1);
    const named = /Expired/.test(m) ? "signature expired — sign again" : /BadSignature/.test(m) ? "signature does not match this account and draft" : /WrongRound/.test(m) ? `round ${round} is not open` : /SealedTooLarge/.test(m) ? "sealed orders too large" : /nonce/i.test(m) ? "relay busy — try again in a moment" : "the chain refused this commit";
    return fail(named, 422);
  }
}
