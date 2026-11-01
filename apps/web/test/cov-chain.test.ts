import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { getAddress, encodeAbiParameters, encodeEventTopics, parseAbiParameters, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { COMMITTED_EVENT, PAID_EVENT } from "../lib/abi.ts";
import { forget } from "../lib/guard.ts";

// ---- env must be set before lib/chain is imported (RPCS, relay budget are read at import) ----
const ENV_KEYS = ["RPC_FALLBACK_URLS", "RELAY_FLOOR_WEI", "RELAY_NIGHT_WEI", "RELAY_LAST_ROUND", "RELAYER_PRIVATE_KEY"] as const;
const savedEnv: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restoreEnv = () => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } };

process.env.RPC_FALLBACK_URLS = " https://fallback-a.test , ,https://fallback-b.test ";
process.env.RELAY_FLOOR_WEI = "100";
process.env.RELAY_NIGHT_WEI = "1000";
process.env.RELAY_LAST_ROUND = "8";
const chain = await import("../lib/chain.ts");
for (const k of ["RPC_FALLBACK_URLS", "RELAY_FLOOR_WEI", "RELAY_NIGHT_WEI", "RELAY_LAST_ROUND"] as const) delete process.env[k];
restoreEnv();

// The "env unset" defaults are read at import time, and a second in-process instance of the module would split the coverage
// report, so the defaults are observed from a child process that imports lib/chain.ts with those variables removed.
function readDefaults(): { rpcs: string[]; floor: string; reserve1: string; reserve50: string } {
  const env = { ...process.env };
  for (const k of ENV_KEYS) delete env[k];
  const url = new URL("../lib/chain.ts", import.meta.url).href;
  // the child also exercises guard.bump: V8 coverage from this process is merged into the parent's report, and a never-called
  // one-line function in the child would otherwise mask the parent's real hit count for lib/guard.ts
  const guardUrl = new URL("../lib/guard.ts", import.meta.url).href;
  const code = `const m = await import(${JSON.stringify(url)});
    const g = await import(${JSON.stringify(guardUrl)});
    g.bump("child", 1); g.bump("child", -1); g.bump("child2", -1);
    console.log(JSON.stringify({ rpcs: m.RPCS, floor: String(m.RELAY_FLOOR_WEI), reserve1: String(m.relayReserveWei(1)), reserve50: String(m.relayReserveWei(50)) }));`;
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { env, encoding: "utf8", cwd: new URL("..", import.meta.url).pathname });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").at(-1)!);
}
const defaults = readDefaults();

const { CHAIN_ID, DEP, ORDERS, RESULTS, SCRIMMAGE } = await import("../lib/config.ts");
const PRIMARY = DEP.rpcs[0];
const FROM = DEP.fromBlock;
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const RELAYER = privateKeyToAccount(KEY).address;

// ---- fetch stub: JSON-RPC over globalThis.fetch ----
type Call = { url: string; method: string; params: any[] };
type Handler = (c: Call) => unknown; // return value = result; throw RpcErr = JSON-RPC error; throw HttpErr = HTTP status
class RpcErr extends Error { constructor(public code: number, msg: string) { super(msg); } }
class HttpErr extends Error { constructor(public status: number) { super(`http ${status}`); } }
const realFetch = globalThis.fetch;
const realNow = Date.now;
let skew = 0;
let calls: Call[] = [];
function stub(h: Handler) {
  calls = [];
  // viem caches eth_blockNumber for ~4 s; each stub() jumps the clock past that so every test sees its own head
  skew += 60_000;
  Date.now = () => realNow() + skew;
  globalThis.fetch = (async (input: any, init: any) => {
    const body = JSON.parse(init.body);
    const c: Call = { url: String(input), method: body.method, params: body.params ?? [] };
    calls.push(c);
    try {
      const result = h(c);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      if (e instanceof RpcErr) return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: e.code, message: e.message } }), { status: 200, headers: { "content-type": "application/json" } });
      if (e instanceof HttpErr) return new Response("fail", { status: e.status });
      throw e;
    }
  }) as typeof fetch;
}
test.afterEach(() => { globalThis.fetch = realFetch; Date.now = realNow; restoreEnv(); });

const norm = (u: string) => u.replace(/\/$/, "");
const hex = (n: number | bigint) => toHex(n);
const H32 = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const ACCT = "0x00000000000000000000000000000000000000a1" as const;
const ACCT2 = getAddress("0x00000000000000000000000000000000deadbeef"); // checksummed: has uppercase hex so lower-casing is observable

