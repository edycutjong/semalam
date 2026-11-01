"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { duckMusic, setMusic, sfx, soundPrefs, soundReady, unlockSound } from "@/lib/sound";

export type Frame = { t: number; coins: number; rank: number };
export type AgentRep = { id: string; keyframes: Frame[]; decisive: { t: number; action: string; partner: string | null; partnerAction: string | null; delta: number; why: string } };
/** The sim's per-turn record of the whole night (field order = ids). Pass it only when a re-run of the night in this
 * browser reproduced the posted result hash: then every arc on screen is a move that really happened. */
export type Trace = { ids: string[]; turns: { act: ArrayLike<number>; partner: ArrayLike<number>; coins: ArrayLike<number>; rank: ArrayLike<number> }[] };

const DURATION = 15_000;
const ACTS = ["GATHER", "GUARD", "SHARE", "STEAL"];
const GLYPH: Record<string, string> = { GATHER: "▲", GUARD: "■", SHARE: "◆", STEAL: "✕" };
const COLOR: Record<string, string> = { GATHER: "#8FCB6B", GUARD: "#7C8CC4", SHARE: "#F2D16B", STEAL: "#E2543B" };
const AMBER = "#FFB547", WARM = "#F2D16B", GREY = "#8a7fa0", PAPER = "#F7E9CC";
const ARC_CAP = 36; // ambient arcs per turn; the followed lamp's own arcs are always drawn
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

type Model = { n: number; J: number; samples: Float32Array; coins: Float32Array; rank: Float32Array; maxc: Float32Array; act?: Uint8Array; partner?: Int32Array };

/** Per-sample state in lamp order: every turn from the trace, else the stored keyframes (every 10th turn). Sample 0 is
 * the opening and copies sample 1 — nothing before the first record is invented. */
function buildModel(sorted: AgentRep[], trace: Trace | null | undefined, T: number): Model {
  const n = sorted.length;
  if (trace && trace.turns.length === T && trace.ids.length === n) {
    const at = new Map(trace.ids.map((id, i) => [id.toLowerCase(), i]));
    const ti = sorted.map((r) => at.get(r.id.toLowerCase()) ?? -1);
    if (ti.every((x) => x >= 0)) {
      const inv = new Int32Array(n); ti.forEach((t, s) => (inv[t] = s));
      const samples = Float32Array.from({ length: T + 1 }, (_, j) => j);
      const coins = new Float32Array((T + 1) * n), rank = new Float32Array((T + 1) * n), maxc = new Float32Array(T + 1);
      const act = new Uint8Array(T * n), partner = new Int32Array(T * n);
      for (let k = 1; k <= T; k++) {
        const tr = trace.turns[k - 1]; let m = 1;
        for (let s = 0; s < n; s++) {
          const i = ti[s], c = tr.coins[i];
          coins[k * n + s] = c; rank[k * n + s] = tr.rank[i]; if (c > m) m = c;
          act[(k - 1) * n + s] = tr.act[i]; partner[(k - 1) * n + s] = tr.partner[i] < 0 ? -1 : inv[tr.partner[i]];
        }
        maxc[k] = m;
      }
      coins.copyWithin(0, n, 2 * n); rank.copyWithin(0, n, 2 * n); maxc[0] = maxc[1];
      return { n, J: T, samples, coins, rank, maxc, act, partner };
    }
  }
  const J = sorted[0]?.keyframes.length ?? 0;
  const samples = new Float32Array(J + 1), coins = new Float32Array((J + 1) * n), rank = new Float32Array((J + 1) * n), maxc = new Float32Array(J + 1);
  for (let j = 1; j <= J; j++) {
    let m = 1;
    sorted.forEach((r, s) => { const f = r.keyframes[Math.min(j - 1, r.keyframes.length - 1)]; coins[j * n + s] = f.coins; rank[j * n + s] = f.rank; if (f.coins > m) m = f.coins; });
    samples[j] = sorted[0].keyframes[j - 1].t; maxc[j] = m;
  }
  if (J) { coins.copyWithin(0, n, 2 * n); rank.copyWithin(0, n, 2 * n); maxc[0] = maxc[1]; }
  return { n, J, samples, coins, rank, maxc };
}
/** last sample at or before turn position p */
function seg(M: Model, p: number) {
  if (M.act) return Math.max(0, Math.min(M.J - 1, Math.floor(p)));
  let lo = 0, hi = M.J;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (M.samples[mid] <= p) lo = mid; else hi = mid - 1; }
  return Math.max(0, Math.min(Math.max(0, M.J - 1), lo));
}
/** the last sample at or before turn p, up to the final one (captions: never an interpolated value shown as data) */
function atOrBefore(M: Model, p: number) {
  if (M.act) return Math.max(0, Math.min(M.J, Math.floor(p)));
  let lo = 0, hi = M.J;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (M.samples[mid] <= p) lo = mid; else hi = mid - 1; }
  return lo;
}
/** time warp: every turn gets equal time except around the decisive turn, which plays in slow motion */
function warpOf(T: number, d: number | null) {
  const cum = new Float32Array(T + 1);
  for (let k = 0; k < T; k++) { const x = d == null ? 99 : (k + 0.5 - (d - 0.5)) / 2.2; cum[k + 1] = cum[k] + 1 + 11 * Math.exp(-x * x); }
  const s = DURATION / (cum[T] || 1);
  for (let k = 0; k <= T; k++) cum[k] *= s;
  return cum;
}
function turnAt(cum: Float32Array, ms: number) {
  const T = cum.length - 1; if (ms <= 0) return 0; if (ms >= cum[T]) return T;
  let lo = 0, hi = T - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= ms) lo = mid; else hi = mid - 1; }
  return lo + (ms - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
}
const msAt = (cum: Float32Array, p: number) => { const k = Math.max(0, Math.min(cum.length - 2, Math.floor(p))); return cum[k] + (p - k) * (cum[k + 1] - cum[k]); };

