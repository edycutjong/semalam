"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { readback, type Policy } from "@semalam/policy";
import { MAX_ORDERS, orderLength } from "@semalam/policy/compile";
import Ticket from "./Ticket";
import Countdown from "./Countdown";
import Builder from "./Builder";
import { commitSealed, readBack, sealPolicy, status, type Entered, type StatusJson } from "@/lib/commit";
import { localSigner, walletSigner, restoreSigner, injected, type Signer } from "@/lib/wallet";
import { txUrl } from "@/lib/config";
import HashLine from "./HashLine";
import { exportLocalKey } from "@/lib/wallet";
import { copyText, lsGet, lsSet } from "@/lib/ls";
import { sfx } from "@/lib/sound";
import type { Rewrite } from "@/lib/rewrite";
import Ritual from "./Ritual";

const REWRITE = "semalam.rewrite"; // = REWRITE_KEY in lib/rewrite.ts (not imported: that module carries the sim)

type Compiled = { kind: "policy"; policy: Policy; readback: string[]; model: string } | { kind: "refusal"; reason: string } | { kind: "paused"; reason: string } | { kind: "invalid"; reason: string };
type Phase = "write" | "build" | "readback" | "identity" | "sealing" | "sealed";

// One-tap starters for the orders box; each stays inside PolicySchema v1 (<= 3 rules, known conditions).
const EXAMPLES: { label: string; text: string }[] = [
  { label: "Good neighbour", text: "Share with neighbours who shared with me, gather otherwise. If someone steals from me, steal back for a few turns — but never steal from the leader." },
  { label: "Quiet hoarder", text: "Keep my head down and gather all night. Guard whenever a known thief is next to me. Never share, never steal." },
  { label: "Night raider", text: "Open by stealing. Steal from anyone richer than me, gather from everyone else. If I end up leading, switch to guarding my pile." },
  { label: "Copycat", text: "Copy whatever the leader is doing. If my partner stole from me, guard. If I fall behind, steal from anyone richer." },
  { label: "Grudge keeper", text: "Share with everyone, all night. Anyone who steals from me, I steal back from them for the rest of the night. Never forgive." },
];

/** the free scrimmage runs the round's FIRST sealed orders; only those get the "free" label */
function lsFirstHash(round: number): string | null {
  try { return (JSON.parse(localStorage.getItem(`semalam.first.${round}`) ?? "null")?.policyHash ?? null)?.toLowerCase() ?? null; } catch { return null; }
}

