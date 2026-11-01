import test from "node:test";
import assert from "node:assert/strict";
import { PAYOFF } from "@semalam/sim";
import { PRESETS, readback } from "@semalam/policy";
import { nightOf, ritualOf, streakOf, type Night } from "../lib/ritual.ts";
import { hintOf, ordersText } from "../lib/rewrite.ts";
import type { Row } from "../lib/rank.ts";

const row = (rank: number, id: string, o: Partial<Row> = {}): Row => ({ rank, id, house: false, operator: false, coins: 50 - rank, steals: 0, points: 0, label: null, ...o });
const night = (round: number, playerRank: number | null, players: number, committed = true): Night => ({ round, committed, rank: playerRank, playerRank, players, agents: players + 30, coins: playerRank ? 10 : null });

test("nightOf: a player's rank counts players only; house and operator never score", () => {
  const rows = [row(1, "0xh", { house: true }), row(2, "0xo", { operator: true }), row(3, "0xA"), row(4, "0xb")];
  assert.deepEqual(nightOf(5, rows, ["0xa"], 2, 4, "0xa"), { round: 5, committed: true, rank: 3, playerRank: 1, players: 2, agents: 4, coins: 47 });
  assert.equal(nightOf(5, rows, [], 2, 4, "0xB").playerRank, 2);
  assert.equal(nightOf(5, rows, ["0xh"], 2, 4, "0xh").playerRank, null);
  assert.equal(nightOf(5, rows, ["0xo"], 2, 4, "0xo").playerRank, null);
  const voided = nightOf(5, rows, ["0xc"], 2, 4, "0xC"); // committed but never ranked (void / over capacity)
  assert.equal(voided.committed, true); assert.equal(voided.playerRank, null);
});

test("streak counts nights played back from tonight, or from last night while tonight is still open", () => {
  assert.equal(streakOf([3, 4, 5], 5), 3);
  assert.equal(streakOf([3, 4, 5], 6), 3); // tonight not sealed yet: no zero, no guilt
  assert.equal(streakOf([1, 3, 4, 6], 6), 1);
  assert.equal(streakOf([1, 2], 4), 0);
  assert.equal(streakOf([], 1), 0);
});

test("ritual: best is the best share of the field, delta compares the last two scored nights", () => {
  const r = ritualOf([night(2, 4, 12), night(3, 2, 15), night(4, 2, 3)], [5], 5);
  assert.deepEqual(r.played, [2, 3, 4, 5]);
  assert.equal(r.streak, 4);
  assert.equal(r.best?.round, 3); // 2nd of 15 beats 2nd of 3
  assert.equal(r.last?.round, 4); assert.equal(r.prev?.round, 3); assert.equal(r.delta, 0);
  const up = ritualOf([night(2, 4, 12), night(3, 2, 15)], [], 4);
  assert.equal(up.delta, 2); assert.equal(up.streak, 2);
  const none = ritualOf([], [], 3);
  assert.equal(none.best, null); assert.equal(none.delta, null); assert.equal(none.streak, 0);
});

test("rewrite hint quotes the frozen payoff table, never a typed number", () => {
  const ACTS = ["GATHER", "GUARD", "SHARE", "STEAL"];
  const s = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");
  assert.equal(hintOf("SHARE", "STEAL"), `On that turn, against their steal: guard pays ${s(PAYOFF[1][3])} on the payoff table, your share paid ${s(PAYOFF[2][3])}.`);
  assert.equal(hintOf("GUARD", "STEAL"), `On that turn your guard was already the best reply to their steal (${s(PAYOFF[1][3])} on the payoff table).`);
  for (const a of ACTS) for (const b of ACTS) {
    const h = hintOf(a, b);
    const best = Math.max(...ACTS.map((_, i) => PAYOFF[i][ACTS.indexOf(b)]));
    assert.ok(h.includes(s(best)), `${a} vs ${b} names the best reply's payoff`);
  }
  assert.match(hintOf("GATHER", null), /alone for \+3/);
});

test("rewrite text is the confirmed readback, minus the header, within the order box limit", () => {
  for (const p of PRESETS) {
    const t = ordersText(p);
    assert.ok(!t.includes("Your agent"), "no readback header");
    assert.ok(t.startsWith("Turns 1–10: "), t);
    p.rules.forEach((_, i) => assert.ok(t.includes(`${i + 1}) if `), `${p.name}: rule ${i + 1} kept`));
    assert.ok(!/\(|→/.test(t), `${p.name}: plain words, no glosses or arrows`);
    assert.equal(readback(p).length > 1, true);
    assert.ok(t.length <= 280, `${p.name}: ${t.length} chars`);
  }
});
