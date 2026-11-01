// Coverage gap-fillers for src/index.ts, src/house.ts and src/round.ts: edge cases only, no source or fixture is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, getAddress, bytesToHex, toBytes, type Hex, type Address } from "viem";
import { canonical, PRESETS, type Policy } from "@semalam/policy";
import { QUICKNET } from "@semalam/beacon/consts";
import { run, replayOf, rankOf, TURNS, ALONE, type Agent } from "../src/index.ts";
import { parseHouseSet } from "../src/house.ts";
import { selectCommits, openCommits, type CommitLog } from "../src/round.ts";
import { OPTS } from "./opts.ts";
import { RANDOMNESS } from "./fixture.ts";

const pol = (p: Partial<Policy>): Policy => ({ v: 1, name: "t", opening: "GUARD", default: "GUARD", grudge: 0, rules: [], ...p }) as Policy;
const id = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Hex;
const T = { ...OPTS, trace: true };

// ---------- house.ts
test("parseHouseSet rejects null and undefined input instead of dereferencing it", () => {
  assert.throws(() => parseHouseSet(null), /need v=1 and 30 agents/);
  assert.throws(() => parseHouseSet(undefined), /need v=1 and 30 agents/);
});
test("parseHouseSet rejects a wrong version and a wrong agent count", () => {
  assert.throws(() => parseHouseSet({ v: 2, agents: [] }), /need v=1/);
  assert.throws(() => parseHouseSet({ v: 1, agents: [] }), /need v=1/);
  assert.throws(() => parseHouseSet({ v: 1, agents: "x" }), /need v=1/);
});

// ---------- index.ts: run()
test("run requires round, drandRound, policySetHash and houseSetHash", () => {
  assert.throws(() => run([], RANDOMNESS, { ...OPTS, policySetHash: "" as Hex }), /required/);
  assert.throws(() => run([], RANDOMNESS, { ...OPTS, houseSetHash: "" as Hex }), /required/);
  assert.throws(() => run([], RANDOMNESS, { ...OPTS, round: undefined as unknown as bigint }), /required/);
  assert.throws(() => run([], RANDOMNESS, { ...OPTS, drandRound: undefined as unknown as bigint }), /required/);
});

test("agents whose ids differ only by letter case sort as equal and keep input order (stable tie)", () => {
  const sum = getAddress("0x00000000000000000000000000000000000000ab");
  assert.notEqual(sum, sum.toLowerCase()); // checksummed form really differs in case from the lowercase form
  const a: Agent = { id: sum, policy: pol({}) };
  const b: Agent = { id: sum.toLowerCase() as Hex, policy: pol({ name: "other" }) };
  const r = run([a, b], RANDOMNESS, OPTS);
  assert.equal(r.agents, 2);
  assert.deepEqual(r.field.map((x) => x.policy.name), ["t", "other"]);
  const r2 = run([b, a], RANDOMNESS, OPTS);
  assert.deepEqual(r2.field.map((x) => x.policy.name), ["other", "t"]);
});

test("turn_after without n never fires (defaults to the last turn)", () => {
  const lazy = pol({ rules: [{ if: "turn_after", then: "STEAL" }] as Policy["rules"] });
  const r = run([{ id: id(1), policy: lazy }, { id: id(2), policy: pol({}) }], RANDOMNESS, T);
  for (let t = 11; t <= TURNS; t++) assert.equal(r.trace![t - 1].fired[0], -1, `turn ${t}`);
  assert.equal(r.ranking.find((s) => s.id === id(1))!.steals, 0);
});

test("a negated rule fires when its condition is false, and reports 'not' in the replay", () => {
  const neg = pol({ rules: [{ if: "turn_after", n: 1000, not: true, then: "STEAL" }] as Policy["rules"] });
  const r = run([{ id: id(1), policy: neg }, { id: id(2), policy: pol({}) }], RANDOMNESS, T);
  assert.equal(r.trace![10].fired[0], 0); // turn 11: first turn rules apply
  assert.equal(r.trace![10].act[0], 3); // STEAL
  const rep = replayOf(r, id(1));
  assert.equal(rep.decisive.t, 11);
  assert.equal(rep.decisive.rule, 0);
  assert.equal(rep.decisive.delta, -3);
  assert.equal(rep.decisive.why, "turn 11: rule 1 (not turn_after) → STEAL vs GUARD, -3 coins");
  assert.equal(rep.decisive.partner, id(2));
  assert.equal(rep.decisive.partnerAction, "GUARD");
});

test("a plain (non-negated) firing rule is named without the 'not' prefix", () => {
  const plain = pol({ rules: [{ if: "turn_after", n: 10, then: "STEAL" }] as Policy["rules"] });
  const r = run([{ id: id(1), policy: plain }, { id: id(2), policy: pol({}) }], RANDOMNESS, T);
  assert.match(replayOf(r, id(1)).decisive.why, /^turn 11: rule 1 \(turn_after\) → STEAL vs GUARD, -3 coins$/);
});

