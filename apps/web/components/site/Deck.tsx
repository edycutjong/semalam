"use client";
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* SEMALAM pitch deck controller.
   Keys: → / Space / PageDown next · ← / PageUp back · Home / End · Esc = overview grid · P = presenter (speaker notes,
   cursor hides after 2 s) · C = contrast check (outlines every text box). Swipe on touch screens. #3 in the URL opens
   slide 3. Print (Cmd/Ctrl+P → Save as PDF) gives one slide per 16 × 9 in page. The stage is a fixed 1920 × 1080
   canvas scaled to the window from documentElement.clientWidth/Height (a phone's innerWidth lies when zoomed out). */
export default function Deck({ children, notes }: { children: ReactNode; notes: string[] }) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const [i, setI] = useState(0);
  const [overview, setOverview] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [contrast, setContrast] = useState(false);
  const [idle, setIdle] = useState(false);
  const touch = useRef<number | null>(null);
  const go = useCallback((k: number) => setI(() => Math.max(0, Math.min(n - 1, k))), [n]);

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
      if (k === "ArrowRight" || k === " " || k === "PageDown") { e.preventDefault(); go(i + 1); }
      else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); go(i - 1); }
      else if (k === "Home") go(0);
      else if (k === "End") go(n - 1);
      else if (k === "Escape") setOverview((o) => !o);
      else if (k === "p" || k === "P") setPresenter((p) => !p);
      else if (k === "c" || k === "C") setContrast((c) => !c);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [i, n, go]);

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
      onTouchEnd={(e) => { const x0 = touch.current; touch.current = null; if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1)); }}>
      <div className="viewport">
        <div className="stage">
          {slides.map((s, k) => (
            <div key={k} className={`frame${k === i ? " on" : ""}`} aria-hidden={!overview && k !== i} style={{ ["--col" as string]: k % 4, ["--row" as string]: Math.floor(k / 4) }}
              onClick={overview ? () => { setI(k); setOverview(false); } : undefined}>
              {s}
            </div>
          ))}
        </div>
      </div>
      <nav className="deck-ui" aria-label="Slides">
        <a className="home" href="/">semalam.edycu.dev</a>
        <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">←</button>
        <span className="count" aria-live="polite">{String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
        <button type="button" onClick={() => go(i + 1)} disabled={i === n - 1} aria-label="Next slide">→</button>
        <button type="button" className="keys" onClick={() => setOverview((o) => !o)} aria-pressed={overview} title="Esc">All slides</button>
        <button type="button" className="keys" onClick={() => setPresenter((p) => !p)} aria-pressed={presenter} title="P">Notes</button>
      </nav>
      {presenter && <aside className="notes-panel" aria-label="Speaker notes"><span className="data">{String(i + 1).padStart(2, "0")}</span><p>{notes[i]}</p></aside>}
    </div>
  );
}
