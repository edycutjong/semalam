"use client";
// The no-LLM builder (P0b T10): 8 presets + a structured editor (≤ 3 rules), all client-side.
import { useState } from "react";
import { ACTIONS, CONDITIONS, PRESETS, Policy } from "@semalam/policy";

const COND_WORDS: Record<string, string> = {
  partner_stole_from_me: "my neighbour stole from me", partner_is_thief: "my neighbour is a known thief", partner_shared_with_me: "my neighbour shared with me",
  partner_richer: "my neighbour is richer", partner_poorer: "my neighbour is poorer", partner_is_leader: "my neighbour is in the top 10",
  i_am_leading: "I am in the top 10", i_am_behind: "I am in the bottom half", turn_after: "it is after turn…",
};
const GL: Record<string, string> = { GATHER: "▲", GUARD: "■", SHARE: "◆", STEAL: "✕", COPY_LEADER: "⧉" };
const Opt = ({ a }: { a: string }) => <option value={a}>{GL[a]} {a}</option>;
export default function Builder({ onPolicy, initial }: { onPolicy: (p: Policy) => void; initial?: Policy }) {
  const [p, setP] = useState<Policy>(initial ?? PRESETS[1]);
  const [err, setErr] = useState<string | null>(null);
  const upd = (patch: Partial<Policy>) => setP((q) => ({ ...q, ...patch }));
  const setRule = (i: number, patch: Partial<Policy["rules"][number]>) =>
    setP((q) => ({ ...q, rules: q.rules.map((r, k) => (k === i ? ({ ...r, ...patch } as Policy["rules"][number]) : r)) }));
  function submit() {
    const rules = p.rules.map((r) => (r.if === "turn_after" ? { ...r, n: r.n ?? 100 } : { if: r.if, not: r.not, then: r.then }));
    const parsed = Policy.safeParse({ ...p, rules: rules.map((r) => (r.not ? r : { ...r, not: undefined })) });
    if (!parsed.success) return setErr(parsed.error.issues.map((i) => i.message).join("; "));
    setErr(null); onPolicy(parsed.data);
  }
  return (
    <section className="card" aria-label="Order builder">
      <p className="muted" style={{ marginTop: 0 }}>No words needed — pick a starting point and adjust it. Nothing here leaves your browser until you seal.</p>
      <label htmlFor="preset">Start from</label>
      <select id="preset" value={PRESETS.find((x) => x.name === p.name)?.name ?? ""} onChange={(e) => { const x = PRESETS.find((y) => y.name === e.target.value); if (x) setP(x); }}>
        <option value="">custom</option>
        {PRESETS.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
      </select>
      <div className="row" style={{ marginTop: 14 }}>
        <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="opening">Turns 1–10</label>
          <select id="opening" value={p.opening} onChange={(e) => upd({ opening: e.target.value as Policy["opening"] })}>{ACTIONS.map((a) => <Opt key={a} a={a} />)}</select></div>
        <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="dflt">Otherwise</label>
          <select id="dflt" value={p.default} onChange={(e) => upd({ default: e.target.value as Policy["default"] })}>{ACTIONS.map((a) => <Opt key={a} a={a} />)}</select></div>
        <div style={{ flex: 1, minWidth: 140 }}><label htmlFor="grudge">Remember a theft for (turns)</label>
          <select id="grudge" value={p.grudge} onChange={(e) => upd({ grudge: Number(e.target.value) })}>{[0, 1, 2, 3, 5, 8, 10, 15, 20].map((n) => <option key={n}>{n}</option>)}</select></div>
      </div>
      <h3 style={{ marginTop: 18, fontSize: 20 }}>Rules — first match wins</h3>
      {p.rules.map((r, i) => (
        <div className="row" key={i} style={{ marginBottom: 10 }}>
          <span className="data">{i + 1}. if</span>
          <select aria-label={`Rule ${i + 1} condition`} value={r.if} onChange={(e) => setRule(i, { if: e.target.value as Policy["rules"][number]["if"], n: e.target.value === "turn_after" ? 100 : undefined })}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{COND_WORDS[c]}</option>)}
          </select>
          {r.if === "turn_after" && <input aria-label={`Rule ${i + 1} turn`} type="text" inputMode="numeric" style={{ width: 90, minHeight: 44, fontSize: 16 }} value={r.n ?? 100} onChange={(e) => setRule(i, { n: Math.max(1, Math.min(300, Number(e.target.value.replace(/\D/g, "")) || 1)) })} />}
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0, minHeight: 44 }}><input type="checkbox" checked={Boolean(r.not)} onChange={(e) => setRule(i, { not: e.target.checked })} style={{ width: 22, height: 22 }} /> not</label>
          <span className="data">→</span>
          <select aria-label={`Rule ${i + 1} action`} value={r.then} onChange={(e) => setRule(i, { then: e.target.value as Policy["rules"][number]["then"] })}>{ACTIONS.map((a) => <Opt key={a} a={a} />)}</select>
          <button type="button" className="quiet" aria-label={`Remove rule ${i + 1}`} onClick={() => setP((q) => ({ ...q, rules: q.rules.filter((_, k) => k !== i) }))}>remove</button>
        </div>
      ))}
      {p.rules.length < 3 && <button type="button" className="quiet" onClick={() => setP((q) => ({ ...q, rules: [...q.rules, { if: "partner_stole_from_me", then: "STEAL" }], grudge: Math.max(1, q.grudge) }))}>+ add a rule</button>}
      {err && <p className="note warn" role="alert">{err}</p>}
      <div className="row" style={{ marginTop: 18 }}><button type="button" className="primary" onClick={submit}>Read it back</button></div>
    </section>
  );
}
