import Link from "next/link";
import type { Metadata } from "next";
import { PRESETS, readback } from "@semalam/policy";
import { HOUSE } from "@semalam/sim/house";
import ReplayPlayer from "@/components/ReplayPlayer";
import CountUp from "@/components/site/CountUp";
import CopyCmd from "@/components/site/CopyCmd";
import LampString from "@/components/site/LampString";
import LiveClock from "@/components/site/LiveClock";
import Settle from "@/components/site/Settle";
import Terminal from "@/components/site/Terminal";
import FrozenTicket from "@/components/site/FrozenTicket";
import { loadLanding, REPO } from "@/lib/landing";
import { ordinal } from "@/lib/rank";
import "./site.css";

export const revalidate = 60; // live numbers, at most a minute old; the countdown asks the chain itself
export const metadata: Metadata = { alternates: { canonical: "/" } };

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const nurse = PRESETS.find((p) => p.name === "night-nurse")!;
const utc = (iso: string) => `${new Date(iso).toUTCString().slice(5, 16)} ${iso.slice(11, 16)} UTC`;
const ACTS = [
  { g: "▲", k: "gather", c: "var(--act-gather)" },
  { g: "■", k: "guard", c: "var(--act-guard)" },
  { g: "◆", k: "share", c: "var(--act-share)" },
  { g: "✕", k: "steal", c: "var(--act-steal)" },
];

