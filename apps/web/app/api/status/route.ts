import { getAddress, isAddress } from "viem";
import { closeTime, currentRound } from "@/lib/clock";
import { chainNow, commitsOf, publicClient, relayer, RELAY_FLOOR_WEI } from "@/lib/chain";
import { ipOf, throttle } from "@/lib/guard";
import { CHAIN_ID, IS_TESTNET, ORDERS, WIF_LABEL } from "@/lib/config";
import { ORDERS_ABI } from "@/lib/abi";

export const dynamic = "force-dynamic";

/** Live state for the Tonight screen: chain clock, relay health, and (with ?account=) that account's commits. */
export async function GET(req: Request) {
  if (!throttle(`status:${ipOf(req)}`, 90, 60_000)) return Response.json({ error: "too many requests — wait a few seconds" }, { status: 429 });
  const acc = new URL(req.url).searchParams.get("account");
  try {
    const now = await chainNow();
    const round = currentRound(now);
    const r = relayer();
    const relayOk = r ? (await publicClient.getBalance({ address: r.account.address })) >= RELAY_FLOOR_WEI : false;
    const commits = acc && isAddress(acc) ? await commitsOf(getAddress(acc), round) : [];
    const nonce = acc && isAddress(acc) ? String(await publicClient.readContract({ address: ORDERS, abi: ORDERS_ABI, functionName: "nonces", args: [getAddress(acc)] })) : undefined;
    return Response.json({
      chainId: CHAIN_ID, testnet: IS_TESTNET, wifLabel: WIF_LABEL, chainNow: now, serverNow: Math.floor(Date.now() / 1000), round, closeTime: closeTime(round),
      relay: relayOk, compiler: Boolean(process.env.GROQ_API_KEYS), nonce, commits,
    });
  } catch (e) {
    const nonce = acc && isAddress(acc) ? String(await publicClient.readContract({ address: ORDERS, abi: ORDERS_ABI, functionName: "nonces", args: [getAddress(acc)] })) : undefined;
    return Response.json({ error: `chain unreachable (${(e as Error).message.split("\n")[0]})` }, { status: 503 });
  }
}