function committedLog(o: { round: number; account: string; policyHash: Hex; sealed: Hex; block: number; idx: number }) {
  return {
    address: ORDERS, blockHash: H32(9), blockNumber: hex(o.block), logIndex: hex(o.idx), transactionHash: H32(o.block * 10 + o.idx), transactionIndex: "0x0", removed: false,
    topics: encodeEventTopics({ abi: [COMMITTED_EVENT], eventName: "Committed", args: { round: BigInt(o.round), account: o.account as `0x${string}` } }),
    data: encodeAbiParameters(parseAbiParameters("bytes32, bytes"), [o.policyHash, o.sealed]),
  };
}
function paidLog(o: { payer: string; round: number; draft: Hex; amount: bigint; burned: bigint; toCompute: bigint; block: number; address?: string }) {
  return {
    address: o.address ?? SCRIMMAGE, blockHash: H32(9), blockNumber: hex(o.block), logIndex: "0x0", transactionHash: H32(o.block), transactionIndex: "0x0", removed: false,
    topics: encodeEventTopics({ abi: [PAID_EVENT], eventName: "Paid", args: { payer: o.payer as `0x${string}`, round: BigInt(o.round) } }),
    data: encodeAbiParameters(parseAbiParameters("bytes32, uint256, uint256, uint256"), [o.draft, o.amount, o.burned, o.toCompute]),
  };
}

// ---- module config ----
test("RPCS lists deployment rpcs first, then trimmed non-empty RPC_FALLBACK_URLS entries", () => {
  assert.deepEqual(chain.RPCS, [...DEP.rpcs, "https://fallback-a.test", "https://fallback-b.test"]);
});

test("RPCS is just the deployment rpcs when RPC_FALLBACK_URLS is unset", () => {
  assert.deepEqual(defaults.rpcs, DEP.rpcs);
});

test("relay budget defaults to a 0.0003 ETH floor and no per-night reserve when env is unset", () => {
  assert.equal(defaults.floor, "300000000000000");
  assert.equal(defaults.reserve1, "300000000000000");
  assert.equal(defaults.reserve50, "300000000000000");
});

test("relay budget reads floor, night slice and last round from env", () => {
  assert.equal(chain.RELAY_FLOOR_WEI, 100n);
  assert.equal(chain.relayReserveWei(2), 100n + 6n * 1000n);
  assert.equal(chain.relayReserveWei(8), 100n);
  assert.equal(chain.relayReserveWei(20), 100n);
});

test("RELAY_SAYS names both non-ok relay states", () => {
  assert.equal(chain.RELAY_SAYS.empty, "relay empty — use your own wallet");
  assert.match(chain.RELAY_SAYS["spent-tonight"], /come back tomorrow/);
});

// ---- chainNow ----
test("chainNow returns the latest block's timestamp as a number", async () => {
  stub((c) => {
    assert.equal(c.method, "eth_getBlockByNumber");
    assert.equal(c.params[0], "latest");
    return { number: "0x10", hash: H32(1), parentHash: H32(0), timestamp: hex(1793293999), transactions: [], nonce: "0x0000000000000000", miner: ACCT, gasLimit: "0x1", gasUsed: "0x0" };
  });
  assert.equal(await chain.chainNow(), 1793293999);
});

// ---- fallback transport ----
test("a failing primary RPC falls over to the next node and the result still comes back", async () => {
  stub((c) => {
    if (norm(c.url) === norm(PRIMARY)) throw new HttpErr(500);
    assert.equal(c.method, "eth_blockNumber");
    return hex(777);
  });
  const head = await chain.publicClient.getBlockNumber();
  assert.equal(head, 777n);
  const urls = calls.map((c) => c.url.replace(/\/$/, ""));
  assert.equal(urls[0], PRIMARY.replace(/\/$/, ""), "primary is tried first");
  assert.equal(urls.at(-1), "https://fallback-a.test", "then the first extra node");
});

