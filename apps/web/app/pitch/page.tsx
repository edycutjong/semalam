import type { Metadata } from "next";
import Deck from "@/components/site/Deck";
import FrozenTicket from "@/components/site/FrozenTicket";
import LampString from "@/components/site/LampString";
import Settle from "@/components/site/Settle";
import { QR_PATH, QR_URL, QR_VIEWBOX } from "@/components/site/qr";
import { loadLanding, REPO } from "@/lib/landing";
import { ordinal } from "@/lib/rank";
import "../site.css";
import "./deck.css";

export const revalidate = 60; // the same numbers as the landing page, at most a minute old
export const metadata: Metadata = {
  title: "SEMALAM — pitch deck",
  description: "Ten slides: orders at bedtime, one deterministic night market after the 00:00 WIB close, a replay and a hash at breakfast.",
  alternates: { canonical: "/pitch" },
};

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const utc = (iso: string) => `${new Date(iso).toUTCString().slice(5, 16)} ${iso.slice(11, 16)} UTC`;
// Runs before React: sizes the 1920 × 1080 stage to the window, so the first paint is already at the right scale.
const FIT = `(function(){var d=document.documentElement;d.style.setProperty("--deck-s",String(Math.min(d.clientWidth/1920,d.clientHeight/1080)))})()`;
const SHA = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

function Foot({ k, chain }: { k: number; chain: string }) {
  return <footer className="slide-foot"><span>SEMALAM · {chain}{SHA ? ` · build ${SHA}` : ""}</span><span>{REPO.replace("https://", "")}</span><span className="pg">{String(k).padStart(2, "0")} / 10</span></footer>;
}
const STOPS = [
  { t: "bedtime", k: "sealed", h: "Sealed", p: "orders timelocked to a drand round (23:40 in our example)" },
  { t: "00:00 WIB", k: "dark", h: "Closed", p: "commits stop; nobody can read them yet" },
  { t: "00:05", k: "dark", h: "Seeded, played", p: "the drand beacon opens every policy; plain code plays 300 turns" },
  { t: "00:05–00:30", k: "settled", h: "Posted", p: "the hash goes on chain only if the CLI agrees; replay it at breakfast" },
];

