import test from "node:test";
import assert from "node:assert/strict";

// env first: lib/chain reads the relay budget at import
process.env.RELAY_FLOOR_WEI = "100";
process.env.RELAY_NIGHT_WEI = "1000";
process.env.RELAY_LAST_ROUND = "8";
const { relayReserveWei, RELAY_SAYS } = await import("../lib/chain.ts");

test("per-night relay stop keeps the later nights' slices back (one night cannot drain the relayer)", () => {
  assert.equal(relayReserveWei(2), 100n + 6n * 1000n); // round 2 of 8: six nights still to fund
  assert.equal(relayReserveWei(7), 1100n);
  assert.equal(relayReserveWei(8), 100n); // last night may spend down to the floor
  assert.equal(relayReserveWei(12), 100n); // after the last night: floor only, never negative
  assert.match(RELAY_SAYS["spent-tonight"], /use your own wallet/);
});
