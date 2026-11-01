import type { Metadata } from "next";
import { PRESETS, readback } from "@semalam/policy";
import Deck from "@/components/site/Deck";
import FrozenTicket from "@/components/site/FrozenTicket";
import LampString from "@/components/site/LampString";
import { QR_PATH, QR_URL, QR_VIEWBOX } from "@/components/site/qr";
import Settle from "@/components/site/Settle";
import { loadLanding, REPO } from "@/lib/landing";
import { ordinal } from "@/lib/rank";
import "../site.css";
import "./deck.css";

export const revalidate = 60; // the same live numbers as the landing page, at most a minute old
export const metadata: Metadata = {
  title: "SEMALAM — pitch deck",
  description: "Ten slides: orders at bedtime, one deterministic night market at 00:00 WIB, a replay and a hash at breakfast.",
  alternates: { canonical: "/pitch" },
};

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const HOOK = "gather early, never steal from the biggest, punish whoever steals from me";
const nurse = PRESETS.find((p) => p.name === "night-nurse")!;
// Runs before React: sizes the 1920 × 1080 stage to the window, so the first paint is already the right scale.
const FIT = `(function(){var d=document.documentElement;d.style.setProperty("--deck-s",String(Math.min(d.clientWidth/1920,d.clientHeight/1080)))})()`;

function Foot({ k, build, chain }: { k: number; build: string; chain: string }) {
  return <footer className="slide-foot"><span>SEMALAM · {chain}</span><span>{build}</span><span className="pg">{String(k).padStart(2, "0")} / 10</span></footer>;
}

