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

const PRICE = 200n * 10n ** 18n;
type Opp = { source: { round: number } | null; opponents: Opponent[]; mix: { house: number; players: number }; note?: string };

export default function Scrimmage() {
  const [st, setSt] = useState<StatusJson | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [opp, setOpp] = useState<Opp | null>(null);
  const [draft, setDraft] = useState<Policy>(PRESETS[2]);
  const [editing, setEditing] = useState(false);
  const [res, setRes] = useState<{ kind: "free" | "paid"; r: ScrimResult; tx?: string; policy: Policy } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  useEffect(() => setHasWallet(Boolean(injected())), []);
  const [bal, setBal] = useState<bigint | null>(null);

  const load = useCallback(async () => {
    const s = restoreSigner(); setSigner(s);
    try {
      const x = await status(s?.address); setSt(x);
      setOpp(await (await fetch(`/api/opponents/${x.round}`)).json());
    } catch (e) { setErr((e as Error).message); }
    try { const d = JSON.parse(localStorage.getItem("semalam.draft") ?? "null"); if (d) setDraft(d); } catch { /* keep the default */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!signer) return;
    publicRpc().readContract({ address: WIF, abi: ERC20_ABI, functionName: "balanceOf", args: [signer.address] }).then(setBal).catch(() => setBal(null));
  }, [signer, res]);

  const first = st ? (JSON.parse(localStorage.getItem(`semalam.first.${st.round}`) ?? "null") as { policy: Policy; policyHash: Hex; account: Address } | null) : null;
  const firstOnChain = st?.commits[0];
  const freeOk = Boolean(first && signer && first.account.toLowerCase() === signer.address.toLowerCase() && firstOnChain && firstOnChain.policyHash.toLowerCase() === first.policyHash.toLowerCase());

  function runFree() {
    if (!first || !st || !opp || !signer) return;
    setRes({ kind: "free", r: scrimmage({ id: signer.address, policy: first.policy }, opp.opponents, freeSeed(st.round, signer.address, first.policyHash), st.round), policy: first.policy });
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
      setMsg("checking the Paid receipt…");
      const r = await (await fetch(`/api/paid?tx=${tx}`)).json();
      if (r.error || r.payer.toLowerCase() !== signer.address.toLowerCase() || r.round !== st.round || r.draftHash.toLowerCase() !== dh.toLowerCase()) throw new Error(r.error ?? "the Paid receipt does not match this draft");
      setRes({ kind: "paid", tx, policy: draft, r: scrimmage({ id: signer.address, policy: draft }, opp.opponents, paidSeed(tx), st.round) });
      setMsg(null);
    } catch (e) { setErr((e as Error).message.split("\n")[0]); setMsg(null); }
    setBusy(false);
  }
  async function mint() {
    setBusy(true); setErr(null);
    try { setMsg(`minting 1,000 ${WIF_LABEL}…`); await send("mint", [signer!.address, 1000n * 10n ** 18n], WIF, ERC20_ABI); setBal(null); } catch (e) { setErr((e as Error).message.split("\n")[0]); }
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
          {!freeOk && <p className="note">{!signer ? "Seal orders on Tonight first, then come back." : !first ? "No committed policy from this browser yet this round." : "Waiting for the chain to show your first commit."}</p>}
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
        {msg && <p className="data" role="status">{msg}</p>}
        {err && <p className="note warn" role="alert">{err}</p>}
      </section>
      <section aria-label="Scrimmage result">
        {res ? (
          <>
            <h2 style={{ fontSize: 28 }}>{res.kind === "free" ? "Your first commit" : "Your draft"}: {res.r.rank} of {res.r.of}</h2>
            <p className="data">{res.r.coins} coins · {res.r.steals} steals · {res.kind === "paid" && res.tx ? <a href={txUrl(res.tx)}>payment {res.tx.slice(0, 10)}…</a> : "free run"} · not counted toward the score</p>
            <p className="data">scrimmage hash <HashLine value={res.r.resultHash} short /></p>
            <ReplayPlayer replays={res.r.replays} mineId={signer?.address} houseIds={new Set(res.r.houseIds)} agents={res.r.of} />
          </>
        ) : <p className="muted">The replay of your scrimmage appears here.</p>}
      </section>
    </div>
  );
}