// ---- commitsOf ----
test("commitsOf decodes commit logs and reports the sealed blob size in bytes", async () => {
  const sealed = ("0x" + "ab".repeat(48)) as Hex;
  stub((c) => {
    if (c.method === "eth_blockNumber") return hex(FROM + 5);
    assert.equal(c.method, "eth_getLogs");
    const f = c.params[0];
    assert.equal(f.address.toLowerCase(), ORDERS.toLowerCase());
    assert.equal(f.fromBlock, hex(FROM));
    assert.equal(f.toBlock, hex(FROM + 5));
    assert.equal(f.topics[1], H32(4)); // round 4 indexed
    return [committedLog({ round: 4, account: ACCT, policyHash: H32(0xbeef), sealed, block: FROM + 2, idx: 3 })];
  });
  const out = await chain.commitsOf(ACCT, 4);
  assert.deepEqual(out, [{ tx: H32((FROM + 2) * 10 + 3), block: FROM + 2, logIndex: 3, policyHash: H32(0xbeef), sealedBytes: 48 }]);
});

test("commitsOf memoises per account and round for 3 s (second call sends no RPC)", async () => {
  stub((c) => (c.method === "eth_blockNumber" ? hex(FROM - 1) : []));
  const a = await chain.commitsOf(ACCT2, 11);
  const sent = calls.length;
  const b = await chain.commitsOf(ACCT2, 11);
  assert.deepEqual(a, []);
  assert.deepEqual(b, []);
  assert.equal(calls.length, sent);
});

// ---- paged (through commitsOf) ----
test("paged returns nothing and requests no logs when head is behind the deployment block", async () => {
  stub((c) => { assert.equal(c.method, "eth_blockNumber"); return hex(FROM - 1); });
  assert.deepEqual(await chain.commitsOf(ACCT, 21), []);
  assert.equal(calls.length, 1);
});

test("paged halves the span when a provider errors and retries the same start block", async () => {
  const ranges: Array<[number, number]> = [];
  const head = FROM + 3_000_000; // two spans of 2M at the default size
  stub((c) => {
    if (c.method === "eth_blockNumber") return hex(head);
    const lo = parseInt(c.params[0].fromBlock, 16), hi = parseInt(c.params[0].toBlock, 16);
    if (!ranges.length || ranges.at(-1)![0] !== lo || ranges.at(-1)![1] !== hi) ranges.push([lo, hi]); // fallback transport re-asks each node
    if (hi - lo + 1 > 1_000_000) throw new RpcErr(-32602, "block range too large");
    return [];
  });
  assert.deepEqual(await chain.commitsOf(ACCT, 22), []);
  assert.deepEqual(ranges[0], [FROM, FROM + 1_999_999]); // initial 2M-wide ask fails
  assert.deepEqual(ranges[1], [FROM, FROM + 999_999]);   // halved, same start
  assert.equal(ranges.at(-1)![1], head);                  // walks all the way to head
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] !== ranges[i - 1][0]) assert.equal(ranges[i][0], ranges[i - 1][1] + 1, "pages are contiguous");
});

test("paged rethrows the provider error once the span is down to 1000 blocks", async () => {
  const spans: number[] = [];
  stub((c) => {
    if (c.method === "eth_blockNumber") return hex(FROM + 5_000_000);
    const sp = parseInt(c.params[0].toBlock, 16) - parseInt(c.params[0].fromBlock, 16) + 1;
    if (spans.at(-1) !== sp) spans.push(sp); // fallback transport re-asks each node
    throw new RpcErr(-32602, "no logs for you");
  });
  await assert.rejects(chain.commitsOf(ACCT, 23), /no logs for you/);
  assert.equal(spans[0], 2_000_000);
  assert.equal(spans.at(-1), 976); // 2_000_000 halves down to 976 (<=1000): that attempt fails and is rethrown
  assert.ok(spans.every((v, i) => i === 0 || v === Math.floor(spans[i - 1] / 2)));
});

test("paged splits a full page (>=1000 logs) in half and re-reads, so a silently capped result is never kept", async () => {
  const head = FROM + 3999;
  const seen: Array<[number, number]> = [];
  stub((c) => {
    if (c.method === "eth_blockNumber") return hex(head);
    const lo = parseInt(c.params[0].fromBlock, 16), hi = parseInt(c.params[0].toBlock, 16);
    seen.push([lo, hi]);
    if (hi - lo + 1 > 2000) return Array.from({ length: 1000 }, (_, i) => committedLog({ round: 24, account: ACCT, policyHash: H32(1), sealed: "0x00", block: lo, idx: i }));
    return [committedLog({ round: 24, account: ACCT, policyHash: H32(2), sealed: "0xaabb", block: lo, idx: 0 })];
  });
  const out = await chain.commitsOf(ACCT, 24);
  assert.deepEqual(seen, [[FROM, head], [FROM, FROM + 1999], [FROM + 2000, head]]);
  assert.deepEqual(out.map((o) => o.policyHash), [H32(2), H32(2)]); // the capped 1000-log page was discarded
  assert.equal(out[0].sealedBytes, 2);
});

