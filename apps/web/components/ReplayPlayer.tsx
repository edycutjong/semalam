"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type Frame = { t: number; coins: number; rank: number };
export type AgentRep = { id: string; keyframes: Frame[]; decisive: { t: number; action: string; partner: string | null; partnerAction: string | null; delta: number; why: string } };
const DURATION = 15_000;
const GLYPH: Record<string, string> = { GATHER: "▲", GUARD: "■", SHARE: "◆", STEAL: "✕" };
const COLOR: Record<string, string> = { GATHER: "#8FCB6B", GUARD: "#7C8CC4", SHARE: "#F2D16B", STEAL: "#E2543B" };

/** Lamp row = the replay: one lamp per agent, brightness follows rank; the player's lamp is amber. 15 s, scrubbable. */
export default function ReplayPlayer({ replays, mineId, houseIds, agents }: { replays: AgentRep[]; mineId?: string; houseIds: Set<string>; agents: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const mine = replays.find((r) => r.id.toLowerCase() === mineId?.toLowerCase());
  const turns = replays[0]?.keyframes.at(-1)?.t ?? 300;
  const step = reduced ? 6 : 0;
  useEffect(() => { setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  useEffect(() => {
    if (!playing || reduced) return;
    let raf = 0; const t0 = performance.now() - ms;
    const loop = (n: number) => { const x = Math.min(DURATION, n - t0); setMs(x); if (x < DURATION) raf = requestAnimationFrame(loop); else setPlaying(false); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, reduced]);

  const idx = Math.min(replays[0]?.keyframes.length - 1 || 0, Math.max(0, Math.round((ms / DURATION) * ((replays[0]?.keyframes.length ?? 1) - 1))));
  const sorted = useMemo(() => [...replays].sort((a, b) => a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1), [replays]);
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext("2d")!; g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    g.strokeStyle = "#3A2F55"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 26); g.quadraticCurveTo(w / 2, 6, w, 26); g.stroke(); // the string the lamps hang from
    const cell = Math.max(10, Math.sqrt((w * (h - 56)) / Math.max(1, sorted.length)));
    const cols = Math.max(1, Math.min(sorted.length, Math.floor(w / cell)));
    const rows = Math.ceil(sorted.length / cols);
    const cw = w / cols, rh = (h - 56) / rows, base = Math.min(10, cell * 0.3);
    sorted.forEach((r, i) => {
      const f = r.keyframes[Math.min(idx, r.keyframes.length - 1)];
      const bright = 1 - (f.rank - 1) / Math.max(1, agents);
      const isMine = r.id.toLowerCase() === mineId?.toLowerCase();
      const x = (i % cols) * cw + cw / 2, y = 48 + Math.floor(i / cols) * rh + rh / 2;
      const rad = isMine ? Math.max(7, base * 1.3) : base * (0.5 + 0.5 * bright);
      g.globalAlpha = isMine ? 1 : 0.25 + 0.75 * bright;
      if (isMine) { g.shadowColor = "#FFB547"; g.shadowBlur = 18; }
      g.fillStyle = isMine ? "#FFB547" : houseIds.has(r.id.toLowerCase()) ? "#6c6280" : "#F2D16B";
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    });
    g.globalAlpha = 1;
  }, [idx, sorted, mineId, houseIds, agents]);

  const f = mine?.keyframes[idx];
  const d = mine?.decisive;
  const showDecisive = d && f && f.t >= d.t;
  return (
    <section aria-label="Replay">
      <canvas ref={canvas} className="lamps" role="img" aria-label={`Lamp row: ${replays.length} agents at turn ${f?.t ?? replays[0]?.keyframes[idx]?.t ?? 0}`} />
      <div className="row" style={{ margin: "12px 0" }}>
        <button type="button" className="primary" onClick={() => { if (reduced) return setMs((m) => (m >= DURATION ? 0 : Math.min(DURATION, m + DURATION / 5))); if (ms >= DURATION) setMs(0); setPlaying((p) => !p); }}>
          {reduced ? "step through →" : playing ? "pause" : ms >= DURATION ? "replay" : "play 15 s"}
        </button>
        <input type="range" min={0} max={DURATION} value={ms} step={step ? DURATION / 5 : 50} aria-label="Scrub the replay" onChange={(e) => { setPlaying(false); setMs(Number(e.target.value)); }} style={{ flex: 1, minWidth: 140 }} />
        <span className="data">turn {f?.t ?? replays[0]?.keyframes[idx]?.t ?? 0}/{turns}</span>
      </div>
      <div className="caption" aria-live="polite">
        {mine && f ? (
          <>
            <span className="data">rank {f.rank} of {agents} · {f.coins} coins</span>
            {showDecisive && d && (
              <p style={{ margin: "6px 0 0" }}>
                <span className="glyph" style={{ color: COLOR[d.action] }}>{GLYPH[d.action]}</span> {d.why}
                {d.partner ? <span className="muted"> · neighbour {d.partner.slice(0, 6)}…{d.partner.slice(-4)}</span> : null}
              </p>
            )}
          </>
        ) : <span className="muted">No agent of yours played this night — the lamps are the whole market.</span>}
      </div>
      <div className="legend" aria-label="Legend">
        <span><span className="glyph" style={{ color: COLOR.GATHER }}>▲</span> gather</span>
        <span><span className="glyph" style={{ color: COLOR.GUARD }}>■</span> guard</span>
        <span><span className="glyph" style={{ color: COLOR.SHARE }}>◆</span> share</span>
        <span><span className="glyph" style={{ color: COLOR.STEAL }}>✕</span> steal</span>
        <span>brighter lamp = higher rank · grey = house agent{mine ? " · amber = you" : ""}</span>
      </div>
    </section>
  );
}
