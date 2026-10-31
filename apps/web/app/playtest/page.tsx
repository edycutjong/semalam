import Link from "next/link";
import { CHAIN_ID, DEP, IS_TESTNET, ORDERS, RESULTS, SCRIMMAGE, WIF, WIF_LABEL, addrUrl } from "@/lib/config";

export default function Playtest() {
  return (
    <>
      <div className="eyebrow">Playtest kit · {DEP.name} ({CHAIN_ID})</div>
      <h1>Play one night</h1>
      <p className="lead">Five minutes tonight, ninety seconds tomorrow morning. {IS_TESTNET ? `This is the testnet: ${WIF_LABEL} is a labelled stand-in with no value.` : ""}</p>
      <ol style={{ paddingLeft: 22 }}>
        <li><strong>Tonight</strong> — open <Link href="/">the first page</Link>, write two or three sentences, press Compile, read the ticket, press “That's what I meant → Seal”. Pick “Play without a wallet”: it costs you nothing.</li>
        <li><strong>Check you are in</strong> — the ticket gets a SEALED stamp and a transaction link only after the chain shows your commit.</li>
        <li><strong>Practise (optional)</strong> — <Link href="/scrimmage">Scrimmage</Link>: your first commit of the round runs free. Other drafts cost 200 {WIF_LABEL}{IS_TESTNET ? <> — get testnet ETH at <a href="https://faucet.testnet.chain.robinhood.com">the faucet</a>, then use “Mint 1,000 {WIF_LABEL}” on the scrimmage page</> : ""}.</li>
        <li><strong>Breakfast</strong> — after 00:00 WIB (17:00 UTC) the runner settles the night. Open <Link href="/board">Board</Link> or your round page and play the 15-second replay.</li>
        <li><strong>Tell us</strong> — fill the three lines in <span className="data">submission/playtest-results.md</span>, or send the file from <Link href="/fidelity">Check my orders</Link>.</li>
      </ol>
      <h2 style={{ fontSize: 24, marginTop: 32 }}>What to report</h2>
      <ul>
        <li>Did the readback match what you meant? (Yes / No + the words you typed)</li>
        <li>Where did you hesitate? Which screen or word confused you?</li>
        <li>Did the replay explain why you finished where you did?</li>
      </ul>
      <h2 style={{ fontSize: 24, marginTop: 32 }}>Contracts</h2>
      <p className="data"><a href={addrUrl(ORDERS)}>Orders</a> · <a href={addrUrl(RESULTS)}>Results</a> · <a href={addrUrl(SCRIMMAGE)}>Scrimmage</a> · <a href={addrUrl(WIF)}>{WIF_LABEL}</a></p>
      <p className="note">Verify any night yourself: <span className="data">npx semalam replay &lt;round&gt; --chain {CHAIN_ID}</span></p>
    </>
  );
}
