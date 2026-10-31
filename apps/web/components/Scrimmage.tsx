"use client";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { readback, PRESETS, type Policy } from "@semalam/policy";
import Builder from "./Builder";
import Ticket from "./Ticket";
import ReplayPlayer from "./ReplayPlayer";
import HashLine from "./HashLine";
import { draftHash, freeSeed, paidSeed, scrimmage, type ScrimResult } from "@/lib/scrim";
import type { Opponent } from "@/lib/artifact";
import { ERC20_ABI, SCRIMMAGE_ABI } from "@/lib/abi";
import { CHAIN, DEP, IS_TESTNET, SCRIMMAGE, WIF, WIF_LABEL, txUrl } from "@/lib/config";
import { publicRpc, restoreSigner, walletSigner, localSigner, injected, type Signer } from "@/lib/wallet";
import { status, type StatusJson } from "@/lib/commit";
import { lsGet, lsSet } from "@/lib/ls";

const PRICE = 200n * 10n ** 18n;
const PAID_STORE = "semalam.paid.v1";
/** src = the settled night whose top 30 was the field when the run was made (null = the house set) — a re-run uses the SAME field. */
type PaidRun = { tx: Hex; round: number; account: Address; policy: Policy; src: number | null };
const loadPaid = (): PaidRun[] => lsGet<PaidRun[]>(PAID_STORE, []);
type Opp = { source: { round: number } | null; opponents: Opponent[]; mix: { house: number; players: number }; note?: string };

