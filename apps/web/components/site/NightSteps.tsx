"use client";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { NightSteps as Data } from "@/lib/steps";
import { ordinal } from "@/lib/rank";
import { FrameStepContext } from "./Deck";

/* The deck's turn-by-turn night. → plays the re-run night forward to the next turning point (the lamps re-light by
   rank as the turns pass, the tagged lamp's rank line draws on), then stops on what happened there. Off screen, in the
   overview, in print and without JS it shows the settled end of the night. Reduced motion jumps straight to each stop. */
const W = 1920, LW = 1680, LH = 132, LT = 34, LB = 24;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");

function Glyph({ a }: { a: string }) {
  const k = a.toLowerCase();
  return (
    <svg viewBox="0 0 16 16" className={`gl ${k}`} aria-hidden>
      {a === "GATHER" && <path d="M8 2 15 14H1z" />}
      {a === "GUARD" && <rect x="2.5" y="2.5" width="11" height="11" />}
      {a === "SHARE" && <path d="M8 1 15 8 8 15 1 8z" />}
      {a === "STEAL" && <path d="M3 3l10 10M13 3 3 13" />}
    </svg>
  );
}

export default function NightSteps({ d, legend }: { d: Data; legend: string }) {
  const { step: ctxStep, set } = useContext(FrameStepContext);
  const lastK = d.steps.length - 1;
  const [printing, setPrinting] = useState(false);
  const target = printing || ctxStep === null ? lastK : Math.min(ctxStep, lastK);
  const [turn, setTurn] = useState(d.steps[lastK].t);
  const [shown, setShown] = useState(lastK);
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    const on = () => setPrinting(true), off = () => setPrinting(false);
    window.addEventListener("beforeprint", on); window.addEventListener("afterprint", off);
    return () => { window.removeEventListener("beforeprint", on); window.removeEventListener("afterprint", off); };
  }, []);

  useEffect(() => { // play forward to the target stop; anything else (back, jump, reduced motion, off screen) cuts
    const goal = d.steps[target].t;
    const from = turnRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ctxStep === null || printing || reduced || target <= shownRef.current || goal <= from) { setTurn(goal); setShown(target); return; }
    const dur = Math.max(900, Math.min(2400, (goal - from) * 14));
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      setTurn(Math.round(from + (goal - from) * e));
      if (p < 1) raf = requestAnimationFrame(tick); else setShown(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ctxStep, printing, d.steps]);

  const geo = useMemo(() => {
    const n = d.house.length, x0 = 58, x1 = W - 58, sag = 66, y0 = 18;
    return d.house.map((house, j) => {
      const x = n === 1 ? W / 2 : x0 + (j * (x1 - x0)) / (n - 1);
      const u = (x - W / 2) / (W / 2), wy = y0 + sag * (1 - u * u);
      const cy = wy + (13 + ((j * 7) % 5) * 6) + 12;
      return { x, wy, cy, house, tag: j === d.tagIndex };
    });
  }, [d.house, d.tagIndex]);
  const frame = useMemo(() => { let f = d.frames[0]; for (const x of d.frames) { if (x.t <= turn) f = x; else break; } return f; }, [d.frames, turn]);
  const rankNow = d.line[Math.max(1, turn) - 1];
  const maxR = Math.max(2, ...d.line);
  const lx = (t: number) => ((t - 1) / Math.max(1, d.turns - 1)) * LW;
  const ly = (r: number) => LT + ((r - 1) / (maxR - 1)) * (LH - LT - LB);
  const pts = useMemo(() => d.line.map((r, k) => `${lx(k + 1).toFixed(1)},${ly(r).toFixed(1)}`).join(" "), [d.line]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = d.steps[shown];
  const atStop = turn === s.t;
  const playing = !atStop;
  const N = d.agents;
  const settled = shown === lastK && atStop;
  const ring = atStop && s.pj >= 0 && s.partner ? s.pj : -1;

  return (
    <div className={`ns${playing ? " playing" : ""}${settled ? " settled" : ""}`}>
      <div className="ns-top">
        <h2>Night {d.round}, turn by turn.</h2>
        <p className="ns-proof data">re-run when this page was built · result hash {d.resultHash.slice(0, 8)}…{d.resultHash.slice(-4)} = the posted hash <b className="ok">✓</b></p>
      </div>
      <svg className="ns-lamps" viewBox={`0 0 ${W} 200`} role="img" aria-label={`Night ${d.round} at turn ${turn}: ${N} lamps, brighter means a higher rank at that turn; the amber lamp is the tagged one, ${ordinal(rankNow)}.`}>
        <defs>
          <radialGradient id="ns-p"><stop offset="0" stopColor="#F2D16B" stopOpacity=".6" /><stop offset=".5" stopColor="#F2D16B" stopOpacity=".13" /><stop offset="1" stopColor="#F2D16B" stopOpacity="0" /></radialGradient>
          <radialGradient id="ns-h"><stop offset="0" stopColor="#A89C8A" stopOpacity=".4" /><stop offset=".5" stopColor="#A89C8A" stopOpacity=".08" /><stop offset="1" stopColor="#A89C8A" stopOpacity="0" /></radialGradient>
          <radialGradient id="ns-f"><stop offset="0" stopColor={settled ? "#FFB547" : "#FFF4DA"} stopOpacity=".8" /><stop offset=".45" stopColor={settled ? "#FFB547" : "#FFF4DA"} stopOpacity=".22" /><stop offset="1" stopColor={settled ? "#FFB547" : "#FFF4DA"} stopOpacity="0" /></radialGradient>
        </defs>
        <path d={`M-10 ${12} Q ${W / 2} ${18 + 2 * 66} ${W + 10} ${12}`} className="wire" />
        {geo.map((g, j) => {
          const b = 1 - (frame.r[j] - 1) / Math.max(1, N);
          const k = g.tag ? "f" : g.house ? "h" : "p";
          const rx = g.tag ? 14 : 7.5, ry = g.tag ? 17 : 9.5;
          return (
            <g key={j} className={`lamp ${k}`}>
              <line x1={g.x} y1={g.wy} x2={g.x} y2={g.cy - ry} className="cord" />
              <circle cx={g.x} cy={g.cy} r={g.tag ? 64 : 14 + 32 * b} fill={`url(#ns-${k})`} style={{ opacity: g.tag ? 1 : 0.18 + 0.66 * b }} />
              <ellipse cx={g.x} cy={g.cy} rx={rx} ry={ry} className="globe" style={{ opacity: g.tag ? 1 : 0.28 + 0.72 * b }} />
              <ellipse cx={g.x} cy={g.cy + 1} rx={rx * 0.42} ry={ry * 0.5} className="mantle" style={{ opacity: g.tag ? 1 : 0.12 + 0.88 * b }} />
              {j === ring && <circle cx={g.x} cy={g.cy} r="19" className={`ring ${s.partner!.act.toLowerCase()}`} />}
              {g.tag && <g className="tag"><line x1={g.x} y1={g.cy + ry} x2={g.x} y2={g.cy + ry + 16} className="cord" /><rect x={g.x - 40} y={g.cy + ry + 16} width="80" height="30" rx="4" /><text x={g.x} y={g.cy + ry + 38} textAnchor="middle">{ordinal(rankNow).toUpperCase()}</text></g>}
            </g>
          );
        })}
      </svg>
      <p className="ns-legend data">{legend}</p>
      <div className="ns-mid">
        <div className="ns-turn">
          <p className="ns-k data">turn</p>
          <p className="ns-n">{turn}</p>
          <p className="ns-rank data">{ordinal(rankNow)} of {N} agents{atStop ? ` · ${s.coins.toLocaleString("en-US")} coins` : ""}</p>
        </div>
        <div className="ns-story" aria-live="polite">
          <p className="ns-head data"><span>stop {shown + 1} of {d.steps.length} · {s.head}</span><span className="ns-hint">{shown < lastK ? "→ plays the night to the next turning point" : "settled · → next slide"}</span></p>
          {s.strip ? (
            <ol className="ns-strip" aria-label="The first turns of the run, from the trace">
              {s.strip.map((c) => (
                <li key={c.t} className={c.theirs === "STEAL" ? "hit" : ""}>
                  <p className="data">turn {c.t} · {c.who}</p>
                  <p className="acts"><Glyph a={c.mine} /><b>{c.mine}</b><span>vs</span><Glyph a={c.theirs} /><b>{c.theirs}</b><em className={c.delta < 0 ? "neg" : "pos"}>{signed(c.delta)}</em></p>
                  <p className="note data">{c.note}</p>
                </li>
              ))}
            </ol>
          ) : settled ? (
            <p className="ns-seal">settled · {ordinal(s.rank)} of {N}</p>
          ) : (
            <div className="ns-duel">
              <span className="side"><Glyph a={s.act} /><b>{s.act}</b><i>{d.tag.policy}</i></span>
              {s.partner ? <><span className="vs">vs</span><span className="side"><Glyph a={s.partner.act} /><b>{s.partner.act}</b><i>{s.partner.name}{s.partner.house ? " · house" : ""}</i></span></> : <span className="vs">alone this turn</span>}
              <span className={`dl ${s.delta < 0 ? "neg" : "pos"}`}>{signed(s.delta)}</span>
            </div>
          )}
          <p className="ns-text">{s.text}</p>
          {s.rule && <p className="ns-rule data">{s.rule}</p>}
        </div>
      </div>
      <figure className="ns-line">
        <svg viewBox={`0 0 ${LW} ${LH}`} role="img" aria-label={`The tagged lamp's rank after every turn: ${d.steps.map((x) => `${ordinal(x.rank)} at turn ${x.t}`).join(", ")}.`}>
          <defs><clipPath id="ns-clip"><rect x="-20" y="-20" width={lx(turn) + 20} height={LH + 40} /></clipPath></defs>
          <polyline points={pts} className="ghost" />
          <polyline points={pts} className="drawn" clipPath="url(#ns-clip)" />
          {d.steps.map((x, k) => <g key={x.t} className={`stop${x.t <= turn ? " reached" : ""}${k === shown && atStop ? " here" : ""}`}><circle cx={lx(x.t)} cy={ly(x.rank)} r="9" /><text x={lx(x.t)} y={ly(x.rank) + (k === 0 || x.rank >= maxR - 1 ? 34 : -18)} textAnchor={k === 0 ? "start" : k === lastK ? "end" : "middle"}>{ordinal(x.rank)}</text></g>)}
        </svg>
      </figure>
      <div className="ns-chips" role="group" aria-label="Turning points">
        {d.steps.map((x, k) => (
          <button key={x.t} type="button" className={k === shown ? "on" : ""} aria-pressed={k === shown} style={{ left: `${(lx(x.t) / LW) * 100}%` }} onClick={() => set(k)}>turn {x.t}</button>
        ))}
      </div>
    </div>
  );
}
