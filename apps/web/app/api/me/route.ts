import { readArtifact, settledRounds } from "@/lib/artifact";
import { nightOf, type Night } from "@/lib/ritual";
import { isQA } from "@/lib/qa";

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
    // how many of that night's player accounts are our own QA runs, so the ritual can say so next to "of N players"
    if (n.committed || n.playerRank !== null) nights.push({ ...n, qaPlayers: s.ranking.filter((r) => !r.house && !r.operator && isQA(r.id)).length });
  }
  return Response.json({ account, nights }, { headers: { "cache-control": "public, max-age=60, s-maxage=60" } });
}
