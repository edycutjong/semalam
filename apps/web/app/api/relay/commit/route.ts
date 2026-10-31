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
/** ~3× the measured worst case (1,536 B blob: 97,936 incl. the L1 part) — room for an L1 price spike, never a gas bomb. */
const RELAY_GAS_CAP = 300_000n;
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
  // EOAs only: an account with code (a smart wallet, an EIP-7702 delegate) runs its own isValidSignature on our gas,
  // which can be made arbitrarily expensive — those accounts send commit() themselves
  const code = await publicClient.getCode({ address: account });
  if (code && code !== "0x") return fail("smart accounts commit from their own wallet — the relay sponsors plain keys only", 403, { relay: false });
  const rkey = `${account}:${round}`;
  forget(`commitsOf:${account}:${round}`); // never trust a cached count for the quota
  const have = { length: Math.max((await commitsOf(account, round)).length, reserve(rkey)) }; // chain count or in-flight sends, whichever is higher
  if (have.length >= MAX_PER_ROUND) return fail(`at most ${MAX_PER_ROUND} sponsored commits per account per round — use your own wallet`, 429, { relay: false });
  bump(rkey, 1); // reserved now, before the next await, so concurrent requests for this account see it (failures release it)
  let rs: Awaited<ReturnType<typeof relayState>>;
  try {
    if (have.length === 0 && (await commitCountOf(round)) >= ROUND_SPONSOR_CAP) { bump(rkey, -1); return fail("relay full for this round — use your own wallet", 429, { relay: false }); }
    rs = await relayState(round);
  } catch { bump(rkey, -1); return fail("chain unreachable — try again in a moment", 503); }
  if (rs !== "ok") { bump(rkey, -1); return fail(RELAY_SAYS[rs], 503, { relay: false }); }
  try {
    const args = [account, BigInt(round), ph as Hex, sealed as Hex, deadline, sig as Hex] as const;
    // one relayer key = one nonce stream: sends are serialised per instance; a cross-instance nonce clash retries once
    const send = () => serial("relayer", async () => {
      const { request } = await publicClient.simulateContract({ address: ORDERS, abi: ORDERS_ABI, functionName: "commitBySig", args, account: r.account });
      return r.wallet.writeContract({ ...request, gas: RELAY_GAS_CAP });
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
