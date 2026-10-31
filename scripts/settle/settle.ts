// The nightly runner. For each closed round that has no Posted event (oldest first):
//   1. replay it with the bundled CLI in a FRESH process (the CLI also checks the pins and BLS-verifies the beacon),
//   2. replay it again here through the libraries (own log reader) and require the two resultHashes to be equal,
//   3. only then Results.post(round, hash, seedRound) with the POSTER key,
//   4. write apps/web/data/rounds/<n>.json (ranking, voids, ≤30 keyframes per agent, top-30 opponents).
// A mismatch writes a named "hash-mismatch-not-posted" artifact and posts nothing.
// usage: tsx settle/settle.ts [--chain 46630] [--round N] [--dry] [--rpc URL]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, defineChain, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { settle, selectCommits, openCommits, closeTime, seedRound, type CommitLog } from "@semalam/sim/round";
import { HOUSE } from "@semalam/sim/house";
import { fetchBeacon, open } from "@semalam/beacon";
import deployments from "../../packages/cli/src/deployments.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const chainId = arg("--chain") ?? process.env.SEMALAM_CHAIN ?? "46630";
const only = arg("--round") ? Number(arg("--round")) : undefined;
const dry = argv.includes("--dry");
const d = (deployments as Record<string, any>)[chainId];
const rpc = arg("--rpc") ?? d.rpcs[0];
const outDir = path.join(root, "apps/web/data/rounds");
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const EV = parseAbi([
  "event Committed(uint256 indexed round, address indexed account, bytes32 policyHash, bytes sealedBlob)",
  "event Posted(uint256 indexed round, bytes32 resultHash, uint64 drandRound)",
]);
const RES = parseAbi([
  "function post(uint256 round, bytes32 resultHash, uint64 drandRound)",
  "function resultOf(uint256) view returns (bytes32)",
  "function GENESIS() view returns (uint256)",
]);

function posterKey(): Hex {
  if (process.env.POSTER_PRIVATE_KEY) return process.env.POSTER_PRIVATE_KEY as Hex;
  const m = readFileSync(`${homedir()}/.config/semalam/poster.env`, "utf8").match(/^POSTER_PRIVATE_KEY=(.+)$/m);
  if (!m) throw new Error("no POSTER_PRIVATE_KEY");
  return m[1].trim() as Hex;
}

const chain = defineChain({ id: Number(chainId), name: d.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc, { retryCount: 3, retryDelay: 500, timeout: 20_000 }) });

async function pagedLogs<T>(f: (lo: bigint, hi: bigint) => Promise<T[]>, from: bigint, to: bigint) {
  const out: T[] = [];
  let span = 2_000_000n, lo = from;
  while (lo <= to) {
    const hi = lo + span - 1n > to ? to : lo + span - 1n;
    try { out.push(...(await f(lo, hi))); lo = hi + 1n; } catch (e) { if (span <= 1000n) throw e; span /= 2n; }
  }
  return out;
}

