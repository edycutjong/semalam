// semalam — replay any night from public data and check it against Results.post.
//   semalam replay <round> [--chain 4663|46630] [--rpc <url>]... [--agent <address>] [--json <file>]
//   semalam replay --fixture golden            (offline: the three golden rounds shipped in this package)
//   semalam season <s> [--chain …]             (season points + crown eligibility, as Results.crown must match)
//   semalam house                              (house-set hash + the 30 policies)
// Exit codes: 0 match · 1 MISMATCH (hash, Results.post names another drand round, or Paid logs disagree with the chain)
//             2 refused (bad beacon signature / beacon for the wrong round / house-set or SIM_VERSION pin mismatch)
//             3 network · 4 waiting (chain not final past close, beacon not published, or round not posted / post not
//             final yet — only the last case has a computed hash to print)
//             64 usage · 70 internal error
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256, toBytes, parseAbiItem, getAddress, type Address, type Hex, type PublicClient } from "viem";
import { readback } from "@semalam/policy";
import { verifyBeacon, fetchBeacon, open, DRAND_URLS, type Beacon } from "@semalam/beacon";
import { SIM_VERSION } from "@semalam/sim";
import { HOUSE, HOUSE_SET_HASH } from "@semalam/sim/house";
import { settle, seedRound, closeTime, season as seasonOf, type CommitLog, type Settled } from "@semalam/sim/round";
import deployments from "./deployments.json" with { type: "json" };

