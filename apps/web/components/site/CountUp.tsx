"use client";
import { useEffect, useRef, useState } from "react";

const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
/** Server HTML prints the real value; the count-up only runs when the number starts below the fold, and the DOM text is
 * the real value until then (screen readers, print and full-page captures never see a 0 that is not true). */
export default function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(value);
  const [armed, setArmed] = useState(false); // armed = the real value, invisible until it counts up (never a false 0)
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    let raf = 0;
    setArmed(true);
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      setArmed(false);
      const t0 = performance.now();
      const step = (n: number) => { const k = Math.min(1, (n - t0) / 1200); setV(value * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return <span ref={ref} className={armed ? "cu armed" : "cu"} suppressHydrationWarning>{fmt(v, decimals)}</span>;
}