export default function Scrimmage() {
  const [st, setSt] = useState<StatusJson | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [opp, setOpp] = useState<Opp | null>(null);
  const [draft, setDraft] = useState<Policy>(PRESETS[2]);
  const [editing, setEditing] = useState(false);
  const [res, setRes] = useState<{ kind: "free" | "paid"; r: ScrimResult; tx?: string; policy: Policy; account: Address } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  useEffect(() => setHasWallet(Boolean(injected())), []);
  const [bal, setBal] = useState<bigint | null>(null);
  const [tick, setTick] = useState(0);
  const [paidRuns, setPaidRuns] = useState<PaidRun[]>([]);
  const [restoreTx, setRestoreTx] = useState("");
  useEffect(() => setPaidRuns(loadPaid()), []);

  const load = useCallback(async () => {
    const s = restoreSigner(); setSigner(s);
    try {
      const x = await status(s?.address); setSt(x);
      setOpp(await (await fetch(`/api/opponents/${x.round}`)).json());
    } catch (e) { setErr((e as Error).message); }
    const d = lsGet<Policy | null>("semalam.draft", null); if (d) setDraft(d);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!signer) return;
    publicRpc().readContract({ address: WIF, abi: ERC20_ABI, functionName: "balanceOf", args: [signer.address] }).then(setBal).catch(() => setBal(null));
  }, [signer, res, tick]);

  const first = st ? lsGet<{ policy: Policy; policyHash: Hex; account: Address } | null>(`semalam.first.${st.round}`, null) : null;
  const firstOnChain = st?.commits[0];
  const sameAccount = Boolean(first && signer && first.account.toLowerCase() === signer.address.toLowerCase());
  const intact = Boolean(first && draftHash(first.policy).toLowerCase() === first.policyHash.toLowerCase()); // the stored policy is still the one that was sealed
  const freeOk = Boolean(sameAccount && intact && firstOnChain && firstOnChain.policyHash.toLowerCase() === first!.policyHash.toLowerCase());

  function runFree() {
    if (!first || !st || !opp || !signer) return;
    // the free run is one deterministic result per (round, account): pin the field the first time, reuse it on every repeat
    const pinKey = `semalam.freesrc.${st.round}.${signer.address.toLowerCase()}`;
    const pinned = lsGet<{ src: number | null } | null>(pinKey, null);
    (async () => {
      const src = pinned ? pinned.src : (opp.source?.round ?? null);
      if (!pinned) lsSet(pinKey, { src });
      const field = pinned && src !== (opp.source?.round ?? null) ? ((await (await fetch(`/api/opponents/${st.round}?source=${src ?? "house"}`)).json()) as Opp) : opp;
      setRes({ kind: "free", account: signer.address, r: scrimmage({ id: signer.address, policy: first.policy }, field.opponents, freeSeed(st.round, signer.address, first.policyHash), st.round), policy: first.policy });
    })().catch((e) => setErr((e as Error).message));
  }
  async function connect(kind: "local" | "wallet") {
    try { const s = kind === "local" ? localSigner(true)! : await walletSigner(); setSigner(s); setSt(await status(s.address)); } catch (e) { setErr((e as Error).message); }
  }
  async function send(fn: "approve" | "pay" | "mint", args: unknown[], to: Address, abi: typeof ERC20_ABI | typeof SCRIMMAGE_ABI): Promise<Hex> {
    if (!signer) throw new Error("connect an account first");
    const opts = { chain: CHAIN, address: to, abi, functionName: fn, args } as never;
    const hash = signer.mode === "local"
      ? await createWalletClient({ account: signer.account, chain: CHAIN, transport: http(DEP.rpcs[0]) }).writeContract(opts)
      : await signer.client.writeContract({ ...(opts as object), account: signer.address } as never);
    const rc = await publicRpc().waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (rc.status !== "success") throw new Error(`${fn} reverted`);
    return hash;
  }
  async function pay() {
    if (!signer || !st || !opp) return;
    setBusy(true); setErr(null);
    try {
      const dh = draftHash(draft);
      const allowance = await publicRpc().readContract({ address: WIF, abi: ERC20_ABI, functionName: "allowance", args: [signer.address, SCRIMMAGE] });
      if (allowance < PRICE) { setMsg(`approve exactly 200 ${WIF_LABEL}…`); await send("approve", [SCRIMMAGE, PRICE], WIF, ERC20_ABI); }
      setMsg("paying 200 — 160 burned, 40 to compute…");
      const tx = await send("pay", [BigInt(st.round), PRICE, dh], SCRIMMAGE, SCRIMMAGE_ABI);
      const entry: PaidRun = { tx, round: st.round, account: signer.address, policy: draft, src: opp.source?.round ?? null };
      const all = [...loadPaid().filter((x) => x.tx !== tx), entry]; lsSet(PAID_STORE, all); setPaidRuns(all);
      await verifyAndRun(entry);
    } catch (e) { setErr((e as Error).message.split("\n")[0]); setMsg(null); }
    setBusy(false);
  }
  /** A13: the paid run exists only for a successful Paid receipt whose payer, round and draftHash match; same tx → same result. */
  async function verifyAndRun(e: PaidRun) {
    setMsg("checking the Paid receipt…");
    const r = await (await fetch(`/api/paid?tx=${e.tx}`)).json();
    if (r.error) throw new Error(r.error);
    if (r.payer.toLowerCase() !== e.account.toLowerCase() || r.round !== e.round || r.draftHash.toLowerCase() !== draftHash(e.policy).toLowerCase()) throw new Error("the Paid receipt does not match this draft");
    const field = (await (await fetch(`/api/opponents/${e.round}?source=${e.src ?? "house"}`)).json()) as Opp;
    if (!field.opponents) throw new Error("could not load the opponents this run was made against");
    setRes({ kind: "paid", account: e.account, tx: e.tx, policy: e.policy, r: scrimmage({ id: e.account, policy: e.policy }, field.opponents, paidSeed(e.tx), e.round) });
    setMsg(null);
  }
  async function restore(e: PaidRun) { setBusy(true); setErr(null); try { await verifyAndRun(e); } catch (x) { setErr((x as Error).message.split("\n")[0]); setMsg(null); } setBusy(false); }
  async function restoreByTx() {
    setBusy(true); setErr(null);
    try {
      const known = loadPaid().find((x) => x.tx.toLowerCase() === restoreTx.trim().toLowerCase() && (!signer || x.account.toLowerCase() === signer.address.toLowerCase()));
      if (!known) throw new Error("that payment is not saved in this browser — the draft that was paid for is needed to re-run it");
      await verifyAndRun(known);
    } catch (x) { setErr((x as Error).message.split("\n")[0]); setMsg(null); }
    setBusy(false);
  }
  async function mint() {
    setBusy(true); setErr(null);
    try { setMsg(`minting 1,000 ${WIF_LABEL}…`); await send("mint", [signer!.address, 1000n * 10n ** 18n], WIF, ERC20_ABI); setTick((t) => t + 1); } catch (e) { setErr((e as Error).message.split("\n")[0]); }
    setMsg(null); setBusy(false);
  }

  const enough = bal !== null && bal >= PRICE;
  return (
    <div className="grid2">
      <section aria-label="Scrimmage setup">
        <div className="eyebrow">Round {st?.round ?? "…"} {IS_TESTNET && <span className="badge test">testnet · {WIF_LABEL}</span>}</div>
        <h1>Scrimmage</h1>
        <p className="lead">Try a draft against yesterday's top 30 — instantly. It never counts toward your score.</p>
        <div className="card">
          <h3 style={{ fontSize: 20 }}>Opponents</h3>
          <p style={{ margin: 0 }}>{opp ? <>{opp.mix.house} house agents + {opp.mix.players} players{opp.source ? ` from round ${opp.source.round}` : ""}. {opp.note ?? ""}</> : "loading the field…"}</p>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 20 }}>Free: tonight's orders</h3>
          <p className="muted" style={{ marginTop: 0 }}>Your first committed policy of this round — one result, no payment.</p>
          <button type="button" onClick={runFree} disabled={!freeOk || !opp}>Run my first commit</button>
          {!freeOk && <p className="note">{!signer ? "Seal orders on Tonight first, then come back." : !first ? "No committed policy from this browser yet this round." : !sameAccount ? "The first commit saved here belongs to a different account than the one you are using now." : !intact ? "The saved first commit no longer matches what was sealed — it cannot be re-run." : "Waiting for the chain to show your first commit."}</p>}
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 20 }}>Any other draft</h3>
          <Ticket state="draft" title={draft.name} lines={readback(draft)} stamp="DRAFT" />
          {editing ? <Builder initial={draft} onPolicy={(p) => { setDraft(p); setEditing(false); }} /> : <button type="button" className="quiet" onClick={() => setEditing(true)}>Edit this draft</button>}
          <p style={{ marginTop: 16 }} className="data">Pay 200 {WIF_LABEL}: 160 burned, 40 to the compute wallet.</p>
          {!signer ? (
            <div className="row"><button type="button" onClick={() => connect("local")}>Use my browser key</button><button type="button" onClick={() => connect("wallet")} disabled={!hasWallet}>Connect wallet</button></div>
          ) : (
            <>
              <p className="data">paying as {signer.address.slice(0, 8)}…{signer.address.slice(-6)} · {bal === null ? "balance…" : `${Number(bal / 10n ** 18n)} ${WIF_LABEL}`}</p>
              {!enough && bal !== null && (
                <div className="note">
                  Add {WIF_LABEL} and a little ETH to the address above{IS_TESTNET ? <> — <a href="https://faucet.testnet.chain.robinhood.com">testnet ETH faucet</a>, then mint test tokens</> : ""}. This is the same address that plays; the session key never moves {WIF_LABEL}.
                  {IS_TESTNET && <div style={{ marginTop: 8 }}><button type="button" onClick={mint} disabled={busy}>Mint 1,000 {WIF_LABEL}</button></div>}
                </div>
              )}
              <button type="button" className="primary" onClick={pay} disabled={busy || !enough || !opp}>{busy ? "Working…" : `Pay 200 ${WIF_LABEL} (160 burned)`}</button>
            </>
          )}
          <p className="muted" style={{ fontSize: 15 }}>The CLI runs the same simulation free on your own machine; the fee buys the instant in-app run and replay.</p>
        </div>
        {paidRuns.filter((x) => st && signer && x.round === st.round && x.account.toLowerCase() === signer.address.toLowerCase()).length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 20 }}>Your paid runs this round</h3>
            {paidRuns.filter((x) => st && signer && x.round === st.round && x.account.toLowerCase() === signer.address.toLowerCase()).map((x) => (
              <div className="row" key={x.tx} style={{ marginBottom: 8 }}>
                <span className="data">{x.policy.name} · <a href={txUrl(x.tx)}>{x.tx.slice(0, 10)}…</a></span>
                <button type="button" className="quiet" onClick={() => restore(x)} disabled={busy}>Show again</button>
              </div>))}
            <label htmlFor="rtx" style={{ marginTop: 10 }}>Or paste a payment transaction hash saved in this browser</label>
            <div className="row"><input id="rtx" type="text" value={restoreTx} onChange={(e) => setRestoreTx(e.target.value)} style={{ flex: 1, minWidth: 200, fontSize: 14 }} /><button type="button" className="quiet" onClick={restoreByTx} disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(restoreTx.trim())}>Re-check</button></div>
          </div>
        )}
        {msg && <p className="data" role="status">{msg}</p>}
        {err && <p className="note warn" role="alert">{err}</p>}
      </section>
      <section aria-label="Scrimmage result">
        {res ? (
          <>
            <h2 style={{ fontSize: 28 }}>{res.kind === "free" ? "Your first commit" : "Your draft"}: {res.r.rank} of {res.r.of}</h2>
            <p className="data">{res.r.coins} coins · {res.r.steals} steals · {res.kind === "paid" && res.tx ? <a href={txUrl(res.tx)}>payment {res.tx.slice(0, 10)}…</a> : "free run"} · not counted toward the score</p>
            <p className="data">scrimmage hash <HashLine value={res.r.resultHash} short /></p>
            <ReplayPlayer replays={res.r.replays} mineId={res.account} houseIds={new Set(res.r.houseIds)} agents={res.r.of} />
          </>
        ) : <p className="muted">The replay of your scrimmage appears here.</p>}
      </section>
    </div>
  );
}