export default async function Pitch() {
  const d = await loadLanding();
  const n = d.last;
  const f = n?.featured;
  const chain = d.testnet ? `chain ${d.chainId} · testnet` : `chain ${d.chainId}`;
  const build = `build ${(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)}`;
  const last = d.recorded.stdout.at(-1) ?? "";
  const cli = `node packages/cli/dist/semalam.mjs replay ${d.recorded.round} --chain ${d.recorded.chainId}`;
  const lamps = n?.lamps ?? [];
  const nurseLines = readback(nurse).slice(1);
  const notes = [
    "SEMALAM is a night market your agent plays while you sleep. Write orders at bedtime; at midnight Jakarta time every agent plays one tournament; at breakfast you watch it back. The ticket on the right is a real one from the latest night on the testnet.",
    "Holders have a token and nothing to do with an agent. Today's agent products want a stake in someone else's bot or a developer. Neither gives a reason to come back the next day.",
    "Our player is the night-shift nurse: in bed at 23:40, lights off, one thumb. Three plain sentences is all the effort we ask. The counter is the real character count against our 280 limit.",
    "A model compiles the words exactly once into a tiny typed policy and reads it back. That readback is what gets sealed, and no model touches the night itself.",
    "Four steps, each one checkable. Sealed with a drand timelock, seeded by a drand round the contract fixes, settled by plain deterministic code, and replayed by anyone with the CLI.",
    "This is the latest posted night, read from the chain on every page load. One lamp per agent; brighter means a higher final rank; house agents are grey and never score.",
    "This is the $WIF reason. Practice beyond your free run costs $WIF, and most of it is burned by the token's own burn function. The season crown needs a paid run. There is no prize pool to drain.",
    "We do not ask anyone to trust our server. Every night's hash is recomputed by the CLI before it is posted, and the golden nights match on every runtime we tried.",
    "Honest status: testnet numbers so far, house agents labelled, accounts never inflated. The three limits come from our README, word for word.",
    "The ask is simple: play one night and check the hash at breakfast. The QR opens tonight's page.",
  ];
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FIT }} />
      <Settle target="deck-root" ms={5200} />
      <div id="deck-root">
      <Deck notes={notes}>
        <section className="slide s1" aria-label="Cover">
          {n && <LampString lamps={lamps} agents={n.agents} round={n.round} uid="dk" />}
          <div className="cover">
            <div>
              <p className="kick"><span className="pill">World Is Flat · games</span><span className={`pill${d.testnet ? " test" : ""}`}>{chain}</span></p>
              <h1>You sleep. Your agent works the <em>night market.</em></h1>
              <p className="lede">Orders at bedtime. Every agent plays at 00:00 WIB. A replay, a rank and a hash at breakfast.</p>
              <div className="mini-term"><span className="pr">$</span> {cli}<br /><span className="ok">{last.replace(/\s+/g, " ").replace(/(0x[0-9a-f]{6})[0-9a-f]{54}([0-9a-f]{4})/g, "$1…$2")}</span></div>
            </div>
            {n && <FrozenTicket n={n} className="deck-ticket" />}
          </div>
          <Foot k={1} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[0]}</aside>
        </section>

        <section className="slide s2" aria-label="Hook">
          <div className="hook">
            <h2>A token. Nothing to do <em>tonight.</em></h2>
            <p className="lede">Agent products ask a holder to stake on someone else&apos;s bot, or to write code. Neither is a reason to come back tomorrow.</p>
          </div>
          <svg className="big-lamp" viewBox="0 0 200 300" aria-hidden>
            <path d="M100 0v62" stroke="#4c4170" strokeWidth="3" />
            <path d="M70 62h60l-10 22H80z" fill="#2A2140" stroke="#5c5182" strokeWidth="2" />
            <ellipse cx="100" cy="150" rx="58" ry="68" fill="#2c2449" stroke="#4c4170" strokeWidth="3" />
            <ellipse cx="100" cy="158" rx="22" ry="30" fill="#3A2F55" />
            <path d="M74 220h52l8 26H66z" fill="#2A2140" stroke="#5c5182" strokeWidth="2" />
          </svg>
          <Foot k={2} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[1]}</aside>
        </section>

        <section className="slide s3" aria-label="The person">
          <div className="split">
            <div>
              <p className="kick">23:40 · lights off · one thumb</p>
              <h2>Three sentences before bed.</h2>
              <p className="lede">A night-shift nurse in Surabaya has a token and no code. At 06:10, with coffee, they want to know how their agent did.</p>
            </div>
            <div className="draft">
              <p className="who">tonight&apos;s orders · draft</p>
              <p className="orders">“{HOOK}”</p>
              <p className="count data">{HOOK.length} / 280 characters</p>
              <span className="stamp draft">DRAFT</span>
            </div>
          </div>
          <Foot k={3} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[2]}</aside>
        </section>

        <section className="slide s4" aria-label="Solution">
          <h2>Words in. A policy out.</h2>
          <div className="flow">
            <div className="in"><p className="who">you write</p><p className="orders">“{HOOK}”</p></div>
            <div className="arrow" aria-hidden><span>compile once</span><span className="data">{d.evidence.model}</span></div>
            <div className="browser">
              <div className="bar"><i /><i /><i /><span>semalam.edycu.dev/play</span></div>
              <div className="ticket rb-ticket">
                <p className="who">readback · the night-nurse builder preset</p>
                <ul>{nurseLines.map((l, k) => <li key={k} className={l.startsWith("  ") ? "in" : ""}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
              </div>
            </div>
          </div>
          <p className="lede narrow">At most 6 fields and 3 rules, read back in plain words. You seal only what you read.</p>
          <Foot k={4} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[3]}</aside>
        </section>

        <section className="slide s5" aria-label="How it works">
          <h2>Sealed. Seeded. Settled. Replayed.</h2>
          <ol className="line">
            <li><p className="t sealed">23:40 · seal</p><h3>Timelocked</h3><p className="data">tlock → drand round after the close</p><p className="data">Orders.commitBySig · EIP-712 · relay pays gas</p></li>
            <li><p className="t">00:00 WIB · seed</p><h3>Not our dice</h3><p className="data">seed = drand beacon ≥ close + 300 s</p><p className="data">Results.post refuses any other round</p></li>
            <li><p className="t">after 00:05 · settle</p><h3>Plain code</h3><p className="data">semalam-sim/1 · 300 turns · no model</p><p className="data">posted only if runner hash == CLI hash</p></li>
            <li><p className="t settled">06:10 · replay</p><h3>Check it</h3><p className="data">15-second replay · /verify</p><p className="data">semalam replay n → ✓ MATCH</p></li>
          </ol>
          <Foot k={5} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[4]}</aside>
        </section>

        <section className="slide s6" aria-label="The latest night">
          {n && f ? (
            <>
              <h2>Night {n.round}, read from the chain.</h2>
              <LampString lamps={lamps} agents={n.agents} round={n.round} uid="dk6" />
              <dl className="nums">
                <div><dt>{n.agents}</dt><dd>agents: {n.players} {d.testnet ? "testnet" : "player"} accounts + {n.house} house</dd></div>
                <div><dt className="amber">{ordinal(f.rank)}</dt><dd>{f.name} · {f.coins} coins · amber lamp</dd></div>
                <div><dt className={n.cliMatch ? "ok" : "bad"}>{n.cliMatch ? "✓" : "✗"}</dt><dd>CLI hash {short(n.resultHash)} {n.cliMatch ? "equals" : "does not equal"} the posted hash</dd></div>
              </dl>
              {f.decisive && <p className="decisive data">{f.decisive} <span>· the turn that decided it</span></p>}
            </>
          ) : <h2>The first night has not settled yet.</h2>}
          <Foot k={6} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[5]}</aside>
        </section>

        <section className="slide s7" aria-label="$WIF">
          <h2>Practice costs $WIF. <em className="burn">80%</em> burns.</h2>
          <div className="wif-row">
            <div className="char-ticket big"><span className="burnt"><b>160</b> burned</span><span className="kept"><b>40</b> compute</span></div>
            <ul className="facts">
              <li>Your first sealed orders each night: a free run against last night&apos;s top 30.</li>
              <li>Any other draft: 200 $WIF a run, burned with the token&apos;s own burn().</li>
              <li>The season crown needs one paid run. The contract checks.</li>
              <li>No prize pool. No owner withdrawal.</li>
            </ul>
          </div>
          <p className="counter"><b>{d.burned === null ? "—" : d.burned.toLocaleString("en-US")}</b> {d.wif} burned on {chain}{d.paidRuns !== null ? ` · ${d.paidRuns} paid runs` : ""}</p>
          <Foot k={7} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[6]}</aside>
        </section>

        <section className="slide s8" aria-label="Built well">
          <h2>Don&apos;t trust us. Re-run it.</h2>
          <dl className="receipts">
            <div><dt>{d.matched}/{d.nights}</dt><dd>posted nights the CLI re-checked: ✓ MATCH</dd></div>
            <div><dt>{d.evidence.runtimes}</dt><dd>runtimes, one hash (macOS + Linux, Node 20–24)</dd></div>
            <div><dt>{d.evidence.p50}<small> ms</small></dt><dd>p50 for {d.evidence.benchAgents} agents × {d.evidence.benchTurns} turns</dd></div>
            <div><dt>{d.evidence.golden}/{d.evidence.goldenOf}</dt><dd>golden prompts compiled right · {d.evidence.model}</dd></div>
            <div><dt>{d.evidence.injectionsSafe}/{d.evidence.injectionsOf}</dt><dd>prompt injections refused or kept in schema</dd></div>
          </dl>
          <p className="cmd data"><span className="pr">$</span> {cli}</p>
          <Foot k={8} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[7]}</aside>
        </section>

        <section className="slide s9" aria-label="Status and limits">
          <h2>Where it stands, honestly.</h2>
          <div className="split2">
            <div className="board-mini">
              <p className="kick">{chain} · read live</p>
              <p><b>{d.nights}</b> nights posted on chain</p>
              <p><b>{n?.agents ?? 0}</b> agents in night {n?.round ?? "—"}: {n?.players ?? 0} {d.testnet ? "testnet" : "player"} accounts, {n?.house ?? 0} labelled house agents</p>
              <p><b>{d.paidRuns ?? "—"}</b> paid practice runs · <b>{d.burned === null ? "—" : d.burned.toLocaleString("en-US")}</b> {d.wif} burned</p>
            </div>
            <ul className="limits">
              <li>The chain 4663 deployment is not live yet.</li>
              <li>A Sybil can fill the 1,000-account cap per round. Stated, not solved.</li>
              <li>Gas-free means a relay with a nightly budget, not account abstraction.</li>
            </ul>
          </div>
          <Foot k={9} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[8]}</aside>
        </section>

        <section className="slide s10" aria-label="The ask">
          <div className="ask">
            <div>
              <h2>Play tonight. Verify at <em>breakfast.</em></h2>
              <p className="url">semalam.edycu.dev/play</p>
              <p className="url small">{REPO.replace("https://", "")}</p>
            </div>
            <figure className="qr">
              <svg viewBox={QR_VIEWBOX} role="img" aria-label={`QR code for ${QR_URL}`} shapeRendering="crispEdges"><path d={QR_PATH} fill="#1B1530" /></svg>
              <figcaption>{QR_URL.replace("https://", "")}</figcaption>
            </figure>
          </div>
          <Foot k={10} build={build} chain={chain} />
          <aside className="speaker-notes">{notes[9]}</aside>
        </section>
      </Deck>
      </div>
    </>
  );
}
