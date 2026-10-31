import Link from "next/link";
import HashLine from "@/components/HashLine";
import { namedState, readArtifact } from "@/lib/artifact";
import { chainNow, postedOf } from "@/lib/chain";
import { currentRound } from "@/lib/clock";
import { CHAIN_ID, DEP, EXCLUDED, ORDERS, RESULTS, SCRIMMAGE, WIF_LABEL, addrUrl, txUrl } from "@/lib/config";
import { QUICKNET } from "@semalam/beacon";

export const dynamic = "force-dynamic";

export default async function Verify({ params }: { params: Promise<{ n: string }> }) {
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n < 1) return <h1>No such round</h1>;
  const art = await readArtifact(n);
  let posted: Awaited<ReturnType<typeof postedOf>> = null, state = null as ReturnType<typeof namedState> | null;
  try { posted = await postedOf(n); const now = await chainNow(); state = namedState(n, now, currentRound(now), Boolean(posted)); } catch { state = { code: "rpc", label: "chain unreachable — try again in a moment" }; }
  const s = art?.settled;
  const verdict = !art ? null : art.status !== "posted" ? art.status.toUpperCase() : posted && posted.resultHash.toLowerCase() === s!.resultHash.toLowerCase() && art.cli.match ? "MATCH" : "MISMATCH";
  const chainFlag = CHAIN_ID === 46630 ? "--chain 46630" : "";
  return (
    <>
      <div className="eyebrow">Verify · round {n} · {DEP.name}</div>
      <h1>Don't trust — replay</h1>
      <p className="lead">Everything below comes from public chain logs and the public drand beacon. The same open code runs on your machine.</p>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="data" style={{ marginBottom: 8 }}>$ npx semalam replay {n} {chainFlag}</div>
        <p style={{ margin: 0 }} className="muted">Exit 0 prints the hash below and says MATCH. {CHAIN_ID === 46630 ? `Testnet uses ${WIF_LABEL}, a labelled stand-in.` : ""}</p>
      </div>
      {verdict && <p className={verdict === "MATCH" ? "ok" : "bad"} role="status" style={{ fontSize: 22, fontFamily: "var(--font-display)" }}>{verdict === "MATCH" ? "✓ MATCH" : `✗ ${verdict.replace(/-/g, " ").toLowerCase()}`}</p>}
      {!art && state && <p className="note" role="status">{state.label}{state.detail ? ` — ${state.detail}` : ""}</p>}
      <dl className="kv">
        <dt>Result hash (runner artifact)</dt><dd>{s ? <HashLine value={s.resultHash} /> : <span className="muted">not computed yet</span>}</dd>
        <dt>Result hash (on chain)</dt><dd>{posted ? <HashLine value={posted.resultHash} href={art?.onchain?.tx ? txUrl(art.onchain.tx) : undefined} /> : <span className="muted">not posted</span>}</dd>
        <dt>CLI cross-check (runner's fresh-process run)</dt><dd>{art ? <span className="data">v{art.cli.version} · {art.cli.match ? "same hash" : "DIFFERENT hash"}</span> : <span className="muted">—</span>}</dd>
        <dt>drand round</dt><dd className="data">{s ? s.drandRound : "—"} · quicknet <span className="muted">{QUICKNET.hash.slice(0, 10)}…</span> · the runner and the CLI BLS-verify this beacon before replaying (packages/beacon); run the CLI to check it yourself</dd>
        <dt>Randomness</dt><dd>{s ? <HashLine value={s.randomness} short /> : "—"}</dd>
        <dt>Players (accounts, house excluded)</dt><dd className="data">{s ? `${s.players} (${s.playersAll - s.players} operator address${s.playersAll - s.players === 1 ? "" : "es"} excluded)${s.playersAll === 0 ? " · house-only night" : ""}` : "—"} · excluded: {EXCLUDED.map((a) => a.slice(0, 8)).join(", ") || "none"}</dd>
        <dt>Void commits</dt><dd className="data">{s ? (s.voids.length ? s.voids.map((v) => `${v.account.slice(0, 8)}… ${v.reason}`).join(" · ") : "none") : "—"}</dd>
        <dt>Commit logs read · policy set hash</dt><dd className="data">{art && s ? <>{art.commitTxs.length} · <HashLine value={s.policySetHash} short /></> : "—"}</dd>
        <dt>Contracts</dt><dd className="data"><a href={addrUrl(ORDERS)}>Orders</a> · <a href={addrUrl(RESULTS)}>Results</a> · <a href={addrUrl(SCRIMMAGE)}>Scrimmage</a></dd>
        <dt>Commit transactions</dt><dd className="data">{art ? (art.commitTxs.length ? art.commitTxs.slice(0, 12).map((c, i) => <span key={c.tx}>{i ? " · " : ""}<a href={txUrl(c.tx)}>{c.tx.slice(0, 10)}…</a></span>) : "none") : "—"}{art && art.commitTxs.length > 12 ? ` · +${art.commitTxs.length - 12} more` : ""}</dd>
      </dl>
      <p className="note">Your replay says ✗ MISMATCH? Re-run it with another node (<span className="data">--rpc &lt;url&gt;</span>): one that has not indexed every commit log gives a false mismatch — compare the commit count and policy set hash above. Still different: the night is disputed. A post is final on chain and is never re-posted; open an issue on the <a href="https://github.com/edycutjong/semalam/issues">repo</a> with the CLI output. The full artifact is <a href={`/api/round/${n}`}>/api/round/{n}</a>.</p>
      <p className="note">Orders compiled by the AI path are visible to the operator; the builder path never leaves the browser. Sealed orders cannot be read by anyone until the drand round above is published.</p>
      <Link className="btn quiet" href={`/round/${n}`}>Replay</Link>
    </>
  );
}
