// The live replay path against an injected chain client + drand fetch (no network): finality gate, log paging,
// pin checks, beacon refusal/waiting, MATCH / MISMATCH / not-posted exit codes, void lines; plus the season table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, toBytes, getAddress, type Hex, type PublicClient } from "viem";
import { deps, replayLive, parse, seasonTable, main, Exit } from "../src/cli.ts";
import { cleanReason } from "@semalam/policy/compile";
import { SIM_VERSION } from "@semalam/sim";
import { HOUSE_SET_HASH } from "@semalam/sim/house";
import { closeTime, type Settled } from "@semalam/sim/round";
import deployments from "../src/deployments.json" with { type: "json" };

const g = JSON.parse(readFileSync(new URL("../../../fixtures/golden/round-b.json", import.meta.url), "utf8"));
const FROM = BigInt(deployments["46630"].fromBlock);
const FIN = FROM + 600_000n;

type Opts = { posted?: Hex | null; pendingPost?: boolean; finTs?: number; house?: Hex; maxSpan?: bigint; beacon?: typeof g.beacon | "425" };
function chain(o: Opts) {
  let calls = 0;
  const committed = g.logs.map((l: { account: Hex; policyHash: Hex; blob: number; blockNumber: number; logIndex: number }, i: number) => ({
    args: { round: BigInt(g.round), account: l.account, policyHash: l.policyHash, sealedBlob: g.blobs[l.blob] },
    blockNumber: FROM + 100_000n + BigInt(i) * 150_000n, logIndex: l.logIndex, transactionHash: keccak256(toBytes(`tx${i}`)),
  }));
  const client = {
    readContract: async ({ functionName }: { functionName: string }) =>
      ({ SIM_VERSION: keccak256(toBytes(SIM_VERSION)), HOUSE_SET_HASH: o.house ?? HOUSE_SET_HASH, GENESIS: BigInt(g.genesis) })[functionName],
    getBlock: async () => ({ number: FIN, timestamp: BigInt(o.finTs ?? closeTime(g.genesis, g.round) + 3600) }),
    getLogs: async ({ event, fromBlock, toBlock }: { event: { name: string }; fromBlock: bigint; toBlock: bigint | "latest" }) => {
      calls++;
      if (toBlock === "latest") return o.pendingPost && event.name === "Posted" ? [{ blockNumber: FIN + 5n, args: { round: BigInt(g.round), resultHash: g.expect.resultHash, drandRound: BigInt(g.expect.drandRound) } }] : [];
      if (toBlock - fromBlock + 1n > (o.maxSpan ?? 10n ** 12n)) throw new Error("query exceeds max block range");
      const inRange = (b: bigint) => b >= fromBlock && b <= toBlock;
      if (event.name === "Committed") return committed.filter((l: { blockNumber: bigint }) => inRange(l.blockNumber));
      if (event.name === "Posted" && o.posted && inRange(FROM + 590_000n)) return [{ args: { round: BigInt(g.round), resultHash: o.posted, drandRound: BigInt(g.expect.drandRound) } }];
      return [];
    },
  } as unknown as PublicClient;
  const fetchFn = (async (url: string) => {
    if (o.beacon === "425") return new Response("not yet", { status: 425 });
    const b = o.beacon ?? g.beacon;
    return String(url).endsWith(`/public/${g.expect.drandRound}`) ? Response.json(b) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { client, fetchFn, calls: () => calls };
}

async function live(o: Opts) {
  const c = chain(o);
  deps.client = c.client;
  deps.fetchFn = c.fetchFn;
  const out: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
  try {
    const r = await replayLive(parse(["--chain", "46630"]), g.round);
    return { code: r.code, out: out.join("\n"), calls: c.calls() };
  } catch (e) {
    if (e instanceof Exit) return { code: e.code, out: `${out.join("\n")}\n${e.message}`, calls: c.calls() };
    throw e;
  } finally {
    console.log = log;
  }
}

test("live: posted hash equal → exit 0, MATCH, void line printed; logs paged with range halving", async () => {
  const r = await live({ posted: g.expect.resultHash, maxSpan: 100_000n });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✓ MATCH/);
  assert.match(r.out, /void 0x[0-9a-fA-F]{40} SCHEMA_INVALID/);
  assert.match(r.out, /3 events/);
  assert.ok(r.calls > 10, `paged in ${r.calls} getLogs calls`);
});

test("live: a different posted hash → exit 1 MISMATCH; nothing posted → exit 4 with the computed hash", async () => {
  const bad = await live({ posted: keccak256(toBytes("not the night")) });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /✗ MISMATCH/);
  assert.match(bad.out, /another node \(--rpc <url>/); // a judge is told how to rule out their RPC before disputing
  assert.match(bad.out, /github\.com\/edycutjong\/semalam\/issues/);
  const none = await live({ posted: null });
  assert.equal(none.code, 4);
  assert.match(none.out, new RegExp(`${g.expect.resultHash}.*not posted yet`));
});

test("live: finalized chain not past close → exit 4 (waiting), never a comparison", async () => {
  const r = await live({ posted: g.expect.resultHash, finTs: closeTime(g.genesis, g.round) - 1 });
  assert.equal(r.code, 4);
  assert.match(r.out, /waiting/);
  assert.doesNotMatch(r.out, /MATCH/);
});

test("live: house-set pin mismatch → exit 2; tampered beacon → exit 2; beacon not published → exit 4", async () => {
  assert.equal((await live({ posted: g.expect.resultHash, house: keccak256(toBytes("an-older-house-set")) })).code, 2);
  const tampered = { ...g.beacon, randomness: g.beacon.randomness.replace(/^./, (c: string) => (c === "a" ? "b" : "a")) };
  const t = await live({ posted: g.expect.resultHash, beacon: tampered });
  assert.equal(t.code, 2);
  assert.match(t.out, /REFUSED/);
  assert.equal((await live({ posted: g.expect.resultHash, beacon: "425" })).code, 4);
});

test("season table: operators and house never score; crown needs paid + points + a top-half finish (A16)", () => {
  const A = getAddress("0x00000000000000000000000000000000000000a1"), B = getAddress("0x00000000000000000000000000000000000000b2");
  const C = getAddress("0x00000000000000000000000000000000000000c3"), OP = getAddress("0x00000000000000000000000000000000000000d4");
  const row = (id: Hex, rank: number, points: number, extra: Partial<Settled["ranking"][number]> = {}) =>
    ({ rank, id, label: null, house: false, operator: false, coins: 100 - rank, steals: 0, points, policyHash: null, ...extra });
  const night = (rows: Settled["ranking"]) => ({ agents: 10, ranking: rows }) as unknown as Settled;
  const nights = [
    night([row(OP, 1, 0, { operator: true }), row(A, 2, 99), row("0x0000000000000000000000000000000000000001", 3, 0, { house: true, label: "house-01" }), row(B, 4, 97), row(C, 9, 92)]),
    night([row(B, 1, 100), row(A, 6, 95), row(C, 8, 93)]),
    night([row(C, 7, 94), row(A, 7, 94), row(B, 10, 91)]),
  ];
  const t = seasonTable(nights, new Set([B.toLowerCase(), C.toLowerCase(), OP.toLowerCase()]));
  assert.deepEqual(t.board.map((b) => b.id), [A, B, C]); // A and B tie on 288 points and 285 coins → keccak256(account) decides; C 279; no operator, no house
  assert.equal(t.board[0].eligible, false); // A never paid
  assert.equal(t.champion?.id, B);
  assert.equal(t.board[2].eligible, false); // C paid but never in the top half (ranks 9, 8, 7 of 10)
});

test("live: a post above the finalized head → exit 4 'posted … not final yet', never compared", async () => {
  const r = await live({ posted: null, pendingPost: true });
  assert.equal(r.code, 4);
  assert.match(r.out, new RegExp(`posted in block ${FIN + 5n}, not final yet`));
  assert.doesNotMatch(r.out, /MATCH/);
});

test("usage: season needs an integer ≥ 1; --json is refused with --fixture (exit 64)", async () => {
  for (const argv of [["season", "x"], ["season", "0"], ["season", "1.5"], ["replay", "--fixture", "golden", "--json", "out.json"]])
    await assert.rejects(main(argv), (e: unknown) => e instanceof Exit && e.code === 64, argv.join(" "));
});

test("refusal text never carries a link, a bare domain or an address", () => {
  for (const r of ["go to evil.com/claim now", "visit https://x.io", "send to 0x5b84F1A4E8037107a2B0aAcf3381005633A8f74e", "see www.example.org"])
    assert.doesNotMatch(cleanReason(r), /evil\.com|x\.io|0x5b84|example\.org/, r);
  assert.equal(cleanReason("request conflicts with game rules"), "request conflicts with game rules");
});

test("flags: --key=value equals --key value (a judge pasting --chain=4663 is not refused)", () => {
  const a = parse(["replay", "3", "--chain=46630", "--rpc=https://a.example", "--rpc", "https://b.example"]);
  assert.deepEqual([a._, a.chain, a.rpc], [["replay", "3"], "46630", ["https://a.example", "https://b.example"]]);
});

test("logs: a page of ≥ 1,000 logs is split, so a node that caps results silently cannot shorten the night", async () => {
  const { logsPaged } = await import("../src/cli.ts");
  const perBlock = 3n; // blocks 0..999 hold 3 logs each = 3,000 logs
  const node = async (lo: bigint, hi: bigint) => {
    const all: bigint[] = [];
    for (let b = lo; b <= hi; b++) for (let k = 0n; k < perBlock; k++) all.push(b * 10n + k);
    return all.slice(0, 1000); // silently capped at 1,000 results, no error
  };
  const got = await logsPaged(node, 0n, 999n);
  assert.equal(got.length, 3000);
  assert.equal(new Set(got).size, 3000);
});
