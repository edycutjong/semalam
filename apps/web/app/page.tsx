import Link from "next/link";
import type { Metadata } from "next";
import { PRESETS, readback } from "@semalam/policy";
import { HOUSE } from "@semalam/sim/house";
import ReplayPlayer from "@/components/ReplayPlayer";
import CountUp from "@/components/site/CountUp";
import { Glyph } from "@/components/site/Glyphs";
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
          <a href="#last-night">Last night</a><a href="#how">How it plays</a><a href="#wif">$WIF</a><a href="#trust">Verify</a><a href="#faq">FAQ</a>
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
              A night-shift nurse in Surabaya types three sentences before bed: <i>gather early, never steal from the biggest, punish
              whoever steals from me.</i> Sealed until <b>00:00 WIB</b>, their agent plays <b>300 turns</b> against everyone else&apos;s.
              At breakfast: a <b>15-second</b> replay, a rank, a hash anyone can check.
            </p>
            <div className="s-ctas">
              <Link href="/play" className="btn s-primary">Write tonight&apos;s orders</Link>
              {n && <Link href={`/round/${n.round}`} className="btn s-ghost">Watch night {n.round}</Link>}
            </div>
            <p className="s-proof">
              <span>sealed by drand timelock</span><span>seeded by drand</span><span>settled by open code</span>
              {n && <a href="#last-night">night {n.round}: {n.cliMatch ? "✓ MATCH" : "not re-checked"}</a>}
            </p>
          </div>
          {n ? (
            <FrozenTicket n={n} />
          ) : (
            <article className="ticket s-ticket" aria-label="Stall ticket: a builder preset">
              <p className="who">No night has settled on {chain} yet · builder preset</p>
              <h3>{nurse.name}</h3>
              <ul>{readback(nurse).slice(1).map((l, i) => <li key={i}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
              <div className="stub"><div className="stamps"><span className="stamp draft st1">DRAFT</span></div></div>
            </article>
          )}
        </div>
      </section>

      <section className="board" aria-label="The morning board">
        <div className="plank">
          <p className="plank-head">Papan pagi · the morning board · {chain}</p>
          <dl className="plank-grid">
            <div>
              <dt><CountUp value={d.nights} /></dt>
              <dd>nights settled on chain<small>{d.matched} of {d.nights} re-checked by the CLI: ✓ MATCH</small></dd>
            </div>
            <div>
              <dt>{n ? <CountUp value={n.agents} /> : "0"}</dt>
              <dd>agents played night {n?.round ?? "—"}<small>{n ? `${n.players} ${d.testnet ? "testnet" : "player"} accounts + ${n.house} labelled house agents` : "the first night has not settled"}</small></dd>
            </div>
            <div>
              <dt>{d.burned === null ? "—" : <CountUp value={d.burned} decimals={d.burned % 1 ? 1 : 0} />}</dt>
              <dd>{d.wif} burned<small>{d.paidRuns === null ? "chain read failed just now" : `${d.paidRuns} paid practice run${d.paidRuns === 1 ? "" : "s"}, operator wallets excluded`}{d.testnet ? " · MockWIF stands in for $WIF on testnet" : ""}</small></dd>
            </div>
            <div>
              <dt><CountUp value={d.evidence.runtimes} /></dt>
              <dd>runtimes, one hash<small>the golden nights replay to the same hashes on macOS and Linux, Node 20 to 24</small></dd>
            </div>
          </dl>
          <p className="plank-foot">
            {d.testnet ? "Testnet numbers, read live. The chain 4663 deployment is not live yet; this board reads it once it is." : "Read live from chain 4663."}{" "}
            <Link href="/board">Full board</Link>{n && <> · <Link href={`/verify/${n.round}`}>verify night {n.round}</Link></>} · <a href={d.links.scrimmage}>paid runs on the explorer</a>
          </p>
        </div>
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
              <Terminal title={`replay · night ${d.recorded.round} · chain ${d.recorded.chainId}`} cmd={cli} lines={d.recorded.stdout}
                foot={`recorded ${d.recorded.at.replace("T", " ").replace(/:\d\dZ$/, " UTC")} · ${d.recorded.machine} · exit ${d.recorded.exit} · ${d.recorded.wallSeconds} s`} />
              {n.round !== d.recorded.round && <p className="s-note">Night {n.round}: the settler&apos;s CLI hash {n.cliMatch ? "equals" : "does not equal"} the posted hash {short(n.resultHash)}.</p>}
            </div>
          </div>
        </section>
      )}

      <section id="how" className="s-sec how" aria-labelledby="h-how">
        <h2 id="h-how">Bedtime. Midnight. Breakfast.</h2>
        <ol className="rail">
          <li className="act">
            <p className="t">23:40 · tonight</p>
            <h3>Write it like you&apos;d tell a friend.</h3>
            <p>Up to 280 characters. A model compiles them once into a policy of at most 6 fields and 3 rules, then reads it back. You seal only what you read.</p>
            <div className="mini-ticket" aria-label="Readback of the night-nurse builder preset">
              <p className="who">builder preset · {nurse.name}</p>
              <ul>{readback(nurse).slice(1).map((l, i) => <li key={i} className={l.startsWith("  ") ? "in" : ""}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
            </div>
          </li>
          <li className="act mid">
            <p className="t">00:00 WIB · the market plays</p>
            <h3>Every agent, 300 turns.</h3>
            <p>Each turn an agent gathers, guards, shares or steals with a neighbour; every 50 turns the ring reseats. Thirty labelled house agents fill the field. No model plays: plain code does.</p>
            <ul className="acts" aria-label="The four actions">{ACTS.map((a) => <li key={a.k}><span className="glyph" style={{ color: a.c }} aria-hidden>{a.g}</span>{a.k}</li>)}</ul>
          </li>
          <li className="act">
            <p className="t">06:10 · breakfast</p>
            <h3>Your lamp, your rank, your rewrite.</h3>
            <p>A 15-second replay, the turn that decided your night, and your rank on the ticket. Change a rule and go again tonight.</p>
            {f?.decisive && <p className="decisive"><span className="data">{f.decisive}</span><small>the turn that decided night {n!.round} for the {ordinal(f.rank)}-place ticket</small></p>}
          </li>
        </ol>
      </section>

      <section id="wif" className="wif" aria-labelledby="h-wif">
        <div className="wif-in">
          <div>
            <h2 id="h-wif">Practice costs $WIF. The crown needs it.</h2>
            <p>Your first sealed orders each night run free against last night&apos;s top 30. Testing any other draft costs <b>200 $WIF</b>: <b>160</b> is burned with the token&apos;s own <code>burn()</code> and <b>40</b> pays for compute. A season crown needs at least one paid run, and the contract checks it.</p>
            <p className="quiet">No prize pool and no owner withdrawal: the contracts hold nothing to drain. A fork test against the real $WIF contract shows payer −200, total supply −160, compute +40.</p>
          </div>
          <figure className="char" aria-label="One paid practice run: 200 $WIF, 160 burned, 40 to compute">
            <div className="char-ticket">
              <span className="burnt"><b>160</b> burned · 80%</span>
              <span className="kept"><b>40</b> compute</span>
            </div>
            <figcaption>
              <span className="big">{d.burned === null ? "—" : <CountUp value={d.burned} decimals={d.burned % 1 ? 1 : 0} />}</span>
              <span>{d.wif} burned so far on {chain}{d.paidRuns !== null ? ` · ${d.paidRuns} paid runs` : ""}</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <section id="trust" className="s-sec trust" aria-labelledby="h-trust">
        <p className="eyebrow s-eye">Don&apos;t trust us</p>
        <h2 id="h-trust">Replay it yourself.</h2>
        <div className="bento">
          <article className="b1"><Glyph k="pen" /><h3>Words compile once</h3><p>A model turns up to 280 characters into a policy of at most 6 fields and 3 rules and reads it back. It never plays.</p><span className="tag">{d.evidence.model} · {d.evidence.golden}/{d.evidence.goldenOf} golden prompts · {d.evidence.injectionsSafe}/{d.evidence.injectionsOf} injections held</span></article>
          <article className="b2"><Glyph k="seal" /><h3>Sealed till the close</h3><p>Orders are timelock-encrypted to a drand round after 00:00 WIB. Nobody opens them early, us included.</p><span className="tag">drand quicknet · tlock</span></article>
          <article className="b3"><Glyph k="beacon" /><h3>The seed is not ours</h3><p>The contract only accepts the drand beacon fixed for that night, at least 300 s after the close.</p><span className="tag">Results.post · seedRound</span></article>
          <article className="b4"><Glyph k="lamp" /><h3>Plain code plays</h3><p>{d.evidence.benchAgents} agents × {d.evidence.benchTurns} turns run in {d.evidence.p50} ms at the median. Same inputs, same hash.</p><span className="tag">semalam-sim/1</span></article>
          <article className="b5"><Glyph k="stamp" /><h3>Posted only if it matches</h3><p>The runner posts a night&apos;s hash only when it equals the CLI&apos;s, and anyone can re-run any night from public data.</p><code className="cmd">{cli}</code><span className="tag">{d.evidence.runtimes} runtimes · one hash</span></article>
        </div>
      </section>

      <section className="honest" aria-labelledby="h-honest">
        <div className="honest-in">
          <h2 id="h-honest">Honest by design.</h2>
          <p className="s-sub">Lifted from the README&apos;s limits. Judges should hear them from us first.</p>
          <div className="notes">
            <blockquote className="n1"><p>The chain 4663 deployment is not live yet; everything above runs on the 46630 testnet with a mock token, except the fork test.</p><cite>README · Honest limits, 1</cite></blockquote>
            <blockquote className="n2"><p>A Sybil can fill the 1,000-account admission cap per round with own-wallet commits … Stated, not solved.</p><cite>README · Honest limits, 3</cite></blockquote>
            <blockquote className="n3"><p>Gas-free onboarding is a relay with a per-night budget, not account abstraction … when the relay is empty the app asks for your own wallet.</p><cite>README · Honest limits, 5</cite></blockquote>
          </div>
        </div>
      </section>

      <section id="faq" className="s-sec faq" aria-labelledby="h-faq">
        <p className="eyebrow s-eye">Questions a judge would ask</p>
        <h2 id="h-faq">Before you play.</h2>
        <div className="faq-list">
          <details><summary>Does an AI play the game?</summary><p>No. A model reads your words once, when you write them, and turns them into a small typed policy you approve. The night itself is plain deterministic code: same inputs, same hash, on any machine.</p></details>
          <details><summary>Can anyone read my orders before midnight, even you?</summary><p>No. Your policy is timelock-encrypted to the drand beacon published about five minutes after the close, then committed on chain. It opens for everyone at once, us included.</p></details>
          <details><summary>What stops you from posting a fake result?</summary><p>The contract accepts only the beacon round fixed for that night, and the runner posts only when its hash equals the CLI&apos;s. Anyone can re-run a night from public data; a mismatch is disputed in public, never re-posted.</p></details>
          <details><summary>Where does the $WIF go?</summary><p>A paid practice run is exactly 200 $WIF: 160 burned with the token&apos;s own burn() and 40 to compute. The contracts hold no prize pool and have no owner withdrawal.</p></details>
          <details><summary>Do I need gas or a wallet?</summary><p>No. A key is made in your browser and a relay pays the gas, within a per-night budget. When the relay is empty, the app asks for your own wallet instead.</p></details>
          <details><summary>Is it live on mainnet?</summary><p>{d.testnet ? "Not yet. Everything on this page runs on the chain 46630 testnet, with MockWIF in place of $WIF. The page reads chain 4663 once the mainnet contracts are deployed." : "Yes. The numbers on this page are read from chain 4663 and the real $WIF."}</p></details>
        </div>
      </section>

      <section className="close" aria-labelledby="h-close">
        <h2 id="h-close">The market opens at <em>midnight.</em></h2>
        <p className="s-sub"><LiveClock round={d.tonight?.round ?? null} />{d.tonight?.commits != null ? ` · ${d.tonight.commits} account${d.tonight.commits === 1 ? "" : "s"} sealed so far` : ""}</p>
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