export default async function Landing() {
  const d = await loadLanding();
  const n = d.last;
  const f = n?.featured;
  const lamps = n?.lamps ?? HOUSE.agents.map((a) => ({ id: a.id, rank: 30, house: true, featured: false }));
  const chain = d.testnet ? `chain ${d.chainId} · testnet` : `chain ${d.chainId}`;
  const cli = `node packages/cli/dist/semalam.mjs replay ${d.recorded.round} --chain ${d.recorded.chainId}`;
  return (
    <div className="site" id="site">
      <Settle target="site" ms={5200} />
      <header className="s-top">
        <Link href="/" className="brand"><i aria-hidden /> Semalam</Link>
        <nav aria-label="On this page">
          <a href="#how">How it plays</a><a href="#last-night">Last night</a><a href="#wif">$WIF</a><a href="#trust">Verify</a><a href="#faq">FAQ</a><Link href="/pitch">Deck</Link><a href={REPO}>GitHub</a>
        </nav>
        <Link href="/play" className="btn s-cta">Play tonight</Link>
      </header>

      <section className="hero" aria-labelledby="h1">
        <LampString lamps={lamps} agents={n?.agents ?? 30} round={n?.round ?? null} />
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow s-eye"><span className={`chip-net${d.testnet ? " test" : ""}`}>{chain}</span><LiveClock round={d.tonight?.round ?? null} /></p>
            <h1 id="h1">You sleep. Your agent works the <em>night market.</em></h1>
            <p className="s-lede">
              A nightly strategy game for $WIF holders. Write three short orders before bed; they stay sealed through the
              <b> 00:00 WIB</b> close. Then your agent gathers, guards, shares or steals for <b>300 turns</b>. At breakfast:
              a <b>15-second</b> replay, your rank, a hash anyone can check. Your sealed orders also get one free practice
              run on the spot, so you watch them play within a minute.
            </p>
            <div className="s-ctas">
              <Link href="/play" className="btn s-primary">Write tonight&apos;s orders</Link>
              {n && <Link href={`/round/${n.round}`} className="btn s-ghost">Watch night {n.round}</Link>}
            </div>
            <p className="s-links"><Link href="/pitch">Pitch deck →</Link><a href={REPO}>Source on GitHub →</a></p>
            <p className="s-proof">
              <span>sealed by drand timelock</span><span>settled by open code</span>
              {n && <a href="#last-night">night {n.round}: {n.cliMatch ? "✓ MATCH" : "not re-checked"}</a>}
            </p>
          </div>
          {n ? (
            <FrozenTicket n={n} />
          ) : (
            <article className="ticket s-ticket" aria-label="Stall ticket: example orders">
              <p className="who">No night has settled on {chain} yet · example orders</p>
              <p className="t-title">{nurse.name}</p>
              <ul>{readback(nurse).slice(1).map((l, i) => <li key={i}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
              <div className="stub"><div className="stamps"><span className="stamp draft st1">DRAFT</span></div></div>
            </article>
          )}
        </div>
      </section>

      <section id="how" className="s-sec how" aria-labelledby="h-how">
        <h2 id="h-how">Bedtime. Midnight. Breakfast.</h2>
        <ol className="rail">
          <li className="act sealed">
            <svg viewBox="0 0 120 150" aria-hidden className="stop-lamp"><path d="M60 0v26" className="cord" /><circle cx="60" cy="86" r="56" className="halo" /><path d="M42 26h36l-6 13H48z" className="cap" /><ellipse cx="60" cy="80" rx="30" ry="36" className="globe" /><ellipse cx="60" cy="84" rx="12" ry="17" className="mantle" /></svg>
            <p className="t">bedtime · e.g. 23:40</p>
            <h3>Write it like you&apos;d tell a friend.</h3>
            <p>Up to 280 characters. A model compiles them once into a policy of at most 6 fields and 3 rules; plain code reads it back. You seal only what you read.</p>
            <div className="mini-ticket" aria-label="A real readback from the live compiler">
              <p className="who">compiled by {d.compiled.model} in {(d.compiled.ms / 1000).toFixed(1)} s · {utc(d.compiled.at)}</p>
              <p className="said">“{d.compiled.orders}”</p>
              <ul>{d.compiled.lines.slice(1).map((l, i) => <li key={i} className={l.startsWith("  ") ? "in" : ""}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
            </div>
          </li>
          <li className="act mid dark">
            <svg viewBox="0 0 120 150" aria-hidden className="stop-lamp"><path d="M60 0v26" className="cord" /><circle cx="60" cy="86" r="56" className="halo" /><path d="M42 26h36l-6 13H48z" className="cap" /><ellipse cx="60" cy="80" rx="30" ry="36" className="globe" /><ellipse cx="60" cy="84" rx="12" ry="17" className="mantle" /></svg>
            <p className="t">00:00 WIB close · plays at 00:05</p>
            <h3>Every agent, 300 turns.</h3>
            <p>Each turn every agent gathers, guards, shares or steals with a neighbour; the ring reseats every 50 turns. Thirty labelled house agents fill the field.</p>
            <ul className="acts" aria-label="The four actions">{ACTS.map((a) => <li key={a.k}><span className="glyph" style={{ color: a.c }} aria-hidden>{a.g}</span>{a.k}</li>)}</ul>
          </li>
          <li className="act settled">
            <svg viewBox="0 0 120 150" aria-hidden className="stop-lamp"><path d="M60 0v26" className="cord" /><circle cx="60" cy="86" r="56" className="halo" /><path d="M42 26h36l-6 13H48z" className="cap" /><ellipse cx="60" cy="80" rx="30" ry="36" className="globe" /><ellipse cx="60" cy="84" rx="12" ry="17" className="mantle" /></svg>
            <p className="t">06:10 · breakfast</p>
            <h3>Your lamp, your rank, your rewrite.</h3>
            <p>A 15-second replay, the turn where your own rules moved the most coins, and your rank on the ticket. Change a rule and go again tonight.</p>
            {f?.decisive && <p className="decisive"><span className="data">{f.decisive}</span><small>night {n!.round}, {ordinal(f.rank)}-place ticket: {f.ruleFired ? "the biggest swing from one of its rules" : "its biggest single-turn swing (none of its rules fired)"}</small></p>}
          </li>
        </ol>
      </section>

      {n && (
        <section id="last-night" className="s-sec demo" aria-labelledby="h-demo">
          <p className="eyebrow s-eye">Night {n.round} · {chain}</p>
          <h2 id="h-demo">Last night, replayed twice.</h2>
          <p className="s-sub">Left: the app&apos;s replay, one lamp per agent, brighter is higher. Right: the same night recomputed from public chain data by the open-source CLI.</p>
          <div className="demo-grid">
            <div className="stall">
              <div className="stall-head"><span>/round/{n.round}</span><span className="data">{n.agents} agents · drand {n.drandRound}</span></div>
              <ReplayPlayer replays={n.replays} mineId={f?.id} houseIds={n.houseIds} agents={n.agents} autoPlay mineLabel={`the ${ordinal(f?.rank ?? 4)}-place ticket`} />
            </div>
            <div className="demo-term">
              <Terminal title={`replay · night ${d.recorded.round} · chain ${d.recorded.chainId}${d.recorded.chainId === 46630 ? " (testnet)" : ""}`} cmd={cli} lines={d.recorded.stdout}
                foot={`recorded ${d.recorded.at.replace("T", " ").replace(/:\d\dZ$/, " UTC")} · ${d.recorded.machine} · exit ${d.recorded.exit} · ${d.recorded.wallSeconds} s`} />
              {n.round !== d.recorded.round && <p className="s-note">Night {n.round}: the settler&apos;s CLI hash {n.cliMatch ? "equals" : "does not equal"} the posted hash {short(n.resultHash)}.</p>}
            </div>
          </div>
        </section>
      )}

      <section className="board" aria-label="The morning board">
        <div className="plank">
          <p className="plank-head">Papan pagi · the morning board · {chain}</p>
          <dl className="plank-grid">
            <div>
              <dt><CountUp value={d.nights} /></dt>
              <dd>nights settled on chain<small>{d.nights === 0 ? `no night on ${chain} to re-check yet` : `${d.matched} of ${d.nights} re-checked${d.matched > 0 ? ": ✓ MATCH" : ""}`}{d.houseOnly.length ? ` · ${d.houseOnly.length > 1 ? "nights" : "night"} ${d.houseOnly.join(", ")}: house agents only` : ""}</small></dd>
            </div>
            <div>
              <dt>{n ? <CountUp value={n.agents} /> : "0"}</dt>
              <dd>agents played night {n?.round ?? "—"}<small>{n ? `${n.players} ${d.testnet ? "testnet" : "player"} accounts${n.qaPlayers ? (n.qaPlayers === n.players ? " (our QA runs)" : ` (${n.qaPlayers} our QA runs)`) : ""} + ${n.house} house agents` : "the first night has not settled"}</small></dd>
            </div>
            <div>
              <dt>{d.burned === null ? "—" : <CountUp value={d.burned} decimals={d.burned % 1 ? 1 : 0} />}</dt>
              <dd>{d.wif} burned<small>{d.paidRuns === null ? "chain read failed just now" : `${d.paidRuns} paid run${d.paidRuns === 1 ? "" : "s"}${d.paidQa ? (d.paidQa === d.paidRuns ? ", all our QA" : `, ${d.paidQa} our QA`) : ""}`}{d.testnet ? " · testnet stand-in for $WIF" : ""}</small></dd>
            </div>
            <div>
              <dt><CountUp value={d.evidence.runtimes} /></dt>
              <dd>runtimes, one hash<small>golden nights: 5 macOS Node builds (20–24) + Linux Node 20/22 on arm64 and amd64</small></dd>
            </div>
          </dl>
          <p className="plank-foot">
            {d.testnet ? "Testnet: chain 4663 is not live yet. Nights = artifacts equal to their on-chain hash; burns at most about a minute old." : "Nights = artifacts equal to their hash on chain 4663; burns at most about a minute old."}{" "}
            <span className="plank-links"><Link href="/board">Full board</Link>{n && <> · <Link href={`/verify/${n.round}`}>verify night {n.round}</Link></>} · <a href={d.links.scrimmage}>paid runs on the explorer</a></span>
          </p>
        </div>
      </section>

      <section id="wif" className="wif" aria-labelledby="h-wif">
        <div className="wif-in">
          <div>
            <h2 id="h-wif">Practice costs $WIF. The season crown needs it.</h2>
            <p>Your first sealed orders each night run free against {n ? "last night\u2019s top 30" : "the 30 house agents (no night has settled on this chain yet)"}. Testing any other draft costs <b>200 $WIF</b>: <b>160</b> is burned with the token&apos;s own <code>burn()</code> and <b>40</b> pays for compute. A season is three nights. Its crown is an on-chain title, not a prize. Our settler key names the season&apos;s winner (<code>semalam season</code> re-derives the pick from public data), and the contract refuses the crown to any account without a paid run that season.{d.tonight && d.tonight.round < 2 ? " Round 1 is a rehearsal night with no season, so its paid runs count toward no crown; season 1 starts with round 2." : ""}</p>
            <p className="quiet">No prize pool and no owner withdrawal: the contracts hold nothing to drain. A fork test against the real $WIF contract shows payer −200, total supply −160, compute +40.</p>
          </div>
          <figure className="char" aria-label="One paid practice run: 200 $WIF, 160 burned, 40 to compute">
            <div className="char-ticket">
              <span className="burnt"><b>160</b> burned · 80%</span>
              <span className="kept"><b>40</b> compute</span>
            </div>
            <figcaption>
              <span className="big">{d.burned === null ? "—" : <CountUp value={d.burned} decimals={d.burned % 1 ? 1 : 0} />}</span>
              <span>{d.wif} burned so far on {chain}{d.paidRuns !== null ? ` · ${d.paidRuns} paid runs${d.paidQa && d.paidQa === d.paidRuns ? ", all by our QA accounts" : ""}` : ""}</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <section id="trust" className="s-sec trust" aria-labelledby="h-trust">
        <p className="eyebrow s-eye">Don&apos;t trust us</p>
        <h2 id="h-trust">Replay it yourself.</h2>
        <div className="bento">
          <article className="b1"><h3>Words compile once</h3><p>A model turns up to 280 characters into a policy of at most 6 fields and 3 rules, once. Plain code reads it back to you, and no model plays the night.</p><span className="tag">{d.evidence.model} · {d.evidence.golden}/{d.evidence.goldenOf} golden prompts · {d.evidence.injectionsSafe}/{d.evidence.injectionsOf} injections refused or kept in schema</span></article>
          <article className="b2"><span className="obj"><span className="stamp sealed">SEALED · ROUND {d.tonight?.round ?? (n ? n.round + 1 : 1)}</span></span><h3>Sealed till the close</h3><p>Sealed policies are timelock-encrypted to a drand round after 00:00 WIB. Nobody can open one early, us included. (The words you send the AI compiler do pass our server.)</p><span className="tag">drand quicknet · tlock</span></article>
          <article className="b3">{n && <span className="obj big-mono">drand {n.drandRound}</span>}<h3>The seed is not ours</h3><p>The contract only accepts the drand beacon fixed for the night, at least 300 s after the close{n ? `; night ${n.round} used round ${n.drandRound}` : ""}.</p><span className="tag">Results.post · seedRound</span></article>
          <article className="b4"><span className="obj big-stat">{d.evidence.p50}<small> ms</small></span><h3>Plain code plays</h3><p>A {d.evidence.benchAgents}-agent benchmark night, {d.evidence.benchTurns} turns: the median run on an M1 Max. Same inputs, same hash.</p><span className="tag">semalam-sim/1</span></article>
          <article className="b5"><h3>Posted only if it matches</h3><p>Our settler posts a night&apos;s hash only when it equals the open-source CLI&apos;s, run in a fresh process. Anyone can re-run any night from public data.</p><CopyCmd cmd={cli} /><span className="tag">{d.evidence.runtimes} runtimes · one hash</span></article>
        </div>
      </section>

      <section className="honest" aria-labelledby="h-honest">
        <div className="honest-in">
          <h2 id="h-honest">What isn&apos;t done yet.</h2>
          <p className="s-sub">Lifted from the README&apos;s limits. Judges should hear them from us first.</p>
          <div className="notes">
            <blockquote className="n1"><p className="k">{d.nights === 0 ? "Hours old" : "Days old"}</p><p>{d.nights === 0 ? "The chain 4663 deployment is hours old: its first night (round 1) has not been settled yet, and any night shown above that is older comes from the 46630 testnet with a mock token." : `The chain 4663 deployment went live on 3 Nov 2026 and has settled ${d.nights} ${d.nights > 1 ? "nights" : "night"} so far; the earlier QA nights in the repo come from the 46630 testnet with a mock token.`}</p><cite>README · Honest limits, 1</cite></blockquote>
            <blockquote className="n2"><p className="k">Stated, not solved</p><p>A Sybil can fill the 1,000-account admission cap per round with own-wallet commits … Stated, not solved.</p><cite>README · Honest limits, 3</cite></blockquote>
            <blockquote className="n3"><p className="k">A relay, not AA</p><p>Gas-free onboarding is a relay with a per-night budget, not account abstraction … when the relay is empty the app asks for your own wallet.</p><cite>README · Honest limits, 5</cite></blockquote>
          </div>
        </div>
      </section>

      <section id="faq" className="s-sec faq" aria-labelledby="h-faq">
        <p className="eyebrow s-eye">Questions a judge would ask</p>
        <h2 id="h-faq">Before you play.</h2>
        <div className="faq-list">
          <details><summary>Does an AI play the game?</summary><p>No. A model reads your words once, when you write them, and turns them into a small typed policy you approve. The night itself is plain deterministic code: same inputs, same hash, on all nine runtimes we tested.</p></details>
          <details><summary>Can anyone read my orders before midnight, even you?</summary><p>Not the sealed policy: it is timelock-encrypted to the drand beacon published about five minutes after the close and opens for everyone at once, us included. The sentences you type do pass through our compile endpoint and the model provider; the no-LLM builder keeps them in your browser.</p></details>
          <details><summary>What stops you from posting a fake result?</summary><p>The contract accepts only the beacon round fixed for that night, and the runner posts only when its hash equals the CLI&apos;s. Anyone can re-run a night from public data; a mismatch is disputed in public, never re-posted. Posting and crowning are signed by one settler key, the immutable <code>POSTER</code> in the <a href={d.links.results}>Results contract</a>. The chain checks the beacon round and the paid-run rule, not the hash itself: a wrong hash would show up as a ✗ MISMATCH anyone can reproduce, and a post is final.</p></details>
          <details><summary>Where does the $WIF go?</summary><p>A paid practice run is exactly 200 $WIF: 160 burned with the token&apos;s own burn() and 40 to compute. The contracts hold no prize pool and have no owner withdrawal.</p></details>
          <details><summary>Do I need gas or a wallet?</summary><p>For writing and sealing orders, no: a key is made in your browser and a relay pays the gas, within nightly limits; when the relay is empty, the app asks for your own wallet. A paid practice run needs $WIF and a little ETH in that same address. The browser key lives in this browser&apos;s storage: <Link href="/play">/play</Link> lets you copy it, clearing the storage loses it, and it controls only that play address. Connect a wallet instead to keep one identity everywhere.</p></details>
          <details><summary>Is it live on mainnet?</summary><p>{d.testnet ? "Not yet. Everything on this page runs on the chain 46630 testnet, with MockWIF in place of $WIF. The page reads chain 4663 once the mainnet contracts are deployed." : "Yes. The numbers on this page are read from chain 4663 and the real $WIF."}</p></details>
        </div>
      </section>

      <section className="close" aria-labelledby="h-close">
        <h2 id="h-close">Seal yours before <em>midnight.</em></h2>
        <p className="s-sub"><LiveClock round={d.tonight?.round ?? null} />{d.tonight?.commits != null ? ` · ${d.tonight.commits} ${d.testnet ? "testnet " : "player "}account${d.tonight.commits === 1 ? "" : "s"} sealed so far${d.tonight.operatorCommits ? ` (+ ${d.tonight.operatorCommits} operator test commit${d.tonight.operatorCommits > 1 ? "s" : ""})` : ""}` : ""}</p>
        <div className="s-ctas center">
          <Link href="/play" className="btn s-primary">Write tonight&apos;s orders</Link>
          <Link href="/pitch" className="btn s-ghost">Read the pitch deck</Link>
        </div>
      </section>

      <footer className="s-foot">
        <nav aria-label="Footer">
          <Link href="/play">Play</Link><Link href="/board">Board</Link>{n && <Link href={`/verify/${n.round}`}>Verify night {n.round}</Link>}<Link href="/pitch">Pitch deck</Link><a href={REPO}>Source on GitHub</a><a href="https://worldisflat.fun/build">World Is Flat · games</a>
        </nav>
        <p>SEMALAM · MIT licence · Independent hackathon project, not affiliated with any chain operator, exchange or token issuer.</p>
      </footer>
    </div>
  );
}
