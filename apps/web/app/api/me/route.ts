import { readArtifact, settledRounds } from "@/lib/artifact";
import { nightOf, type Night } from "@/lib/ritual";

export const dynamic = "force-dynamic";

/** One account's posted nights (public artifacts only): committed, rank, player rank — the ritual strip reads this. */
export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return Response.json({ error: "account must be a 0x address" }, { status: 400 });
  const nights: Night[] = [];
  for (const r of await settledRounds()) {
    const art = await readArtifact(r);
    if (!art || art.status !== "posted") continue;
    const s = art.settled;
    const n = nightOf(r, s.ranking, art.commitTxs.map((c) => c.account), s.players, s.agents, account);
    if (n.committed || n.playerRank !== null) nights.push(n);
  }
  return Response.json({ account, nights }, { headers: { "cache-control": "public, max-age=60, s-maxage=60" } });
}