test("paged accepts a full page when the range is already a single block (cannot split further)", async () => {
  stub((c) => {
    if (c.method === "eth_blockNumber") return hex(FROM);
    return Array.from({ length: 1000 }, (_, i) => committedLog({ round: 25, account: ACCT, policyHash: H32(3), sealed: "0x", block: FROM, idx: i }));
  });
  const out = await chain.commitsOf(ACCT, 25);
  assert.equal(out.length, 1000);
  assert.equal(out[999].logIndex, 999);
  assert.equal(out[0].sealedBytes, 0);
});

// ---- commitCountOf ----
test("commitCountOf counts distinct accounts case-insensitively and queries without an account filter", async () => {
  stub((c) => {
    if (c.method === "eth_blockNumber") return hex(FROM + 1);
    assert.equal(c.params[0].topics[2] ?? null, null); // [event, round, <no account>]
    return [
      committedLog({ round: 31, account: ACCT2, policyHash: H32(1), sealed: "0x", block: FROM, idx: 0 }),
      committedLog({ round: 31, account: ACCT2.toLowerCase(), policyHash: H32(1), sealed: "0x", block: FROM, idx: 1 }),
      committedLog({ round: 31, account: ACCT, policyHash: H32(1), sealed: "0x", block: FROM, idx: 2 }),
    ];
  });
  assert.equal(await chain.commitCountOf(31), 2);
});

test("commitCountOf memoises per round (15 s) so repeat calls cost no RPC", async () => {
  stub((c) => (c.method === "eth_blockNumber" ? hex(FROM - 1) : []));
  assert.equal(await chain.commitCountOf(32), 0);
  const n = calls.length;
  assert.equal(await chain.commitCountOf(32), 0);
  assert.equal(calls.length, n);
});

// ---- postedOf ----
function ethCall(c: Call, results: Record<string, Hex>) {
  assert.equal(c.method, "eth_call");
  assert.equal(c.params[0].to.toLowerCase(), RESULTS.toLowerCase());
  const sel = (c.params[0].data as string).slice(0, 10);
  return results[sel];
}

test("postedOf returns null for an all-zero result hash and never asks for the drand round", async () => {
  stub((c) => ethCall(c, { "0x0b0e7ef1": "0x" + "0".repeat(64) as Hex, "*": "0x" as Hex }) ?? "0x" + "0".repeat(64));
  assert.equal(await chain.postedOf(5), null);
  assert.equal(calls.length, 1);
});

test("postedOf returns the result hash and drand round once posted", async () => {
  const seenData: string[] = [];
  stub((c) => {
    seenData.push(c.params[0].data);
    return seenData.length === 1 ? H32(0xabc123) : H32(4242);
  });
  assert.deepEqual(await chain.postedOf(5), { resultHash: H32(0xabc123), drandRound: 4242 });
  assert.equal(seenData.length, 2);
  assert.notEqual(seenData[0].slice(0, 10), seenData[1].slice(0, 10)); // resultOf then drandRoundOf
  assert.ok(seenData[0].endsWith(H32(5).slice(2)) && seenData[1].endsWith(H32(5).slice(2)), "both calls carry round 5");
});