test("with no rule ever firing, the decisive turn is the biggest swing and is attributed to the default", () => {
  // A opens GUARD then defaults to STEAL (turn 11+); B guards throughout → A's first swing of 3 is at turn 11.
  const r = run([{ id: id(1), policy: pol({ default: "STEAL" }) }, { id: id(2), policy: pol({}) }], RANDOMNESS, T);
  const a = replayOf(r, id(1)).decisive;
  assert.equal(a.t, 11);
  assert.equal(a.rule, -1);
  assert.equal(a.why, "turn 11: default → STEAL vs GUARD, -3 coins");
  const b = replayOf(r, id(2)).decisive;
  assert.equal(b.delta, 3);
  assert.equal(b.why, "turn 11: default → GUARD vs STEAL, +3 coins");
});

test("an odd field leaves one stall alone: replay shows partner null and the opening source", () => {
  const three = [1, 2, 3].map((n) => ({ id: id(n), policy: pol({}) }));
  const r = run(three, RANDOMNESS, T);
  const alone = r.field.map((a) => replayOf(r, a.id)).filter((x) => x.decisive.partner === null);
  assert.equal(alone.length, 3); // with this beacon every seat is alone at its best turn
  for (const x of alone) {
    assert.equal(x.decisive.partnerAction, null);
    assert.equal(x.decisive.delta, ALONE);
    // alone turns inside the opening window are attributed to the opening, later ones to the default
    assert.equal(x.decisive.rule, x.decisive.t <= 10 ? -2 : -1);
    assert.match(x.decisive.why, new RegExp(`^turn ${x.decisive.t}: ${x.decisive.t <= 10 ? "opening" : "default"} → GUARD alone, \\+3 coins$`));
  }
  assert.deepEqual(alone.map((x) => x.decisive.t).sort((p, q) => p - q), [1, 2, 51]);
});

test("replayOf matches ids case-insensitively and returns 30 keyframes", () => {
  const r = run([{ id: id(0xab), policy: pol({}) }, { id: id(2), policy: pol({}) }], RANDOMNESS, T);
  const rep = replayOf(r, id(0xab).toUpperCase().replace("0X", "0x") as Hex);
  assert.equal(rep.id, id(0xab));
  assert.equal(rep.keyframes.length, 30);
});

test("replayOf throws without a trace and for an agent that is not in the night", () => {
  const plain = run([{ id: id(1), policy: pol({}) }, { id: id(2), policy: pol({}) }], RANDOMNESS, OPTS);
  assert.throws(() => replayOf(plain, id(1)), /run with \{ trace: true \}/);
  const traced = run([{ id: id(1), policy: pol({}) }, { id: id(2), policy: pol({}) }], RANDOMNESS, T);
  assert.throws(() => replayOf(traced, id(9)), /not in this night/);
});

test("rankOf breaks full ties by tie key ascending, in either input order", () => {
  assert.deepEqual(rankOf([5, 5], [1, 1], ["0x02", "0x01"]), [2, 1]);
  assert.deepEqual(rankOf([5, 5], [1, 1], ["0x01", "0x02"]), [1, 2]);
  assert.deepEqual(rankOf([5, 5], [1, 1], ["0x01", "0x01"]), [1, 2]); // identical keys keep input order
  assert.deepEqual(rankOf([5, 5], [2, 1], ["0x01", "0x02"]), [2, 1]); // fewer steals wins before the key
  assert.deepEqual(rankOf([4, 9], [0, 0], ["0x01", "0x02"]), [2, 1]); // more coins wins first
});

// ---------- round.ts
const ACC = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const commit = (n: number, block: number, idx: number): CommitLog => ({ account: ACC(n), policyHash: keccak256(toBytes(`p${n}`)), sealedBlob: "0x", blockNumber: BigInt(block), logIndex: idx });

test("selectCommits orders by (block, logIndex) whatever the input order, and ties keep a deterministic result", () => {
  const a = commit(1, 5, 0), b = commit(2, 5, 1), c = commit(3, 6, 0);
  for (const logs of [[a, b, c], [c, b, a], [b, c, a]]) assert.deepEqual(selectCommits(logs).latest.map((l) => l.account), [ACC(1), ACC(2), ACC(3)].map((x) => x));
  const same1 = commit(4, 7, 3), same2 = commit(5, 7, 3);
  const out = selectCommits([same1, same2]);
  assert.equal(out.latest.length, 2);
  assert.deepEqual(selectCommits([same2, same1]).latest.map((l) => l.account), [ACC(5), ACC(4)]); // equal position: stable order
});