export default function Tonight() {
  const [st, setSt] = useState<StatusJson | null>(null);
  const [stErr, setStErr] = useState<string | null>(null);
  const [orders, setOrders] = useState("");
  const [phase, setPhase] = useState<Phase>("write");
  const [busy, setBusy] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  useEffect(() => setHasWallet(Boolean(injected())), []);
  const [res, setRes] = useState<Compiled | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [viaLLM, setViaLLM] = useState(false);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [entered, setEntered] = useState<(Entered & { policyHash: string; round: number }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [hint, setHint] = useState<Rewrite | null>(null);
  useEffect(() => { // "rewrite from here" on a breakfast page: last night's orders + what the decisive turn paid
    const r = lsGet<Rewrite | null>(REWRITE, null);
    if (!r?.policy || Date.now() - r.at > 36 * 3600_000) return;
    setHint(r);
    if (r.text && orderLength(r.text) <= MAX_ORDERS) setOrders(r.text);
  }, []);
  const dropHint = () => { setHint(null); try { localStorage.removeItem(REWRITE); } catch { /* blocked */ } };

  const refresh = useCallback(async (a?: string) => { try { setSt(await status(a as `0x${string}` | undefined)); setStErr(null); } catch (e) { setStErr((e as Error).message); } }, []);
  useEffect(() => { const s = restoreSigner(); setSigner(s); refresh(s?.address); }, [refresh]);

  // chain clock: skew measured at each status fetch; a rollover (or a 409 from the relay) refetches the round
  const [nowC, setNowC] = useState(0);
  const lastTry = useRef(0);
  useEffect(() => {
    if (!st) return;
    const skew = st.chainNow - Math.floor(Date.now() / 1000);
    const tick = () => setNowC(Math.floor(Date.now() / 1000) + skew);
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [st]);
  useEffect(() => {
    // after the close, ask again every 5 s until the chain reports a newer round (a failed or stale answer never sticks)
    if (st && nowC >= st.closeTime && nowC - lastTry.current >= 5) { lastTry.current = nowC; refresh(signer?.address); }
  }, [nowC, st, refresh, signer]);

  const len = orderLength(orders);
  const rb = policy ? readback(policy) : [];

  async function compile() {
    setBusy(true); setErr(null); setRes(null); setPolicy(null); setViaLLM(false);
    try {
      const r = await fetch("/api/compile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orders }) });
      const j = (await r.json()) as Compiled;
      setRes(j);
      if (j.kind === "policy") { setPolicy(j.policy); setViaLLM(true); setPhase("readback"); sfx.rustle(); }
      else if (j.kind === "refusal") setPhase("readback");
    } catch { setRes({ kind: "paused", reason: "compiler paused — use the builder" }); }
    setBusy(false);
  }

  async function seal(s: Signer) {
    if (!policy || !st) return;
    setPhase("sealing"); setErr(null);
    try {
      // the drand round is derived from GENESIS: if this app's copy disagrees with the contract, every seal would void
      if (st.genesisOk === false) throw new Error("sealing paused — this app's round clock does not match the contract (operator fix needed); your orders were not sent");
      setStep("sealing your orders to the drand beacon…");
      const sealed = await sealPolicy(policy, st.round);
      setStep("reading your account…");
      const fresh = await status(s.address);
      setStep(s.mode === "local" ? "signing and sending through the relay…" : "approve the signature in your wallet…");
      if (fresh.round !== st.round) { setSt(fresh); throw new Error(`round ${st.round} closed while you were sealing — the new round ${fresh.round} is open; press Seal again`); }
      const e = await commitSealed(s, st.round, sealed, BigInt(fresh.nonce ?? "0"), fresh.chainNow, fresh.relay);
      setStep("waiting for the chain to show your commit…");
      const hit = await readBack(s.address, sealed.policyHash, fresh.commits.length);
      if (!hit) throw new Error("the commit was sent but the chain does not show it yet — check again in a minute; nothing was lost");
      const done = { ...e, tx: hit.tx, url: e.url || txUrl(hit.tx), policyHash: sealed.policyHash, round: st.round };
      setEntered(done);
      lsSet(`semalam.committed.${st.round}`, { policy, policyHash: sealed.policyHash, tx: hit.tx, account: s.address, at: Date.now() });
      if (!localStorage.getItem(`semalam.first.${st.round}`)) lsSet(`semalam.first.${st.round}`, { policy, policyHash: sealed.policyHash, account: s.address });
      lsSet("semalam.draft", policy);
      setPhase("sealed"); sfx.stamp(0.16); dropHint(); refresh(s.address);
    } catch (e) {
      setErr((e as Error).message); setPhase("identity");
      if (/not open|409|closed/.test((e as Error).message)) refresh(s.address);
    }
  }
  async function pickLocal() { const s = localSigner(true)!; setSigner(s); await seal(s); }
  async function pickWallet() { try { const s = await walletSigner(); setSigner(s); await seal(s); } catch (e) { setErr((e as Error).message); } }

  const open = Boolean(st && st.round > 0 && nowC > 0 && nowC < st.closeTime);
  const wasOpen = useRef(false);
  useEffect(() => { if (wasOpen.current && !open) sfx.bell(); wasOpen.current = open; }, [open]); // the market closes: one bell
  function nightlyReminder() { // opt-in: the viewer's own calendar reminds them at 22:30 WIB (15:30 UTC); nothing is sent anywhere
    const at = new Date(); at.setUTCHours(15, 30, 0, 0); if (at.getTime() < Date.now()) at.setUTCDate(at.getUTCDate() + 1);
    const z = (x: Date) => `${x.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SEMALAM//nightly//EN", "BEGIN:VEVENT", `UID:semalam-nightly@${location.host}`, `DTSTAMP:${z(new Date())}`,
      `DTSTART:${z(at)}`, "DURATION:PT15M", "RRULE:FREQ=DAILY", "SUMMARY:SEMALAM — write tonight's orders (closes 00:00 WIB)", `URL:${location.origin}/play`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const u = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })), a = document.createElement("a");
    a.href = u; a.download = "semalam-nightly.ics"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  }

  return (
    <div className="grid2">
      <section aria-label="Write your orders">
        <div className="eyebrow">{st ? `Round ${st.round}` : "Tonight"} {st?.testnet && <span className="badge test">testnet · {st.wifLabel}</span>}</div>
        <h1>Tonight</h1>
        <p className="lead">Write your orders before bed. Seal them and watch them play a practice night right away, free, against last night&apos;s top 30 (until players arrive, the 30 house agents). At 00:00 WIB your agent plays the real night; replay it at breakfast.</p>
        {st && <p className="data">closes in <Countdown round={st.round} closeTime={st.closeTime} chainNow={st.chainNow} serverNow={st.serverNow} /> ({new Date(st.closeTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} your time) · <span className={`badge ${st.relay ? "relay" : ""}`}>{st.relay ? "gasless · relay" : st.relayState === "spent-tonight" ? "relay spent for tonight — use your own wallet" : "relay empty — use your own wallet"}</span></p>}
        {st && <p style={{ margin: "-6px 0 14px" }}><button type="button" className="quiet chip" onClick={nightlyReminder}>Nightly reminder (.ics)</button></p>}
        <p className="muted" style={{ fontSize: 15, marginTop: 0 }}>Sealing signs one commit for tonight&apos;s round. It approves no token and moves no $WIF.</p>
        {stErr && <p className="note warn" role="alert">{stErr}</p>}
        {signer && st && st.round > 0 && <Ritual account={signer.address} round={st.round} sealedTonight={st.commits.length > 0} />}
        {hint && phase !== "sealed" && (
          <div className="card rewrite" role="note" aria-label="Rewriting from last night">
            <div className="eyebrow">Rewriting from round {hint.round} · turn {hint.t}</div>
            <p style={{ margin: "0 0 6px" }}>{hint.why}</p>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 16 }}>{hint.hint} {orders === hint.text ? "Last night's orders are in the box below, ready to edit." : ""}</p>
            <div className="row">
              <button type="button" onClick={() => { setPolicy(hint.policy); setViaLLM(false); setRes(null); setPhase("build"); }} disabled={phase === "sealing"}>Open last night's orders in the builder</button>
              <button type="button" className="quiet" onClick={dropHint}>Dismiss</button>
            </div>
          </div>
        )}
        {phase === "build" ? (
          <>
            <Builder onPolicy={(p) => { setPolicy(p); setViaLLM(false); setRes(null); setPhase("readback"); sfx.rustle(); }} initial={policy ?? undefined} />
            <p><button type="button" className="quiet" onClick={() => setPhase("write")}>← back to writing</button></p>
          </>
        ) : (
          <>
            <label htmlFor="orders">Your orders — plain language, up to {MAX_ORDERS} characters</label>
            <div className="row examples" role="group" aria-label="Example orders">
              <span className="muted" style={{ fontSize: 14 }}>Try one:</span>
              {EXAMPLES.map((x) => (
                <button key={x.label} type="button" className={`chip ${orders === x.text ? "on" : ""}`} aria-pressed={orders === x.text}
                  onClick={() => { setOrders(x.text); setRes(null); sfx.click(); }} disabled={phase === "sealing" || phase === "sealed"}>{x.label}</button>
              ))}
            </div>
            <textarea id="orders" value={orders} onChange={(e) => setOrders(e.target.value)} disabled={phase === "sealing" || phase === "sealed"}
              placeholder="Share with neighbours who shared with me, gather otherwise. If someone steals from me, steal back for a few turns — but never steal from the leader." />
            <div className="row" style={{ justifyContent: "space-between", margin: "6px 0 14px" }}>
              <span className={`counter ${len > MAX_ORDERS ? "over" : ""}`}>{len}/{MAX_ORDERS}</span>
              <span className="muted" style={{ fontSize: 15 }}>The AI path lets the operator read your words. The in-browser builder sends them nowhere.</span>
            </div>
            <div className="row">
              <button type="button" className="primary" onClick={compile} disabled={busy || !orders.trim() || len > MAX_ORDERS || !open || phase === "sealing" || phase === "sealed"}>{busy ? "Compiling…" : "Compile"}</button>
              <button type="button" className="quiet" onClick={() => setPhase("build")} disabled={phase === "sealing" || phase === "sealed"}>Use the builder</button>
            </div>
            {!open && st && <p className="note">{st.round === 0 ? "The market has not opened yet." : "This round has closed — the next one opens at the stroke of midnight WIB."}</p>}
            {res?.kind === "paused" && <p className="note warn" role="status">{res.reason}. The builder works without it.</p>}
            {res?.kind === "invalid" && <p className="note warn" role="alert">{res.reason}</p>}
          </>
        )}
      </section>

      <section aria-label="Your stall ticket" aria-live="polite">
        {phase === "write" && !res && (
          <Ticket state="draft" title="Your stall ticket" lines={["Your agent will:", "- (compile your orders to see exactly what it will do)"]} stamp="DRAFT" />
        )}
        {res?.kind === "refusal" && phase === "readback" && (
          <Ticket state="refused" title="Refused" lines={["The compiler could not use these orders:", `- ${res.reason}`]} stamp="REFUSED">
            <p style={{ margin: "10px 0 0", fontSize: 16 }}>Orders can only describe how your stall plays — gather, guard, share, steal, and when. Try again, or use the builder.</p>
          </Ticket>
        )}
        {policy && (phase === "readback" || phase === "identity" || phase === "sealing") && (
          <>
            <Ticket state="draft" title={policy.name} lines={rb} stamp={phase === "sealing" ? "SEALING…" : "DRAFT"} />
            {viaLLM && <p className="note">Compiled by a language model and checked against a fixed schema (≤ 6 fields, ≤ 3 rules). The operator can see these words.</p>}
            {phase === "readback" && (
              <div className="row">
                <button type="button" className="primary" onClick={() => { if (st && !st.relay && !signer) setSigner(localSigner(true)); setPhase("identity"); }} disabled={!open}>That's what I meant → Seal</button>
                <button type="button" className="quiet" onClick={() => { if (viaLLM) { setPolicy(null); setRes(null); setViaLLM(false); } setPhase(viaLLM ? "write" : "build"); }}>Edit</button>
              </div>
            )}
          </>
        )}
        {(phase === "identity" || (phase === "sealing" && !entered)) && policy && (
          <div className="card" style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 20 }}>Who is playing?</h3>
            <p className="muted" style={{ marginTop: 0 }}>One identity commits and pays. Sealing locks your orders to a public beacon, so nobody can read them from the chain before midnight.{viaLLM ? " The words you typed went through the AI compiler, which the operator can see; orders made with the in-browser builder never leave this browser." : " Your words never left this browser."} {st?.relay ? `Sealing signs one typed message, “SEMALAM Orders · Commit”: your address, round ${st.round}, the policy and sealed-blob hashes, a nonce and a 15-minute deadline.` : "Sealing sends one transaction, Orders.commit with the round, the policy hash and the sealed blob."} It approves no token and moves no $WIF.</p>
            {signer?.mode === "local" ? <p className="data" style={{ wordBreak: "break-all" }}>your key stays in this browser · {st?.relay ? <HashLine value={signer.address} short /> : <HashLine value={signer.address} />}</p> : null}
            <div className="row">
              <button type="button" className="primary" onClick={pickLocal} disabled={phase === "sealing"}>Play without a wallet</button>
              <button type="button" onClick={pickWallet} disabled={phase === "sealing" || !hasWallet}>Connect wallet</button>
            </div>
            <p className="muted" style={{ fontSize: 15 }}>{st?.relay ? "Without a wallet we make a key in this browser; the relay pays the gas, so it costs you nothing." : `The relay is empty right now: a browser key needs a little ${st?.testnet ? "testnet " : ""}ETH to commit itself — send some to the address above, then press Seal again, or connect a wallet that has ETH.`} Connect a wallet to keep one identity across devices.</p>
            {signer?.mode === "local" && !st?.relay && <button type="button" className="quiet" onClick={() => { const k = exportLocalKey(); if (k) copyText(k); }}>Copy private key</button>}
            {phase === "sealing" && <p className="data" role="status">{step}</p>}
            {err && <p className="note warn" role="alert">{err}</p>}
          </div>
        )}
        {phase === "sealed" && entered && policy && st && (
          <>
            <Ticket state="sealed" fresh title={policy.name} lines={rb} stamp={`SEALED · ROUND ${entered.round}`} hash={entered.policyHash} tx={entered.tx} txUrl={entered.url} />
            {signer?.mode === "local" && (
              <details className="note" style={{ marginBottom: 12 }}>
                <summary style={{ minHeight: 44, cursor: "pointer", display: "flex", alignItems: "center" }}>Keep your agent — your play address and key</summary>
                <p className="data" style={{ wordBreak: "break-all" }}>{signer.address}</p>
                <p style={{ margin: "6px 0" }}>Clearing this browser's storage loses the key. To play from another device, copy it somewhere safe (it controls this address — nothing else; never share it).</p>
                <button type="button" className="quiet" onClick={() => { const k = exportLocalKey(); if (k) copyText(k); }}>Copy private key</button>
              </details>
            )}
            <p className="note">Entered. The chain shows your commit ({entered.mode === "relay" ? "gasless, through the relay" : "sent from your wallet"}). You can re-commit until the close; only your latest counts.</p>
            <div className="row">
              <Link className="btn primary" href="/scrimmage">{lsFirstHash(entered.round) === entered.policyHash.toLowerCase() ? "Watch it play now · free" : "Practise this draft"}</Link>
              <Link className="btn" href={`/round/${entered.round}`}>Where breakfast will be</Link>
              <button type="button" className="quiet" onClick={() => { setPhase("write"); setEntered(null); setRes(null); }}>Rewrite</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
