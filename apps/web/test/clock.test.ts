import test from "node:test";
import assert from "node:assert/strict";
import { closeTime, countdown, currentRound, seasonOf, wibLabel } from "../lib/clock.ts";

const G = 1793293200; // 29 Oct 2026 17:00 UTC (testnet GENESIS)
test("round clock matches RoundClock.sol arithmetic", () => {
  assert.equal(currentRound(G - 1, G), 0);
  assert.equal(currentRound(G, G), 1);
  assert.equal(currentRound(G + 86399, G), 1);
  assert.equal(currentRound(G + 86400, G), 2);
  assert.equal(closeTime(1, G), G + 86400);
});
test("a round closes at 00:00 WIB", () => {
  assert.equal(wibLabel(closeTime(1, G)), "2026-10-31 00:00 WIB");
});
test("seasons: round 1 rehearsal, 2-4 = season 1, 5-7 = season 2", () => {
  assert.deepEqual([1, 2, 4, 5, 7, 8].map(seasonOf), [0, 1, 1, 2, 2, 3]);
});
test("countdown is hh:mm:ss, null once closed", () => {
  assert.equal(countdown(closeTime(2, G) - 3725, 2, G), "01:02:05");
  assert.equal(countdown(closeTime(2, G), 2, G), null);
});
