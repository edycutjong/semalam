// The deck's turn-by-turn night: the latest posted night re-run here from its settled artifact (the sealed policies,
// now public, + the pinned house set + the drand randomness), kept only if the re-run gives the posted result hash.
// The turns shown are picked from the trace by fixed rules, never typed in: the opening, the tagged lamp's first best
// rank, the first theft against it after that, the end of that theft run, its lowest point after the best, the close.
import type { Policy } from "@semalam/policy";
import { readback } from "@semalam/policy";
import type { Hex } from "viem";
import { run, type Act, type Agent } from "@semalam/sim";
import { HOUSE } from "@semalam/sim/house";
import { readArtifact } from "./artifact";
import { CHAIN_ID, IS_TESTNET } from "./config";
import qaFile from "../../../evidence/qa-accounts-46630.json";
import { ordinal } from "./rank";

const ACTS: Act[] = ["GATHER", "GUARD", "SHARE", "STEAL"];
export type Who = { name: string; house: boolean };
export type Cell = { t: number; who: string; theirs: Act; mine: Act; delta: number; note: string };
export type Step = {
  t: number; rank: number; coins: number; delta: number;
  act: Act; partner: (Who & { act: Act }) | null; pj: number;
  head: string; text: string; rule?: string; strip?: Cell[];
};
export type NightSteps = {
  round: number; agents: number; turns: number; resultHash: string;
  tag: Who & { policy: string };
  /** the tagged lamp's rank after every turn (index 0 = turn 1) */
  line: number[];
  /** every lamp's rank (lamp order = id order, as the lamp string and the sim seat them) every FRAME turns + each step's turn */
  frames: { t: number; r: number[] }[];
  house: boolean[];
  tagIndex: number;
  steps: Step[];
};
const FRAME = 5;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** our own QA accounts are labelled as such wherever they appear (build/evidence/qa-accounts-46630.json) */
const QA = new Set(qaFile.chainId === CHAIN_ID ? qaFile.accounts.map((a) => a.toLowerCase()) : []);

