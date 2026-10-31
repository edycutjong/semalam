import { getAddress, isHex, keccak256, type Hex } from "viem";
import { ORDERS_ABI } from "@/lib/abi";
import { ORDERS, EXCLUDED, txUrl } from "@/lib/config";
import { MAX_SEALED } from "@semalam/sim/round";
import { closeTime, currentRound } from "@/lib/clock";
import { chainNow, commitsOf, publicClient, relayer, RELAY_FLOOR_WEI } from "@/lib/chain";
import { ipOf, throttle } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MAX_PER_ROUND = 3;

const fail = (state: string, status = 400, extra: object = {}) => Response.json({ ok: false, state, ...extra }, { status });

// Self-relay: the player signs EIP-712, our relayer pays the gas via Orders.commitBySig.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail("request body is not JSON"); }
  if (!throttle(`relay:${ipOf(req)}`, 20, 60_000)) return fail("too many commits from this address — wait a minute", 429);
  const sealed = b.sealedBlob, sig = b.signature, ph = b.policyHash;
  if (typeof b.account !== "string" || !isHex(sealed) || !isHex(sig) || !isHex(ph) || ph.length !== 66) return fail("malformed commit");
  const account = getAddress(b.account);
  const round = Number(b.round), deadline = BigInt(String(b.deadline ?? "0"));
  if (!Number.isInteger(round)) return fail("malformed round");
  if ((sealed.length - 2) / 2 > MAX_SEALED) return fail(`sealed orders are larger than ${MAX_SEALED} bytes`);
  const r = relayer();
  if (!r) return fail("relay empty — use your own wallet", 503, { relay: false });
  const now = await chainNow();
  if (round !== currentRound(now) || now >= closeTime(round)) return fail(`round ${round} is not open for commits`, 409);
  if (EXCLUDED.includes(account.toLowerCase())) return fail("operator addresses cannot play");
  const have = await commitsOf(account, round);
  if (have.length >= MAX_PER_ROUND) return fail(`at most ${MAX_PER_ROUND} sponsored commits per account per round — use your own wallet`, 429);
  const bal = await publicClient.getBalance({ address: r.account.address });
  if (bal < RELAY_FLOOR_WEI) return fail("relay empty — use your own wallet", 503, { relay: false });
  try {
    const args = [account, BigInt(round), ph as Hex, sealed as Hex, deadline, sig as Hex] as const;
    const { request } = await publicClient.simulateContract({ address: ORDERS, abi: ORDERS_ABI, functionName: "commitBySig", args, account: r.account });
    const hash = await r.wallet.writeContract(request);
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
    if (rc.status !== "success") return fail("the commit transaction reverted", 502, { tx: hash });
    return Response.json({ ok: true, tx: hash, url: txUrl(hash), mode: "relay", sealedKeccak: keccak256(sealed as Hex) });
  } catch (e) {
    const m = (e as Error).message ?? "";
    const named = /Expired/.test(m) ? "signature expired — sign again" : /BadSignature/.test(m) ? "signature does not match this account and draft" : /WrongRound/.test(m) ? `round ${round} is not open` : /SealedTooLarge/.test(m) ? "sealed orders too large" : "the chain refused this commit";
    return fail(named, 422);
  }
}
