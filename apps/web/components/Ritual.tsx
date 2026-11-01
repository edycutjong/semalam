"use client";
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ordinal } from "@/lib/rank";
import { ritualOf, type Night, type Ritual as R } from "@/lib/ritual";

/** rounds this browser sealed for this account (Tonight writes semalam.committed.<round> after the chain shows it) */
function localRounds(account: string): number[] {
  const out: number[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const m = /^semalam\.committed\.(\d+)$/.exec(localStorage.key(i) ?? "");
      if (!m) continue;
      const v = JSON.parse(localStorage.getItem(m[0]) ?? "null") as { account?: string } | null;
      if (v?.account?.toLowerCase() === account.toLowerCase()) out.push(Number(m[1]));
    }
  } catch { /* blocked storage = nothing remembered */ }
  return out;
}

/** The nights you played, as a short lamp string (the last 7 rounds), plus streak, personal best and the change since
 * your previous night. Shown only once there is something real to show. */
export default function Ritual({ account, round, sealedTonight, onRitual }: { account: string; round: number; sealedTonight?: boolean; onRitual?: (r: R) => void }) {
  const [nights, setNights] = useState<Night[] | null>(null);
  const [local, setLocal] = useState<number[]>([]);
  useEffect(() => {
    setLocal(localRounds(account));
    let live = true;
    fetch(`/api/me?account=${account}`).then((r) => (r.ok ? r.json() : { nights: [] })).then((j: { nights?: Night[] }) => { if (live) setNights(j.nights ?? []); }).catch(() => { if (live) setNights([]); });
    return () => { live = false; };
  }, [account]);
  const r = nights && round >= 1 ? ritualOf(nights, sealedTonight ? [...local, round] : local, round) : null;
  useEffect(() => { if (r) onRitual?.(r); }, [r?.streak, r?.played.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r || !r.played.length) return null;
  const played = new Set(r.played), from = Math.max(r.played[0], round - 6); // the string starts at your first sealed night
  const lamps = Array.from({ length: round - from + 1 }, (_, i) => from + i);
  return (
    <div className="ritual" aria-label="Your nights">
      <ol className="nights">
        {lamps.map((n, k) => {
          const tonight = n === round, on = played.has(n);
          const label = tonight ? `round ${n}, tonight: ${on ? "sealed" : "open"}` : `round ${n}: ${on ? "sealed" : "not sealed"}`;
          return <li key={n} className={tonight ? (on ? "sealed" : "open") : on ? "lit" : "dark"} title={label} style={{ "--k": k } as CSSProperties}><span className="sr">{label}</span></li>;
        })}
      </ol>
      <p className="data">
        {r.streak >= 2 ? `${r.streak} nights in a row` : `${r.played.length} night${r.played.length === 1 ? "" : "s"} sealed`}
        {r.best && <> · best <Link href={`/round/${r.best.round}`}>{ordinal(r.best.playerRank!)} of {r.best.players} player{r.best.players === 1 ? "" : "s"}</Link> (round {r.best.round})</>}
        {r.last && r.prev && <> · round {r.last.round}: {ordinal(r.last.playerRank!)} of {r.last.players} (round {r.prev.round}: {ordinal(r.prev.playerRank!)} of {r.prev.players})</>}
      </p>
    </div>
  );
}
