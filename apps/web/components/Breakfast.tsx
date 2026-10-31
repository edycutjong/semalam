"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { readback, type Policy } from "@semalam/policy";
import { run, type Agent } from "@semalam/sim";
import { HOUSE } from "@semalam/sim/house";
import type { Hex } from "viem";
import ReplayPlayer, { type AgentRep } from "./ReplayPlayer";
import Ticket from "./Ticket";
import { rankLine, type Row } from "@/lib/rank";
import { restoreSigner } from "@/lib/wallet";

export type BreakfastData = {
  round: number; resultHash: string; drandRound: number; randomness: string; policySetHash: string; houseSetHash: string;
  players: number; agents: number; ranking: Row[]; replays: AgentRep[]; policies: { id: string; policy: Policy }[]; tx: string | null; txUrl: string | null;
};

const MAX_VARIANTS = 3;
export default function Breakfast({ d }: { d: BreakfastData }) {
  const [addr, setAddr] = useState("");
  const [typed, setTyped] = useState("");
  const [off, setOff] = useState<Set<number>>(new Set());
  const [variants, setVariants] = useState<{ off: number[]; rank: number; coins: number }[]>([]);
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(`semalam.committed.${d.round}`) ?? "null") as { account?: string } | null;
    setAddr(saved?.account ?? restoreSigner()?.address ?? "");
  }, [d.round]);

  const mine = d.ranking.find((r) => r.id.toLowerCase() === addr.toLowerCase());
  const houseIds = useMemo(() => new Set(d.ranking.filter((r) => r.house).map((r) => r.id.toLowerCase())), [d.ranking]);
  const myPolicy = d.policies.find((p) => p.id.toLowerCase() === addr.toLowerCase())?.policy;
  const line = addr ? rankLine(d.ranking, addr, d.players, d.agents) : null;

  const fieldWith = (mineP: Policy): Agent[] => [
    ...HOUSE.agents.map((h) => ({ id: h.id, policy: h.policy, house: true })),
    ...d.policies.map((p) => ({ id: p.id as Hex, policy: p.id.toLowerCase() === addr.toLowerCase() ? mineP : p.policy })),
  ];
  const opts = { round: BigInt(d.round), drandRound: BigInt(d.drandRound), policySetHash: d.policySetHash as Hex, houseSetHash: d.houseSetHash as Hex };
  // an unmodified re-run must reproduce the posted hash, or the what-if numbers cannot be trusted
  const [baseline, setBaseline] = useState<"checking" | "ok" | "differs">("checking");
  useEffect(() => {
    if (!myPolicy) return;
    try { setBaseline(run(fieldWith(myPolicy), d.randomness as Hex, opts).resultHash.toLowerCase() === d.resultHash.toLowerCase() ? "ok" : "differs"); } catch { setBaseline("differs"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPolicy, d.resultHash]);

  function whatIf() {
    if (!myPolicy || variants.length >= MAX_VARIANTS || baseline !== "ok") return;
    const edited: Policy = { ...myPolicy, rules: myPolicy.rules.filter((_, i) => !off.has(i)) };
    const res = run(fieldWith(edited), d.randomness as Hex, opts);
    const idx = res.ranking.findIndex((r) => r.id.toLowerCase() === addr.toLowerCase());
    setVariants((v) => [...v, { off: [...off], rank: idx + 1, coins: res.ranking[idx].coins }]);
  }

  return (
    <div className="grid2">
      <section aria-label="Your night">
        <div className="eyebrow">Breakfast · round {d.round}</div>
        <h1>{mine ? "Your night" : "The night"}</h1>
        {line ? <p className="lead data" style={{ color: "var(--after)" }}>{line}</p> : <p className="lead">{d.players} player{d.players === 1 ? "" : "s"} and {d.agents - d.players} house/operator agents played. {d.players === 0 ? "A house-only night — no player commits were admitted." : ""}</p>}
        {!mine && (
          <div>
            <label htmlFor="who">Find your agent by address</label>
            <div className="row"><input id="who" type="text" value={typed} placeholder="0x…" onChange={(e) => setTyped(e.target.value)} style={{ flex: 1, minWidth: 220, fontSize: 16 }} />
              <button type="button" onClick={() => setAddr(typed.trim())} disabled={!/^0x[0-9a-fA-F]{40}$/.test(typed.trim())}>Show</button></div>
            {addr && !mine && <p className="note">No agent with that address played round {d.round} (no commit, void, or over capacity).</p>}
          </div>
        )}
        {mine && myPolicy && (
          <Ticket state="settled" title={myPolicy.name} lines={readback(myPolicy)} stamp={`SETTLED · ${(/^(\S+ of \d+)/.exec(line ?? "")?.[1] ?? "").toUpperCase()}`} hash={d.resultHash} hashLabel="result hash" tx={d.tx ?? undefined} txUrl={d.txUrl ?? undefined} />
        )}
        {mine && myPolicy && myPolicy.rules.length > 0 && (
          <div className="card" aria-label="What if">
            <h3 style={{ fontSize: 20 }}>What if…</h3>
            <p className="muted" style={{ marginTop: 0 }}>Turn one of your own rules off and re-run this night in your browser. Up to {MAX_VARIANTS} tries. A new draft goes to the <Link href="/scrimmage">scrimmage</Link>.</p>
            {myPolicy.rules.map((r, i) => (
              <label key={i} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, color: "var(--ink)" }}>
                <input type="checkbox" style={{ width: 22, height: 22 }} checked={!off.has(i)} onChange={(e) => setOff((o) => { const n = new Set(o); e.target.checked ? n.delete(i) : n.add(i); return n; })} />
                <span>{readback(myPolicy).filter((l) => /^\s+\d+\./.test(l))[i]?.trim() ?? `rule ${i + 1}`}</span>
              </label>
            ))}
            <button type="button" onClick={whatIf} disabled={variants.length >= MAX_VARIANTS || off.size === 0 || baseline !== "ok"}>Re-run the night ({variants.length}/{MAX_VARIANTS})</button>
            {baseline === "differs" && <p className="note warn" role="status">Re-running the unmodified night here does not reproduce the posted hash, so what-if is switched off for this round. Verify it with the CLI.</p>}
            {variants.map((v, i) => <p key={i} className="data" style={{ margin: "8px 0 0" }}>rules off [{v.off.map((x) => x + 1).join(", ")}] → rank {v.rank} of {d.agents}, {v.coins} coins (actual: {mine.rank}, {mine.coins})</p>)}
          </div>
        )}
        <div className="row" style={{ marginTop: 18 }}><Link className="btn" href="/">Rewrite for tonight</Link><Link className="btn quiet" href={`/verify/${d.round}`}>Verify this night</Link></div>
      </section>
      <section aria-label="The market">
        <ReplayPlayer replays={d.replays} mineId={mine?.id} houseIds={houseIds} agents={d.agents} />
      </section>
    </div>
  );
}
