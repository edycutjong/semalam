"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readback, type Policy } from "@semalam/policy";
import { run, type Agent } from "@semalam/sim";
import { HOUSE } from "@semalam/sim/house";
import type { Address, Hex } from "viem";
import ReplayPlayer, { type AgentRep, type Trace } from "./ReplayPlayer";
import Ticket from "./Ticket";
import Ritual from "./Ritual";
import MorningCard from "./MorningCard";
import Countdown from "./Countdown";
import { ordinal, rankLine, type Row } from "@/lib/rank";
import { restoreSigner } from "@/lib/wallet";
import { lsGet, lsSet } from "@/lib/ls";
import { MAX_VARIANTS, editedPolicy } from "@/lib/whatif";
import { status, type StatusJson } from "@/lib/commit";
import { REWRITE_KEY, hintOf, ordersText, type Rewrite } from "@/lib/rewrite";
import { sfx } from "@/lib/sound";
import { isQA } from "@/lib/qa";

export type BreakfastData = {
  round: number; resultHash: string; drandRound: number; randomness: string; policySetHash: string; houseSetHash: string;
  players: number; agents: number; ranking: Row[]; replays: AgentRep[]; policies: { id: string; policy: Policy }[]; tx: string | null; txUrl: string | null;
};

/** The morning reveal: the player rank counts up from the back of the field, then the lamp chime. */
function RankReveal({ line, from }: { line: string; from: number }) {
  const m = /^(\d+)(st|nd|rd|th)/.exec(line), to = m ? Number(m[1]) : 0;
  const [v, setV] = useState(to);
  const [lit, setLit] = useState(true);
  useEffect(() => {
    if (!to || from <= to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(to); setLit(true); return; }
    let raf = 0; const t0 = performance.now(); setLit(false);
    const step = (n: number) => {
      const k = Math.min(1, (n - t0) / 1100);
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step); else { setLit(true); sfx.chime(1 - (to - 1) / Math.max(1, from - 1)); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [line, from, to]);
  return (
    <p className={`lead data reveal ${lit ? "lit" : ""}`} style={{ color: "var(--after)" }}>
      <span aria-hidden>{m ? line.replace(m[0], ordinal(v)) : line}</span><span className="sr">{line}</span>
    </p>
  );
}

export default function Breakfast({ d }: { d: BreakfastData }) {
  const router = useRouter();
  const [addr, setAddr] = useState("");
  const [typed, setTyped] = useState("");
  const [off, setOff] = useState<Set<number>>(new Set());
  const [variants, setVariants] = useState<{ off: number[]; rank: number; coins: number }[]>([]);
  const [st, setSt] = useState<StatusJson | null>(null);
  const [streak, setStreak] = useState(0);
  const [own, setOwn] = useState(""); // this browser's own address (its commit or its key) — never a typed one
  useEffect(() => {
    const saved = lsGet<{ account?: string } | null>(`semalam.committed.${d.round}`, null);
    const a = saved?.account ?? restoreSigner()?.address ?? "";
    setOwn(a); setAddr(a);
  }, [d.round]);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(addr);
  useEffect(() => { // tonight's round and close, for the countdown and the "sealed tonight" lamp
    let live = true;
    status(valid ? (addr as Address) : undefined).then((s) => { if (live) setSt(s); }).catch(() => { /* the replay still works without it */ });
    return () => { live = false; };
  }, [addr, valid]);

  const mine = d.ranking.find((r) => r.id.toLowerCase() === addr.toLowerCase());
  const myRep = useMemo(() => d.replays.find((r) => r.id.toLowerCase() === addr.toLowerCase()), [d.replays, addr]);
  const houseIds = useMemo(() => new Set(d.ranking.filter((r) => r.house).map((r) => r.id.toLowerCase())), [d.ranking]);
  const myPolicy = d.policies.find((p) => p.id.toLowerCase() === addr.toLowerCase())?.policy;
  const line = addr ? rankLine(d.ranking, addr, d.players, d.agents) : null;

  const fieldWith = (mineP?: Policy): Agent[] => [
    ...HOUSE.agents.map((h) => ({ id: h.id, policy: h.policy, house: true })),
    ...d.policies.map((p) => ({ id: p.id as Hex, policy: mineP && p.id.toLowerCase() === addr.toLowerCase() ? mineP : p.policy })),
  ];
  const opts = { round: BigInt(d.round), drandRound: BigInt(d.drandRound), policySetHash: d.policySetHash as Hex, houseSetHash: d.houseSetHash as Hex };
  // one re-run of the posted night in this browser, traced: if it reproduces the posted hash, the replay draws every real
  // steal and share, and the what-if numbers can be trusted; if not, both stay off
  const [baseline, setBaseline] = useState<"checking" | "ok" | "differs">("checking");
  const [trace, setTrace] = useState<Trace | null>(null);
  useEffect(() => {
    let gone = false;
    const go = () => {
      try {
        const res = run(fieldWith(), d.randomness as Hex, { ...opts, trace: true });
        if (gone) return;
        const ok = res.resultHash.toLowerCase() === d.resultHash.toLowerCase();
        setBaseline(ok ? "ok" : "differs");
        if (ok && res.trace) setTrace({ ids: res.field.map((a) => a.id), turns: res.trace });
      } catch { if (!gone) setBaseline("differs"); }
    };
    const idle = typeof window.requestIdleCallback === "function"; // Safari has no idle callback
    const h = idle ? window.requestIdleCallback(go, { timeout: 1200 }) : window.setTimeout(go, 60);
    return () => { gone = true; if (idle) window.cancelIdleCallback(h); else clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.resultHash]);

  function whatIf() {
    if (!myPolicy || variants.length >= MAX_VARIANTS || baseline !== "ok") return;
    const edited = editedPolicy(myPolicy, off);
    const res = run(fieldWith(edited), d.randomness as Hex, opts);
    const idx = res.ranking.findIndex((r) => r.id.toLowerCase() === addr.toLowerCase());
    setVariants((v) => [...v, { off: [...off], rank: idx + 1, coins: res.ranking[idx].coins }]);
  }
  const dd = myRep?.decisive;
  function rewriteFromHere() {
    if (!myPolicy || !dd) return;
    const rw: Rewrite = { round: d.round, t: dd.t, why: dd.why, hint: hintOf(dd.action, dd.partnerAction), policy: myPolicy, text: ordersText(myPolicy), at: Date.now() };
    lsSet(REWRITE_KEY, rw);
    router.push("/play");
  }
  const isOwn = Boolean(own) && addr.toLowerCase() === own.toLowerCase();
  const winnerWhy = useMemo(() => {
    const w = d.ranking[0];
    if (!w || d.agents < 2) return null;
    const hp = HOUSE.agents.find((h) => h.id.toLowerCase() === w.id.toLowerCase())?.policy;
    const wp = d.policies.find((p) => p.id.toLowerCase() === w.id.toLowerCase())?.policy ?? hp;
    const per = (c: number) => (c / 300).toFixed(1);
    const name = w.house ? (w.label ?? "the house agent") : "the winner";
    const nr = wp ? `${wp.rules.length} rule${wp.rules.length === 1 ? "" : "s"}` : "";
    const style = wp ? (wp.opening === wp.default ? `Always ${wp.default}${wp.rules.length ? ` except ${nr}` : ""}.` : `Opened with ${wp.opening}, then ${wp.default} by default${wp.rules.length ? ` — ${nr}` : ""}.`) : "";
    const nx = d.ranking[1];
    const next = nx ? ` Next best: ${nx.house ? (nx.label ?? "a house agent") : `rank 2 with ${nx.steals} steal${nx.steals === 1 ? "" : "s"}`}, ${nx.coins} coins (${w.coins - nx.coins} behind).` : "";
    const rules = wp ? readback(wp).filter((l) => /^\s+\d\./.test(l)).map((l) => l.trim()) : [];
    const line = `${name === "the winner" ? "Rank 1" : name} finished with ${w.coins} coins (${per(w.coins)} a turn) and ${w.steals} steal${w.steals === 1 ? "" : "s"}. ${style}${next}`.trim();
    const m = d.ranking.find((r) => r.id.toLowerCase() === addr.toLowerCase());
    const you = m && m.id !== w.id && !m.house && !m.operator
      ? `${isOwn ? "You" : "They"} finished rank ${m.rank} of ${d.agents} with ${m.coins} coins (${per(m.coins)} a turn) and ${m.steals} steal${m.steals === 1 ? "" : "s"}: ${w.coins - m.coins} coins behind the winner over 300 turns.`
      : null;
    return { name, line, rules, you };
  }, [d, addr, isOwn]);
  const qa = d.ranking.filter((r) => !r.house && !r.operator && isQA(r.id)).length;
  const tonight = st && st.round > 0 && st.round > d.round ? st : null;
  const sealedTonight = Boolean(tonight && valid && tonight.commits.length > 0);

  return (
    <div className="breakfast">
      <section className="b-head" aria-label={isOwn ? "Your night" : "The night"}>
        <div className="eyebrow">Breakfast · round {d.round}</div>
        <h1>{mine ? (isOwn ? "Your night" : "Their night") : "The night"}</h1>
        {line ? <RankReveal line={line} from={mine && !mine.house && !mine.operator ? d.players : 0} /> : (
          <p className="lead">{d.players} player account{d.players === 1 ? "" : "s"}{qa ? ` (${qa === d.players ? "all" : qa} our own QA runs, not users)` : ""} and {d.agents - d.players} house/operator agents played. {d.players === 0 ? "A house-only night — no player commits were admitted." : ""}</p>
        )}
        {line && qa > 0 && <p className="muted data" style={{ margin: "-10px 0 16px" }}>{qa === d.players ? `all ${d.players} player accounts this night are` : `${qa} of the ${d.players} player accounts are`} our own QA runs — not users</p>}
        {isOwn && valid && st && <Ritual account={addr} round={Math.max(st.round, d.round + 1)} sealedTonight={sealedTonight} onRitual={(r) => setStreak(r.streak)} />}
        {!mine && (
          <div>
            <label htmlFor="who">Find an agent by address</label>
            <div className="row"><input id="who" type="text" value={typed} placeholder="0x…" onChange={(e) => setTyped(e.target.value)} style={{ flex: 1, minWidth: 220, fontSize: 16 }} />
              <button type="button" onClick={() => setAddr(typed.trim())} disabled={!/^0x[0-9a-fA-F]{40}$/.test(typed.trim())}>Show</button></div>
            {addr && !mine && <p className="note">No agent with that address played round {d.round} (no commit, void, or over capacity).</p>}
          </div>
        )}
      </section>
      <section className="b-market" aria-label="The market">
        <ReplayPlayer replays={d.replays} mineId={mine?.id} houseIds={houseIds} agents={d.agents} trace={trace} ready={baseline !== "checking"} autoPlay={baseline !== "checking"} mineLabel={isOwn ? "you" : "that agent"} />
        {winnerWhy && (
          <div className="card why-winner" aria-label="Why the winner won">
            <div className="eyebrow">Why {winnerWhy.name} won</div>
            <p style={{ margin: "0 0 6px" }}>{winnerWhy.line}</p>
            {winnerWhy.rules.length > 0 && <p className="muted data" style={{ margin: "0 0 6px", fontSize: 16 }}>{winnerWhy.rules.join(" · ")}</p>}
            {winnerWhy.you && <p style={{ margin: 0 }}>{winnerWhy.you}</p>}
          </div>
        )}
        {mine && myPolicy && dd && (
          <div className="card decisive" aria-label={isOwn ? "Your decisive turn" : "Their decisive turn"}>
            <div className="eyebrow">{isOwn ? "Your" : "Their"} decisive turn · {dd.t}</div>
            <p style={{ margin: "0 0 6px" }}>{dd.why}</p>
            <p className="muted" style={{ margin: isOwn ? "0 0 12px" : 0, fontSize: 16 }}>{hintOf(dd.action, dd.partnerAction, isOwn ? "you" : "they")}</p>
            {isOwn && <button type="button" className="primary" onClick={rewriteFromHere}>Rewrite from turn {dd.t}</button>}
          </div>
        )}
        {isOwn && mine && line && !mine.house && !mine.operator && (
          <MorningCard round={d.round} line={line} coins={mine.coins} agents={d.agents} replays={d.replays} mineId={mine.id} houseIds={houseIds} why={dd?.why ?? ""} resultHash={d.resultHash} streak={streak} />
        )}
      </section>
      <div className="b-rest">
        {mine && myPolicy && (
          <Ticket state="settled" fresh title={myPolicy.name} lines={readback(myPolicy)} stamp={`SETTLED · ${(/^(\S+ of \d+)/.exec(line ?? "")?.[1] ?? "").toUpperCase()}`} hash={d.resultHash} hashLabel="result hash" tx={d.tx ?? undefined} txUrl={d.txUrl ?? undefined} />
        )}
        {mine && myPolicy && myPolicy.rules.length > 0 && (
          <div className="card" aria-label="What if">
            <h3 style={{ fontSize: 20 }}>What if…</h3>
            <p className="muted" style={{ marginTop: 0 }}>Turn one of these rules off and re-run this night in your browser. Up to {MAX_VARIANTS} tries. Take what you learn into <Link href="/play">tonight's orders</Link>.</p>
            {myPolicy.rules.map((r, i) => (
              <label key={i} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, color: "var(--ink)" }}>
                <input type="checkbox" style={{ width: 22, height: 22 }} checked={!off.has(i)} onChange={(e) => setOff((o) => { const n = new Set(o); e.target.checked ? n.delete(i) : n.add(i); return n; })} />
                <span>{readback(myPolicy).filter((l) => /^\s+\d+\./.test(l))[i]?.trim() ?? `rule ${i + 1}`}</span>
              </label>
            ))}
            <button type="button" onClick={whatIf} disabled={variants.length >= MAX_VARIANTS || off.size === 0 || baseline !== "ok"}>Re-run the night ({variants.length}/{MAX_VARIANTS})</button>
            {baseline === "checking" && <p className="muted" role="status" style={{ margin: "8px 0 0" }}>checking that your browser reproduces this night…</p>}
            {baseline === "differs" && <p className="note warn" role="status">Re-running the unmodified night here does not reproduce the posted hash, so what-if is switched off for this round. Verify it with the CLI.</p>}
            {variants.map((v, i) => <p key={i} className="data" style={{ margin: "8px 0 0" }}>rules off [{v.off.map((x) => x + 1).join(", ")}] → rank {v.rank} of {d.agents}, {v.coins} coins (actual: {mine.rank}, {mine.coins})</p>)}
          </div>
        )}
        {tonight && (
          <p className="data tonight-line">round {tonight.round} closes in <Countdown round={tonight.round} closeTime={tonight.closeTime} chainNow={tonight.chainNow} serverNow={tonight.serverNow} />{sealedTonight ? " · sealed — you can re-commit until the close" : ""}</p>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          {!(isOwn && mine && myPolicy && dd) && <Link className="btn" href="/play">{sealedTonight ? "Tonight" : "Write tonight's orders"}</Link>}
          <Link className="btn quiet" href={`/verify/${d.round}`}>Verify this night</Link>
        </div>
      </div>
    </div>
  );
}
