// Sound, synthesized in the browser with Web Audio — no audio files. Nothing plays before a user gesture; music is off
// by default; effects switch on with the first interaction; both choices are remembered per viewer (localStorage).
// The music is a generative night-market loop: a 16-beat gamelan cycle (slendro saron + peking, kenong, gong) over a
// low pad and crickets, so it never repeats audibly and costs zero bytes to download.
import { lsGet, lsSet } from "./ls";

export type SoundPrefs = { sfx: boolean; music: boolean };
const KEY = "semalam.sound";
let prefs: SoundPrefs | null = null;
const subs = new Set<(p: SoundPrefs) => void>();
export function soundPrefs(): SoundPrefs {
  if (!prefs) { const s = lsGet<Partial<SoundPrefs> | null>(KEY, null); prefs = { sfx: s?.sfx !== false, music: s?.music === true }; }
  return prefs;
}
export function onSoundPrefs(f: (p: SoundPrefs) => void) { subs.add(f); return () => { subs.delete(f); }; }
function save(p: SoundPrefs) { prefs = p; lsSet(KEY, p); subs.forEach((f) => f(p)); }

let ctx: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, musicBus: GainNode, duckBus: GainNode, noiseBuf: AudioBuffer;
const MUSIC_LEVEL = 0.5, SFX_LEVEL = 0.6;

/** Call from inside a user gesture (click, key). Creates or resumes the one AudioContext. */
export function unlockSound(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) { if (ctx.state === "suspended") void ctx.resume(); return ctx; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC({ latencyHint: "interactive" }); } catch { return null; }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  comp.connect(ctx.destination);
  master = gain(0.8, comp);
  sfxBus = gain(soundPrefs().sfx ? SFX_LEVEL : 0, master);
  duckBus = gain(1, master);
  musicBus = gain(0, duckBus);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const ch = noiseBuf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  document.addEventListener("visibilitychange", onVisibility);
  if (soundPrefs().music) startMusic();
  return ctx;
}
export const soundReady = () => Boolean(ctx && ctx.state === "running");

function gain(v: number, to: AudioNode | AudioParam) {
  const g = ctx!.createGain(); g.gain.value = v;
  if (to instanceof AudioNode) g.connect(to); else g.connect(to);
  return g;
}
function ramp(p: AudioParam, v: number, secs: number) { const t = ctx!.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + secs); }
/** an attack/exponential-decay envelope on a fresh gain node */
function env(t: number, peak: number, attack: number, decay: number, to: AudioNode) {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(to);
  return g;
}
function tone(type: OscillatorType, f: number, t: number, stop: number, to: AudioNode) {
  const o = ctx!.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.connect(to); o.start(t); o.stop(stop);
  return o;
}
function noise(t: number, dur: number, to: AudioNode) {
  const s = ctx!.createBufferSource(); s.buffer = noiseBuf; s.connect(to); s.start(t, Math.random() * 0.5, dur); return s;
}
function pan(v: number, to: AudioNode) { if (typeof ctx!.createStereoPanner !== "function") return to; const p = ctx!.createStereoPanner(); p.pan.value = v; p.connect(to); return p; }

export function setSfx(on: boolean) { save({ ...soundPrefs(), sfx: on }); if (ctx) ramp(sfxBus.gain, on ? SFX_LEVEL : 0, 0.08); }
export function setMusic(on: boolean) {
  save({ ...soundPrefs(), music: on });
  if (!ctx) return;
  if (on) startMusic(); else stopMusic();
}
/** Quieter music while a replay plays or a result is revealed. */
export function duckMusic(on: boolean) { if (ctx) ramp(duckBus.gain, on ? 0.35 : 1, on ? 0.4 : 1.2); }

