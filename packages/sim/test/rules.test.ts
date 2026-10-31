// A17, A18 (COPY_LEADER), replay keyframes — rule-level vectors on traced nights.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRESETS, Policy, policyHash } from "@semalam/policy";
import type { Hex } from "viem";
import { open } from "@semalam/beacon";
import { selectCommits, openCommits, policySetHash, type CommitLog } from "../src/round.ts";
import { run, replayOf, ACTS, OPENING_TURNS, points, type Agent } from "../src/index.ts";
import { houseAgents, HOUSE_SET_HASH } from "../src/house.ts";
import { field, RANDOMNESS } from "./fixture.ts";
import { OPTS } from "./opts.ts";

const nurse = PRESETS.find((p) => p.name === "night-nurse")!;
const copy = PRESETS.find((p) => p.name === "copy-the-winner")!;
const golden = (n: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/golden/${n}.json`, import.meta.url), "utf8"));

test("A18: COPY_LEADER = GATHER on turn 1, the leader's previous resolved action after, default when I lead", () => {
  const agents: Agent[] = [...field(60), { id: "0x00000000000000000000000000000000c0c0c0c0", policy: { ...copy, opening: "COPY_LEADER" } }];
  const res = run(agents, RANDOMNESS, { ...OPTS, trace: true });
  const tr = res.trace!;
  let copied = 0, led = 0;
  res.field.forEach((a, i) => {
    const usesCopy = (t: number) => (t <= OPENING_TURNS ? a.policy.opening : a.policy.rules.length === 0 ? a.policy.default : null) === "COPY_LEADER";
    for (let t = 1; t <= tr.length; t++) {
      if (!usesCopy(t)) continue;
      const got = ACTS[tr[t - 1].act[i]];
      if (t === 1) { assert.equal(got, "GATHER", `agent ${i} turn 1`); continue; }
      const prev = tr[t - 2];
      const leader = prev.rank.indexOf(1);
      if (leader === i) {
        led++;
        assert.equal(got, a.policy.default === "COPY_LEADER" ? "GATHER" : a.policy.default);
      } else {
        copied++;
        const leaderResolved = prev.partner[leader] < 0 ? "GATHER" : ACTS[prev.act[leader]];
        assert.equal(got, leaderResolved, `agent ${i} turn ${t} copies leader ${leader}`);
      }
    }
  });
  assert.ok(copied > 300, `copied ${copied}`);
});

test("A17: night-nurse fires 'partner stole from me → STEAL' on every golden night and never steals from a top-10 neighbour", async () => {
  assert.equal(nurse.rules[0].if, "partner_is_leader");
  assert.notEqual(nurse.rules[0].then, "STEAL");
  assert.deepEqual([nurse.rules[1].if, nurse.rules[1].then], ["partner_stole_from_me", "STEAL"]);
  for (const name of ["round-a", "round-b"]) {
    const g = golden(name);
    const logs: CommitLog[] = g.logs.map((l: { account: Hex; policyHash: Hex; blob: number; blockNumber: number; logIndex: number }) => ({ ...l, sealedBlob: g.blobs[l.blob], blockNumber: BigInt(l.blockNumber) }));
    const { latest } = selectCommits(logs);
    const { agents } = await openCommits(latest, g.beacon.round, (b) => open(b, g.beacon));
    const res = run([...houseAgents(), ...agents], `0x${g.beacon.randomness}`, { round: BigInt(g.round), drandRound: BigInt(g.beacon.round), policySetHash: policySetHash(latest), houseSetHash: HOUSE_SET_HASH, trace: true });
    assert.equal(res.resultHash, g.expect.resultHash, `${name} traced run reproduces the golden hash`);
    const i = res.field.findIndex((a) => policyHash(a.policy) === policyHash(nurse));
    assert.ok(i >= 0, `${name}: night-nurse plays`);
    let fires = 0;
    res.trace!.forEach((row, k) => {
      if (row.fired[i] === 1) fires++;
      const p = row.partner[i];
      if (k > 0 && p >= 0 && ACTS[row.act[i]] === "STEAL") assert.ok(res.trace![k - 1].rank[p] > 10, `${name} turn ${k + 1}: stole from top-10`);
    });
    assert.ok(fires >= 1, `${name}: rule 2 fired ${fires}×`);
    const rep = replayOf(res, res.field[i].id);
    assert.equal(rep.keyframes.length, 30);
    assert.match(rep.decisive.why, /^turn \d+: /);
  }
});

test("points: 100 for rank 1, 0 from rank 101, house never scores", () => {
  assert.deepEqual([points(1), points(4), points(100), points(101), points(1, true)], [100, 97, 1, 0, 0]);
});

test("presets: 8, schema-valid, distinct names", () => {
  assert.equal(PRESETS.length, 8);
  PRESETS.forEach((p) => Policy.parse(p));
  assert.equal(new Set(PRESETS.map((p) => p.name)).size, 8);
});