// ---- paidReceipt ----
const TX = H32(0x7777);
function receipt(status: "0x1" | "0x0", logs: unknown[]) {
  return { status, logs, transactionHash: TX, transactionIndex: "0x0", blockHash: H32(9), blockNumber: "0x1", from: ACCT, to: SCRIMMAGE, cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", contractAddress: null, logsBloom: "0x" + "0".repeat(512), type: "0x2" };
}

test("paidReceipt returns null for a reverted transaction", async () => {
  stub((c) => { assert.equal(c.method, "eth_getTransactionReceipt"); assert.deepEqual(c.params, [TX]); return receipt("0x0", []); });
  assert.equal(await chain.paidReceipt(TX), null);
});

test("paidReceipt decodes the Paid event from the scrimmage contract, skipping other contracts' and undecodable logs", async () => {
  const good = paidLog({ payer: ACCT, round: 6, draft: H32(0xd0), amount: 100n, burned: 40n, toCompute: 60n, block: 5 });
  const foreign = paidLog({ payer: ACCT2, round: 9, draft: H32(0xee), amount: 1n, burned: 1n, toCompute: 0n, block: 5, address: "0x0000000000000000000000000000000000000dad" });
  const junk = { ...good, topics: [H32(0xdead)], data: "0x" }; // right address, not a known event -> decode throws -> skipped
  stub(() => receipt("0x1", [foreign, junk, good]));
  const r = await chain.paidReceipt(TX);
  assert.deepEqual(r && { ...r, payer: r.payer.toLowerCase() }, { payer: ACCT.toLowerCase(), round: 6, draftHash: H32(0xd0), amount: 100n, burned: 40n, toCompute: 60n });
});

test("paidReceipt returns null when a successful tx has no Paid log", async () => {
  const other = { ...paidLog({ payer: ACCT, round: 1, draft: H32(1), amount: 1n, burned: 0n, toCompute: 1n, block: 5 }), topics: [H32(0xdead)], data: "0x" };
  stub(() => receipt("0x1", [other]));
  assert.equal(await chain.paidReceipt(TX), null);
});

// ---- relayer ----
test("relayer is null without RELAYER_PRIVATE_KEY", () => {
  delete process.env.RELAYER_PRIVATE_KEY;
  assert.equal(chain.relayer(), null);
});

test("relayer builds an account and wallet client from RELAYER_PRIVATE_KEY", () => {
  process.env.RELAYER_PRIVATE_KEY = KEY;
  const r = chain.relayer()!;
  assert.equal(r.account.address, RELAYER);
  assert.equal(r.wallet.account.address, RELAYER);
  assert.equal(r.wallet.chain.id, CHAIN_ID);
});

// ---- relayState ----
test("relayState is 'empty' without a relayer key and sends no RPC", async () => {
  delete process.env.RELAYER_PRIVATE_KEY;
  stub(() => { throw new Error("must not be called"); });
  assert.equal(await chain.relayState(1), "empty");
  assert.equal(calls.length, 0);
});

async function stateAt(bal: bigint, round: number) {
  process.env.RELAYER_PRIVATE_KEY = KEY;
  stub((c) => { assert.equal(c.method, "eth_getBalance"); assert.equal(c.params[0].toLowerCase(), RELAYER.toLowerCase()); return hex(bal); });
  return chain.relayState(round);
}
test("relayState is 'empty' when the balance is below the floor", async () => {
  assert.equal(await stateAt(99n, 2), "empty");
});
test("relayState is 'spent-tonight' between the floor and the per-night reserve", async () => {
  assert.equal(await stateAt(6099n, 2), "spent-tonight"); // reserve for round 2 = 100 + 6*1000 = 6100
  assert.equal(await stateAt(100n, 2), "spent-tonight"); // exactly the floor is not 'empty'
});
test("relayState is 'ok' at or above the reserve", async () => {
  assert.equal(await stateAt(6100n, 2), "ok");
  assert.equal(await stateAt(100n, 8), "ok"); // last night spends down to the floor
});

// ---- paidLogs ----
test("paidLogs maps Paid logs to payer, round, draft hash, burned amount and tx", async () => {
  forget("paid");
  stub((c) => {
    if (c.method === "eth_blockNumber") return hex(FROM + 1);
    assert.equal(c.params[0].address.toLowerCase(), SCRIMMAGE.toLowerCase());
    return [paidLog({ payer: ACCT, round: 3, draft: H32(0xd1), amount: 10n, burned: 4n, toCompute: 6n, block: FROM + 1 })];
  });
  const out = await chain.paidLogs();
  assert.deepEqual(out.map((o) => ({ ...o, payer: o.payer.toLowerCase() })), [{ payer: ACCT.toLowerCase(), round: 3, draftHash: H32(0xd1), burned: 4n, tx: H32(FROM + 1) }]);
});

test("paidLogs is memoised for 30 s", async () => {
  forget("paid");
  stub((c) => (c.method === "eth_blockNumber" ? hex(FROM - 1) : []));
  await chain.paidLogs();
  const n = calls.length;
  assert.deepEqual(await chain.paidLogs(), []);
  assert.equal(calls.length, n);
  forget("paid");
});
