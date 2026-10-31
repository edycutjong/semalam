import Link from "next/link";
import Breakfast from "@/components/Breakfast";
import { namedState, readArtifact } from "@/lib/artifact";
import { chainNow, postedOf } from "@/lib/chain";
import { currentRound } from "@/lib/clock";
import { txUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function RoundPage({ params }: { params: Promise<{ n: string }> }) {
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n < 1) return <><h1>No such round</h1><p className="lead">Rounds are numbered from 1.</p><Link className="btn" href="/">Tonight</Link></>;
  const art = await readArtifact(n);
  if (art && art.status !== "posted")
    return (
      <>
        <div className="eyebrow">Breakfast · round {n}</div>
        <h1>{art.status === "hash-mismatch-not-posted" ? "Hash mismatch — not posted" : art.status === "poster-reverted" ? "Poster reverted" : "Not posted yet"}</h1>
        <p className="lead">The runner and the CLI disagreed or the post failed, so no result is shown for this night. Replay it yourself: <span className="data">npx semalam replay {n}</span>.</p>
        <Link className="btn" href={`/verify/${n}`}>Verify</Link>
      </>
    );
  if (!art) {
    let label = "chain unreachable — try again in a moment", detail: string | undefined;
    try { const now = await chainNow(); const s = namedState(n, now, currentRound(now), Boolean(await postedOf(n))); label = s.label; detail = s.detail; } catch { /* keep the named rpc state */ }
    return (
      <>
        <div className="eyebrow">Breakfast · round {n}</div>
        <h1>{label}</h1>
        {detail && <p className="lead">{detail}</p>}
        <p className="note">Every failure has a name here; nothing says “settling” forever.</p>
        <Link className="btn" href="/">Tonight</Link> <Link className="btn quiet" href={`/verify/${n}`}>Verify</Link>
      </>
    );
  }
  const s = art.settled;
  return (
    <Breakfast d={{
      round: n, resultHash: s.resultHash, drandRound: s.drandRound, randomness: s.randomness, policySetHash: s.policySetHash, houseSetHash: s.houseSetHash,
      players: s.players, agents: s.agents, ranking: s.ranking, replays: s.replays as never, policies: art.policies,
      tx: art.onchain?.tx ?? null, txUrl: art.onchain?.tx ? txUrl(art.onchain.tx) : null,
    }} />
  );
}