// ---------- effects (all short and quiet; each one is a no-op until a gesture unlocked audio and SFX are on) ----------
const live = () => Boolean(ctx && ctx.state === "running" && soundPrefs().sfx);
let lastTick = 0;
export const sfx = {
  /** rubber stamp hitting paper: a pitch-dropping thump plus a short paper slap; `delay` lines it up with the CSS impact */
  stamp(delay = 0) {
    if (!live()) return;
    const t = ctx!.currentTime + delay;
    const body = env(t, 0.9, 0.003, 0.2, sfxBus);
    const o = tone("sine", 150, t, t + 0.3, body); o.frequency.exponentialRampToValueAtTime(46, t + 0.17);
    const lp = ctx!.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1500; lp.connect(env(t, 0.5, 0.001, 0.06, sfxBus));
    noise(t, 0.09, lp);
  },
  /** a lamp lighting: two bell partials, a slendro step apart; `hi` (0–1) lifts the pitch for a better rank */
  chime(hi = 0.5, delay = 0) {
    if (!live()) return;
    const t = ctx!.currentTime + delay, f = 660 * Math.pow(2, Math.round(Math.max(0, Math.min(1, hi)) * 4) * 0.2);
    [0, 0.13].forEach((dt, k) => {
      const ff = f * (k ? 1.3195 : 1), out = env(t + dt, 0.22, 0.004, 1.6, pan(k ? 0.2 : -0.2, sfxBus));
      tone("sine", ff, t + dt, t + dt + 1.7, out); tone("sine", ff * 2.76, t + dt, t + dt + 0.6, env(t + dt, 0.05, 0.002, 0.4, out));
    });
  },
  /** a coin landing on a pile, throttled so a fast replay never machine-guns */
  tick() {
    if (!live()) return;
    const now = performance.now(); if (now - lastTick < 95) return; lastTick = now;
    const t = ctx!.currentTime, f = 2400 + Math.random() * 900;
    tone("triangle", f, t, t + 0.05, env(t, 0.07, 0.002, 0.035, sfxBus));
  },
  /** a steal: band-passed air sweeping across the stereo field */
  whoosh(dir = 1) {
    if (!live()) return;
    const t = ctx!.currentTime;
    const p = typeof ctx!.createStereoPanner === "function" ? ctx!.createStereoPanner() : null;
    const out = env(t, 0.32, 0.06, 0.24, sfxBus);
    if (p) { p.pan.setValueAtTime(-0.6 * dir, t); p.pan.linearRampToValueAtTime(0.6 * dir, t + 0.3); p.connect(out); }
    const bp = ctx!.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.9; bp.frequency.setValueAtTime(320, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.28);
    bp.connect(p ?? out);
    noise(t, 0.34, bp);
  },
  /** paper rustle when a ticket is read back: crackly high noise */
  rustle() {
    if (!live()) return;
    const t = ctx!.currentTime;
    const hp = ctx!.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1900;
    const g = ctx!.createGain(); g.gain.setValueAtTime(0.0001, t);
    for (let k = 0; k < 7; k++) { const at = t + k * 0.032 + Math.random() * 0.02; g.gain.linearRampToValueAtTime(0.1 + Math.random() * 0.16, at); g.gain.linearRampToValueAtTime(0.012, at + 0.018); }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    hp.connect(g); g.connect(sfxBus);
    noise(t, 0.32, hp);
  },
};

