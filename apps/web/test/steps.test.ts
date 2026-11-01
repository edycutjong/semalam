// The deck's turn-by-turn night (lib/steps.ts): the re-run must be the posted night, and its stops come from the trace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nightSteps } from "../lib/steps";

const art = JSON.parse(readFileSync("data/rounds/2.json", "utf8"));
const pool = art.settled.ranking.filter((r: { operator: boolean }) => !r.operator);
const tagged = pool[Math.min(3, pool.length - 1)].id as string; // the landing's featured ticket: 4th non-operator

test("night 2 re-runs to the posted result hash", async () => {
  const d = await nightSteps(2, tagged);
  assert.ok(d, "nightSteps returned null: the re-run no longer gives the posted hash");
  assert.equal(d.resultHash.toLowerCase(), art.onchain.resultHash.toLowerCase());
  assert.equal(d.agents, art.settled.agents);
  assert.equal(d.line.length, d.turns);
});

test("its stops are picked from the trace, in order, ending at the settled rank", async () => {
  const d = (await nightSteps(2, tagged))!;
  const ts = d.steps.map((s) => s.t);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  assert.equal(ts[0], 1);
  assert.equal(ts.at(-1), d.turns);
  const final = art.settled.ranking.find((r: { id: string }) => r.id.toLowerCase() === tagged.toLowerCase());
  assert.equal(d.steps.at(-1)!.rank, final.rank);
  assert.equal(d.steps.at(-1)!.coins, final.coins);
  for (const s of d.steps) assert.equal(s.rank, d.line[s.t - 1]); // every stop agrees with the rank line
  // keyframes in the artifact (every 10th turn) agree with the re-run trace
  const kf = art.settled.replays.find((r: { id: string }) => r.id.toLowerCase() === tagged.toLowerCase()).keyframes;
  for (const k of kf) assert.equal(d.line[k.t - 1], k.rank, `turn ${k.t}`);
});

test("an unknown agent or an unposted night gives no steps", async () => {
  assert.equal(await nightSteps(2, "0x000000000000000000000000000000000000dEaD"), null);
  assert.equal(await nightSteps(999, tagged), null);
});