export default async function Pitch() {
  const d = await loadLanding();
  const n = d.last;
  const f = n?.featured;
  const chain = d.testnet ? `chain ${d.chainId} · testnet` : `chain ${d.chainId}`;
  const last = d.recorded.stdout.at(-1) ?? "";
  const cli = `node packages/cli/dist/semalam.mjs replay ${d.recorded.round} --chain ${d.recorded.chainId}`;
  const lamps = n?.lamps ?? [];
  const qa = Boolean(n && n.qaPlayers === n.players && n.players > 0);
  const paidQa = d.paidRuns !== null && d.paidRuns > 0 && d.paidQa === d.paidRuns;
  const notes = [
    "SEMALAM is a night market your agent plays while you sleep. Orders at bedtime; after the midnight close (Jakarta time) every agent plays one tournament; at breakfast you watch it back. The ticket is real: the 4th place of the latest testnet night, one of our own QA accounts, not a user.",
    "A holder with a token and no code has nothing to do with an agent tonight. That is the gap: no reason to open the app, and no reason to come back tomorrow.",
    "Picture our player, a night-shift nurse — an illustrative persona, not a user. In bed at 23:40, lights off, one thumb, three short orders. The counter is the real count against our 280-character limit.",
    "This is a real call to the live compiler with exactly that sentence. The model runs once; plain code turns the policy back into these lines, and only what you read gets sealed. No model plays the night.",
    "One night in four stops. Sealed with a drand timelock at bedtime; closed at midnight; opened and played after the beacon five minutes later; posted on chain only when the CLI agrees (night 2 posted at 00:25 WIB), then replayed at breakfast.",
    "The latest settled night. Its artifact's hash equals the one posted on chain. One lamp per agent, brighter means a higher final rank, house agents are grey and never score. The accounts are our own QA runs so far.",
    "This is the $WIF reason. Practice beyond your free run costs $WIF, and 80 percent is burned by the token's own burn function. The season crown needs a paid run. There is no prize pool to drain. On testnet the burns so far are our QA runs, with a mock token.",
    "We don't ask anyone to trust our server: the CLI recomputes every night from chain data. Every posted night is re-checked by the CLI before it goes on chain, and the golden nights hash the same on nine runtimes.",
    "Honest status: testnet only, numbers from our own QA runs, house agents labelled. The three notes are shortened from our README's Honest limits 1, 3 and 5.",
    "The ask: play one night and check the hash at breakfast. The QR opens tonight's page.",
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
              <p className="kick"><img src="/icon.svg" alt="" width={46} height={46} className="cover-icon" /><span className="pill">World Is Flat · games</span><span className={`pill${d.testnet ? " test" : ""}`}>{chain}</span></p>
              <h1>You sleep. Your agent works the <em>night market.</em></h1>
              <p className="lede">Orders at bedtime. The market closes at 00:00 WIB and plays when the drand beacon lands. A replay, a rank and a hash at breakfast.</p>
              <div className="mini-term"><span className="pr">$</span> {cli}<br /><span className="ok">{last.replace(/\s+/g, " ").replace(/(0x[0-9a-f]{6})[0-9a-f]{54}([0-9a-f]{4})/g, "$1…$2")}</span></div>
            </div>
            {n && <FrozenTicket n={n} className="deck-ticket" />}
          </div>
          <Foot k={1} chain={chain} />
          <aside className="speaker-notes">{notes[0]}</aside>
        </section>

        <section className="slide s2" aria-label="Hook">
          <div className="hook">
            <h2>A token. Nothing to do <em>tonight.</em></h2>
            <p className="lede">A holder with a token and no code has nothing to do with an agent, and no reason to come back tomorrow.</p>
          </div>
          <svg className="big-lamp" viewBox="0 0 240 380" overflow="visible" aria-hidden>
            <path d="M120 0v70" stroke="#5c5182" strokeWidth="3" />
            <path d="M86 70h68l-12 26H98z" fill="#2A2140" stroke="#7a6ea0" strokeWidth="2.5" />
            <ellipse cx="120" cy="176" rx="66" ry="78" fill="#241c40" stroke="#7a6ea0" strokeWidth="3" />
            <path d="M84 132c-10 22-10 66 4 92" stroke="#F7E9CC" strokeOpacity=".22" strokeWidth="6" strokeLinecap="round" fill="none" />
            <ellipse cx="120" cy="184" rx="24" ry="34" fill="#3A2F55" stroke="#5c5182" strokeWidth="2" />
            <path d="M88 256h64l10 30H78z" fill="#2A2140" stroke="#7a6ea0" strokeWidth="2.5" />
            <path d="M120 286v22" stroke="#5c5182" strokeWidth="2" />
            <g transform="rotate(-6 120 334)"><rect x="46" y="306" width="148" height="54" rx="4" fill="#F7E9CC" /><text x="120" y="331" textAnchor="middle" className="tag-k">UNLIT</text><text x="120" y="349" textAnchor="middle" className="tag-s">0 orders tonight</text></g>
          </svg>
          <Foot k={2} chain={chain} />
          <aside className="speaker-notes">{notes[1]}</aside>
        </section>

        <section className="slide s3" aria-label="The player">
          <div className="split">
            <div>
              <p className="kick">23:40 · lights off · one thumb</p>
              <h2>Three orders before bed.</h2>
              <p className="lede">Picture a night-shift nurse in Surabaya: a token, no code. At 06:10, with coffee, they want to know how their agent did.</p>
            </div>
            <div className="draft">
              <p className="who">tonight&apos;s orders · draft</p>
              <p className="orders">“{d.compiled.orders}”</p>
              <p className="count data">{d.compiled.orders.length} / 280 characters</p>
              <span className="stamp draft">DRAFT</span>
            </div>
          </div>
          <Foot k={3} chain={chain} />
          <aside className="speaker-notes">{notes[2]}</aside>
        </section>

        <section className="slide s4" aria-label="Solution">
          <h2>Words in. A policy out.</h2>
          <div className="flow">
            <div className="in"><p className="who">you write</p><p className="orders">“{d.compiled.orders}”</p></div>
            <div className="arrow" aria-hidden><span>compiled once</span><span className="data">{d.compiled.model} · {(d.compiled.ms / 1000).toFixed(1)} s</span></div>
            <div className="browser">
              <div className="bar"><i /><i /><i /><span>semalam.edycu.dev/play</span></div>
              <div className="ticket rb-ticket">
                <p className="who">readback · a real compile, {utc(d.compiled.at)}</p>
                <ul>{d.compiled.lines.slice(1).map((l, k) => <li key={k} className={l.startsWith("  ") ? "in" : ""}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
              </div>
            </div>
          </div>
          <p className="lede narrow">At most 6 fields and 3 rules, read back by plain code. You seal only what you read.</p>
          <Foot k={4} chain={chain} />
          <aside className="speaker-notes">{notes[3]}</aside>
        </section>

        <section className="slide s5" aria-label="How a night works">
          <h2>Sealed. Seeded. Settled.</h2>
          <ol className="night">
            {STOPS.map((s) => (
              <li key={s.t} className={s.k}>
                <svg viewBox="0 0 120 150" aria-hidden className="stop-lamp"><path d="M60 0v26" className="cord" /><circle cx="60" cy="86" r="58" className="halo" /><path d="M42 26h36l-6 13H48z" className="cap" /><ellipse cx="60" cy="80" rx="30" ry="36" className="globe" /><ellipse cx="60" cy="84" rx="12" ry="17" className="mantle" /></svg>
                <p className="t">{s.t}</p><h3>{s.h}</h3><p>{s.p}</p>
              </li>
            ))}
          </ol>
          <Foot k={5} chain={chain} />
          <aside className="speaker-notes">{notes[4]}</aside>
        </section>

        <section className="slide s6" aria-label="The latest night">
          {n && f ? (
            <>
              <h2>Night {n.round}, settled on chain.</h2>
              <LampString lamps={lamps} agents={n.agents} round={n.round} uid="dk6" tag={ordinal(f.rank).toUpperCase()} />
              <dl className="nums">
                <div><dt>{n.agents}</dt><dd>agents: {n.players} {d.testnet ? "testnet" : "player"} accounts{qa ? " (our QA runs)" : ""} + {n.house} house</dd></div>
                <div><dt className="amber">{ordinal(f.rank)}</dt><dd>{f.name} · {f.coins} coins · the tagged lamp</dd></div>
                <div><dt className={n.cliMatch ? "ok" : "bad"}>{n.cliMatch ? "✓" : "✗"}</dt><dd>CLI hash {short(n.resultHash)} {n.cliMatch ? "equals" : "does not equal"} the posted hash</dd></div>
              </dl>
            </>
          ) : <h2>The first night has not settled yet.</h2>}
          <Foot k={6} chain={chain} />
          <aside className="speaker-notes">{notes[5]}</aside>
        </section>

        <section className="slide s7" aria-label="$WIF">
          <h2>Practice costs $WIF. <em>80%</em> burns.</h2>
          <div className="char-ticket big"><span className="burnt"><b>160</b> burned</span><span className="kept"><b>40</b> compute</span></div>
          <p className="wif-line">200 $WIF a practice run, burned by the token&apos;s own burn(). The crown needs a paid run. No prize pool.</p>
          <p className="counter"><b>{d.burned === null ? "—" : d.burned.toLocaleString("en-US")}</b> {d.wif} burned on {chain}{d.paidRuns !== null ? ` · ${d.paidRuns} paid runs${paidQa ? ", all our QA" : ""}` : ""}</p>
          <Foot k={7} chain={chain} />
          <aside className="speaker-notes">{notes[6]}</aside>
        </section>

        <section className="slide s8" aria-label="Built well">
          <h2>Don&apos;t trust us. Re-run it.</h2>
          <div className="hero-num"><span className="big">{d.matched}/{d.nights}</span><div className="rhs"><b className="ok">✓ MATCH</b><span className="lbl">posted nights re-checked by the CLI, from public chain data</span><p className="cmd data"><span className="pr">$</span> {cli}</p></div></div>
          <p className="foot-stats">{d.evidence.runtimes} runtimes, one hash · {d.evidence.p50} ms p50, {d.evidence.benchAgents} agents × {d.evidence.benchTurns} turns · {d.evidence.golden}/{d.evidence.goldenOf} golden prompts · {d.evidence.injectionsSafe}/{d.evidence.injectionsOf} injections refused or kept in schema</p>
          <Foot k={8} chain={chain} />
          <aside className="speaker-notes">{notes[7]}</aside>
        </section>

        <section className="slide s9" aria-label="Status and limits">
          <h2>Where it stands, honestly.</h2>
          <p className="status data">{chain} · {d.nights} nights posted · night {n?.round ?? "—"}: {n?.players ?? 0} {qa ? "QA" : "player"} accounts + {n?.house ?? 0} house · {d.paidRuns ?? "—"} paid runs{paidQa ? " (QA)" : ""}</p>
          <ul className="limits">
            <li><b>Not live yet.</b> The chain 4663 deployment is not live; everything runs on the 46630 testnet with a mock token.</li>
            <li><b>Stated, not solved.</b> A Sybil can fill the 1,000-account cap per round with own-wallet commits.</li>
            <li><b>A relay, not AA.</b> Gas-free is a relay with nightly limits; when it is empty you use your own wallet.</li>
          </ul>
          <Foot k={9} chain={chain} />
          <aside className="speaker-notes">{notes[8]}</aside>
        </section>

        <section className="slide s10" aria-label="The ask">
          <div className="ask">
            <div>
              <h2>Play tonight. Verify at <em className="settled">breakfast.</em></h2>
              <p className="url">semalam.edycu.dev/play</p>
              <p className="url small">{REPO.replace("https://", "")}</p>
            </div>
            <figure className="qr">
              <svg viewBox={QR_VIEWBOX} role="img" aria-label={`QR code for ${QR_URL}`} shapeRendering="crispEdges"><path d={QR_PATH} fill="#1B1530" /></svg>
              <figcaption>{QR_URL.replace("https://", "")}</figcaption>
            </figure>
          </div>
          <Foot k={10} chain={chain} />
          <aside className="speaker-notes">{notes[9]}</aside>
        </section>
      </Deck>
      </div>
    </>
  );
}
