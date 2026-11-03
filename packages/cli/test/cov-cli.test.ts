// Coverage for src/cli.ts: in-process runs of main() against an injected chain client / drand fetch / stubbed
// globalThis.fetch (JSON-RPC), offline golden fixtures, the season command and the process entry point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes, type Address, type Hex, type PublicClient } from "viem";
import { deps, main, parse, replayLive, seasonTable, logsPaged, Exit } from "../src/cli.ts";
import { SIM_VERSION } from "@semalam/sim";
import { HOUSE, HOUSE_SET_HASH } from "@semalam/sim/house";
import { closeTime, seedRound, season as seasonOf, type Settled } from "@semalam/sim/round";
import deployments from "../src/deployments.json" with { type: "json" };

const gold = (n: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/golden/${n}.json`, import.meta.url), "utf8"));
const A = gold("round-a"), B = gold("round-b"), C = gold("round-c");
const tmp = mkdtempSync(join(tmpdir(), "semalam-cov-"));
const write = (name: string, v: unknown) => { const p = join(tmp, name); writeFileSync(p, JSON.stringify(v)); return p; };
const DEP = deployments["46630"];
const FROM = BigInt(DEP.fromBlock);
const FIN = FROM + 600_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** Capture console.log / console.error while fn runs; restore them (and the deps seam) afterwards. */
async function cap<T>(fn: () => Promise<T>): Promise<{ out: string; err: string; ret?: T; exit?: Exit; thrown?: unknown }> {
  const out: string[] = [], err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
  console.error = (...a: unknown[]) => { err.push(a.join(" ")); };
  try {
    const ret = await fn();
    return { out: out.join("\n"), err: err.join("\n"), ret };
  } catch (e) {
    return { out: out.join("\n"), err: err.join("\n"), exit: e instanceof Exit ? e : undefined, thrown: e };
  } finally {
    console.log = log; console.error = error;
    delete deps.client; delete deps.fetchFn;
  }
}
/** Make setTimeout fire immediately (logsPaged back-off) for the duration of fn. */
async function fast<T>(fn: () => Promise<T>): Promise<T> {
  const st = globalThis.setTimeout;
  globalThis.setTimeout = ((f: () => void) => st(f, 0)) as unknown as typeof setTimeout;
  try { return await fn(); } finally { globalThis.setTimeout = st; }
}

type Fx = typeof B;
type Mock = {
  genesis?: number; ordersGenesis?: number; fixtures?: Record<number, Fx>; posted?: Record<number, { hash: Hex; drand: number }>;
  pending?: "ok" | "reject" | "none"; finTs?: number; paid?: { payer: Address; round: number }[]; crowned?: Address;
  paidInSeason?: boolean; crownedPolicy?: Hex | null; failRead?: boolean; failBlock?: boolean; failLogs?: string; receipt?: unknown | "reject";
  postedBlock?: bigint;
};
function mock(o: Mock) {
  const genesis = o.genesis ?? B.genesis;
  const fixtures = o.fixtures ?? { [B.round]: B };
  const committed = (r: number) => fixtures[r].logs.map((l: { account: Hex; policyHash: Hex; blob: number; logIndex: number }, i: number) => ({
    args: { round: BigInt(r), account: l.account, policyHash: l.policyHash, sealedBlob: fixtures[r].blobs[l.blob] },
    blockNumber: FROM + 100_000n + BigInt(i) * 150_000n, logIndex: l.logIndex, transactionHash: keccak256(toBytes(`tx${r}-${i}`)),
  }));
  const client = {
    readContract: async ({ functionName, address }: { functionName: string; address: Address }) => {
      if (o.failRead) throw new Error("boom: eth_call\nsecond line");
      if (functionName === "GENESIS") return BigInt(address === DEP.orders ? (o.ordersGenesis ?? genesis) : genesis);
      if (functionName === "championOf") return o.crowned ?? ZERO;
      if (functionName === "paidInSeason") return o.paidInSeason ?? true;
      return { SIM_VERSION: keccak256(toBytes(SIM_VERSION)), HOUSE_SET_HASH }[functionName];
    },
    getBlock: async () => {
      if (o.failBlock) throw new Error("block rpc down");
      return { number: FIN, timestamp: BigInt(o.finTs ?? closeTime(genesis, Math.max(...Object.keys(fixtures).map(Number))) + 3600) };
    },
    getTransactionReceipt: async () => { if (o.receipt === "reject") throw new Error("no receipt"); return o.receipt; },
    getLogs: async ({ event, args, fromBlock, toBlock }: { event: { name: string }; args?: { round?: bigint; season?: bigint }; fromBlock: bigint; toBlock: bigint | "latest" }) => {
      if (o.failLogs === event.name) throw new Error("logs rpc down");
      if (toBlock === "latest") {
        if (o.pending === "reject") throw new Error("pending down");
        return o.pending === "ok" ? [{ blockNumber: FIN + 5n }] : [];
      }
      const inRange = (b: bigint) => b >= fromBlock && b <= toBlock;
      const r = Number(args?.round);
      if (event.name === "Committed") return fixtures[r] ? committed(r).filter((l: { blockNumber: bigint }) => inRange(l.blockNumber)) : [];
      if (event.name === "Posted") { const p = o.posted?.[r]; return p && inRange(FROM + 590_000n) ? [{ args: { round: BigInt(r), resultHash: p.hash, drandRound: BigInt(p.drand) } }] : []; }
      if (event.name === "Paid") return inRange(FROM + 10n) ? (o.paid ?? []).map((p) => ({ args: { payer: p.payer, round: BigInt(p.round) } })) : [];
      if (event.name === "Crowned") return o.crownedPolicy === undefined || o.crownedPolicy === null ? [] : [{ args: { season: args!.season, policyHash: o.crownedPolicy } }];
      return [];
    },
  } as unknown as PublicClient;
  const beacons = Object.values(fixtures).map((f) => f.beacon);
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(String(url));
    const b = beacons.find((x: { round: number }) => String(url).endsWith(`/public/${x.round}`));
    return b ? Response.json(b) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { client, fetchFn, urls };
}
async function run(o: Mock, argv: string[]) {
  const m = mock(o);
  deps.client = m.client; deps.fetchFn = m.fetchFn;
  const r = await cap(() => main(argv));
  return { ...r, urls: m.urls };
}
const live = (o: Mock, extra: string[] = []) => run(o, ["replay", String(B.round), "--chain", "46630", ...extra]);
const postedB = { [B.round]: { hash: B.expect.resultHash as Hex, drand: B.expect.drandRound } };

// ---------- argument parsing, help, version, house ----------
test("parse collects --drand, --json, --fixture, a valid --agent and routes -v / -h to the version / help command", () => {
  const who = B.logs[0].account;
  const a = parse(["replay", "2", "--drand", "https://d1", "--drand=https://d2", "--json", "o.json", "--fixture", "golden", "--agent", who]);
  assert.deepEqual([a.drand, a.json, a.fixture, a.agent, a._], [["https://d1", "https://d2"], "o.json", "golden", who, ["replay", "2"]]);
  assert.deepEqual(parse(["-v"])._, ["version"]);
  assert.deepEqual(parse(["x", "--help"])._, ["help", "x"]);
  assert.deepEqual(parse(["-h"])._, ["help"]);
});

test("parse rejects a non-address --agent, a flag with no value and an unknown flag with exit 64", () => {
  assert.throws(() => parse(["--agent", "0x123"]), (e: unknown) => e instanceof Exit && e.code === 64 && /needs a 0x address, got 0x123/.test(e.message));
  assert.throws(() => parse(["--rpc"]), (e: unknown) => e instanceof Exit && e.code === 64 && /--rpc needs a value/.test(e.message));
  assert.throws(() => parse(["--bogus"]), (e: unknown) => e instanceof Exit && e.code === 64 && /unknown flag --bogus/.test(e.message));
});

test("main with no command prints usage and returns 64; 'help' and -h return 0", async () => {
  const none = await cap(() => main([]));
  assert.equal(none.ret, 64);
  assert.match(none.out, /verify SEMALAM nights from public data/);
  assert.match(none.out, /exit: 0 match · 1 mismatch · 2 refused/);
  assert.equal((await cap(() => main(["help"]))).ret, 0);
  assert.equal((await cap(() => main(["-h"]))).ret, 0);
});

test("main --version and -v print 0.1.0 and return 0", async () => {
  for (const f of ["--version", "-v", "version"]) {
    const r = await cap(() => main([f]));
    assert.equal(r.ret, 0);
    assert.equal(r.out, "0.1.0");
  }
});

test("house lists HOUSE_SET_HASH and every house agent with its policy name", async () => {
  const r = await cap(() => main(["house"]));
  assert.equal(r.ret, 0);
  const lines = r.out.split("\n");
  assert.equal(lines[0], `HOUSE_SET_HASH ${HOUSE_SET_HASH} (keccak256 of the canonical house-set.json)`);
  assert.equal(lines.length, 1 + HOUSE.agents.length);
  assert.ok(lines[1].includes(HOUSE.agents[0].label) && lines[1].includes(HOUSE.agents[0].policy.name));
});

test("an unknown command, a missing / zero / non-numeric round and an unknown chain all exit 64", async () => {
  const cases: [string[], RegExp][] = [
    [["frobnicate"], /unknown command frobnicate/],
    [["replay"], /usage: semalam replay <round>/],
    [["replay", "0"], /usage: semalam replay <round>/],
    [["replay", "abc"], /usage: semalam replay <round>/],
    [["replay", "2", "--chain", "99999"], /unknown --chain 99999 \(known: /],
  ];
  for (const [argv, re] of cases) {
    const r = await cap(() => main(argv));
    assert.ok(r.exit && r.exit.code === 64 && re.test(r.exit.message), `${argv.join(" ")}: ${r.exit?.message}`);
  }
});

// ---------- offline fixtures ----------
test("replay --fixture golden runs all three golden rounds in-process: exit 0 and a MATCH per round", async () => {
  const r = await cap(() => main(["replay", "--fixture", "golden"]));
  assert.equal(r.ret, 0, r.out);
  assert.equal(r.out.match(/✓ MATCH/g)?.length, 3);
  assert.match(r.out, /== fixture round-a · round 1 · offline/);
  assert.match(r.out, /sim         semalam-sim\/1\n/);
  assert.doesNotMatch(r.out, /== on-chain SIM_VERSION/);
  assert.match(r.out, /== the fixture's HOUSE_SET_HASH ✓/);
});

test("a fixture whose expected hash is wrong exits 1 and the golden max-of-codes is kept", async () => {
  const f = structuredClone(B);
  f.expect.resultHash = keccak256(toBytes("other"));
  const r = await cap(() => main(["replay", "--fixture", write("wrong-hash.json", f)]));
  assert.equal(r.ret, 1);
  assert.match(r.out, /✗ MISMATCH/);
});

test("a fixture with a wrong drand round in expect is reported as 'Results.post used drand round' with exit 1", async () => {
  const f = structuredClone(B);
  f.expect.drandRound = f.expect.drandRound + 1;
  const r = await cap(() => main(["replay", "--fixture", write("wrong-drand.json", f)]));
  assert.equal(r.ret, 1);
  assert.match(r.out, new RegExp(`Results.post used drand round ${f.expect.drandRound}, expected ${B.expect.drandRound}`));
});

test("a fixture with a bad beacon or a stale house-set hash is refused with exit 2 in-process", async () => {
  const bad = structuredClone(B);
  bad.beacon.signature = bad.beacon.signature.slice(0, 10) + (bad.beacon.signature[10] === "a" ? "b" : "a") + bad.beacon.signature.slice(11);
  const r1 = await cap(() => main(["replay", "--fixture", write("bsig.json", bad)]));
  assert.ok(r1.exit?.code === 2 && /^REFUSED: /.test(r1.exit.message));
  const old = structuredClone(B);
  old.expect.houseSetHash = keccak256(toBytes("an-older-house-set"));
  const r2 = await cap(() => main(["replay", "--fixture", write("old-house.json", old)]));
  assert.ok(r2.exit?.code === 2 && /house-set\.json hash/.test(r2.exit.message));
});

test("a missing fixture file is an internal error (the raw ENOENT), not a silent success", async () => {
  const r = await cap(() => main(["replay", "--fixture", join(tmp, "nope.json")]));
  assert.ok(!r.exit && (r.thrown as NodeJS.ErrnoException).code === "ENOENT");
});

test("--agent for a player prints rank, coin sparkline, rank track and the decisive turn", async () => {
  const who = B.logs[0].account;
  const r = await cap(() => main(["replay", "--fixture", write("b.json", B), "--agent", who]));
  assert.equal(r.ret, 0);
  assert.match(r.out, new RegExp(`agent ${who}`));
  assert.match(r.out, /finished \d+ of \d+ agents · \d+ of \d+ players · \d+ coins · \d+ steals · \d+ points/);
  assert.match(r.out, /rank  t\d+:#\d+( → t\d+:#\d+)+/);
  assert.match(r.out, /decisive /);
});

test("--agent for a house agent labels it HOUSE and prints the policy readback", async () => {
  const h = HOUSE.agents[0];
  const r = await cap(() => main(["replay", "--fixture", write("b2.json", B), "--agent", h.id]));
  assert.equal(r.ret, 0);
  assert.match(r.out, new RegExp(`agent ${h.id} \\(${h.label}, HOUSE\\)`));
  assert.match(r.out, /finished \d+ of \d+ agents · \d+ coins/);
  assert.doesNotMatch(r.out, /players ·/);
  assert.ok(r.out.split("decisive ")[1].split("\n").length > 1, "readback lines follow the decisive line");
});

test("--agent for an address that did not play says so in the output and still exits 0", async () => {
  const stranger = "0x00000000000000000000000000000000000000ee";
  const r = await cap(() => main(["replay", "--fixture", write("b3.json", B), "--agent", stranger]));
  assert.equal(r.ret, 0);
  assert.match(r.out, new RegExp(`agent ${stranger} did not play this night`));
});

// ---------- live replay edge cases (injected client) ----------
test("live: Orders.GENESIS ≠ Results.GENESIS is refused with exit 2", async () => {
  const r = await live({ posted: postedB, ordersGenesis: B.genesis + 1 });
  assert.equal(r.exit?.code, 2);
  assert.match(r.exit!.message, /Orders\.GENESIS \d+ ≠ Results\.GENESIS \d+/);
});

test("live: an RPC error reading Results exits 3 with the first line of the error and the --rpc hint", async () => {
  const r = await live({ failRead: true });
  assert.equal(r.exit?.code, 3);
  assert.match(r.exit!.message, /^reading Results failed: boom: eth_call\n  hint: pass a working RPC with --rpc/);
  assert.doesNotMatch(r.exit!.message, /second line/);
});

test("live: failing finalized-block, Committed-log and Posted-log reads exit 3 naming the call that failed", async () => {
  assert.match((await live({ failBlock: true })).exit!.message, /^reading the finalized block failed: block rpc down/);
  await fast(async () => {
    const c = await live({ failLogs: "Committed" });
    assert.equal(c.exit?.code, 3);
    assert.match(c.exit!.message, /^eth_getLogs\(Committed\) failed: logs rpc down/);
    assert.match((await live({ failLogs: "Posted" })).exit!.message, /^eth_getLogs\(Posted\) failed/);
  });
});

test("live: the deploy-receipt check is skipped for an injected client (no receipt call)", async () => {
  const m = mock({ posted: postedB });
  (m.client as unknown as { getTransactionReceipt: () => never }).getTransactionReceipt = () => { throw new Error("must not be called"); };
  deps.client = m.client; deps.fetchFn = m.fetchFn;
  const r = await cap(() => main(["replay", "2", "--chain", "46630"]));
  assert.equal(r.ret, 0, r.out + r.exit?.message);
});

/** A client that is visible to client() on its first read and absent for `!deps.client`, so the receipt check runs. */
async function withReceiptCheck(o: Mock, mutate?: () => void) {
  const m = mock(o);
  let n = 0;
  Object.defineProperty(deps, "client", { configurable: true, get: () => (n++ % 3 !== 2 ? m.client : undefined), set: () => {} });
  deps.fetchFn = m.fetchFn;
  const saved = { ...DEP };
  mutate?.();
  try { return await cap(() => main(["replay", "2", "--chain", "46630"])); }
  finally { Object.assign(DEP, saved); if (!("ordersDeployTx" in saved)) delete (DEP as Record<string, unknown>).ordersDeployTx; }
}
test("live: a chain record with no ordersDeployTx is refused (exit 2) because fromBlock cannot be proven", async () => {
  const r = await withReceiptCheck({ posted: postedB }, () => { (DEP as Record<string, unknown>).ordersDeployTx = null; });
  assert.equal(r.exit?.code, 2);
  assert.match(r.exit!.message, /no ordersDeployTx for chain 46630 .*fromBlock \d+/);
});
test("live: a deploy receipt for another contract or another block is refused (exit 2)", async () => {
  const wrongAddr = await withReceiptCheck({ posted: postedB, receipt: { contractAddress: ZERO, blockNumber: FROM } });
  assert.equal(wrongAddr.exit?.code, 2);
  assert.match(wrongAddr.exit!.message, /is not the block that created Orders/);
  const noAddr = await withReceiptCheck({ posted: postedB, receipt: { contractAddress: null, blockNumber: FROM } });
  assert.equal(noAddr.exit?.code, 2);
  const wrongBlock = await withReceiptCheck({ posted: postedB, receipt: { contractAddress: DEP.orders, blockNumber: FROM + 1n } });
  assert.match(wrongBlock.exit!.message, new RegExp(`deploy tx block ${FROM + 1n}`));
});
test("live: an unreadable deploy receipt exits 3; a matching receipt (any address case) lets the replay MATCH", async () => {
  const gone = await withReceiptCheck({ posted: postedB, receipt: "reject" });
  assert.equal(gone.exit?.code, 3);
  assert.match(gone.exit!.message, /^reading the Orders deploy receipt failed: no receipt/);
  const good = await withReceiptCheck({ posted: postedB, receipt: { contractAddress: DEP.orders.toLowerCase(), blockNumber: FROM } });
  assert.equal(good.ret, 0, good.out);
  assert.match(good.out, /✓ MATCH/);
});

test("live: a failing look-ahead for a post above the finalized head is treated as 'not posted yet' (exit 4)", async () => {
  const r = await live({ pending: "reject" });
  assert.equal(r.ret, 4);
  assert.match(r.out, /\(not posted yet\)/);
});

test("live: Results.post naming another drand round warns, reports the mismatch and exits 1 with the dispute help", async () => {
  const r = await live({ posted: { [B.round]: { hash: B.expect.resultHash as Hex, drand: B.expect.drandRound + 1 } } });
  assert.equal(r.ret, 1);
  assert.match(r.out, new RegExp(`warning: Results.post names drand round ${B.expect.drandRound + 1}, seedRound is ${B.expect.drandRound}`));
  assert.match(r.out, new RegExp(`Results.post used drand round ${B.expect.drandRound + 1}, expected ${B.expect.drandRound}`));
  assert.match(r.out, /what this means/);
  assert.match(r.out, /semalam replay 2 --chain 46630 --json round-2\.json/);
});

test("live: drand failures map to exit 3 with a --drand hint; --drand mirrors are the URLs actually tried", async () => {
  const f = structuredClone(B);
  f.beacon.round += 1; // the mirror has no such round for seedRound → 404 → 'not published yet'
  const m = mock({ posted: postedB, fixtures: { [B.round]: f } });
  deps.client = m.client;
  deps.fetchFn = (async () => new Response("oops", { status: 500 })) as unknown as typeof fetch;
  const r = await cap(() => main(["replay", "2", "--chain", "46630", "--drand", "https://mirror.example"]));
  assert.equal(r.exit?.code, 3);
  assert.match(r.exit!.message, /HTTP 500 from https:\/\/mirror\.example[^\n]*\n  hint: pass a drand mirror with --drand <url>/);
  const w = await run({ posted: postedB, fixtures: { [B.round]: f } }, ["replay", "2", "--chain", "46630", "--drand", "https://mirror.example"]);
  assert.equal(w.exit?.code, 4);
  assert.match(w.exit!.message, /^waiting for drand round \d+: drand: round \d+ not published yet/);
  assert.ok(w.urls.every((u) => new URL(u).origin === "https://mirror.example"));
});

test("live: --json writes the settled night with bigints as strings; --agent prints the agent block first", async () => {
  const file = join(tmp, "night.json");
  const who = B.logs[0].account;
  const r = await live({ posted: postedB }, ["--json", file, "--agent", who]);
  assert.equal(r.ret, 0, r.out);
  assert.match(r.out, new RegExp(`agent ${who}`));
  const j = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(j.resultHash, B.expect.resultHash);
  assert.equal(readFileSync(file, "utf8").endsWith("}\n"), true);
});

test("live: --json to an unwritable path is an internal (non-Exit) error", async () => {
  const r = await live({ posted: postedB }, ["--json", join(tmp, "no-such-dir", "x.json")]);
  assert.ok(!r.exit && (r.thrown as NodeJS.ErrnoException).code === "ENOENT");
});

test("live: an operator (excluded) address is shown as 'operator address (not counted as a player)'", async () => {
  const f = structuredClone(B);
  const op = DEP.excluded[0];
  f.logs[0].account = op;
  const r = await live({ fixtures: { [B.round]: f } }, ["--agent", op]);
  if (/did not play/.test(r.out)) assert.fail(`operator commit was void: ${r.out}`);
  assert.match(r.out, /operator address \(not counted as a player\)/);
});

// ---------- log paging ----------
test("logsPaged gives up with the provider's error once the range cannot be halved below 1,000 blocks", async () => {
  let tries = 0;
  await fast(async () => {
    await assert.rejects(logsPaged(async () => { tries++; throw new Error("range too large"); }, 0n, 5_000_000n), /range too large/);
  });
  assert.equal(tries, 12); // 2,000,000 → 976 blocks: eleven halvings, the twelfth failure is thrown
});

test("logsPaged keeps a full page when it is a single block (it cannot be split further)", async () => {
  const page = Array.from({ length: 1000 }, (_, i) => i);
  assert.deepEqual(await logsPaged(async () => page, 7n, 7n), page);
});

// ---------- real RPC client over a stubbed fetch ----------
function rpcStub(handlers: Record<string, (url: string) => unknown>, seen: string[]) {
  return (async (input: unknown, init?: { body?: string }) => {
    const url = typeof input === "string" ? input : (input as { url: string }).url;
    const body = JSON.parse(init?.body ?? "{}");
    seen.push(`${url.replace(/\/$/, "")} ${body.method}`);
    const h = handlers[url.replace(/\/$/, "")];
    if (!h) return new Response("", { status: 503 });
    const result = h(body.method);
    const payload = result instanceof Error ? { jsonrpc: "2.0", id: body.id, error: { code: -32602, message: result.message } } : { jsonrpc: "2.0", id: body.id, result };
    return Response.json(payload);
  }) as unknown as typeof fetch;
}
const blockJson = { number: "0x10", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), timestamp: "0x10", transactions: [], uncles: [], gasLimit: "0x1", gasUsed: "0x0", miner: ZERO, nonce: "0x0000000000000000", difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", logsBloom: "0x" + "00".repeat(256), receiptsRoot: "0x" + "33".repeat(32), sha3Uncles: "0x" + "44".repeat(32), size: "0x1", stateRoot: "0x" + "55".repeat(32), transactionsRoot: "0x" + "66".repeat(32), mixHash: "0x" + "77".repeat(32) };

test("rpc: no endpoint answering for the chain exits 3 listing each endpoint's failure and the --rpc hint", async () => {
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = rpcStub({
    "https://rpc-a.test": () => new Error("method not found\nextra"),
    "https://rpc-b.test": (m) => (m === "eth_chainId" ? "0x1" : blockJson),
  }, seen);
  try {
    const r = await cap(() => main(["replay", "2", "--chain", "46630", "--rpc", "https://rpc-a.test", "--rpc=https://rpc-b.test", "--rpc", "https://rpc-down.test"]));
    assert.equal(r.exit?.code, 3);
    assert.match(r.exit!.message, /no RPC answered for chain 46630:/);
    assert.match(r.exit!.message, /https:\/\/rpc-a\.test: Invalid parameters were provided/);
    assert.match(r.exit!.message, /https:\/\/rpc-b\.test: chain id 1, expected 46630/);
    assert.match(r.exit!.message, /https:\/\/rpc-down\.test: /);
    assert.match(r.exit!.message, /hint: pass a working RPC with --rpc <url> \(repeatable\)/);
  } finally { globalThis.fetch = real; }
});

test("rpc: the first endpoint with the right chain id and a finalized head is used once per run (cached across calls)", async () => {
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = rpcStub({
    "https://pick-bad.test": () => new Error("nope"),
    "https://pick-ok.test": (m) => (m === "eth_chainId" ? "0xb626" : m === "eth_getBlockByNumber" ? blockJson : new Error("eth_call not supported")),
  }, seen);
  try {
    const argv = ["replay", "2", "--chain", "46630", "--rpc", "https://pick-bad.test", "--rpc", "https://pick-ok.test"];
    for (let i = 0; i < 2; i++) {
      const r = await cap(() => main(argv));
      assert.equal(r.exit?.code, 3);
      assert.match(r.exit!.message, /^reading Results failed: /);
    }
    assert.equal(seen.filter((s) => s === "https://pick-bad.test eth_chainId").length, 1, "the endpoint probe ran once");
    assert.equal(seen.filter((s) => s === "https://pick-ok.test eth_chainId").length, 1);
    assert.ok(seen.some((s) => s === "https://pick-ok.test eth_call"));
  } finally { globalThis.fetch = real; }
});

// ---------- season ----------
const G2 = B.genesis - 86400; // rounds 2,3,4 of this genesis close on the days of golden rounds a, b, c → their real beacons
const SEASON = { 2: A, 3: B, 4: C } as Record<number, Fx>;
const sm = (o: Mock = {}) => ({ genesis: G2, fixtures: SEASON, finTs: closeTime(G2, 4) + 3600, ...o });
const sargv = ["season", "1", "--chain", "46630"];

async function nights() {
  const m = mock(sm());
  deps.client = m.client; deps.fetchFn = m.fetchFn;
  const out: Settled[] = [];
  const hashes: Record<number, { hash: Hex; drand: number }> = {};
  await cap(async () => {
    for (const r of [2, 3, 4]) {
      const { s } = await replayLive(parse(["--chain", "46630"]), r);
      out.push(s);
      hashes[r] = { hash: s.resultHash as Hex, drand: seedRound(G2, r) };
    }
  });
  return { nights: out, hashes };
}
const sRun = (o: Mock, argv = sargv) => run(sm(o), argv);

test("season 1 is made of rounds 2, 3 and 4 and each night is settled from the same chain", async () => {
  const { nights: ns, hashes } = await nights();
  assert.equal(ns.length, 3);
  assert.deepEqual(ns.map((n) => n.round), [2, 3, 4]);
  assert.ok([2, 3, 4].every((r) => seasonOf(r) === 1));
  assert.equal(new Set(Object.values(hashes).map((h) => h.hash)).size, 3);
});

test("season: unverified nights stop it — a not-yet-posted night exits 4, a mismatching one exits 1", async () => {
  const { hashes } = await nights();
  const none = await sRun({ posted: {} });
  assert.equal(none.exit?.code, 4);
  assert.match(none.exit!.message, /^round 2 is not a verified settled round \(exit 4\) — no season result yet/);
  const wrong = await sRun({ posted: { ...hashes, 2: { hash: keccak256(toBytes("x")), drand: hashes[2].drand } } });
  assert.equal(wrong.exit?.code, 1);
  assert.match(wrong.exit!.message, /round 2 is not a verified settled round \(exit 1\)/);
});

test("season: with no payer there is no champion; a crown on chain for that season is a MISMATCH (1), none posted is fine (0)", async () => {
  const { hashes } = await nights();
  const quiet = await sRun({ posted: hashes });
  assert.equal(quiet.ret, 0, quiet.out);
  assert.match(quiet.out, /season 1 \(rounds 2, 3, 4\) · \d+ players · 0 paid accounts/);
  assert.match(quiet.out, /champion    none \(no account paid this season, scored, AND finished in the top half once\)/);
  assert.match(quiet.out, /crown       not posted on chain yet/);
  const crowned = await sRun({ posted: hashes, crowned: "0x00000000000000000000000000000000000000c1" });
  assert.equal(crowned.ret, 1);
  assert.match(crowned.out, /crown       Results\.championOf\(1\) = 0x0+c1/);
  assert.match(crowned.out, /✗ MISMATCH — a crown was posted for a season with no eligible champion/);
});

test("season: a Paid log from another season does not make anyone crown-eligible", async () => {
  const { nights: ns, hashes } = await nights();
  const top = seasonTable(ns, new Set()).board[0].id;
  const r = await sRun({ posted: hashes, paid: [{ payer: top, round: 10 }] });
  assert.equal(seasonOf(10) === 1, false);
  assert.equal(r.ret, 0, r.out);
  assert.match(r.out, /0 paid accounts/);
  assert.match(r.out, /champion    none/);
});

async function champ() {
  const { nights: ns, hashes } = await nights();
  const all = new Set(ns.flatMap((n) => n.ranking.filter((x) => !x.house && !x.operator).map((x) => x.id.toLowerCase())));
  const t = seasonTable(ns, all);
  const champion = t.champion!;
  assert.ok(champion, "someone is crown-eligible when everyone paid");
  const want = [...ns].reverse().map((n) => n.ranking.find((x) => x.id.toLowerCase() === champion.id.toLowerCase())?.policyHash).find(Boolean) as Hex;
  const paid = [...all].map((p) => ({ payer: p as Address, round: 3 }));
  return { hashes, champion, want, paid };
}

test("season: eligible champion, crown not on chain yet → table, champion line and exit 4 (waiting)", async () => {
  const { hashes, champion, paid } = await champ();
  const r = await sRun({ posted: hashes, paid });
  assert.equal(r.ret, 4, r.out);
  assert.match(r.out, new RegExp(`  1\\. ${champion.id} ${champion.points} pts · crown-eligible`));
  assert.match(r.out, new RegExp(`champion    ${champion.id} · ${champion.points} pts ✓ paidInSeason`));
  assert.match(r.out, /crown       not posted on chain yet/);
});

test("season: the posted crown naming someone else is a MISMATCH (exit 1)", async () => {
  const { hashes, paid } = await champ();
  const r = await sRun({ posted: hashes, paid, crowned: "0x00000000000000000000000000000000000000c1" });
  assert.equal(r.ret, 1);
  assert.match(r.out, /✗ MISMATCH — the posted crown is not the champion computed from the three nights/);
});

test("season: Scrimmage.paidInSeason false for the computed champion is refused with exit 1", async () => {
  const { hashes, champion, paid } = await champ();
  const r = await sRun({ posted: hashes, paid, paidInSeason: false });
  assert.equal(r.exit?.code, 1);
  assert.match(r.exit!.message, new RegExp(`champion ${champion.id} has a Paid log but Scrimmage.paidInSeason is false`));
});

test("season: crown posted but its Crowned log is not final yet → exit 4; a different policyHash → MISMATCH (1); the right one → MATCH (0)", async () => {
  const { hashes, champion, want, paid } = await champ();
  const base = { posted: hashes, paid, crowned: champion.id.toLowerCase() as Address };
  const lagging = await sRun({ ...base, crownedPolicy: null });
  assert.equal(lagging.ret, 4);
  assert.match(lagging.out, /posted but its Crowned log is not final yet/);
  const other = await sRun({ ...base, crownedPolicy: keccak256(toBytes("some other policy")) });
  assert.equal(other.ret, 1);
  assert.match(other.out, /✗ MISMATCH — Crowned\.policyHash 0x[0-9a-f]{4}…[0-9a-f]{4} is not the champion's played policy/);
  const good = await sRun({ ...base, crownedPolicy: want });
  assert.equal(good.ret, 0, good.out);
  assert.match(good.out, /✓ MATCH — the posted crown is the computed champion/);
  assert.match(good.out, new RegExp(`crown       Results.championOf\\(1\\) = ${champion.id.toLowerCase()}`));
});

test("season: a failing Paid-log read exits 3 naming eth_getLogs(Paid)", async () => {
  const { hashes } = await nights();
  await fast(async () => {
    const r = await sRun({ posted: hashes, failLogs: "Paid" });
    assert.equal(r.exit?.code, 3);
    assert.match(r.exit!.message, /^eth_getLogs\(Paid\) failed: logs rpc down/);
  });
});

// ---------- more edges ----------
test("rpc: with no --rpc flag the deployment's own endpoint list is probed (and cached under that key)", async () => {
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = rpcStub({ [DEP.rpcs[0]]: (m) => (m === "eth_chainId" ? "0xb626" : m === "eth_getBlockByNumber" ? blockJson : new Error("no eth_call")) }, seen);
  try {
    for (let i = 0; i < 2; i++) {
      const r = await cap(() => main(["replay", "2", "--chain", "46630"]));
      assert.match(r.exit!.message, /^reading Results failed: /);
    }
    assert.equal(seen.filter((s) => s === `${DEP.rpcs[0]} eth_chainId`).length, 1);
  } finally { globalThis.fetch = real; }
});

test("golden fixtures: the package-local folder is tried first, the repo-root folder is the fallback, neither → exit 64", async () => {
  const fs = (await import("node:fs")).default as unknown as { readdirSync: typeof import("node:fs").readdirSync };
  const { syncBuiltinESMExports } = await import("node:module");
  const real = fs.readdirSync;
  const dirs: string[] = [];
  try {
    fs.readdirSync = ((d: string, ...rest: unknown[]) => {
      dirs.push(String(d));
      if (dirs.length === 1) throw new Error("first dir unreadable");
      return (real as (...a: unknown[]) => unknown)(d, ...rest);
    }) as unknown as typeof real;
    syncBuiltinESMExports();
    const ok = await cap(() => main(["replay", "--fixture", "golden"]));
    assert.equal(ok.ret, 0, ok.out);
    assert.equal(ok.out.match(/✓ MATCH/g)?.length, 3);
    assert.equal(dirs.length, 2);
    assert.match(dirs[0], /fixtures[\\/]golden$/); // either separator: Windows paths use backslashes
    fs.readdirSync = (() => { throw new Error("nothing readable"); }) as unknown as typeof real;
    syncBuiltinESMExports();
    const none = await cap(() => main(["replay", "--fixture", "golden"]));
    assert.ok(none.exit?.code === 64 && /golden fixtures not found next to the CLI/.test(none.exit.message));
  } finally { fs.readdirSync = real; syncBuiltinESMExports(); }
});

test("a night with no commits is reported as a house-only night with zero players", async () => {
  const f = structuredClone(B);
  f.logs = [];
  const r = await cap(() => main(["replay", "--fixture", write("empty.json", f)]));
  assert.equal(r.ret, 1); // the fixture's expected hash was for the three commits
  assert.match(r.out, /players     0 \(0 incl\. 0 operator addresses; 0 listed\) · agents 30 \(30 house\) · house-only night/);
  assert.match(r.out, /top 5       1\. house-/);
});

test("season table: players tied on points and coins are ordered by keccak256(account) ascending", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Hex);
  const rows = ids.map((id, i) => ({ rank: i + 1, id, label: null, house: false, operator: false, coins: 50, steals: 0, points: 10, policyHash: null }));
  const t = seasonTable([{ agents: 8, ranking: rows } as unknown as Settled], new Set());
  const expected = [...t.board.map((b) => b.id)].sort((x, y) => (keccak256(x) < keccak256(y) ? -1 : 1));
  assert.deepEqual(t.board.map((b) => b.id), expected);
  assert.equal(t.board.length, 8);
  assert.equal(t.champion, null);
});

// ---------- process entry point (child process; V8 coverage is inherited through NODE_V8_COVERAGE) ----------
const pkg = fileURLToPath(new URL("..", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const child = (args: string[], pre: string[] = [], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", ...pre, cliPath, ...args], { cwd: pkg, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", ...env } });

test("entry: run as the main script it exits with main()'s code (house → 0, usage error → 64 on stderr)", () => {
  const h = child(["house"]);
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /^HOUSE_SET_HASH 0x/);
  const bad = child(["frobnicate"]);
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /unknown command frobnicate/);
});

test("entry: an unexpected error becomes 'internal error: …' on stderr with exit 70", () => {
  const r = child(["replay", "--fixture", join(tmp, "missing-fixture.json")]);
  assert.equal(r.status, 70);
  assert.match(r.stderr, /^internal error: Error: ENOENT/);
});

test("entry: win32 path comparison is case-insensitive and still detects the main script", () => {
  const r = child(["--version"], ["--import", "data:text/javascript,Object.defineProperty(process,'platform',{value:'win32'})"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "0.1.0");
});

// Python's pty module is POSIX-only, so this one is skipped on Windows runners.
test("entry: on a terminal (pty) the offline replay is coloured; a mismatch is red", { skip: process.platform === "win32" }, () => {
  const ok = write("col-ok.json", B);
  const badF = write("col-bad.json", { ...B, expect: { ...B.expect, resultHash: keccak256(toBytes("z")) } });
  for (const [file, code, esc] of [[ok, 0, "\x1b[32m✓\x1b[0m"], [badF, 1, "\x1b[31m✗ MISMATCH\x1b[0m"]] as const) {
    const env = { ...process.env } as Record<string, string>;
    delete env.NO_COLOR;
    const py = "import os,pty,subprocess,sys\nm,sl=pty.openpty()\np=subprocess.Popen(sys.argv[1:],stdout=sl,stderr=sl,stdin=subprocess.DEVNULL)\nos.close(sl)\nbuf=b''\nwhile True:\n    try:\n        d=os.read(m,4096)\n    except OSError:\n        break\n    if not d: break\n    buf+=d\nrc=p.wait()\nsys.stdout.buffer.write(buf)\nsys.exit(rc)";
    const r = spawnSync("python3", ["-c", py, process.execPath, "--import", "tsx", cliPath, "replay", "--fixture", file], { cwd: pkg, encoding: "utf8", env });
    assert.equal(r.status, code, r.stderr);
    assert.ok(r.stdout.includes(esc), JSON.stringify(r.stdout.slice(0, 300)));
  }
});
