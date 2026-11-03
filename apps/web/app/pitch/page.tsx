import type { Metadata } from "next";
import Deck from "@/components/site/Deck";
import FrozenTicket from "@/components/site/FrozenTicket";
import LampString from "@/components/site/LampString";
import NightSteps from "@/components/site/NightSteps";
import Settle from "@/components/site/Settle";
import { QR_PATH, QR_URL, QR_VIEWBOX } from "@/components/site/qr";
import { loadLanding, REPO } from "@/lib/landing";
import { ordinal } from "@/lib/rank";
import { nightSteps } from "@/lib/steps";
import "../site.css";
import "./deck.css";

export const revalidate = 60; // the same numbers as the landing page, at most a minute old
export const metadata: Metadata = {
  title: "SEMALAM — pitch deck",
  description: "Nine slides: orders at bedtime, one deterministic night market after the 00:00 WIB close, one real night stepped turn by turn, a replay and a hash at breakfast.",
  alternates: { canonical: "/pitch" },
};

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const utc = (iso: string) => `${new Date(iso).toUTCString().slice(5, 16)} ${iso.slice(11, 16)} UTC`;
// Runs before React: sizes the 1920 × 1080 stage to the window, so the first paint is already at the right scale.
const FIT = `(function(){var d=document.documentElement;d.style.setProperty("--deck-s",String(Math.min(d.clientWidth/1920,d.clientHeight/1080)))})()`;
const SHA = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
const TOTAL = 9;

