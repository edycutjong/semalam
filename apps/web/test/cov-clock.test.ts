import test from "node:test";
import assert from "node:assert/strict";
import { closeTime, countdown, currentRound, wibLabel, DAY, WIB } from "../lib/clock.ts";
import { GENESIS } from "../lib/config.ts";

test("clock defaults to the configured GENESIS when no genesis argument is given", () => {
  assert.equal(currentRound(GENESIS - 1), 0);
  assert.equal(currentRound(GENESIS), 1);
  assert.equal(closeTime(3), GENESIS + 3 * DAY);
  assert.equal(countdown(closeTime(1) - 5, 1), "00:00:05");
  assert.equal(countdown(closeTime(1), 1), null);
});
test("wibLabel shifts UTC by +7h and rolls over the date", () => {
  assert.equal(WIB, 25200);
  assert.equal(wibLabel(0), "1970-01-01 07:00 WIB");
  assert.equal(wibLabel(17 * 3600 + 30 * 60), "1970-01-02 00:30 WIB");
});
