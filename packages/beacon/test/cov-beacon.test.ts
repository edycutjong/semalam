import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyBeacon,
  fetchBeacon,
  offlineClient,
  seal,
  open,
  stanzaOf,
  QUICKNET,
  type Beacon,
} from "../src/index.ts";
import { roundTimeOf, seedRoundAt } from "../src/consts.ts";

// Real quicknet beacon (api.drand.sh, fetched 2026-10-31).
const B: Beacon = {
  round: 33548730,
  randomness: "3c11de15056c2178129fd057942ef8d0a826dc210e339a785390d50097e42f3e",
  signature: "8b712b36d332899c647ec99914f1712b213e131602778966d4aa33fd5ac6650ec92e5780742a38a8666f1e36e5ec2729",
};

const flip = (h: string) => (h[5] === "0" ? h.slice(0, 5) + "1" + h.slice(6) : h.slice(0, 5) + "0" + h.slice(6));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test("verifyBeacon accepts a valid quicknet beacon (no expectRound) and returns it", () => {
  assert.deepEqual(verifyBeacon(B), B);
});

test("verifyBeacon accepts a valid quicknet beacon when expectRound matches", () => {
  assert.deepEqual(verifyBeacon(B, B.round), B);
});

test("verifyBeacon rejects a round that does not match expectRound", () => {
  assert.throws(() => verifyBeacon(B, B.round + 1), /drand: got round \d+, need \d+/);
});

test("verifyBeacon rejects a signature whose bytes are not a curve point (verify throws)", () => {
  assert.throws(() => verifyBeacon({ ...B, signature: B.signature.slice(0, -1) }), /BAD SIGNATURE/);
});

test("verifyBeacon rejects a well-formed signature that fails verification", () => {
  assert.throws(() => verifyBeacon({ ...B, signature: flip(B.signature) }), /BAD SIGNATURE/);
});

test("verifyBeacon rejects tampered randomness", () => {
  assert.throws(() => verifyBeacon({ ...B, randomness: flip(B.randomness) }), /randomness != sha256/);
});

test("fetchBeacon verifies and returns the beacon from the first mirror", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return jsonResponse(B);
  };
  const beacon = await fetchBeacon(B.round, ["https://one.example"], fetchFn);
  assert.equal(calls, 1);
  assert.deepEqual(beacon, B);
});

test("fetchBeacon skips a 425 mirror and verifies on the next", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return calls === 1 ? jsonResponse(null, 425) : jsonResponse(B);
  };
  const beacon = await fetchBeacon(B.round, ["https://one.example", "https://two.example"], fetchFn);
  assert.equal(calls, 2);
  assert.deepEqual(beacon, B);
});

test("fetchBeacon skips a non-ok HTTP response and verifies on the next", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return calls === 1 ? jsonResponse(null, 500) : jsonResponse(B);
  };
  const beacon = await fetchBeacon(B.round, ["https://one.example", "https://two.example"], fetchFn);
  assert.equal(calls, 2);
  assert.deepEqual(beacon, B);
});

test("fetchBeacon throws the last mirror's error when every mirror fails", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return jsonResponse(null, 500);
  };
  await assert.rejects(fetchBeacon(B.round, ["https://one.example", "https://two.example"], fetchFn), /HTTP 500/);
  assert.equal(calls, 2);
});

test("fetchBeacon wraps a non-Error failure from the only mirror", async () => {
  const fetchFn = async () => {
    throw "down";
  };
  await assert.rejects(fetchBeacon(B.round, ["https://one.example"], fetchFn), /down/);
});

test("fetchBeacon with no mirrors throws", async () => {
  await assert.rejects(fetchBeacon(B.round, []), /undefined/);
});

test("offlineClient.get returns the pinned beacon for an existing round", async () => {
  const client = offlineClient([B]);
  assert.deepEqual(await client.get(B.round), {
    round: B.round,
    randomness: B.randomness,
    signature: B.signature,
  });
});

test("offlineClient.get throws for a round with no pinned beacon", async () => {
  await assert.rejects(offlineClient([B]).get(B.round + 1), /no verified beacon for round/);
});

test("offlineClient.latest always throws", async () => {
  await assert.rejects(offlineClient([B]).latest(), /latest\(\) not available/);
});

test("offlineClient.chain returns the pinned offline chain info", () => {
  const client = offlineClient([B]);
  assert.equal(client.chain().baseUrl, "offline://quicknet");
  assert.equal(typeof client.chain().info, "function");
});

test("offlineClient.options disables verification and caching", () => {
  const o = offlineClient([B]).options;
  assert.equal(o.disableBeaconVerification, true);
  assert.equal(o.noCache, true);
  assert.equal(o.chainVerificationParams!.chainHash, QUICKNET.hash);
  assert.equal(o.chainVerificationParams!.publicKey, QUICKNET.public_key);
});

test("seal returns binary age output naming the round and chain", async () => {
  const msg = new TextEncoder().encode('{"v":1}');
  const sealed = await seal(msg, B.round);
  assert.ok(sealed instanceof Uint8Array && sealed.length > 0);
  assert.deepEqual(stanzaOf(sealed), { round: B.round, chain: QUICKNET.hash });
});

test("open returns the plaintext sealed with the matching beacon", async () => {
  const msg = new TextEncoder().encode("hello beacon");
  const sealed = await seal(msg, B.round);
  assert.deepEqual(await open(sealed, B), msg);
});

test("open restores console.log even when the beacon cannot decrypt", async () => {
  const sealed = await seal(new TextEncoder().encode("x"), B.round);
  const log = console.log;
  await assert.rejects(open(sealed, { ...B, round: B.round + 1 }), /no verified beacon/);
  assert.equal(console.log, log);
});

test("roundTimeOf is the inverse of seedRoundAt: the seed round's time is the first quicknet tick at or after close + 300 s", () => {
  for (const close of [1_793_552_400, 1_793_552_401, 1_793_552_402]) {
    const r = seedRoundAt(close);
    assert.ok(roundTimeOf(r) >= close + 300);
    assert.ok(roundTimeOf(r - 1) < close + 300);
  }
  assert.equal(roundTimeOf(1), QUICKNET.genesis_time);
});

const ageHeader = (stanzas: string[]) => new TextEncoder().encode(`age-encryption.org/v1\n${stanzas.join("\n")}\n--- mac\nbody`);

test("stanzaOf voids a header with two recipient stanzas (an extra stanza is never decrypted)", () => {
  assert.equal(stanzaOf(ageHeader([`-> tlock 7 ${QUICKNET.hash}`, "-> X25519 abc"])), null);
});

test("stanzaOf voids a single stanza that is not tlock (e.g. a costly scrypt stanza)", () => {
  assert.equal(stanzaOf(ageHeader(["-> scrypt salt 18"])), null);
});

test("stanzaOf reads round and chain from a well-formed single tlock stanza", () => {
  assert.deepEqual(stanzaOf(ageHeader([`-> tlock 42 ${QUICKNET.hash}`])), { round: 42, chain: QUICKNET.hash });
});