function Foot({ k, chain }: { k: number; chain: string }) {
  return <footer className="slide-foot"><span>SEMALAM · {chain}{SHA ? ` · build ${SHA}` : ""}</span><span>{REPO.replace("https://", "")}</span><span className="pg">{String(k).padStart(2, "0")} / {String(TOTAL).padStart(2, "0")}</span></footer>;
}
type KF = { t: number; rank: number; coins: number };
const th = (r: number) => ordinal(r);
/** The tagged lamp's whole night as one line: its rank every 10 turns, read from the settled artifact (no invented points). */
function NightLine({ kf, turns }: { kf: KF[]; turns: number }) {
  if (kf.length < 2) return null;
  const W = 1680, H = 230, top = 40, bot = 44;
  const best = Math.min(...kf.map((k) => k.rank));
  const iBest = kf.findIndex((k) => k.rank === best);
  const tail = kf.slice(iBest);
  const worst = Math.max(...tail.map((k) => k.rank));
  const iWorst = iBest + tail.findIndex((k) => k.rank === worst);
  const end = kf[kf.length - 1];
  const lo = Math.max(...kf.map((k) => k.rank), best + 1);
  const x = (t: number) => (t / turns) * W;
  const y = (r: number) => top + ((r - best) / (lo - best)) * (H - top - bot);
  type Mark = { k: KF; a: "start" | "middle" | "end"; dy: number };
  const marks: Mark[] = [{ k: kf[iBest], a: "start", dy: 46 }, ...(iWorst < kf.length - 1 && worst > end.rank ? [{ k: kf[iWorst], a: "middle", dy: 40 } as Mark] : []), { k: end, a: "end", dy: -16 }];
  return (
    <figure className="nightline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The tagged lamp's rank through the night: ${marks.map((m) => `${th(m.k.rank)} at turn ${m.k.t}`).join(", ")}.`}>
        <path d={`M0 ${y(best)}H${W}`} className="guide" />
        <polyline points={kf.map((k) => `${x(k.t).toFixed(1)},${y(k.rank).toFixed(1)}`).join(" ")} className="line" />
        {marks.map((m) => <g key={m.k.t}><circle cx={x(m.k.t)} cy={y(m.k.rank)} r="9" className="dot" /><text x={x(m.k.t) + (m.a === "start" ? 14 : 0)} y={y(m.k.rank) + m.dy} textAnchor={m.a}>{th(m.k.rank)} · turn {m.k.t}</text></g>)}
        <text x="0" y={H - 6} className="axis">turn 0</text><text x={W} y={H - 6} textAnchor="end" className="axis">turn {turns}</text>
      </svg>
      <figcaption>the tagged lamp&apos;s rank every 10 turns, from the night&apos;s settled replay</figcaption>
    </figure>
  );
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
  const lastShort = last.replace(/\s+/g, " ").replace(/(0x[0-9a-f]{6})[0-9a-f]{54}([0-9a-f]{4})/g, "$1…$2");
  const qa = Boolean(n && n.qaPlayers === n.players && n.players > 0);
  const paidQa = d.paidRuns !== null && d.paidRuns > 0 && d.paidQa === d.paidRuns;
  const steps = n && f ? await nightSteps(n.round, f.id) : null;
  const legend = n ? `${n.agents} lamps: ${n.players} ${d.testnet ? "testnet" : "player"} accounts${qa ? " (our QA runs)" : ""} + ${n.house} house agents (grey) · brighter = a higher rank at that turn` : "";
  const notes = [
    "SEMALAM is a night market your agent plays while you sleep. Orders at bedtime; after the midnight close (Jakarta time) every agent plays one tournament; at breakfast you watch it back. The ticket is real: the 4th place of the latest testnet night, one of our own QA accounts, not a user.",
    "The judging rules ask for a real reason to use $wif. Holding is not one: a held token gives you nothing to do tonight and nothing to check at breakfast. The card is an illustration of that night, not data. A reason has to bring a holder back tonight, and again tomorrow night.",
    "Picture our player, a night-shift nurse — an illustrative persona, not a user. In bed, lights off, one thumb, three short orders. This is a real call to the live compiler with exactly that sentence: the model runs once, plain code reads the policy back as these lines, and only what you read gets sealed. No model plays the night. Note the order in the readback: rule 1 (steal back from a thief) comes before rule 2 (gather beside a richer neighbour), so a richer neighbour who robbed you still gets robbed back. Reading that before sealing is the point.",
    "One night in four stops. Sealed with a drand timelock at bedtime; closed at midnight; opened and played after the beacon five minutes later; posted on chain only when the CLI agrees (night 2 posted at 00:25 WIB), then replayed at breakfast.",
    "Press → to play the latest night forward. This page re-ran it from the settled artifact when it was built and got the posted result hash, so every turn here is the real night. The stops are picked from that trace by fixed rules: the opening, the tagged lamp's first best rank, the first theft against it after that, the end of that theft run, its lowest point, the close. The tagged lamp is one of our own QA accounts running tit-for-tat; house agents are grey, labelled, and never score.",
    "This is the $WIF reason and the flywheel. Tonight is free. At breakfast the replay shows why you lost. To test a changed rule you practise against last night's top 30: beyond your free run that costs 200 $WIF, 160 of it burned by the token's own burn function and 40 for the compute. Then you seal the fix for the next night. The season crown is an on-chain title, no money, and only an account with a paid run that season can take it. There is no pot: the practice contract (Scrimmage) keeps nothing between calls, has no owner and no withdrawal. On testnet the burns so far are our QA runs, with a mock token.",
    `We don't ask anyone to trust our server: the CLI recomputes every night from chain data. Every posted night is re-checked by the CLI before it goes on chain, and the golden nights hash the same on ${d.evidence.runtimes} runtimes. The night itself is plain code: ${d.evidence.p50} ms at the median for ${d.evidence.benchAgents} agents × ${d.evidence.benchTurns} turns on an M1 Max. The compiler passed ${d.evidence.golden}/${d.evidence.goldenOf} golden prompts and refused or kept in schema ${d.evidence.injectionsSafe}/${d.evidence.injectionsOf} injections.`,
    "Honest status: testnet only, numbers from our own QA runs, house agents labelled. The three notes are shortened from our README's Honest limits 1, 3 and 5.",
    "The ask: play one night and check the hash at breakfast. The QR opens tonight's page.",
  ];
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FIT }} />
      <Settle target="deck-root" ms={5200} />
      <div id="deck-root">
      <Deck notes={notes} steps={steps ? { 4: steps.steps.length } : {}}>
        <section className="slide s1" aria-label="Cover">
          {n && <LampString lamps={lamps} agents={n.agents} round={n.round} uid="dk" />}
          <div className="cover">
            <div>
              <p className="kick"><img src="/icon.svg" alt="" width={46} height={46} className="cover-icon" /><span className="pill">World Is Flat · games</span><span className={`pill${d.testnet ? " test" : ""}`}>{chain}</span></p>
              <h1>You sleep. Your agent works the <em>night market.</em></h1>
              <p className="lede">Orders at bedtime. The market closes at 00:00 WIB and plays when the drand beacon lands. A replay, a rank and a hash at breakfast.</p>
              <div className="mini-term"><span className="pr">$</span> {cli}<br /><span className="ok">{lastShort}</span></div>
            </div>
            {n && <FrozenTicket n={n} className="deck-ticket" />}
          </div>
          <Foot k={1} chain={chain} />
          <aside className="speaker-notes">{notes[0]}</aside>
        </section>

        <section className="slide s2" aria-label="The problem">
          <div className="hook">
            <h2>Holding is not a reason to <em>come back.</em></h2>
            <p className="lede">The judging rules ask for “a real reason to use $wif”. We read that as a reason to open the app tonight, and again tomorrow night.</p>
          </div>
          <figure className="held-card">
            <p className="who">a holder&apos;s night · an illustration</p>
            <ol aria-label="23:40, bed: held. 03:00, woke up: held. 06:10, breakfast: nothing to check.">
              <li><span className="when"><b className="data">23:40</b><small>bed</small></span><span className="held h0">HELD</span></li>
              <li><span className="when"><b className="data">03:00</b><small>woke up</small></span><span className="held h1">HELD</span></li>
              <li><span className="when"><b className="data">06:10</b><small>breakfast</small></span><span className="slot" aria-hidden /></li>
            </ol>
            <figcaption>nothing to check at breakfast.</figcaption>
          </figure>
          <Foot k={2} chain={chain} />
          <aside className="speaker-notes">{notes[1]}</aside>
        </section>

        <section className="slide s4" aria-label="Orders to a policy">
          <p className="kick">bedtime · lights off · one thumb · e.g. a night-shift nurse, no code</p>
          <h2>Three orders before bed. <em>Read back</em> before sealing.</h2>
          <div className="flow">
            <div className="draft-card in"><p className="who">tonight&apos;s orders · {d.compiled.orders.length} / 280 characters</p><p className="orders">“{d.compiled.orders}”</p><span className="stamp draft">DRAFT</span></div>
            <div className="arrow" aria-hidden><span>compiled once</span><span className="data">{d.compiled.model} · {(d.compiled.ms / 1000).toFixed(1)} s</span></div>
            <div className="browser">
              <div className="bar"><i /><i /><i /><span>semalam.edycu.dev/play</span></div>
              <div className="ticket rb-ticket">
                <p className="who">readback · a real compile, {utc(d.compiled.at)}</p>
                <ul>{d.compiled.lines.slice(1).map((l, k) => <li key={k} className={l.startsWith("  ") ? "in" : ""}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
              </div>
            </div>
          </div>
          <p className="lede narrow">At most 6 fields and 3 rules, read back by plain code. You seal only what you read; no model plays the night.</p>
          <Foot k={3} chain={chain} />
          <aside className="speaker-notes">{notes[2]}</aside>
        </section>

        <section className="slide s5" aria-label="How a night works">
          <h2>Sealed. Seeded. Settled.</h2>
          <p className="lede plain">Locked at bedtime. Opened by a public random number no single party controls. Played by plain code anyone can re-run.</p>
          <ol className="night">
            {STOPS.map((s) => (
              <li key={s.t} className={s.k}>
                <svg viewBox="0 0 120 150" aria-hidden className="stop-lamp"><path d="M60 0v26" className="cord" /><circle cx="60" cy="86" r="58" className="halo" /><path d="M42 26h36l-6 13H48z" className="cap" /><ellipse cx="60" cy="80" rx="30" ry="36" className="globe" /><ellipse cx="60" cy="84" rx="12" ry="17" className="mantle" /></svg>
                <p className="t">{s.t}</p><h3>{s.h}</h3><p>{s.p}</p>
              </li>
            ))}
          </ol>
          <Foot k={4} chain={chain} />
          <aside className="speaker-notes">{notes[3]}</aside>
        </section>

        <section className="slide s6 steps" aria-label="One night, turn by turn">
          {n && f && steps ? <NightSteps d={steps} legend={legend} /> : n && f ? (
            <>
              <h2>Night {n.round}, settled on chain.</h2>
              <LampString lamps={lamps} agents={n.agents} round={n.round} uid="dk6" tag={ordinal(f.rank).toUpperCase()} />
              <dl className="nums">
                <div><dt>{n.agents}</dt><dd>agents: {n.players} {d.testnet ? "testnet" : "player"} accounts{qa ? " (our QA runs)" : ""} + {n.house} house</dd></div>
                <div><dt className="amber">{ordinal(f.rank)}</dt><dd>{f.name} · {f.coins} coins · the tagged lamp</dd></div>
                <div><dt className={n.cliMatch ? "ok" : "bad"}>{n.cliMatch ? "✓" : "✗"}</dt><dd>CLI hash {short(n.resultHash)} {n.cliMatch ? "equals" : "does not equal"} the posted hash</dd></div>
              </dl>
              {(() => { const kf = (n.replays.find((r) => r.id.toLowerCase() === f.id.toLowerCase())?.keyframes ?? []) as KF[]; return <NightLine kf={kf} turns={kf.at(-1)?.t ?? 300} />; })()}
            </>
          ) : <h2>The first night has not settled yet.</h2>}
          <Foot k={5} chain={chain} />
          <aside className="speaker-notes">{notes[4]}</aside>
        </section>

        <section className="slide s7" aria-label="$WIF and the flywheel">
          <h2>Practice costs $WIF. <em>No</em> prize pool.</h2>
          <div className="wheel-wrap">
            <div className="wheel">
              <svg viewBox="0 0 760 760" aria-hidden className="ring">
                <defs><marker id="wh-a" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" /></marker></defs>
                <circle cx="380" cy="380" r="300" className="track" />
                {[[-55, -16], [16, 50], [130, 164], [196, 235]].map(([a0, a1]) => { const r = 300, p = (a: number) => `${380 + r * Math.cos((a * Math.PI) / 180)} ${380 + r * Math.sin((a * Math.PI) / 180)}`; return <path key={a0} d={`M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`} className="arc" markerEnd="url(#wh-a)" />; })}
                <g className="runner"><circle cx="380" cy="80" r="11" /></g>
              </svg>
              <ol className="nodes">
                <li className="n1"><b>tonight</b>play free</li>
                <li className="n2"><b>breakfast</b>see why you lost</li>
                <li className="n3"><b>practise</b>change a rule, test it against last night&apos;s top 30<span className="split" aria-hidden><i>160 burned</i><i>40</i></span><small className="per">of 200 $WIF: 40 to compute</small></li>
                <li className="n4"><b>next night</b>seal the fix</li>
              </ol>
              <p className="hub"><b>{d.burned === null ? "—" : d.burned.toLocaleString("en-US")}</b><span>{d.wif} burned{paidQa ? " · our QA runs" : ""}</span><span className="sub">{d.testnet ? "testnet" : chain}</span></p>
            </div>
            <div className="holds">
              <h3>Why it holds up</h3>
              <p><b>It keeps nothing.</b> Each payment splits in the same transaction, 160 burned and 40 to compute; the practice contract has no owner and no withdrawal.</p>
              <p><b>80% burned.</b> 160 of every 200 $WIF practice run, by the token&apos;s own burn().</p>
              <p><b>The crown is a title.</b> No money: only an account with a paid run that season can take it.</p>
            </div>
          </div>
          <Foot k={6} chain={chain} />
          <aside className="speaker-notes">{notes[5]}</aside>
        </section>

        <section className="slide s8" aria-label="Re-run it">
          <h2>Don&apos;t trust us. Re-run it.</h2>
          <div className="hero-num"><span className="big">{d.matched}/{d.nights}</span><div className="rhs"><b className="ok">✓ MATCH</b><span className="lbl">posted nights re-checked by the CLI, from public chain data</span></div></div>
          <div className="proof-run">
            <p className="cmd data"><span className="pr">$</span> {cli}<br /><span className="ok">{lastShort}</span></p>
            <p className="foot-stats">{d.evidence.runtimes} runtimes, one hash · recorded {d.recorded.at.slice(0, 16).replace("T", " ")} UTC</p>
          </div>
          <Foot k={7} chain={chain} />
          <aside className="speaker-notes">{notes[6]}</aside>
        </section>

        <section className="slide s9" aria-label="Status and limits">
          <h2>Where it stands, honestly.</h2>
          <p className="status data">{chain} · {d.nights} nights posted · night {n?.round ?? "—"}: {n?.players ?? 0} {qa ? "QA" : "player"} accounts + {n?.house ?? 0} house · {d.paidRuns ?? "—"} paid runs{paidQa ? " (QA)" : ""}</p>
          <ul className="limits">
            <li><b>Hours old.</b> The chain 4663 deployment is hours old and its first night has not settled; earlier nights shown here are from the 46630 testnet with a mock token.</li>
            <li><b>Stated, not solved.</b> One person with many wallets can fill the 1,000-account cap per round.</li>
            <li><b>Gas-free, with limits.</b> Our relay pays the gas up to a nightly limit; after that you use your own wallet.</li>
          </ul>
          <Foot k={8} chain={chain} />
          <aside className="speaker-notes">{notes[7]}</aside>
        </section>

        <section className="slide s10" aria-label="The ask">
          {n && <div className="ask-lamps"><LampString lamps={lamps} agents={n.agents} round={n.round} uid="dk9" /></div>}
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
          <Foot k={9} chain={chain} />
          <aside className="speaker-notes">{notes[8]}</aside>
        </section>
      </Deck>
      </div>
    </>
  );
}