export async function nightSteps(round: number, taggedId: string): Promise<NightSteps | null> {
  const art = await readArtifact(round);
  if (!art || art.status !== "posted" || !art.onchain) return null;
  const s = art.settled;
  const field: Agent[] = [
    ...HOUSE.agents.map((h) => ({ id: h.id as Hex, policy: h.policy, house: true })),
    ...art.policies.map((p) => ({ id: p.id as Hex, policy: p.policy })),
  ];
  let res;
  try {
    res = run(field, s.randomness as Hex, { round: BigInt(s.round), drandRound: BigInt(s.drandRound), policySetHash: s.policySetHash as Hex, houseSetHash: s.houseSetHash as Hex, trace: true });
  } catch { return null; }
  // the trace is shown only if it IS the posted night
  if (res.resultHash.toLowerCase() !== s.resultHash.toLowerCase() || res.resultHash.toLowerCase() !== art.onchain.resultHash.toLowerCase()) return null;
  const tr = res.trace!;
  const N = res.field.length, T = tr.length;
  const i = res.field.findIndex((a) => a.id.toLowerCase() === taggedId.toLowerCase());
  if (i < 0) return null;
  const houseOf = (j: number) => HOUSE.agents.find((h) => h.id.toLowerCase() === res.field[j].id.toLowerCase());
  const who = (j: number): Who => {
    const h = houseOf(j);
    const id = res.field[j].id;
    return h ? { name: h.label, house: true } : { name: `${QA.has(id.toLowerCase()) ? "QA account" : IS_TESTNET ? "testnet account" : "player"} ${short(id)}`, house: false };
  };
  const pol: Policy = res.field[i].policy;
  const coinsAt = (t: number) => (t === 0 ? 20 : tr[t - 1].coins[i]);
  const rankAt = (t: number) => tr[t - 1].rank[i];
  const line = tr.map((x) => x.rank[i]);
  const ruleLines = readback(pol).filter((l) => /^\s*\d+\.\s/.test(l)).map((l) => l.replace(/^\s*\d+\.\s*/, "").replace(/\s*\(.*?\)\s*\.?$/, "").trim());

  const step = (t: number, head: string, text: string, extra: { rule?: string; strip?: Cell[] } = {}): Step => {
    const x = tr[t - 1], p = x.partner[i];
    return {
      t, rank: x.rank[i], coins: x.coins[i], delta: x.coins[i] - coinsAt(t - 1), act: ACTS[x.act[i]],
      partner: p >= 0 ? { ...who(p), act: ACTS[x.act[p]] } : null, pj: p, head, text, ...extra,
    };
  };
  const steps: Step[] = [];
  // 1 · the opening
  {
    const x = tr[0], p = x.partner[i];
    steps.push(step(1, "the opening", `${ACTS[x.act[i]]} vs ${p >= 0 ? `${ACTS[x.act[p]]}, with ${who(p).name}` : "nobody (alone)"}: ${signed(x.coins[i] - 20)} coins.`));
  }
  // 2 · first time at its best rank
  const best = Math.min(...line);
  const tBest = line.indexOf(best) + 1;
  if (tBest > 1) {
    const same = tr.slice(0, tBest).every((x) => x.act[i] === tr[0].act[i]);
    steps.push(step(tBest, `${ordinal(best)} of ${N}`, `${same ? `${tBest} turns of ${ACTS[tr[0].act[i]]}` : "Its best rank of the night"}: ${ordinal(best)} of ${N} agents, ${coinsAt(tBest).toLocaleString("en-US")} coins.`));
  }
  // 3 + 4 · the first theft against it after that, and the run of thefts by the same neighbour
  let tTheft = 0;
  for (let t = Math.max(tBest, 1) + 1; t <= T && !tTheft; t++) { const p = tr[t - 1].partner[i]; if (p >= 0 && tr[t - 1].act[p] === 3 && coinsAt(t) < coinsAt(t - 1)) tTheft = t; }
  let tEnd = 0;
  if (tTheft) {
    const thief = tr[tTheft - 1].partner[i];
    const hits = [tTheft];
    for (let t = tTheft + 1; t <= T && t - hits[hits.length - 1] <= 2; t++) if (tr[t - 1].partner[i] === thief && tr[t - 1].act[thief] === 3) hits.push(t);
    tEnd = hits[hits.length - 1];
    const tName = who(thief).name;
    // why the neighbour steals: its own rule, read back from its policy
    const tp = res.field[thief].policy, fr = tr[tTheft - 1].fired[thief];
    let why = `${tName} steals from it: ${signed(coinsAt(tTheft) - coinsAt(tTheft - 1))} coins.`;
    if (fr >= 0 && tp.rules[fr].then === "COPY_LEADER") {
      const prev = tr[tTheft - 2];
      const L = Array.from(prev.rank).indexOf(1);
      let since = tTheft - 1;
      while (since > 1 && tr[since - 2].rank[L] === 1) since--;
      const lp = res.field[L].policy;
      const always = lp.opening === "STEAL" && lp.default === "STEAL" && lp.rules.length === 0;
      const after = tp.rules[fr].if === "turn_after" ? ` after turn ${tp.rules[fr].n}` : "";
      why = `At turn ${since} ${who(L).name} takes the lead, and it ${always ? "always steals" : "steals"}. ${tName}, this lamp's neighbour, copies the leader${after}, so it steals too: ${signed(coinsAt(tTheft) - coinsAt(tTheft - 1))} coins.`;
    }
    steps.push(step(tTheft, "a neighbour turns thief", why));
    if (hits.length > 1) {
      const lost = hits.reduce((sum, t) => sum + coinsAt(t) - coinsAt(t - 1), 0);
      const kRet = pol.rules.findIndex((r) => r.if === "partner_stole_from_me" && !r.not);
      let fired = 0;
      for (let t = tTheft; t <= tEnd; t++) if (tr[t - 1].fired[i] === kRet && kRet >= 0) fired++;
      const gap = Math.min(...hits.slice(1).map((t, k) => t - hits[k]));
      let text = `Robbed ${hits.length} times, ${signed(lost)} coins: ${ordinal(rankAt(tEnd))}.`;
      let rule: string | undefined;
      if (kRet >= 0) {
        rule = `its rule ${kRet + 1}: ${ruleLines[kRet] ?? ""}${fired > 0 ? ` (fired ${fired} times in this run)` : ""}`;
        if (fired === 0 && gap > pol.grudge) text += ` Its rule remembers ${pol.grudge} turn${pol.grudge === 1 ? "" : "s"} back; the thief sits beside it every ${ordinal(gap)} turn, so it never steals back.`;
      }
      // the first turns of the run, cell by cell, straight from the trace
      const strip: Cell[] = [];
      for (let t = tTheft; t <= Math.min(T, tTheft + 2); t++) {
        const x = tr[t - 1], p = x.partner[i];
        if (p < 0) continue;
        const robbed = x.act[p] === 3 && p === thief;
        const back = t - (t > tTheft ? hits.filter((h) => h < t).at(-1) ?? tTheft : tTheft);
        strip.push({ t, who: who(p).name, theirs: ACTS[x.act[p]], mine: ACTS[x.act[i]], delta: x.coins[i] - coinsAt(t - 1),
          note: t === tTheft ? "robbed" : robbed ? (x.fired[i] < 0 && back > pol.grudge ? `robbed again · last theft ${back} turns ago` : "robbed again") : "the other neighbour" });
      }
      steps.push(step(tEnd, `robbed ${hits.length} times`, text, { rule, strip }));
    }
  }
  // 5 · its lowest point after the best, when that is a separate moment
  const after = Math.max(tEnd, tBest);
  let tLow = 0, low = 0;
  for (let t = after + 1; t < T; t++) if (line[t - 1] > low) { low = line[t - 1]; tLow = t; }
  if (tLow && low > rankAt(after) && low > line[T - 1]) steps.push(step(tLow, "its lowest rank", `Lowest rank: ${ordinal(low)} (${coinsAt(tLow).toLocaleString("en-US")} coins).`));
  // 6 · the close
  const top = res.ranking[0];
  const topJ = res.field.findIndex((a) => a.id === top.id);
  const topNote = topJ === i ? "" : houseOf(topJ) ? ` 1st was ${who(topJ).name}, a house agent: no season points.` : "";
  // both pools (A11): the whole field, and the accounts alone (house agents and operator addresses left out)
  const ops = new Set(s.ranking.filter((r) => r.operator).map((r) => r.id.toLowerCase()));
  const acct = (j: number) => !res.field[j].house && !ops.has(res.field[j].id.toLowerCase());
  const accts = res.field.map((_, j) => j).filter(acct);
  const ahead = accts.filter((j) => tr[T - 1].rank[j] < rankAt(T)).length;
  const allQa = accts.every((j) => QA.has(res.field[j].id.toLowerCase()));
  const pool = acct(i) ? `, ${ordinal(ahead + 1)} of the ${accts.length} ${IS_TESTNET ? "testnet accounts" : "players"}${allQa ? " (all our QA runs)" : ""}` : "";
  let shared = 0, met = 0;
  if (tLow) for (let t = tLow + 1; t <= T; t++) { const p = tr[t - 1].partner[i]; if (p >= 0) { met++; if (tr[t - 1].act[p] === 2) shared++; } }
  const climb = tLow && met ? ` After turn ${tLow} its neighbours shared back on ${shared} of ${met} meetings.` : "";
  steps.push(step(T, `settled · ${ordinal(rankAt(T))} of ${N}`, `Settled: ${ordinal(rankAt(T))} of ${N} agents${pool}, ${coinsAt(T).toLocaleString("en-US")} coins.${climb}${topNote}`));

  const want = new Set<number>(steps.map((x) => x.t));
  for (let t = FRAME; t <= T; t += FRAME) want.add(t);
  want.add(1);
  const frames = [...want].sort((a, b) => a - b).map((t) => ({ t, r: Array.from(tr[t - 1].rank) }));
  return {
    round: art.round, agents: N, turns: T, resultHash: res.resultHash,
    tag: { ...who(i), policy: pol.name }, line, frames, house: res.field.map((a) => Boolean(a.house)), tagIndex: i, steps,
  };
}
