import test from "node:test";
import assert from "node:assert/strict";
import { seasonBoard } from "../lib/season.ts";
import { seasonTable } from "../../../packages/cli/src/cli.ts";

const A = "0x00000000000000000000000000000000000000a1", B = "0x00000000000000000000000000000000000000b2", C = "0x00000000000000000000000000000000000000c3";
const row = (rank: number, id: string, coins: number, points: number, o = {}) => ({ rank, id, house: false, operator: false, coins, steals: 0, points, label: null, ...o });
const night = (): any => ({ agents: 6, ranking: [row(1, A, 90, 100), row(2, B, 80, 99), row(3, "0x000000000000000000000000000000000000dEaD", 70, 0, { house: true }), row(5, C, 40, 96)] });

test("season board equals the CLI's seasonTable (same input, same output)", () => {
  const nights = [night(), night()];
  const payers = new Set([B.toLowerCase(), C.toLowerCase()]);
  const mine = seasonBoard(nights, payers);
  const cli = seasonTable(nights, payers);
  assert.deepEqual(mine.board.map((b) => [b.id, b.points, b.eligible]), cli.board.map((b: any) => [b.id, b.points, b.eligible]));
  assert.equal(mine.champion?.id, cli.champion?.id);
});
test("an unpaid account is never crown-eligible; house never scores", () => {
  const r = seasonBoard([night()], new Set());
  assert.equal(r.champion, null);
  assert.ok(r.board.every((b) => !b.eligible));
  assert.equal(r.board.length, 3);
});
