"use client";
import { useEffect, useState } from "react";
import Countdown from "@/components/Countdown";

type S = { round: number; closeTime: number; chainNow: number; serverNow: number };
/** Tonight's close on the chain clock. The page itself may be a minute old, so the clock asks /api/status before it ticks. */
export default function LiveClock({ round }: { round: number | null }) {
  const [s, setS] = useState<S | null>(null);
  useEffect(() => {
    fetch("/api/status", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (typeof j?.round === "number" && j.round > 0) setS({ round: j.round, closeTime: j.closeTime, chainNow: j.chainNow, serverNow: j.serverNow });
    }).catch(() => { /* the static line stays */ });
  }, []);
  if (!s) return <span className="clock">{round ? `round ${round} closes 00:00 WIB` : "closes 00:00 WIB"}</span>;
  return <span className="clock">round {s.round} closes in <Countdown round={s.round} closeTime={s.closeTime} chainNow={s.chainNow} serverNow={s.serverNow} /> · 00:00 WIB = {new Date(s.closeTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} your time</span>;
}
