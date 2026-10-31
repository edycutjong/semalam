import { isHex } from "viem";
import { paidReceipt } from "@/lib/chain";

export const dynamic = "force-dynamic";

/** A13: the paid scrimmage runs only after a successful `Paid` receipt — this returns its payer, round and draftHash. */
export async function GET(req: Request) {
  const tx = new URL(req.url).searchParams.get("tx");
  if (!tx || !isHex(tx) || tx.length !== 66) return Response.json({ error: "tx must be a 32-byte hash" }, { status: 400 });
  try {
    const p = await paidReceipt(tx);
    if (!p) return Response.json({ error: "no successful Scrimmage.Paid log in that transaction" }, { status: 404 });
    return Response.json({ payer: p.payer, round: p.round, draftHash: p.draftHash, amount: p.amount.toString(), burned: p.burned.toString(), toCompute: p.toCompute.toString() });
  } catch (e) {
    return Response.json({ error: `could not read that transaction (${(e as Error).message.split("\n")[0]})` }, { status: 502 });
  }
}
