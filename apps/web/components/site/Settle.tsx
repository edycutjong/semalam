"use client";
import { useEffect } from "react";

/** Once the opening sequence has played, drop its animations: screenshots, print and re-renders then see the settled night. */
export default function Settle({ target, ms }: { target: string; ms: number }) {
  useEffect(() => {
    const el = document.getElementById(target);
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.classList.add("settled"); return; }
    const t = window.setTimeout(() => el.classList.add("settled"), ms);
    return () => window.clearTimeout(t);
  }, [target, ms]);
  return null;
}
