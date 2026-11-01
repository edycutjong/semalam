// Numbers for the landing page and the pitch deck. They come from the same settled artifacts and chain reads the board
// and /verify use, plus measured runs in evidence/. Nothing is typed in by hand: a chain read that fails shows as
// unknown, never as a guess.
import type { Policy } from "@semalam/policy";
import { readback } from "@semalam/policy";
import { HOUSE } from "@semalam/sim/house";
import type { AgentRep } from "@/components/ReplayPlayer";
import { readArtifact, settledRounds, type RoundArtifact } from "./artifact";
import { chainNow, commitCountOf, paidLogs } from "./chain";
import { closeTime, currentRound } from "./clock";
import { CHAIN_ID, EXCLUDED, IS_TESTNET, ORDERS, RESULTS, SCRIMMAGE, WIF_LABEL, addrUrl, txUrl } from "./config";
import { ordinal } from "./rank";
import matrix from "../../../evidence/determinism-matrix.json";
import bench from "../../../evidence/bench.json";
import compilerEval from "../../../evidence/feasibility/compiler-eval.json";
import injection from "../../../evidence/compiler-injection.json";
import recorded from "../../../evidence/replay-2-46630.json";
import qaFile from "../../../evidence/qa-accounts-46630.json";
import compileHook from "../../../evidence/compile-hook.json";

export const REPO = "https://github.com/edycutjong/semalam";
export const SITE = "https://semalam.edycu.dev";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Accounts we ran ourselves (end-to-end + persona QA), per chain — counted and labelled as QA, never as players. */
const QA = new Set(qaFile.chainId === CHAIN_ID ? qaFile.accounts.map((a) => a.toLowerCase()) : []);
const within = <T,>(p: Promise<T>, ms = 8000) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

export type Lamp = { id: string; rank: number; house: boolean; featured: boolean };
export type Featured = {
  id: string; who: string; name: string; lines: string[]; rank: number; coins: number;
  first: string; second: string; decisive: string | null; ruleFired: boolean;
};
export type Night = {
  round: number; agents: number; players: number; qaPlayers: number; operators: number; house: number;
  resultHash: string; drandRound: number; tx: string | null; txUrl: string | null; cliMatch: boolean;
  lamps: Lamp[]; replays: AgentRep[]; houseIds: string[]; featured: Featured;
};
export type Landing = {
  chainId: number; testnet: boolean; wif: string;
  nights: number; matched: number; last: Night | null;
  burned: number | null; paidRuns: number | null; paidQa: number | null; houseOnly: number[];
  compiled: { at: string; orders: string; model: string; ms: number; lines: string[] };
  tonight: { round: number; closeTime: number; chainNow: number; commits: number | null } | null;
  evidence: { runtimes: number; allMatch: boolean; p50: number; benchAgents: number; benchTurns: number; golden: number; goldenOf: number; injectionsSafe: number; injectionsOf: number; model: string };
  recorded: { at: string; cmd: string; exit: number; wallSeconds: number; round: number; chainId: number; stdout: string[]; machine: string };
  links: { scrimmage: string; results: string; orders: string };
};

function policyOf(art: RoundArtifact, id: string, house: boolean): Policy | null {
  const k = id.toLowerCase();
  if (house) return HOUSE.agents.find((a) => a.id.toLowerCase() === k)?.policy ?? null;
  return art.policies?.find((p) => p.id.toLowerCase() === k)?.policy ?? null;
}