function cliRun(round: number) {
  const dist = path.join(root, "packages/cli/dist/semalam.mjs");
  if (!existsSync(dist)) spawnSync("node", ["build.mjs"], { cwd: path.join(root, "packages/cli"), stdio: "inherit" });
  const tmp = path.join(tmpdir(), `semalam-cli-${process.pid}-${round}.json`);
  const r = spawnSync("node", [dist, "replay", String(round), "--chain", chainId, "--rpc", rpc, "--json", tmp], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const version = spawnSync("node", [dist, "--version"], { encoding: "utf8" }).stdout.trim();
  return { code: r.status ?? 70, out: `${r.stdout}${r.stderr}`, version, json: existsSync(tmp) ? JSON.parse(readFileSync(tmp, "utf8")) : null };
}

async function runnerReplay(round: number, genesis: number, finalizedBlock: bigint) {
  const committed = await pagedLogs((lo, hi) => pub.getLogs({ address: d.orders, event: EV[0], args: { round: BigInt(round) }, fromBlock: lo, toBlock: hi }), BigInt(d.fromBlock), finalizedBlock);
  const logs: CommitLog[] = committed.map((l) => ({ account: l.args.account!, policyHash: l.args.policyHash!, sealedBlob: l.args.sealedBlob!, blockNumber: l.blockNumber!, logIndex: l.logIndex!, txHash: l.transactionHash! }));
  const beacon = await fetchBeacon(seedRound(genesis, round));
  const st = await settle({ round, genesis, logs, beacon }, (b, bc) => open(b, bc), d.excluded);
  const { latest } = selectCommits(logs);
  const { agents } = await openCommits(latest, st.drandRound, (s) => open(s, beacon));
  return { st, agents, logs };
}

async function main() {
  const genesis = Number(await pub.readContract({ address: d.results, abi: RES, functionName: "GENESIS" }));
  const fin = await pub.getBlock({ blockTag: "finalized" });
  const todo: number[] = [];
  for (let r = 1; closeTime(genesis, r) + 300 <= Number(fin.timestamp); r++) {
    if (only && r !== only) continue;
    const h = await pub.readContract({ address: d.results, abi: RES, functionName: "resultOf", args: [BigInt(r)] });
    const haveArt = existsSync(path.join(outDir, `${r}.json`));
    if (/^0x0+$/.test(h) || (only && r === only) || !haveArt) todo.push(r); // unposted, or posted without its artifact
  }
  if (!todo.length) return log("nothing to settle");
  mkdirSync(outDir, { recursive: true });
  const wallet = createWalletClient({ account: privateKeyToAccount(posterKey()), chain, transport: http(rpc, { timeout: 20_000 }) });
  // a post is ~70k gas: warn while there is still room for these rounds plus three more nights, not after a post fails
  const [bal, gp] = await Promise.all([pub.getBalance({ address: wallet.account.address }), pub.getGasPrice()]);
  const need = 70_000n * gp * 2n * BigInt(todo.length + 3);
  if (bal < need) log(`POSTER LOW: ${wallet.account.address} holds ${bal} wei, needs ≥ ${need} for ${todo.length} post(s) + 3 nights — top it up from the deployer (HUMAN-TODO)`);
  for (const round of todo) {
    log(`round ${round}: settling (finalized block ${fin.number})`);
    const cli = cliRun(round);
    if (cli.code === 2 || cli.code === 3 || !cli.json) { log(`round ${round}: CLI exit ${cli.code} — not posting\n${cli.out.trim().split("\n").slice(-4).join("\n")}`); continue; }
    if (cli.code === 4 && /waiting/.test(cli.out)) { log(`round ${round}: CLI says waiting — ${cli.out.trim().split("\n").pop()}`); continue; }
    const run = await runnerReplay(round, genesis, fin.number!);
    const cliHash = cli.json.resultHash as Hex, runHash = run.st.resultHash;
    const match = cliHash.toLowerCase() === runHash.toLowerCase();
    let status: "posted" | "hash-mismatch-not-posted" | "poster-reverted" | "unposted" = "unposted";
    let onchain: { resultHash: string; drandRound: number; tx: string | null } | null = null;
    const existing = await pub.readContract({ address: d.results, abi: RES, functionName: "resultOf", args: [BigInt(round)] });
    if (!/^0x0+$/.test(existing)) {
      const p = (await pagedLogs((lo, hi) => pub.getLogs({ address: d.results, event: EV[1], args: { round: BigInt(round) }, fromBlock: lo, toBlock: hi }), BigInt(d.fromBlock), fin.number!))[0];
      onchain = { resultHash: existing, drandRound: Number(p?.args.drandRound ?? run.st.drandRound), tx: p?.transactionHash ?? null };
      status = existing.toLowerCase() === runHash.toLowerCase() && match ? "posted" : "hash-mismatch-not-posted";
    } else if (!match) {
      status = "hash-mismatch-not-posted";
      log(`round ${round}: runner ${runHash} != CLI ${cliHash} — NOT POSTED`);
    } else if (!dry) {
      try {
        const hash = await wallet.writeContract({ address: d.results, abi: RES, functionName: "post", args: [BigInt(round), runHash, BigInt(run.st.drandRound)] });
        const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
        onchain = { resultHash: runHash, drandRound: run.st.drandRound, tx: hash };
        status = rc.status === "success" ? "posted" : "poster-reverted";
        log(`round ${round}: Results.post ${rc.status} ${hash}`);
      } catch (e) { status = "poster-reverted"; log(`round ${round}: post failed — ${(e as Error).message.split("\n")[0]}`); }
    }
    const pol = new Map(run.agents.map((a) => [a.id.toLowerCase(), a.policy]));
    const houseP = new Map(HOUSE.agents.map((h) => [h.id.toLowerCase(), h.policy]));
    const opponents = run.st.ranking.slice(0, 30).map((r) => ({ id: r.id, label: r.label, house: r.house, rank: r.rank, coins: r.coins, policy: (r.house ? houseP : pol).get(r.id.toLowerCase())! }));
    const art = {
      v: 1, chainId: Number(chainId), round, settledAt: new Date().toISOString(), status, onchain,
      cli: { version: cli.version, resultHash: cliHash, match },
      commitTxs: run.logs.map((l) => ({ account: getAddress(l.account), tx: l.txHash! })),
      settled: run.st, opponents,
      policies: run.agents.map((a) => ({ id: a.id, policy: a.policy })),
    };
    if (!dry) writeFileSync(path.join(outDir, `${round}.json`), JSON.stringify(art, (_, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
    log(`round ${round}: ${status} · hash ${runHash.slice(0, 10)}… · ${run.st.players} players of ${run.st.agents} agents${dry ? " (dry)" : ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