const VERSION = "0.1.0";
const here = dirname(fileURLToPath(import.meta.url));
const COMMITTED = parseAbiItem("event Committed(uint256 indexed round, address indexed account, bytes32 policyHash, bytes sealedBlob)");
const POSTED = parseAbiItem("event Posted(uint256 indexed round, bytes32 resultHash, uint64 drandRound)");
const PAID = parseAbiItem("event Paid(address indexed payer, uint256 indexed round, bytes32 draftHash, uint256 amount, uint256 burned, uint256 toCompute)");
const RESULTS_ABI = [
  { type: "function", name: "SIM_VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "HOUSE_SET_HASH", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "GENESIS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const SCRIMMAGE_ABI = [
  { type: "function", name: "paidInSeason", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

class Exit extends Error {
  constructor(public code: number, msg: string) { super(msg); }
}
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c: number) => (s: string) => (color ? `\x1b[${c}m${s}\x1b[0m` : s);
const ok = paint(32), bad = paint(31), dim = paint(2);
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

type Args = { _: string[]; chain: string; rpc: string[]; agent?: string; json?: string; fixture?: string; drand: string[] };
function parse(argv: string[]): Args {
  const a: Args = { _: [], chain: "4663", rpc: [], drand: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Exit(64, `${k} needs a value`); return x; };
    if (k === "--chain") a.chain = v();
    else if (k === "--rpc") a.rpc.push(v());
    else if (k === "--drand") a.drand.push(v());
    else if (k === "--agent") a.agent = v();
    else if (k === "--json") a.json = v();
    else if (k === "--fixture") a.fixture = v();
    else if (k === "--version" || k === "-v") a._.unshift("version");
    else if (k === "--help" || k === "-h") a._.unshift("help");
    else if (k.startsWith("--")) throw new Exit(64, `unknown flag ${k}`);
    else a._.push(k);
  }
  return a;
}

// ---------- chain ----------
type Dep = { name: string; rpcs: string[]; orders: Address | null; results: Address | null; scrimmage: Address | null; fromBlock: number; excluded: Address[] };
function dep(a: Args): Dep {
  const d = (deployments as Record<string, Dep>)[a.chain];
  if (!d) throw new Exit(64, `unknown --chain ${a.chain} (known: ${Object.keys(deployments).join(", ")})`);
  if (!d.orders || !d.results) throw new Exit(64, `no SEMALAM deployment recorded for chain ${a.chain} in this version — try --chain 46630 or a newer semalam`);
  return d;
}
/** Test seam: inject a chain client and a fetch for drand. Production never sets these. */
export const deps: { client?: PublicClient; fetchFn?: typeof fetch } = {};
/**
 * ONE RPC endpoint per run: the first in the list that answers with the right chain id. Mixing nodes mid-run could read
 * the finalized head from one node and logs from a node that has not indexed that far — a silent false MISMATCH.
 */
async function client(a: Args, d: Dep): Promise<PublicClient> {
  if (deps.client) return deps.client;
  const urls = a.rpc.length ? a.rpc : d.rpcs;
  const errs: string[] = [];
  for (const u of urls) {
    const c = createPublicClient({ transport: http(u, { retryCount: 3, retryDelay: 500, timeout: 20_000 }) }) as PublicClient;
    try {
      const id = await c.getChainId();
      if (String(id) === a.chain) return c;
      errs.push(`${u}: chain id ${id}, expected ${a.chain}`);
    } catch (e) {
      errs.push(`${u}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  throw new Exit(3, `no RPC answered for chain ${a.chain}:\n  ${errs.join("\n  ")}\n  hint: pass a working RPC with --rpc <url> (repeatable)`);
}
const net = <T>(p: Promise<T>, what: string): Promise<T> =>
  p.catch((e: unknown) => { throw new Exit(3, `${what} failed: ${(e as Error).message?.split("\n")[0]}\n  hint: pass a working RPC with --rpc <url> (repeatable)`); });

/** eth_getLogs in block ranges up to `to`, halving the range on any provider error. */
async function logsPaged<T>(fetchRange: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  const out: T[] = [];
  let span = 2_000_000n;
  let lo = from;
  while (lo <= to) {
    const hi = lo + span - 1n > to ? to : lo + span - 1n;
    try {
      out.push(...(await fetchRange(lo, hi)));
      lo = hi + 1n;
    } catch (e) {
      if (span <= 1_000n) throw e;
      span /= 2n;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return out;
}

/** A9: refuse unless the on-chain SIM_VERSION and HOUSE_SET_HASH equal this package's. */
export function checkPins(simV: Hex, houseH: Hex, house: Hex = HOUSE_SET_HASH) {
  if (simV !== keccak256(toBytes(SIM_VERSION))) throw new Exit(2, `REFUSED: on-chain SIM_VERSION ${short(simV)} ≠ keccak("${SIM_VERSION}") — use the semalam version for that deployment`);
  if (houseH.toLowerCase() !== house.toLowerCase()) throw new Exit(2, `REFUSED: house-set.json hash ${short(house)} ≠ on-chain HOUSE_SET_HASH ${short(houseH)}`);
}

async function readChainRound(a: Args, round: number) {
  const d = dep(a);
  const c = await client(a, d);
  const [simV, houseH, genesis] = await net(
    Promise.all(RESULTS_ABI.map((f) => c.readContract({ address: d.results!, abi: RESULTS_ABI, functionName: f.name }))),
    "reading Results",
  );
  checkPins(simV as Hex, houseH as Hex);
  const fin = await net(c.getBlock({ blockTag: "finalized" }), "reading the finalized block");
  // every commit of the round must be inside the finalized range, or the replay could miss the last ones
  if (Number(fin.timestamp) < closeTime(Number(genesis), round))
    throw new Exit(4, `waiting: round ${round} closes at ${new Date(closeTime(Number(genesis), round) * 1000).toISOString()}; the finalized chain is not past it yet`);
  const from = BigInt(d.fromBlock);
  const committed = await net(
    logsPaged((lo, hi) => c.getLogs({ address: d.orders!, event: COMMITTED, args: { round: BigInt(round) }, fromBlock: lo, toBlock: hi }), from, fin.number!),
    "eth_getLogs(Committed)",
  );
  const posted = await net(
    logsPaged((lo, hi) => c.getLogs({ address: d.results!, event: POSTED, args: { round: BigInt(round) }, fromBlock: lo, toBlock: hi }), from, fin.number!),
    "eth_getLogs(Posted)",
  );
  const logs: CommitLog[] = committed.map((l) => ({
    account: l.args.account!, policyHash: l.args.policyHash!, sealedBlob: l.args.sealedBlob!, blockNumber: l.blockNumber!, logIndex: l.logIndex!, txHash: l.transactionHash!,
  }));
  const p = posted[0]?.args;
  // a post newer than the finalized block is reported, never compared
  const pending = p ? [] : await c.getLogs({ address: d.results!, event: POSTED, args: { round: BigInt(round) }, fromBlock: fin.number! + 1n, toBlock: "latest" }).catch(() => []);
  return { d, c, genesis: Number(genesis), logs, posted: p ? { resultHash: p.resultHash as Hex, drandRound: Number(p.drandRound) } : null, pendingPostBlock: pending[0]?.blockNumber ?? null, finalized: fin.number! };
}

// ---------- output ----------
function spark(xs: number[]) {
  const bars = "▁▂▃▄▅▆▇█";
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return xs.map((x) => bars[hi === lo ? 3 : Math.round(((x - lo) / (hi - lo)) * 7)]).join("");
}
function printAgent(s: Settled, agent: string) {
  const r = s.ranking.find((x) => x.id.toLowerCase() === agent.toLowerCase());
  const rep = s.replays.find((x) => x.id.toLowerCase() === agent.toLowerCase());
  if (!r || !rep) { console.log(bad(`agent ${agent} did not play this night (void, over capacity or no commit)`)); return; }
  const playersAhead = s.ranking.filter((x) => !x.house && !x.operator && x.rank < r.rank).length;
  console.log(`\nagent ${r.id}${r.label ? ` (${r.label}, HOUSE)` : ""}`);
  const pool = r.house ? "" : r.operator ? " · operator address (not counted as a player)" : ` · ${playersAhead + 1} of ${s.players} players`;
  console.log(`  finished ${r.rank} of ${s.agents} agents${pool} · ${r.coins} coins · ${r.steals} steals · ${r.points} points`);
  console.log(`  coins ${spark(rep.keyframes.map((k) => k.coins))}  ${dim(`t=10…${rep.keyframes.at(-1)?.t}`)}`);
  console.log(`  rank  ${rep.keyframes.filter((_, i) => i % 5 === 4).map((k) => `t${k.t}:#${k.rank}`).join(" → ")}`);
  console.log(`  decisive ${rep.decisive.why}${rep.decisive.partner ? ` (neighbour ${short(rep.decisive.partner)})` : ""}`);
  const pol = r.label ? HOUSE.agents.find((h) => h.label === r.label)?.policy : undefined;
  if (pol) for (const l of readback(pol)) console.log(dim(`  ${l}`));
}
function report(s: Settled, posted: { resultHash: Hex; drandRound: number } | null, extra: { commits: number; beaconNote: string; excluded: number; against?: string; pendingPostBlock?: bigint | null }) {
  const house = s.ranking.filter((r) => r.house).length;
  const where = extra.against === "fixture" ? "the fixture's" : "on-chain";
  console.log(extra.against === "fixture" ? `sim         ${SIM_VERSION}` : `sim         ${SIM_VERSION} == on-chain SIM_VERSION ${ok("✓")}`);
  console.log(`house set   ${short(s.houseSetHash)} == ${where} HOUSE_SET_HASH ${ok("✓")}`);
  console.log(`drand       round ${s.drandRound} = seedRound(${s.round}) ${ok("✓")} · ${extra.beaconNote}`);
  console.log(`commits     ${extra.commits} events · ${s.ranking.filter((r) => !r.house).length + s.voids.length} admitted accounts · ${s.overCapacity.length} over capacity`);
  console.log(`policies    ${s.ranking.length - house} ok · ${s.voids.length} void`);
  for (const v of s.voids) console.log(dim(`  void ${v.account} ${v.reason}`));
  console.log(`players     ${s.players} (${s.playersAll} incl. ${s.playersAll - s.players} operator address${s.playersAll - s.players === 1 ? "" : "es"}; ${extra.excluded} listed) · agents ${s.agents} (${house} house)${s.playersAll === 0 ? " · house-only night" : ""}`);
  console.log(`top 5       ${s.ranking.slice(0, 5).map((r) => `${r.rank}. ${r.label ?? short(r.id)} ${r.coins}`).join(" · ")}`);
  if (!posted) {
    console.log(`resultHash  ${s.resultHash}  ${dim(extra.pendingPostBlock ? `(posted in block ${extra.pendingPostBlock}, not final yet — re-run in a few minutes)` : "(not posted yet)")}`);
    return 4;
  }
  if (posted.drandRound !== s.drandRound) {
    console.log(bad(`Results.post used drand round ${posted.drandRound}, expected ${s.drandRound}`));
    return 1;
  }
  const match = posted.resultHash.toLowerCase() === s.resultHash.toLowerCase();
  console.log(`resultHash  ${s.resultHash}  ${match ? "==" : "!="}  ${extra.against ?? "Results.post"} ${posted.resultHash}  ${match ? ok("✓ MATCH") : bad("✗ MISMATCH")}`);
  return match ? 0 : 1;
}

// ---------- commands ----------
type Fixture = { name: string; genesis: number; round: number; beacon: Beacon; blobs: Hex[]; logs: { account: Address; policyHash: Hex; blob: number; blockNumber: number; logIndex: number }[]; expect: { resultHash: Hex; drandRound: number; houseSetHash: Hex } };
export function fixtureLogs(f: Fixture): CommitLog[] {
  return f.logs.map((l) => ({ account: l.account, policyHash: l.policyHash, sealedBlob: f.blobs[l.blob], blockNumber: BigInt(l.blockNumber), logIndex: l.logIndex }));
}
function fixtureFiles(which: string): string[] {
  if (which !== "golden") return [which];
  for (const dir of [join(here, "../fixtures/golden"), join(here, "../../../fixtures/golden")]) {
    try { return readdirSync(dir).filter((f) => /^round-.*\.json$/.test(f)).sort().map((f) => join(dir, f)); } catch { /* next */ }
  }
  throw new Exit(64, "golden fixtures not found next to the CLI");
}

async function replayFixture(a: Args): Promise<number> {
  let worst = 0;
  for (const file of fixtureFiles(a.fixture!)) {
    const f = JSON.parse(readFileSync(file, "utf8")) as Fixture;
    console.log(`\n== fixture ${f.name} · round ${f.round} · offline`);
    try { verifyBeacon(f.beacon, seedRound(f.genesis, f.round)); } catch (e) { throw new Exit(2, `REFUSED: ${(e as Error).message}`); }
    checkPins(keccak256(toBytes(SIM_VERSION)), f.expect.houseSetHash);
    const s = await settle({ round: f.round, genesis: f.genesis, logs: fixtureLogs(f), beacon: f.beacon }, (b, bc) => open(b, bc));
    const code = report(s, { resultHash: f.expect.resultHash, drandRound: f.expect.drandRound }, { commits: f.logs.length, beaconNote: `BLS signature ${ok("✓")} (quicknet, pinned key)`, excluded: 0, against: "fixture" });
    if (a.agent) printAgent(s, a.agent);
    worst = Math.max(worst, code);
  }
  return worst;
}

async function replayLive(a: Args, round: number): Promise<{ code: number; s: Settled }> {
  const { d, genesis, logs, posted, pendingPostBlock } = await readChainRound(a, round);
  console.log(`semalam ${VERSION} · replay round ${round} · ${d.name} (${a.chain}) · Orders ${short(d.orders!)} · Results ${short(d.results!)}`);
  const need = seedRound(genesis, round);
  if (posted && posted.drandRound !== need) console.log(bad(`warning: Results.post names drand round ${posted.drandRound}, seedRound is ${need}`));
  let beacon: Beacon;
  try {
    beacon = await fetchBeacon(need, a.drand.length ? a.drand : DRAND_URLS, deps.fetchFn);
  } catch (e) {
    const m = (e as Error).message;
    if (m.includes("BAD SIGNATURE") || m.includes("sha256") || m.includes(", need ")) throw new Exit(2, `REFUSED: ${m}`);
    if (m.includes("not published yet")) throw new Exit(4, `waiting for drand round ${need}: ${m}`);
    throw new Exit(3, `${m}\n  hint: pass a drand mirror with --drand <url>`);
  }
  const s = await settle({ round, genesis, logs, beacon }, (b, bc) => open(b, bc), d.excluded);
  const code = report(s, posted, { commits: logs.length, beaconNote: `BLS signature ${ok("✓")} (quicknet, pinned key)`, excluded: d.excluded.length, pendingPostBlock });
  return { code, s };
}

/**
 * Season table from three verified nights. Points come from the FULL-field rank (house agents included as opponents,
 * never as scorers); operator addresses never score. Crown-eligible = paid in that season (Scrimmage.paidInSeason),
 * > 0 points, and a top-half finish of the full field at least once. Order: points desc, then coins desc, then
 * keccak256(account) asc.
 */
export function seasonTable(nights: Settled[], payers: Set<string>) {
  const tally = new Map<string, { points: number; topHalf: boolean; coins: number }>();
  for (const st of nights)
    for (const row of st.ranking) {
      if (row.house || row.operator) continue;
      const t = tally.get(row.id.toLowerCase()) ?? { points: 0, topHalf: false, coins: 0 };
      t.points += row.points; t.coins += row.coins; t.topHalf ||= row.rank <= st.agents / 2;
      tally.set(row.id.toLowerCase(), t);
    }
  const board = [...tally.entries()]
    .map(([id, t]) => ({ id: getAddress(id), ...t, eligible: payers.has(id) && t.topHalf && t.points > 0 }))
    .sort((x, y) => y.points - x.points || y.coins - x.coins || (keccak256(x.id) < keccak256(y.id) ? -1 : 1));
  return { board, champion: board.find((b) => b.eligible) ?? null };
}

async function seasonCmd(a: Args, s: number): Promise<number> {
  if (!Number.isInteger(s) || s < 1) throw new Exit(64, "usage: semalam season <s>  (s ≥ 1; round 1 is the unscored rehearsal)");
  const rounds = [3 * s - 1, 3 * s, 3 * s + 1];
  const nights: Settled[] = [];
  for (const r of rounds) {
    const { code, s: st } = await replayLive(a, r);
    if (code !== 0) throw new Exit(code === 4 ? 4 : 1, `round ${r} is not a verified settled round (exit ${code}) — no season result yet`);
    nights.push(st);
  }
  const d = dep(a);
  const c = await client(a, d);
  const fin = await net(c.getBlock({ blockTag: "finalized" }), "reading the finalized block");
  const paid = await net(
    logsPaged((lo, hi) => c.getLogs({ address: d.scrimmage!, event: PAID, fromBlock: lo, toBlock: hi }), BigInt(d.fromBlock), fin.number!),
    "eth_getLogs(Paid)",
  );
  const payers = new Set(paid.filter((l) => seasonOf(Number(l.args.round)) === s).map((l) => l.args.payer!.toLowerCase()));
  const { board, champion } = seasonTable(nights, payers);
  console.log(`\nseason ${s} (rounds ${rounds.join(", ")}) · ${board.length} players · ${payers.size} paid accounts`);
  for (const [i, b] of board.slice(0, 10).entries()) console.log(`  ${i + 1}. ${b.id} ${b.points} pts${b.eligible ? " · crown-eligible" : ""}`);
  if (!champion) { console.log("champion    none (no account paid this season, scored, AND finished in the top half once)"); return 0; }
  const onchain = await net(c.readContract({ address: d.scrimmage!, abi: SCRIMMAGE_ABI, functionName: "paidInSeason", args: [champion.id, BigInt(s)] }), "paidInSeason");
  if (!onchain) throw new Exit(1, `champion ${champion.id} has a Paid log but Scrimmage.paidInSeason is false — refusing`);
  console.log(`champion    ${champion.id} · ${champion.points} pts ${ok("✓ paidInSeason")}`);
  return 0;
}

function help() {
  console.log(`semalam ${VERSION} — verify SEMALAM nights from public data
  semalam replay <round> [--chain 4663|46630] [--rpc <url>] [--drand <url>] [--agent <address>] [--json <file>]
  semalam replay --fixture golden [--agent <address>]   offline: the golden rounds shipped with this package
  semalam season <s> [--chain …]                         season points and the crown-eligible champion
  semalam house                                          the 30 house agents and HOUSE_SET_HASH
exit: 0 match · 1 mismatch · 2 refused · 3 network · 4 waiting (not final / beacon not published / not posted) · 64 usage · 70 internal`);
}

async function main(argv: string[]): Promise<number> {
  const a = parse(argv);
  const [cmd, arg] = a._;
  if (!cmd || cmd === "help") return help(), cmd ? 0 : 64;
  if (cmd === "version") return console.log(VERSION), 0;
  if (cmd === "house") {
    console.log(`HOUSE_SET_HASH ${HOUSE_SET_HASH} (keccak256 of the canonical house-set.json)`);
    for (const h of HOUSE.agents) console.log(`  ${h.label} ${h.id} ${h.style.padEnd(10)} ${h.policy.name}`);
    return 0;
  }
  if (cmd === "replay") {
    if (a.fixture) {
      if (a.json) throw new Exit(64, "--json writes a live round; with --fixture the expected values are already in the fixture file");
      return replayFixture(a);
    }
    const round = Number(arg);
    if (!Number.isInteger(round) || round < 1) throw new Exit(64, "usage: semalam replay <round>");
    const { code, s } = await replayLive(a, round);
    if (a.agent) printAgent(s, a.agent);
    if (a.json) writeFileSync(a.json, JSON.stringify(s, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1) + "\n");
    return code;
  }
  if (cmd === "season") return seasonCmd(a, Number(arg));
  throw new Exit(64, `unknown command ${cmd}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === (await import("node:fs")).realpathSync(process.argv[1]);
if (isMain)
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Exit ? bad(e.message) : `internal error: ${(e as Error)?.stack ?? e}`);
      process.exit(e instanceof Exit ? e.code : 70);
    },
  );
export { main, Exit, replayLive, parse };
