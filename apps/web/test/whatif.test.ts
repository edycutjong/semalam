import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "@semalam/policy";
import { MAX_VARIANTS, editedPolicy } from "../lib/whatif.ts";

const p = PRESETS.find((x) => x.name === "night-nurse")!;
test("A19: what-if only removes existing rules, never adds or rewrites", () => {
  const e = editedPolicy(p, new Set([1]));
  assert.equal(e.rules.length, p.rules.length - 1);
  for (const r of e.rules) assert.ok(p.rules.some((o) => JSON.stringify(o) === JSON.stringify(r)));
  assert.deepEqual({ ...e, rules: [] }, { ...p, rules: [] });
  assert.equal(editedPolicy(p, new Set()).rules.length, p.rules.length);
  assert.equal(MAX_VARIANTS, 3);
});
