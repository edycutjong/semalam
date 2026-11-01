"use client";
import { Children, createContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* SEMALAM pitch deck controller.
   Keys: → / Space / PageDown next · ← / PageUp back · Home / End · Esc = overview grid · P = presenter (speaker notes,
   cursor hides after 2 s) · C = contrast check (outlines every text box). Swipe on touch screens. #3 in the URL opens
   slide 3. Print (Cmd/Ctrl+P → Save as PDF) gives one slide per 16 × 9 in page. The stage is a fixed 1920 × 1080
   canvas scaled to the window from documentElement.clientWidth/Height (a phone's innerWidth lies when zoomed out).
   A slide with steps (steps[k] > 1) takes → / ← itself until its first or last step; a frame that is not on screen,
   or the overview, reads step null and shows its final state (so do print, screenshots and no-JS). */
export type FrameStep = { step: number | null; set: (k: number) => void };
export const FrameStepContext = createContext<FrameStep>({ step: null, set: () => {} });

export default function Deck({ children, notes, steps = {} }: { children: ReactNode; notes: string[]; steps?: Record<number, number> }) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const [i, setI] = useState(0);
  const [step, setStep] = useState(0);
  const [overview, setOverview] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [contrast, setContrast] = useState(false);
  const [idle, setIdle] = useState(false);
  const touch = useRef<number | null>(null);
  const go = useCallback((k: number) => { setI(Math.max(0, Math.min(n - 1, k))); setStep(0); }, [n]);
  const last = (k: number) => Math.max(0, (steps[k] ?? 0) - 1);
  const next = useCallback(() => {
    if (!overview && step < last(i)) setStep(step + 1);
    else if (i < n - 1) { setI(i + 1); setStep(0); }
  }, [i, n, step, overview, steps]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useCallback(() => {
    if (!overview && step > 0) setStep(step - 1);
    else if (i > 0) { setI(i - 1); setStep(last(i - 1)); }
  }, [i, step, overview, steps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fit = () => {
      const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
      const room = presenter ? Math.round(h * 0.78) : h; // the notes panel takes the bottom 22 %
      document.documentElement.style.setProperty("--deck-s", String(Math.min(w / 1920, room / 1080)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [presenter]);

  useEffect(() => { // #3 opens slide 3; the hash follows the slide
    const k = Number(window.location.hash.slice(1));
    if (Number.isInteger(k) && k >= 1 && k <= n) setI(k - 1);
  }, [n]);
  useEffect(() => { window.history.replaceState(null, "", `#${i + 1}`); }, [i]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "ArrowRight" || k === " " || k === "PageDown") { e.preventDefault(); next(); }
      else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); prev(); }
      else if (k === "Home") go(0);
      else if (k === "End") go(n - 1);
      else if (k === "Escape") setOverview((o) => !o);
      else if (k === "p" || k === "P") setPresenter((p) => !p);
      else if (k === "c" || k === "C") setContrast((c) => !c);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [n, go, next, prev]);

  useEffect(() => { // presenter mode hides the cursor after 2 s without movement
    if (!presenter) return;
    let t = window.setTimeout(() => setIdle(true), 2000);
    const move = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), 2000); };
    window.addEventListener("mousemove", move);
    return () => { window.removeEventListener("mousemove", move); window.clearTimeout(t); setIdle(false); };
  }, [presenter]);

  const cls = ["deck", overview && "overview", presenter && "presenter", contrast && "debug-contrast", idle && "idle"].filter(Boolean).join(" ");
  return (
    <div className={cls}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { const x0 = touch.current; touch.current = null; if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) { if (dx < 0) next(); else prev(); } }}>
      <div className="viewport">
        <div className="stage">
          {slides.map((s, k) => (
            <div key={k} className={`frame${k === i ? " on" : ""}`} aria-hidden={!overview && k !== i} style={{ ["--col" as string]: k % 4, ["--row" as string]: Math.floor(k / 4) }}
              onClick={overview ? () => { setI(k); setStep(0); setOverview(false); } : undefined}>
              <FrameStepContext.Provider value={{ step: k === i && !overview ? step : null, set: setStep }}>{s}</FrameStepContext.Provider>
            </div>
          ))}
        </div>
      </div>
      <nav className="deck-ui" aria-label="Slides">
        <a className="home" href="/">semalam.edycu.dev</a>
        <button type="button" onClick={prev} disabled={i === 0 && step === 0} aria-label="Previous slide or step">←</button>
        <span className="count" aria-live="polite">{String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
        <button type="button" onClick={next} disabled={i === n - 1 && step >= last(i)} aria-label="Next slide or step">→</button>
        <button type="button" className="keys" onClick={() => setOverview((o) => !o)} aria-pressed={overview} title="Esc">All slides</button>
        <button type="button" className="keys" onClick={() => setPresenter((p) => !p)} aria-pressed={presenter} title="P">Notes</button>
      </nav>
      {presenter && <aside className="notes-panel" aria-label="Speaker notes"><span className="data">{String(i + 1).padStart(2, "0")}</span><p>{notes[i]}</p></aside>}
    </div>
  );
}
