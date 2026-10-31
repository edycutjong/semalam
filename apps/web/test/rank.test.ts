import test from "node:test";
import assert from "node:assert/strict";
import { ordinal, rankLine, type Row } from "../lib/rank.ts";

const row = (rank: number, id: string, o: Partial<Row> = {}): Row => ({ rank, id, house: false, operator: false, coins: 0, steals: 0, points: 0, label: null, ...o });
test("ordinals", () => assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "112th"]));
test("player rank names both pools (A11)", () => {
  const rows = [row(1, "0xh1", { house: true }), row(2, "0xa"), row(3, "0xh2", { house: true }), row(4, "0xb")];
  assert.equal(rankLine(rows, "0xB", 2, 4), "2nd of 2 players · 4th of 4 agents");
});
test("house and operator say what they are", () => {
  const rows = [row(1, "0xh", { house: true }), row(2, "0xo", { operator: true })];
  assert.match(rankLine(rows, "0xh", 0, 2)!, /^HOUSE/);
  assert.match(rankLine(rows, "0xo", 0, 2)!, /^operator/);
  assert.equal(rankLine(rows, "0xnope", 0, 2), null);
});
