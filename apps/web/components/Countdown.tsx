"use client";
import { useEffect, useState } from "react";
import { countdown } from "@/lib/clock";

/** Counts down to closeTime on the CHAIN clock (offset measured once from /api/status), not the visitor's clock. */
export default function Countdown({ round, closeTime, chainNow, serverNow }: { round: number; closeTime: number; chainNow: number; serverNow: number }) {
  const [t, setT] = useState<string | null>("--:--:--");
  useEffect(() => {
    const skew = chainNow - Math.floor(Date.now() / 1000); // chain time minus this browser's clock
    const tick = () => setT(countdown(Math.floor(Date.now() / 1000) + skew, round, closeTime - round * 86400));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [round, closeTime, chainNow, serverNow]);
  return t === null ? <span className="data">closed — settling</span> : <span className="data" aria-live="off" suppressHydrationWarning>{t}</span>;
}