type Geo = { w: number; h: number; dpr: number; xs: Float32Array; ys: Float32Array; ws: Float32Array; sy: Float32Array; sag: number; base: number; rows: number };
/** lamps hang in rows from sagging strings, seated in id order like the lamp string on the landing */
function layout(n: number, w: number, h: number, dpr: number): Geo {
  const top = 22, bottom = 12, ah = Math.max(40, h - top - bottom);
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * w) / ah))));
  const rows = Math.max(1, Math.ceil(n / cols)), cw = w / cols, rh = ah / rows;
  const base = Math.max(2.5, Math.min(11, Math.min(cw, rh) * 0.27)), sag = rh * 0.16, hang = Math.max(base + 4, rh * 0.42);
  const xs = new Float32Array(n), ys = new Float32Array(n), ws = new Float32Array(n), sy = new Float32Array(rows);
  for (let r = 0; r < rows; r++) sy[r] = top + r * rh + Math.max(2, rh * 0.12);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), inRow = r === rows - 1 ? n - r * cols : cols;
    const x = ((cols - inRow) * cw) / 2 + ((i % cols) + 0.5) * cw, u = (2 * x) / w - 1;
    xs[i] = x; ws[i] = sy[r] + sag * (1 - u * u); ys[i] = ws[i] + hang;
  }
  return { w, h, dpr, xs, ys, ws, sy, sag, base, rows };
}
function sprite(color: string) {
  const s = document.createElement("canvas"); s.width = s.height = 64;
  const g = s.getContext("2d")!, grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, `${color}d0`); grd.addColorStop(0.3, `${color}55`); grd.addColorStop(1, `${color}00`);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return s;
}

/** The lamp row is the replay: one lamp per agent; brightness follows rank, size follows coins; the player's lamp is
 * amber. 15 s, continuous, scrubbable; slow motion and a close-up on the followed lamp's decisive turn. */