test("selectCommits cap: later accounts are over capacity, and a re-commit keeps the first position", () => {
  const logs = [commit(1, 1, 0), commit(2, 1, 1), commit(3, 1, 2), { ...commit(1, 9, 0), policyHash: keccak256(toBytes("newer")) }];
  const s = selectCommits(logs, 2);
  assert.deepEqual(s.overCapacity, [ACC(3)]);
  assert.equal(s.latest[0].policyHash, keccak256(toBytes("newer")));
});

const header = (round: number, chain: string) => `age-encryption.org/v1\n-> tlock ${round} ${chain}\nAAAA\n--- BBBB\n`;
const blob = (text: string, pad = 0): Hex => bytesToHex(new TextEncoder().encode(text + "x".repeat(pad)));
const withPlain = (sealed: Hex, plain: string): CommitLog => ({ account: ACC(1), policyHash: keccak256(toBytes(plain)), sealedBlob: sealed, blockNumber: 1n, logIndex: 0 });
const okDecrypt = (text: string) => async () => new TextEncoder().encode(text);

test("openCommits voids a blob with no tlock stanza and one over MAX_SEALED, without calling decrypt", async () => {
  let called = 0;
  const dec = async () => { called++; return new Uint8Array(); };
  const garbage = withPlain(blob("not an age file"), "x");
  const huge = withPlain(blob(header(100, QUICKNET.hash), 1600), "x");
  const { agents, voids } = await openCommits([garbage, huge], 100, dec);
  assert.equal(agents.length, 0);
  assert.deepEqual(voids.map((v) => v.reason), ["UNDECRYPTABLE", "UNDECRYPTABLE"]);
  assert.equal(called, 0);
});

test("openCommits voids WRONG_ROUND for another drand round or another chain", async () => {
  const other = withPlain(blob(header(99, QUICKNET.hash)), "x");
  const chain = withPlain(blob(header(100, "0".repeat(64))), "x");
  const { voids } = await openCommits([other, chain], 100, okDecrypt("x"));
  assert.deepEqual(voids.map((v) => v.reason), ["WRONG_ROUND", "WRONG_ROUND"]);
});

test("openCommits voids UNDECRYPTABLE when decrypt rejects with an Error or with a non-Error value", async () => {
  const s = blob(header(100, QUICKNET.hash));
  const l = withPlain(s, "x");
  const asError = await openCommits([l], 100, async () => { throw new Error("boom"); });
  assert.deepEqual(asError.voids.map((v) => v.reason), ["UNDECRYPTABLE"]);
  const asString = await openCommits([l], 100, () => Promise.reject("just a string"));
  assert.deepEqual(asString.voids.map((v) => v.reason), ["UNDECRYPTABLE"]);
});

test("openCommits decrypts an identical blob once and reuses the cached result for the second account", async () => {
  const policy = PRESETS[0];
  const text = canonical(policy);
  const s = blob(header(100, QUICKNET.hash));
  const l1 = { ...withPlain(s, text), account: ACC(1) };
  const l2 = { ...withPlain(s, text), account: ACC(2), logIndex: 1 };
  let calls = 0;
  const { agents, voids } = await openCommits([l1, l2], 100, async () => { calls++; return new TextEncoder().encode(text); });
  assert.equal(calls, 1);
  assert.equal(voids.length, 0);
  assert.deepEqual(agents.map((a) => a.id), [ACC(1), ACC(2)]);
  assert.deepEqual(agents[0].policy, policy);
});

test("openCommits voids HASH_MISMATCH when the plaintext does not hash to the committed policyHash", async () => {
  const l = { ...withPlain(blob(header(100, QUICKNET.hash)), "committed") };
  const { voids } = await openCommits([l], 100, okDecrypt("something else"));
  assert.deepEqual(voids.map((v) => v.reason), ["HASH_MISMATCH"]);
});

test("openCommits voids SCHEMA_INVALID for non-canonical JSON, invalid UTF-8, bad JSON and a schema-invalid policy", async () => {
  const s = blob(header(100, QUICKNET.hash));
  const pretty = JSON.stringify(PRESETS[0], null, 2); // valid policy, hash matches, but not the canonical encoding
  const cases: Uint8Array[] = [
    new TextEncoder().encode(pretty),
    Uint8Array.from([0xff, 0xfe, 0xfd]),
    new TextEncoder().encode("{nope"),
    new TextEncoder().encode('{"v":1}'),
  ];
  for (const plain of cases) {
    const l: CommitLog = { account: ACC(1), policyHash: keccak256(plain), sealedBlob: s, blockNumber: 1n, logIndex: 0 };
    const { agents, voids } = await openCommits([l], 100, async () => plain);
    assert.equal(agents.length, 0);
    assert.deepEqual(voids.map((v) => v.reason), ["SCHEMA_INVALID"]);
  }
});
