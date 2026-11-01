import test from "node:test";
import assert from "node:assert/strict";
import { throttle, ipOf, memoized, serial, forget, reserve, bump } from "../lib/guard.ts";

const realNow = Date.now;
let clock = 1_000_000;
const freezeClock = () => { Date.now = () => clock; };
test.afterEach(() => { Date.now = realNow; });

let n = 0;
const uniq = (p: string) => `${p}-${++n}-${realNow()}`;

test("throttle allows up to max hits in the window then refuses", () => {
  freezeClock();
  const k = uniq("thr");
  assert.equal(throttle(k, 2, 1000), true);
  assert.equal(throttle(k, 2, 1000), true);
  assert.equal(throttle(k, 2, 1000), false);
  assert.equal(throttle(k, 2, 1000), false);
});

test("throttle admits again once old hits fall out of the window", () => {
  freezeClock();
  const k = uniq("thr");
  assert.equal(throttle(k, 1, 1000), true);
  assert.equal(throttle(k, 1, 1000), false);
  clock += 1001;
  assert.equal(throttle(k, 1, 1000), true);
});

test("throttle keys are independent", () => {
  freezeClock();
  const a = uniq("a"), b = uniq("b");
  assert.equal(throttle(a, 1, 1000), true);
  assert.equal(throttle(b, 1, 1000), true);
  assert.equal(throttle(a, 1, 1000), false);
});

test("throttle sweep past 5000 keys keeps a key with a hit still inside the window blocked and still admits an expired one", () => {
  freezeClock();
  const stale = uniq("stale"), live = uniq("live");
  assert.equal(throttle(stale, 1, 1000), true);
  clock += 5000; // stale hit is now outside its window
  assert.equal(throttle(live, 1, 1000), true);
  for (let i = 0; i < 5000; i++) throttle(`${stale}-fill-${i}`, 1, 1000); // map passes 5000 -> sweep runs
  assert.equal(throttle(live, 1, 1000), false); // swept map still remembers the in-window hit
  assert.equal(throttle(stale, 1, 1000), true);
});

test("ipOf takes the first x-forwarded-for hop, trimmed", () => {
  const req = new Request("http://x.test", { headers: { "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" } });
  assert.equal(ipOf(req), "1.2.3.4");
});

test("ipOf falls back to 'local' without the header", () => {
  assert.equal(ipOf(new Request("http://x.test")), "local");
});

test("memoized computes once within ttl and returns the cached value", async () => {
  freezeClock();
  const k = uniq("m");
  let calls = 0;
  const f = async () => ++calls;
  assert.equal(await memoized(k, 1000, f), 1);
  clock += 999;
  assert.equal(await memoized(k, 1000, f), 1);
  assert.equal(calls, 1);
});

test("memoized recomputes after ttl expires", async () => {
  freezeClock();
  const k = uniq("m");
  let calls = 0;
  const f = async () => ++calls;
  await memoized(k, 1000, f);
  clock += 1000;
  assert.equal(await memoized(k, 1000, f), 2);
});

test("memoized does not cache a rejected computation", async () => {
  const k = uniq("m");
  await assert.rejects(memoized(k, 1000, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await memoized(k, 1000, async () => "ok"), "ok");
});

test("memoized evicts entries older than 60s when the memo passes 5000 keys", async () => {
  freezeClock();
  const old = uniq("old");
  let oldCalls = 0;
  await memoized(old, 1_000_000, async () => ++oldCalls);
  clock += 61_000;
  for (let i = 0; i < 5001; i++) await memoized(`${old}-fill-${i}`, 1_000_000, async () => i);
  // old entry was evicted by the sweep even though its ttl had not expired
  assert.equal(await memoized(old, 1_000_000, async () => ++oldCalls), 2);
});

test("forget drops a memoized key so the next call recomputes", async () => {
  const k = uniq("f");
  let calls = 0;
  await memoized(k, 60_000, async () => ++calls);
  forget(k);
  assert.equal(await memoized(k, 60_000, async () => ++calls), 2);
});

test("serial runs same-key jobs one after another, in call order", async () => {
  const k = uniq("s");
  const log: string[] = [];
  const job = (name: string, ms: number) => () => new Promise<string>((r) => setTimeout(() => { log.push(name); r(name); }, ms));
  const [a, b] = await Promise.all([serial(k, job("slow", 30)), serial(k, job("fast", 1))]);
  assert.deepEqual([a, b], ["slow", "fast"]);
  assert.deepEqual(log, ["slow", "fast"]);
});

test("serial keeps the queue alive after a failure and still rejects that caller", async () => {
  const k = uniq("s");
  const bad = serial(k, async () => { throw new Error("nope"); });
  const good = serial(k, async () => "after");
  await assert.rejects(bad, /nope/);
  assert.equal(await good, "after");
});

test("reserve starts at 0 for an unknown key", () => {
  assert.equal(reserve(uniq("r")), 0);
});

test("bump with positive delta on an unknown key creates the reservation", () => {
  const k = uniq("r");
  bump(k, 2);
  assert.equal(reserve(k), 2);
});

test("bump with non-positive delta on an unknown key does nothing", () => {
  const k = uniq("r");
  bump(k, -1);
  bump(k, 0);
  assert.equal(reserve(k), 0);
});

test("bump accumulates, clamps at 0, and only a positive bump restarts the ttl", () => {
  freezeClock();
  const k = uniq("r");
  bump(k, 1);
  clock += 10_000;
  bump(k, 1); // positive: restarts ttl at +10s
  assert.equal(reserve(k, 30_000), 2);
  clock += 25_000;
  bump(k, -1); // negative: ttl clock not restarted
  assert.equal(reserve(k, 30_000), 1);
  bump(k, -5);
  assert.equal(reserve(k, 30_000), 0); // clamped, never negative
});

test("reserve resets to 0 once the reservation is older than ttl", () => {
  freezeClock();
  const k = uniq("r");
  bump(k, 3);
  assert.equal(reserve(k, 1000), 3);
  clock += 1000;
  assert.equal(reserve(k, 1000), 0);
  assert.equal(reserve(k, 1000), 0);
});

test("reserve uses a 30s default ttl", () => {
  freezeClock();
  const k = uniq("r");
  bump(k, 1);
  clock += 29_999;
  assert.equal(reserve(k), 1);
  clock += 30_000;
  assert.equal(reserve(k), 0);
});