// ---------- music: a generative gamelan night market ----------
const BEAT = 60 / 66; // 66 BPM, one balungan note per beat
const SLENDRO: Record<number, number> = { 1: 1, 2: 1.1487, 3: 1.3195, 5: 1.5157, 6: 1.7411 }; // ~240-cent steps
const BASE = 277.18; // the saron's degree 1
// two 16-beat gongan; 0 = rest. Negative = the low octave.
const CYCLES = [
  [2, 1, 2, -6, 2, 1, 2, -6, 3, 5, 6, 5, 3, 2, 1, 2],
  [5, 6, 5, 3, 2, 1, 2, 3, 5, 3, 2, 1, 2, 3, 2, 1],
  [0, 3, 0, 2, 0, 3, 5, 6, 0, 5, 0, 3, 2, 1, 2, -6],
];
const hz = (d: number) => (d < 0 ? BASE / 2 : BASE) * SLENDRO[Math.abs(d)];
let timer: ReturnType<typeof setInterval> | null = null, nextAt = 0, beat = 0, cycle = 0, pad: { stop: () => void } | null = null, seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/** a struck bronze bar: inharmonic bar modes plus a slightly detuned twin for the gamelan shimmer (ombak) */
function bar(t: number, f: number, vel: number, decay: number, p: number) {
  const out = env(t, vel, 0.004, decay, pan(p, musicBus));
  tone("sine", f, t, t + decay + 0.1, out);
  tone("sine", f + 2.6, t, t + decay + 0.1, gain(0.55, out));
  tone("sine", f * 2.76, t, t + decay * 0.4, env(t, 0.22, 0.003, decay * 0.35, out));
  tone("sine", f * 5.4, t, t + 0.25, env(t, 0.06, 0.002, 0.18, out));
}
function gong(t: number) {
  const out = env(t, 0.5, 0.03, 6.5, musicBus);
  tone("sine", BASE / 4, t, t + 7, out);
  tone("sine", BASE / 4 + 1.3, t, t + 7, gain(0.8, out));
  tone("sine", (BASE / 4) * 2.02, t, t + 3, env(t, 0.18, 0.02, 2.6, out));
}
function crickets(t: number) {
  const out = pan(rnd() * 1.6 - 0.8, musicBus), f = 4300 + rnd() * 700;
  for (let k = 0; k < 3; k++) tone("sine", f, t + k * 0.05, t + k * 0.05 + 0.03, env(t + k * 0.05, 0.012, 0.004, 0.022, out));
}
function startPad() {
  const t = ctx!.currentTime, out = gain(0, musicBus);
  out.gain.linearRampToValueAtTime(0.05, t + 4);
  const lp = ctx!.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.7; lp.connect(out);
  const lfo = ctx!.createOscillator(), depth = gain(160, lp.frequency); lfo.frequency.value = 0.045; lfo.connect(depth); lfo.start(t);
  const os = [BASE / 2, (BASE / 2) * 1.5157, BASE / 2 + 0.7].map((f) => { const o = ctx!.createOscillator(); o.type = "triangle"; o.frequency.value = f; o.connect(lp); o.start(t); return o; });
  return { stop: () => { const n = ctx!.currentTime; out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n); out.gain.linearRampToValueAtTime(0, n + 1); [lfo, ...os].forEach((o) => o.stop(n + 1.1)); } };
}
function schedule() {
  if (!ctx) return;
  while (nextAt < ctx.currentTime + 0.45) {
    const pat = CYCLES[cycle % CYCLES.length], d = pat[beat], t = nextAt + (rnd() - 0.5) * 0.012;
    if (d) bar(t, hz(d), 0.16 + rnd() * 0.05, 1.9, -0.25);
    if (d && cycle % 2 === 1) { bar(t + BEAT / 2, hz(d) * 2, 0.045 + rnd() * 0.02, 0.9, 0.35); } // peking doubles every other cycle
    if (beat % 4 === 3) bar(t, hz(beat === 15 ? 1 : 5) / 2, 0.1, 3.2, 0.1); // kenong marks each quarter
    if (beat === 15) gong(t + BEAT * 0.98);
    if (rnd() < 0.35) crickets(t + rnd() * BEAT);
    nextAt += BEAT;
    if (++beat === 16) { beat = 0; cycle++; }
  }
}
function startMusic() {
  if (!ctx || timer || document.hidden) return;
  if (ctx.state === "suspended") void ctx.resume();
  ramp(musicBus.gain, MUSIC_LEVEL, 2.5);
  nextAt = ctx.currentTime + 0.1;
  pad = startPad();
  timer = setInterval(schedule, 120);
  schedule();
}
function stopMusic() {
  if (!ctx) return;
  ramp(musicBus.gain, 0, 0.8);
  if (timer) { clearInterval(timer); timer = null; }
  pad?.stop(); pad = null;
}
function onVisibility() {
  if (!ctx) return;
  if (document.hidden) stopMusic();
  else if (soundPrefs().music) startMusic();
}
