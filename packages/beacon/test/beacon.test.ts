import { test } from "node:test";
import assert from "node:assert/strict";
import { roundAt, roundTime } from "tlock-js";
import { verifyBeacon, seal, open, stanzaOf, seedRoundAt, QUICKNET, type Beacon } from "../src/index.ts";

// Real quicknet beacon (api.drand.sh, fetched 2026-10-31).
const B: Beacon = {
  round: 33548730,
  randomness: "3c11de15056c2178129fd057942ef8d0a826dc210e339a785390d50097e42f3e",
  signature: "8b712b36d332899c647ec99914f1712b213e131602778966d4aa33fd5ac6650ec92e5780742a38a8666f1e36e5ec2729",
};

test("real quicknet beacon verifies; tampered signature, randomness or round is refused (A9)", () => {
  assert.equal(verifyBeacon(B, B.round).round, B.round);
  const flip = (h: string) => (h[5] === "0" ? h.slice(0, 5) + "1" + h.slice(6) : h.slice(0, 5) + "0" + h.slice(6));
  assert.throws(() => verifyBeacon({ ...B, signature: flip(B.signature) }), /SIGNATURE|point|invalid/i);
  assert.throws(() => verifyBeacon({ ...B, randomness: flip(B.randomness) }), /sha256/);
  assert.throws(() => verifyBeacon({ ...B, round: B.round + 1 }), /BAD SIGNATURE/);
  assert.throws(() => verifyBeacon(B, B.round + 1), /need/);
});

test("seal to a round → stanza names that round + quicknet; opens only with that round's beacon (A6)", async () => {
  const msg = new TextEncoder().encode('{"v":1}');
  const sealed = await seal(msg, B.round);
  assert.deepEqual(stanzaOf(sealed), { round: B.round, chain: QUICKNET.hash });
  assert.ok(sealed.length <= 1536);
  assert.deepEqual(await open(sealed, B), msg);
  const wrong = await seal(msg, B.round + 1);
  await assert.rejects(open(wrong, B));
});

test("stanzaOf: exactly one tlock stanza or void — extra/scrypt stanzas never reach the decryptor", async () => {
  const sealed = await seal(new TextEncoder().encode('{"v":1}'), B.round);
  const text = Buffer.from(sealed).toString("latin1");
  const at = text.indexOf("\n", text.indexOf("-> tlock"));
  const withScrypt = Buffer.from(text.slice(0, at) + "\nAAAA\n-> scrypt c2FsdA 22" + text.slice(at), "latin1");
  assert.equal(stanzaOf(new Uint8Array(withScrypt)), null);
  const twoTlock = Buffer.from(text.slice(0, at) + "\nAAAA\n" + text.slice(text.indexOf("-> tlock"), at) + text.slice(at), "latin1");
  assert.equal(stanzaOf(new Uint8Array(twoTlock)), null);
  assert.equal(stanzaOf(new TextEncoder().encode("-> tlock 1 " + QUICKNET.hash)), null); // no age header
  assert.deepEqual(stanzaOf(sealed), { round: B.round, chain: QUICKNET.hash });
});

test("seedRoundAt = drand's own roundAt/roundTime: first quicknet round at or after close + 300 s (A7)", () => {
  const info = { ...QUICKNET, metadata: { ...QUICKNET.metadata } };
  for (let i = 0; i < 2000; i++) {
    const close = 1793293200 + i * 86400 + (i % 7);
    const t = (close + 300) * 1000;
    const ra = roundAt(t, info);
    assert.equal(seedRoundAt(close), roundTime(info, ra) >= t ? ra : ra + 1, `close ${close}`);
  }
});
