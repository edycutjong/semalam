"use client";
import { useEffect, useRef, useState } from "react";

// Types out a RECORDED run (never a re-typed one). Server HTML shows every line, so no-JS, print and screenshots see
// the whole run; the typing only arms when the card starts below the fold.
function Line({ text }: { text: string }) {
  const m = /^(\S+(?: \S+)?)(\s{2,})(.*)$/.exec(text);
  const rest = (m ? m[3] : text).split(/(✓ MATCH|✓|✗ MISMATCH)/);
  return (
    <>
      {m && <><span className="k">{m[1]}</span>{m[2]}</>}
      {rest.map((p, i) => (p === "✓ MATCH" ? <b key={i} className="ok match">{p}</b> : p === "✓" ? <span key={i} className="ok">{p}</span> : p ? <span key={i}>{p}</span> : null))}
    </>
  );
}

export default function Terminal({ title, cmd, lines, foot }: { title: string; cmd: string; lines: string[]; foot: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(-1); // -1 = everything (server render)
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return;
    const timers: number[] = [];
    setShown(0); setTyped("");
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      for (let i = 1; i <= cmd.length; i++) timers.push(window.setTimeout(() => setTyped(cmd.slice(0, i)), 18 * i));
      const t0 = 18 * cmd.length + 350;
      lines.forEach((_, i) => timers.push(window.setTimeout(() => setShown(i + 1), t0 + 230 * i)));
      timers.push(window.setTimeout(() => { setShown(-1); setTyped(null); }, t0 + 230 * lines.length + 60));
    }, { threshold: 0.35 });
    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); };
  }, [cmd, lines]);
  const typing = typed !== null;
  return (
    <div className="term" ref={ref}>
      <div className="term-bar"><i /><i /><i /><span>{title}</span></div>
      <pre className="term-body" aria-label={`Recorded terminal run: ${cmd}`}>
        <span className="pr">$ </span>{typing ? typed : cmd}{typing && shown === 0 ? <span className="cur" aria-hidden /> : null}
        {"\n"}
        {lines.map((l, i) => <span key={i} className={`ln${shown === -1 || i < shown ? "" : " off"}`}><Line text={l} />{"\n"}</span>)}
      </pre>
      <div className="term-foot">{foot}</div>
    </div>
  );
}