/** The featured ticket: the 4th-ranked non-operator agent of the latest posted night, labelled as what it is. */
function night(art: RoundArtifact): Night {
  const s = art.settled;
  const rows = s.ranking;
  const pool = rows.filter((r) => !r.operator);
  const f = pool[Math.min(3, pool.length - 1)];
  const style = f.house ? HOUSE.agents.find((a) => a.id.toLowerCase() === f.id.toLowerCase())?.style : undefined;
  const policy = policyOf(art, f.id, f.house);
  const rep = (s.replays as unknown as AgentRep[]).find((r) => r.id.toLowerCase() === f.id.toLowerCase());
  const finalRank = new Map(rows.map((r) => [r.id.toLowerCase(), r.rank]));
  const houseIds = rows.filter((r) => r.house).map((r) => r.id.toLowerCase());
  const lamps = [...rows]
    .sort((a, b) => (a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1)) // the order ReplayPlayer strings them in
    .map((r) => ({ id: r.id, rank: finalRank.get(r.id.toLowerCase())!, house: r.house, featured: r.id === f.id }));
  return {
    round: art.round, agents: s.agents, players: s.players, operators: s.playersAll - s.players, house: s.agents - s.playersAll,
    qaPlayers: rows.filter((r) => !r.house && !r.operator && QA.has(r.id.toLowerCase())).length,
    resultHash: s.resultHash, drandRound: s.drandRound, tx: art.onchain?.tx ?? null, txUrl: art.onchain?.tx ? txUrl(art.onchain.tx) : null,
    cliMatch: Boolean(art.cli?.match && art.onchain && art.cli.resultHash.toLowerCase() === art.onchain.resultHash.toLowerCase()),
    lamps, replays: s.replays as unknown as AgentRep[], houseIds,
    featured: {
      id: f.id,
      who: f.house ? `house agent · ${f.label}${style ? ` · ${style}` : ""}` : `${IS_TESTNET ? "testnet account" : "player"} ${short(f.id)}${QA.has(f.id.toLowerCase()) ? " · our QA run" : ""}`,
      name: policy?.name ?? f.label ?? short(f.id),
      lines: policy ? readback(policy) : [],
      rank: f.rank, coins: f.coins,
      first: f.house ? `HOUSE · ROUND ${art.round}` : `SEALED · ROUND ${art.round}`,
      second: `SETTLED · ${ordinal(f.rank).toUpperCase()} OF ${s.agents}`,
      decisive: rep?.decisive?.why ?? null,
      ruleFired: ((rep?.decisive as { rule?: number } | undefined)?.rule ?? -1) >= 0,
    },
  };
}

export async function loadLanding(): Promise<Landing> {
  // only this chain's posted nights: a testnet artifact never shows up as a mainnet number
  const arts = (await Promise.all((await settledRounds()).map(readArtifact))).filter((a): a is RoundArtifact => Boolean(a && a.status === "posted" && a.chainId === CHAIN_ID));
  const last = arts.at(-1);
  let burned: number | null = null, paidRuns: number | null = null, paidQa: number | null = null, tonight: Landing["tonight"] = null;
  try {
    const paid = (await within(paidLogs())).filter((p) => !EXCLUDED.includes(p.payer.toLowerCase())); // operator wallets never count
    const wei = paid.reduce((t, p) => t + p.burned, 0n);
    burned = Number(wei / 10n ** 15n) / 1000;
    paidRuns = paid.length;
    paidQa = paid.filter((p) => QA.has(p.payer.toLowerCase())).length;
  } catch { /* unknown, shown as such */ }
  try {
    const now = await within(chainNow());
    const round = currentRound(now);
    let commits: number | null = null;
    try { commits = round > 0 ? await within(commitCountOf(round)) : 0; } catch { /* unknown */ }
    tonight = { round, closeTime: closeTime(round), chainNow: now, commits };
  } catch { /* the client clock asks /api/status again */ }
  const ev = compilerEval.report.find((r) => r.model === "openai/gpt-oss-120b") ?? compilerEval.report[0];
  const b = bench.rows[0];
  return {
    chainId: CHAIN_ID, testnet: IS_TESTNET, wif: WIF_LABEL,
    nights: arts.length,
    matched: arts.filter((a) => a.cli?.match && a.onchain && a.cli.resultHash.toLowerCase() === a.onchain.resultHash.toLowerCase()).length,
    last: last ? night(last) : null,
    burned, paidRuns, paidQa, tonight,
    houseOnly: arts.filter((a) => a.settled.players === 0).map((a) => a.round),
    compiled: { at: compileHook.at, orders: compileHook.orders, model: compileHook.response.model.replace(/^openai\//, ""), ms: compileHook.response.ms, lines: compileHook.response.readback },
    evidence: {
      runtimes: matrix.rows.length, allMatch: matrix.allMatch, p50: Number(b.p50_ms), benchAgents: Number(b.agents), benchTurns: Number(b.turns),
      golden: ev.goldenPass, goldenOf: ev.rows.filter((r) => r.id.startsWith("g")).length,
      injectionsSafe: injection.inSchemaOrRefused, injectionsOf: injection.of, model: ev.model.replace(/^openai\//, ""),
    },
    recorded,
    links: { scrimmage: addrUrl(SCRIMMAGE), results: addrUrl(RESULTS), orders: addrUrl(ORDERS) },
  };
}
