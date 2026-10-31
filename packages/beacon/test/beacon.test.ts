import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyBeacon, seal, open, stanzaOf, seedRoundAt, QUICKNET, type Beacon } from "../src/index.ts";

// Real quicknet beacon (api.drand.sh, fetched 2026-10-31).
const B: Beacon = {
  round: 33548730,
  randomness: "3c11de15056c2178129fd057942ef8d0a826dc210e339a785390d50097e42f3e",
  signature: "8b712b36d332899c647ec99914f1712b213e131602778966d4aa33fd5ac6650ec92e5780742a38a8666f1e36e5ec2729",
};

test("A9: real quicknet beacon verifies; tampered signature, randomness or round is refused", () => {
  assert.equal(verifyBeacon(B, B.round).round, B.round);
  const flip = (h: string) => (h[5] === "0" ? h.slice(0, 5) + "1" + h.slice(6) : h.slice(0, 5) + "0" + h.slice(6));
  assert.throws(() => verifyBeacon({ ...B, signature: flip(B.signature) }), /SIGNATURE|point|invalid/i);
  assert.throws(() => verifyBeacon({ ...B, randomness: flip(B.randomness) }), /sha256/);
  assert.throws(() => verifyBeacon({ ...B, round: B.round + 1 }), /BAD SIGNATURE/);
  assert.throws(() => verifyBeacon(B, B.round + 1), /need/);
});

test("A6: seal to a round → stanza names that round + quicknet; opens only with that round's beacon", async () => {
  const msg = new TextEncoder().encode('{"v":1}');
  const sealed = await seal(msg, B.round);
  assert.deepEqual(stanzaOf(sealed), { round: B.round, chain: QUICKNET.hash });
  assert.ok(sealed.length <= 1536);
  assert.deepEqual(await open(sealed, B), msg);
  const wrong = await seal(msg, B.round + 1);
  await assert.rejects(open(wrong, B));
});

test("A7: seedRoundAt = first quicknet round at or after close + 300 s", () => {
  for (let close = 1793293200; close < 1793293200 + 20; close++) {
    const r = seedRoundAt(close);
    const t = (rr: number) => QUICKNET.genesis_time + (rr - 1) * QUICKNET.period;
    assert.ok(t(r) >= close + 300 && t(r - 1) < close + 300);
  }
});
