"use client";
import { useEffect, useState } from "react";
import { MAX_ORDERS, orderLength } from "@semalam/policy/compile";
import Ticket from "./Ticket";
import type { Policy } from "@semalam/policy";

type Compiled = { kind: "policy"; policy: Policy; readback: string[]; model: string } | { kind: "refusal"; reason: string } | { kind: "paused"; reason: string } | { kind: "invalid"; reason: string };
type Entry = { at: string; orders: string; outcome: "policy" | "refusal"; readback: string[]; reason?: string; meant: "yes" | "no"; note: string };
const LS_NAME = "semalam.fidelity.v1";

export default function Fidelity() {
  const [orders, setOrders] = useState("");
  const [res, setRes] = useState<Compiled | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [log, setLog] = useState<Entry[]>([]);
  useEffect(() => { try { setLog(JSON.parse(localStorage.getItem(LS_NAME) ?? "[]")); } catch { setLog([]); } }, []);

  async function compile() {
    setBusy(true); setRes(null); setNote("");
    try { setRes(await (await fetch("/api/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orders }) })).json()); }
    catch { setRes({ kind: "paused", reason: "compiler paused — try again in a minute" }); }
    setBusy(false);
  }
  function answer(meant: "yes" | "no") {
    if (!res || (res.kind !== "policy" && res.kind !== "refusal")) return;
    const e: Entry = { at: new Date().toISOString(), orders, outcome: res.kind, readback: res.kind === "policy" ? res.readback : [], reason: res.kind === "refusal" ? res.reason : undefined, meant, note: note.trim() };
    const next = [...log, e]; setLog(next); localStorage.setItem(LS_NAME, JSON.stringify(next));
    setRes(null); setOrders(""); setNote("");
  }
  const yes = log.filter((l) => l.meant === "yes").length;
  function download() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), total: log.length, yes, entries: log }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "semalam-fidelity-results.json"; a.click(); URL.revokeObjectURL(a.href);
  }
  const answerable = res && (res.kind === "policy" || res.kind === "refusal");
  return (
    <div className="grid2">
      <section>
        <div className="eyebrow">Fidelity check</div>
        <h1>Did it hear you?</h1>
        <p className="lead">Write orders the way you would. We read back what the agent will do. Tell us if that is what you meant — "no" is the useful answer.</p>
        <label htmlFor="fo">Your orders</label>
        <textarea id="fo" value={orders} onChange={(e) => setOrders(e.target.value)} placeholder="Share with anyone who shares with me. If a neighbour robs me, rob them back for a while." />
        <div className="row" style={{ margin: "6px 0 14px", justifyContent: "space-between" }}>
          <span className={`counter ${orderLength(orders) > MAX_ORDERS ? "over" : ""}`}>{orderLength(orders)}/{MAX_ORDERS}</span>
        </div>
        <button type="button" className="primary" onClick={compile} disabled={busy || !orders.trim() || orderLength(orders) > MAX_ORDERS}>{busy ? "Reading…" : "Read it back"}</button>
        <p className="note">Nothing is stored on our side. Your answers stay in this browser until you download the file and send it to whoever asked you.</p>
      </section>
      <section aria-live="polite">
        {res?.kind === "policy" && <Ticket state="draft" title={res.policy.name} lines={res.readback} stamp="READBACK" />}
        {res?.kind === "refusal" && <Ticket state="refused" title="Refused" lines={["The compiler declined:", `- ${res.reason}`]} stamp="REFUSED" />}
        {(res?.kind === "paused" || res?.kind === "invalid") && <p className="note warn" role="alert">{res.reason}</p>}
        {answerable && (
          <div className="card">
            <h3 style={{ fontSize: 20 }}>{res.kind === "policy" ? "Is that what you meant?" : "Was refusing right?"}</h3>
            <label htmlFor="note">What was off? (optional)</label>
            <input id="note" type="text" value={note} onChange={(e) => setNote(e.target.value)} style={{ fontSize: 16 }} />
            <div className="row" style={{ marginTop: 14 }}>
              <button type="button" className="primary" onClick={() => answer("yes")}>Yes, that's what I meant</button>
              <button type="button" onClick={() => answer("no")}>No</button>
            </div>
          </div>
        )}
        <div className="card" style={{ marginTop: 18 }}>
          <p className="data" style={{ margin: "0 0 10px" }}>{log.length} answered · {yes} yes · {log.length - yes} no</p>
          <button type="button" className="quiet" onClick={download} disabled={!log.length}>Download results.json</button>{" "}
          <button type="button" className="quiet" onClick={() => { localStorage.removeItem(LS_NAME); setLog([]); }} disabled={!log.length}>Clear</button>
        </div>
      </section>
    </div>
  );
}