export default function ReplayPlayer({ replays, mineId, houseIds, agents, autoPlay = false, mineLabel = "you", trace, onEnd, ready = true }: {
  replays: AgentRep[]; mineId?: string; houseIds: Set<string> | string[]; agents: number; autoPlay?: boolean; mineLabel?: string; trace?: Trace | null; onEnd?: () => void;
  /** false while the caller is still checking the night (Breakfast's hash re-run): play waits so the model never swaps mid-play */ ready?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const houseKey = [...houseIds].map((h) => h.toLowerCase()).sort().join(","); // callers may pass a new Set each render
  const house = useMemo(() => new Set(houseKey ? houseKey.split(",") : []), [houseKey]);
  const sorted = useMemo(() => [...replays].sort((a, b) => (a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1)), [replays]);
  const T = sorted[0]?.keyframes.at(-1)?.t ?? 300;
  const mine = mineId ? sorted.find((r) => r.id.toLowerCase() === mineId.toLowerCase()) : undefined;
  const winner = useMemo(() => sorted.reduce<AgentRep | undefined>((w, r) => (!w || (r.keyframes.at(-1)?.rank ?? 1e9) < (w.keyframes.at(-1)?.rank ?? 1e9) ? r : w), undefined), [sorted]);
  const focus = mine ?? winner;
  const fi = focus ? sorted.indexOf(focus) : -1;
  const d = focus?.decisive;
  const dT = d && d.t >= 1 && d.t <= T ? d.t : null;
  const M = useMemo(() => buildModel(sorted, trace, T), [sorted, trace, T]);
  const cum = useMemo(() => warpOf(T, dT), [T, dT]);
  const isHouse = useMemo(() => sorted.map((r) => house.has(r.id.toLowerCase())), [sorted, house]);
  const focusHouse = fi >= 0 && isHouse[fi];
  const tag = mine ? (mineLabel === "you" ? "YOU" : null) : focus ? (focusHouse ? "WINNER · HOUSE" : "WINNER") : null;

  const [turn, setTurn] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [say, setSay] = useState("");
  const [mute, setMute] = useState(false); // effects are on but this page has not had a gesture yet
  useEffect(() => {
    const check = () => setMute(soundPrefs().sfx && !soundReady());
    check(); window.addEventListener("semalam:sound", check);
    return () => window.removeEventListener("semalam:sound", check);
  }, []);
  const S = useRef({ pos: 0, target: 0, clock: 0, playing: false, last: 0, raf: 0, ignite: -1, fade: null as HTMLCanvasElement | null, fadeAt: 0, shown: -1, heard: 0 });
  const eng = useRef<{ kick: () => void; snap: () => HTMLCanvasElement | null } | null>(null);
  const endRef = useRef(onEnd); endRef.current = onEnd;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(mq.matches); set();
    mq.addEventListener?.("change", set);
    return () => mq.removeEventListener?.("change", set);
  }, []);

  // the engine: one rAF loop that only runs while something moves; React state changes at most once per turn
  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const g = c.getContext("2d"); if (!g) return;
    const fam = getComputedStyle(document.documentElement).getPropertyValue("--f-martian").trim() || "ui-monospace, monospace";
    const sp = { [AMBER]: sprite(AMBER), [WARM]: sprite(WARM), [GREY]: sprite(GREY), [PAPER]: sprite(PAPER) };
    let G = layout(M.n, c.clientWidth || 300, c.clientHeight || 160, window.devicePixelRatio || 1);
    const R = new Float32Array(M.n); // lamp radii, reused every frame
    const s = S.current;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); G = layout(M.n, w, h, dpr); paint(performance.now());
    };
    const arc = (from: number, to: number, u: number, color: string, alpha: number, width: number) => {
      const ax = G.xs[from], ay = G.ys[from], bx = G.xs[to], by = G.ys[to];
      const cx = (ax + bx) / 2, cy = (ay + by) / 2 - Math.max(14, Math.hypot(bx - ax, by - ay) * 0.32);
      const hx = (1 - u) * (1 - u) * ax + 2 * u * (1 - u) * cx + u * u * bx, hy = (1 - u) * (1 - u) * ay + 2 * u * (1 - u) * cy + u * u * by;
      g.globalAlpha = alpha; g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width;
      g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(ax + (cx - ax) * u, ay + (cy - ay) * u, hx, hy); g.stroke();
      g.beginPath(); g.arc(hx, hy, width * 1.3, 0, Math.PI * 2); g.fill();
    };
    const arcs = (K: number, u: number, fade: number) => {
      if (!M.act || !M.partner || K < 1) return;
      const o = (K - 1) * M.n; let count = 0;
      for (let i = 0; i < M.n; i++) { const a = M.act[o + i]; if ((a === 2 || a === 3) && M.partner[o + i] >= 0) count++; }
      const stride = Math.max(1, Math.ceil(count / ARC_CAP)); let k = 0;
      for (let i = 0; i < M.n; i++) {
        const a = M.act[o + i], q = M.partner[o + i];
        if ((a !== 2 && a !== 3) || q < 0) continue;
        const mineArc = i === fi || q === fi;
        if (!mineArc && k++ % stride !== K % stride) continue;
        const [from, to] = a === 3 ? [q, i] : [i, q]; // a steal pulls coins from the partner; a share sends them
        arc(from, to, u, a === 3 ? COLOR.STEAL : WARM, mineArc ? fade : 0.28 * fade, mineArc ? 2.4 : 1);
      }
    };
    function paint(now: number) {
      const { w, h, dpr } = G, p = s.pos, n = M.n;
      const b = fi >= 0 && dT != null && !reduced ? Math.exp(-(((p - (dT - 0.5)) / 3.2) ** 2)) : 0;
      const z = 1 + 1.1 * b, fx = fi >= 0 ? G.xs[fi] : w / 2, fy = fi >= 0 ? G.ys[fi] : h / 2;
      // the camera eases toward the followed lamp but never shows past the edge of the market
      const px = Math.min(w - w / (2 * z), Math.max(w / (2 * z), w / 2 + (fx - w / 2) * b)), py = Math.min(h - h / (2 * z), Math.max(h / (2 * z), h / 2 + (fy - h / 2) * b));
      g!.setTransform(dpr, 0, 0, dpr, 0, 0); g!.globalAlpha = 1; g!.fillStyle = "#150F27"; g!.fillRect(0, 0, w, h);
      if (!n || !M.J) return;
      g!.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - px * z), dpr * (h / 2 - py * z));
      // strings and wires
      g!.strokeStyle = "#3A2F55"; g!.lineWidth = 1.2; g!.beginPath();
      for (let r = 0; r < G.rows; r++) { g!.moveTo(0, G.sy[r]); g!.quadraticCurveTo(w / 2, G.sy[r] + 2 * G.sag, w, G.sy[r]); }
      g!.stroke();
      g!.lineWidth = 0.8; g!.beginPath();
      const j = seg(M, p), j1 = Math.min(M.J, j + 1), s0 = M.samples[j], s1 = M.samples[j1];
      const k0 = s1 > s0 ? clamp01((p - s0) / (s1 - s0)) : 0, e = M.act ? ease(k0) : k0, mc = lerp(M.maxc[j], M.maxc[j1], e) || 1; // keyframes (10 turns apart) move linearly: no pulse every 10 turns
      for (let i = 0; i < n; i++) {
        const cn = lerp(M.coins[j * n + i], M.coins[j1 * n + i], e);
        R[i] = G.base * (0.45 + 0.55 * Math.sqrt(Math.max(0, cn) / mc)) * (i === fi ? 1.25 : 1);
        g!.moveTo(G.xs[i], G.ws[i]); g!.lineTo(G.xs[i], G.ys[i] - R[i]);
      }
      g!.stroke();
      // lamps: glow sprite + core; the market lights up over the opening turns
      const dawn = 0.55 + 0.45 * smooth(0, 6, p);
      for (let i = 0; i < n; i++) {
        const rk = lerp(M.rank[j * n + i], M.rank[j1 * n + i], e), bright = 1 - (rk - 1) / Math.max(1, agents - 1);
        const isF = i === fi, col = isF && mine ? AMBER : isHouse[i] ? GREY : WARM, a = (isF ? 1 : 0.22 + 0.78 * bright) * dawn;
        const gs = R[i] * (isF ? 5 : 3.4);
        g!.globalAlpha = a * (isF ? 0.95 : 0.5 * bright); g!.drawImage(sp[col], G.xs[i] - gs, G.ys[i] - gs, gs * 2, gs * 2);
        g!.globalAlpha = a; g!.fillStyle = col; g!.beginPath(); g!.arc(G.xs[i], G.ys[i], R[i], 0, Math.PI * 2); g!.fill();
      }
      // the turn's real moves: steals (red) and shares (yellow) arc between partners; the last turn's fade out
      if (M.act && !reduced) {
        const K = Math.min(T, Math.floor(p) + 1), u = p - Math.floor(p);
        if (K > 1) arcs(K - 1, 1, 0.45 * (1 - u));
        if (p < T) arcs(K, ease(clamp01(u * 1.15)), 1);
      }
      if (fi >= 0) {
        const x = G.xs[fi], y = G.ys[fi], r = R[fi];
        if (!mine) { g!.globalAlpha = 0.9; g!.strokeStyle = PAPER; g!.lineWidth = 1.5; g!.beginPath(); g!.arc(x, y, r + 4, 0, Math.PI * 2); g!.stroke(); }
        if (s.ignite >= 0) { // the morning reveal: the followed lamp lights up
          const k = clamp01((now - s.ignite) / 1100);
          g!.globalAlpha = (1 - k) * (1 - k); g!.strokeStyle = mine ? AMBER : PAPER; g!.lineWidth = 2;
          g!.beginPath(); g!.arc(x, y, r * (1.4 + 4.5 * ease(k)), 0, Math.PI * 2); g!.stroke();
          const gs = r * (5 + 4 * (1 - k)); g!.globalAlpha = 0.6 * (1 - k); g!.drawImage(sp[mine ? AMBER : PAPER], x - gs, y - gs, gs * 2, gs * 2);
        }
        if (dT != null && d && !reduced && p > dT - 1 && p < dT + 1.8) { // the decisive turn's coin swing floats up
          const k = (p - (dT - 1)) / 2.8, al = smooth(0, 0.15, k) * (1 - smooth(0.7, 1, k));
          g!.globalAlpha = al; g!.textAlign = "center"; g!.lineJoin = "round"; g!.strokeStyle = "#150F27"; g!.lineWidth = 4;
          const dl = `${d.delta >= 0 ? "+" : "−"}${Math.abs(d.delta)}`, dy = y - r - 10 - 12 * k;
          g!.font = `700 13px ${fam}`;
          const tw = g!.measureText(dl).width; g!.fillStyle = "rgba(21,15,39,.82)"; g!.beginPath(); g!.roundRect?.(x - tw / 2 - 5, dy - 12, tw + 10, 16, 5); g!.fill(); // an ink plate under the swing
          g!.strokeText(dl, x, dy); g!.fillStyle = d.delta >= 0 ? COLOR.GATHER : COLOR.STEAL; g!.fillText(dl, x, dy);
          // the matchup, each glyph in its action colour: mine vs theirs
          g!.font = `400 10px ${fam}`; g!.textAlign = "left";
          const parts: [string, string][] = [[GLYPH[d.action] ?? "", COLOR[d.action] ?? PAPER], [" vs ", PAPER], [d.partnerAction ? GLYPH[d.partnerAction] : "alone", d.partnerAction ? COLOR[d.partnerAction] : PAPER]];
          let gx = x - parts.reduce((t, [str]) => t + g!.measureText(str).width, 0) / 2;
          const gy = (y + r + 20 - py) * z + h / 2 < h - 2 ? y + r + 16 : dy - 16; // below the lamp, or above the swing when the edge is near
          for (const [str, col] of parts) { g!.strokeText(str, gx, gy); g!.fillStyle = col; g!.fillText(str, gx, gy); gx += g!.measureText(str).width; }
        } else if (tag) {
          const ty = (y + r + 18 - py) * z + h / 2 < h - 2 ? y + r + 15 : y - r - 9; // keep the tag inside the frame
          g!.globalAlpha = 0.85 * (1 - b) * dawn; g!.textAlign = "center"; g!.font = `400 10px ${fam}`; g!.lineJoin = "round"; g!.strokeStyle = "#150F27"; g!.lineWidth = 3;
          g!.strokeText(tag, x, ty); g!.fillStyle = mine ? AMBER : PAPER; g!.fillText(tag, x, ty);
        }
      }
      g!.globalAlpha = 1;
      if (b > 0.02) { // vignette while the camera is close
        g!.setTransform(dpr, 0, 0, dpr, 0, 0);
        const v = g!.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
        v.addColorStop(0, "rgba(10,6,22,0)"); v.addColorStop(1, `rgba(10,6,22,${(0.6 * b).toFixed(3)})`);
        g!.fillStyle = v; g!.fillRect(0, 0, w, h);
      }
      if (s.fade) { // reduced motion: the old frame cross-fades out over the new one
        const k = (now - s.fadeAt) / 450;
        if (k < 1) { g!.setTransform(1, 0, 0, 1, 0, 0); g!.globalAlpha = 1 - ease(k); g!.drawImage(s.fade, 0, 0); g!.globalAlpha = 1; } else s.fade = null;
      }
    }
    // React state + sound follow the integer turn, not the frame
    const sync = (crossed: boolean) => {
      const K = Math.min(T, Math.ceil(s.pos - 1e-6));
      if (K === s.shown) return;
      const prev = s.shown; s.shown = K; setTurn(K);
      if (!crossed || prev < 0 || fi < 0) return;
      for (let k = prev + 1; k <= K; k++) {
        if (k === dT && d) { setSay(d.why); if (d.action === "STEAL" || d.partnerAction === "STEAL") sfx.whoosh(); else sfx.chime(0.25); continue; }
        if (M.act && M.partner) {
          const q = M.partner[(k - 1) * M.n + fi], pa = q >= 0 ? M.act[(k - 1) * M.n + q] : -1, now = performance.now();
          if (pa === 3 && now - s.heard > 380) { s.heard = now; sfx.whoosh(-1); } // a neighbour steals from the followed lamp
          else if (pa === 2 && now - s.heard > 420) { s.heard = now; sfx.pling(); } // a neighbour shares with it
          else if (M.coins[k * M.n + fi] > M.coins[(k - 1) * M.n + fi]) sfx.tick();
        } else if (M.samples.includes(k)) { const jj = M.samples.indexOf(k); if (jj > 0 && M.coins[jj * M.n + fi] > M.coins[(jj - 1) * M.n + fi]) sfx.tick(); }
      }
    };
    const loop = (now: number) => {
      const dt = s.last ? Math.min(64, now - s.last) : 16; s.last = now;
      let busy = false, crossed = false;
      if (s.playing) {
        s.clock = Math.min(DURATION, s.clock + dt); s.pos = turnAt(cum, s.clock); s.target = s.pos; busy = true; crossed = true;
        if (s.clock >= DURATION) {
          s.playing = false; setPlaying(false); duckMusic(false); s.ignite = now;
          const fr = fi >= 0 ? M.rank[M.J * M.n + fi] : 0;
          if (fi >= 0) { sfx.chime(1 - (fr - 1) / Math.max(1, agents - 1), 0.05); setSay(`End of the night: ${mine ? "your lamp" : "the winner"} finished rank ${fr} of ${agents}.`); }
          endRef.current?.();
        }
      } else if (Math.abs(s.target - s.pos) > 0.002) { s.pos += (s.target - s.pos) * (1 - Math.exp(-dt / 70)); busy = true; }
      else s.pos = s.target;
      if (s.ignite >= 0 && now - s.ignite < 1150) busy = true;
      if (s.fade) busy = true;
      paint(now); sync(crossed);
      if (busy) s.raf = requestAnimationFrame(loop); else { s.raf = 0; s.last = 0; }
    };
    eng.current = {
      kick: () => { if (!s.raf) s.raf = requestAnimationFrame(loop); },
      snap: () => { const k = document.createElement("canvas"); k.width = c.width; k.height = c.height; k.getContext("2d")?.drawImage(c, 0, 0); return k; },
    };
    const ro = new ResizeObserver(resize); ro.observe(c); resize();
    s.shown = -1; sync(false);
    if (s.playing) { duckMusic(true); eng.current.kick(); } // the trace landed mid-play: keep going on the new model
    return () => { ro.disconnect(); cancelAnimationFrame(s.raf); s.raf = 0; s.last = 0; if (s.playing) duckMusic(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [M, cum, fi, isHouse, agents, reduced, T, dT, tag]);

  const play = () => {
    const s = S.current;
    if (reduced) return stepTo(s.pos >= T - 0.01 ? 0 : Math.min(T, (Math.floor(s.pos / (T / 5) + 1e-6) + 1) * (T / 5)));
    if (s.playing) { s.playing = false; setPlaying(false); duckMusic(false); return; }
    if (s.pos >= T - 0.01) { s.clock = 0; s.pos = 0; s.target = 0; s.shown = -1; setSay(""); } else s.clock = msAt(cum, s.pos);
    s.ignite = -1; s.playing = true; setPlaying(true); duckMusic(true); eng.current?.kick();
  };
  const stepTo = (v: number) => {
    const s = S.current;
    s.playing = false; setPlaying(false);
    if (reduced) { s.fade = eng.current?.snap() ?? null; s.fadeAt = performance.now(); s.pos = v; s.target = v; if (v >= T && fi >= 0) { setSay(`End of the night: rank ${M.rank[M.J * M.n + fi]} of ${agents}.`); endRef.current?.(); } }
    else { s.target = v; s.clock = msAt(cum, v); s.ignite = -1; }
    eng.current?.kick();
  };
  useEffect(() => { // autoplay (landing, breakfast, scrimmage) once most of the lamp field is on screen; never with reduced motion
    const el = canvas.current;
    if (!autoPlay || !el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); if (!S.current.playing && S.current.pos === 0) play(); } }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, cum]);

  // caption numbers: the exact turn with a trace, else the last stored keyframe at or before it (labelled with its turn)
  const cj = turn <= 0 ? 0 : atOrBefore(M, turn + 1e-6);
  const shownT = M.act ? turn : cj > 0 ? M.samples[cj] : 0;
  const fr = fi >= 0 && cj > 0 ? { rank: M.rank[cj * M.n + fi], coins: M.coins[cj * M.n + fi] } : null;
  const showDecisive = d && dT != null && turn >= dT;
  const who = mine ? null : focus ? (focusHouse ? "following the night's winner, a house agent" : "following the night's winner") : null;
  return (
    <section aria-label="Replay">
      <canvas ref={canvas} className="lamps" role="img" aria-label={`Lamp row: ${replays.length} agents at turn ${shownT} of ${T}`} />
      <div className="row" style={{ margin: "12px 0" }}>
        <button type="button" className="primary" onClick={play} disabled={!ready} aria-label={reduced ? "Step through the night" : undefined}>
          {reduced ? (turn >= T ? "from the start" : "step through →") : playing ? "pause" : turn >= T ? "replay" : "play 15 s"}
        </button>
        <input type="range" min={0} max={T} value={Math.min(T, turn)} step={reduced ? T / 5 : 1} aria-label="Scrub the replay" aria-valuetext={`turn ${shownT} of ${T}`}
          onChange={(e) => stepTo(Number(e.target.value))} style={{ flex: 1, minWidth: 140 }} />
        <span className="data">turn {shownT}/{T}</span>
        {mute && (
          <button type="button" className="chip snd-hint" onClick={() => { unlockSound(); setMute(false); if (turn >= T && fi >= 0) sfx.chime(1 - (M.rank[M.J * M.n + fi] - 1) / Math.max(1, agents - 1), 0.05); }}>
            ♪ tap for sound
          </button>
        )}
        {mute && !soundPrefs().music && (
          <button type="button" className="chip snd-hint" onClick={() => { unlockSound(); setMusic(true); setMute(false); }}>♪ with night-market music</button>
        )}
      </div>
      <div className="caption">
        {focus ? (
          <>
            <span className="data">{who ? <span className="muted">{who} · </span> : null}{fr ? `rank ${fr.rank} of ${agents} · ${fr.coins} coins` : "the market opens at 00:00 WIB"}</span>
            {showDecisive && d && (
              <p style={{ margin: "6px 0 0" }}>
                <span className="glyph" style={{ color: COLOR[d.action] }}>{GLYPH[d.action]}</span> {d.why}
                {d.partner ? <span className="muted"> · partner: {house.has(d.partner.toLowerCase()) ? "a house agent" : `${d.partner.slice(0, 6)}…${d.partner.slice(-4)}`}</span> : null}
              </p>
            )}
          </>
        ) : <span className="muted">No agent of yours played this night — the lamps are the whole market.</span>}
      </div>
      <p className="sr" aria-live="polite">{say}</p>
      <div className="legend" aria-label="Legend">
        <span><span className="glyph" style={{ color: COLOR.GATHER }}>▲</span> gather</span>
        <span><span className="glyph" style={{ color: COLOR.GUARD }}>■</span> guard</span>
        <span><span className="glyph" style={{ color: COLOR.SHARE }}>◆</span> share</span>
        <span><span className="glyph" style={{ color: COLOR.STEAL }}>✕</span> steal</span>
        <span>brighter lamp = higher rank (the followed lamp stays lit) · bigger = more coins · grey = house agent{mine ? ` · amber = ${mineLabel}` : ""}{M.act && !reduced ? " · arcs = this turn's steals (red) and shares (yellow); busy turns show a sample, the followed lamp's always" : ""}</span>
      </div>
    </section>
  );
}
