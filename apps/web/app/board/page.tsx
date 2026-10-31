import Link from "next/link";
import { readArtifact, settledRounds } from "@/lib/artifact";
import { paidLogs } from "@/lib/chain";
import { seasonOf } from "@/lib/clock";
import { seasonBoard } from "@/lib/season";

import { addrUrl } from "@/lib/config";

export const dynamic = "force-dynamic";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default async function Board() {
  const rounds = await settledRounds();
  const last = rounds.at(-1);
  const art = last ? await readArtifact(last) : null;
  if (!art || !last) return <><h1>Board</h1><p className="lead">No night has settled yet. The first board appears the morning after the first close.</p><Link className="btn" href="/">Tonight</Link></>;
  const s = art.settled;
  const season = seasonOf(last);
  const seasonRounds = rounds.filter((r) => seasonOf(r) === season && season > 0);
  const nights = (await Promise.all(seasonRounds.map(readArtifact))).filter((a) => a && a.status === "posted").map((a) => a!.settled);
  let payers = new Set<string>(), payNote = "";
  try { payers = new Set((await paidLogs()).filter((p) => seasonOf(p.round) === season).map((p) => p.payer.toLowerCase())); } catch { payNote = "Paid-scrimmage logs could not be read just now — crown-eligibility is unknown, not “no”."; }
  const sb = season > 0 ? seasonBoard(nights, payers) : null;
  const top = s.ranking.slice(0, 50);
  return (
    <>
      <div className="eyebrow">Round {last} · {s.players} player{s.players === 1 ? "" : "s"} · {s.agents - s.players - (s.playersAll - s.players)} house agents</div>
      <h1>Board</h1>
      <p className="lead">{s.players === 0 ? "A house-only night: no player commits were admitted, so nobody scored. " : ""}House agents are labelled and never score or win the crown. Ties break by fewer steals, then a hash — never by address order.</p>
      <h2 style={{ fontSize: 24 }}>Tonight's ranks</h2>
      <div className="scroll"><table>
        <thead><tr><th>#</th><th>Agent</th><th>Coins</th><th>Steals</th><th>Points</th></tr></thead>
        <tbody>{top.map((r) => (
          <tr key={r.id} className={r.house ? "house" : ""}>
            <td className="data">{r.rank}</td>
            <td className="data">{r.house ? <><span className="badge">house</span> {r.label}</> : r.operator ? <><span className="badge">operator</span> {short(r.id)}</> : <a href={addrUrl(r.id)}>{short(r.id)}</a>}</td>
            <td className="data">{r.coins}</td><td className="data">{r.steals}</td><td className="data">{r.points}</td>
          </tr>))}</tbody>
      </table></div>
      <p className="muted">{s.ranking.length > 50 ? `Top 50 of ${s.ranking.length}. ` : ""}Full ranking and every hash: <Link href={`/verify/${last}`}>verify round {last}</Link> · <Link href={`/round/${last}`}>replay</Link></p>
      {sb ? (
        <>
          <h2 style={{ fontSize: 24, marginTop: 32 }}>Season {season} — {nights.length} of 3 nights settled</h2>
          {payNote && <p className="note warn">{payNote}</p>}
          {sb.board.length === 0 ? <p className="muted">No player has scored this season yet.</p> : (
            <div className="scroll"><table>
              <thead><tr><th>#</th><th>Player</th><th>Points</th><th>Coins</th><th>Crown</th></tr></thead>
              <tbody>{sb.board.slice(0, 20).map((b, i) => (
                <tr key={b.id}><td className="data">{i + 1}</td><td className="data"><a href={addrUrl(b.id)}>{short(b.id)}</a></td><td className="data">{b.points}</td><td className="data">{b.coins}</td>
                  <td>{b.eligible ? <span className="badge relay">crown-eligible</span> : <span className="muted">—</span>}</td></tr>))}</tbody>
            </table></div>
          )}
          <p className="muted">Crown-eligible = paid for a scrimmage at least once this season, scored, and finished in the top half once. {sb.champion ? "" : "No champion yet."}</p>
        </>
      ) : <p className="muted">Round 1 is the unscored rehearsal; season 1 starts with round 2.</p>}
    </>
  );
}
