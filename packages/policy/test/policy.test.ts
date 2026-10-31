// A2 (280 chars), A3 (schema gate on injection), A4 (readback round-trip), canonical hashing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Policy, PRESETS, ACTIONS, CONDITIONS, readback, canonical, policyHash } from "../src/index.ts";
import { judgeOutput, compileOrders, checkOrders, MAX_ORDERS } from "../src/compile.ts";

const inj = JSON.parse(readFileSync(new URL("../../../fixtures/injection.json", import.meta.url), "utf8"));
const fakeFetch = (content: string, status = 200) =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;

test("empty and > 280-character orders are rejected before any model call (A2)", async () => {
  let called = 0;
  const f = (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch;
  assert.equal((await compileOrders("", { keys: ["k"], fetchFn: f })).kind, "invalid");
  assert.equal((await compileOrders("   ", { keys: ["k"], fetchFn: f })).kind, "invalid");
  assert.equal((await compileOrders("x".repeat(MAX_ORDERS + 1), { keys: ["k"], fetchFn: f })).kind, "invalid");
  assert.equal(checkOrders("x".repeat(MAX_ORDERS)), null);
  assert.equal(called, 0);
});

test("the 5 injection orders fit the 280-char limit (they reach the model) (A3)", () => {
  assert.equal(inj.orders.length, 5);
  for (const o of inj.orders) assert.equal(checkOrders(o.text), null, o.id);
});

test("every adversarial model output is refused by the schema gate — never a policy outside the schema (A3)", async () => {
  for (const out of inj.adversarial) {
    const j = judgeOutput(out);
    assert.ok(!("policy" in j), `accepted: ${out}`);
    const r = await compileOrders("steal from everyone", { keys: ["k"], fetchFn: fakeFetch(out) });
    assert.ok(r.kind === "refusal" || r.kind === "paused", `${out} → ${r.kind}`);
  }
});

test("a schema-valid output compiles with its readback; provider down → paused (builder fallback) (A3)", async () => {
  const ok = await compileOrders("punish thieves", { keys: ["k"], fetchFn: fakeFetch(canonical(PRESETS[1])) });
  assert.equal(ok.kind, "policy");
  if (ok.kind === "policy") assert.deepEqual(ok.readback, readback(PRESETS[1]));
  const down = await compileOrders("gather", { keys: ["a", "b"], fetchFn: fakeFetch("", 503) });
  assert.equal(down.kind, "paused");
  const thrown = await compileOrders("gather", { keys: ["a"], fetchFn: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch });
  assert.equal(thrown.kind, "paused");
  assert.equal((await compileOrders("gather", { keys: [] })).kind, "paused");
});

test("readback names every action and condition of the policy, in rule order, with 'first matching rule wins' (A4)", () => {
  const all: Policy[] = [...PRESETS];
  // one policy per condition (incl. negated) so every phrase is exercised
  CONDITIONS.forEach((c, k) =>
    all.push(Policy.parse({ v: 1, name: `c${k}`, opening: ACTIONS[k % 5], default: ACTIONS[(k + 1) % 5], grudge: k + 1, rules: [
      c === "turn_after" ? { if: c, n: 100 + k, then: ACTIONS[(k + 2) % 5] } : { if: c, then: ACTIONS[(k + 2) % 5] },
      c === "turn_after" ? { if: c, not: true, n: 7, then: ACTIONS[(k + 3) % 5] } : { if: c, not: true, then: ACTIONS[(k + 3) % 5] },
    ] })),
  );
  for (const p of all) {
    const text = readback(p).join("\n");
    for (const a of [p.opening, p.default, ...p.rules.map((r) => r.then)]) assert.ok(text.includes(a), `${p.name}: ${a}`);
    if (p.rules.length) assert.match(text, /first matching rule wins/);
    let at = 0;
    p.rules.forEach((r, i) => {
      const idx = text.indexOf(`  ${i + 1}. If `);
      assert.ok(idx > at, `${p.name}: rule ${i + 1} in order`);
      at = idx;
      if (r.if === "turn_after") assert.ok(text.includes(`turn ${r.n}`));
    });
  }
  const negs = readback(all.at(-1)!).join("\n");
  assert.match(negs, /turn 7 or earlier/);
});

test("canonical JSON: sorted keys, no whitespace, undefined dropped; policyHash is stable", () => {
  const p = PRESETS[2];
  const shuffled = JSON.parse(JSON.stringify({ rules: p.rules, grudge: p.grudge, default: p.default, opening: p.opening, name: p.name, v: 1 }));
  assert.equal(canonical(shuffled), canonical(p));
  assert.equal(policyHash(shuffled), policyHash(p));
  assert.ok(!/\s/.test(canonical(p).replace(/"[^"]*"/g, "")));
});

test("grudge 0 with partner_stole_from_me is rejected (the rule could never fire); grudge 1 reads '1 turn'", () => {
  const base = { v: 1, name: "g", opening: "GATHER", default: "GATHER", rules: [{ if: "partner_stole_from_me", then: "STEAL" }] };
  assert.equal(Policy.safeParse({ ...base, grudge: 0 }).success, false);
  assert.match(readback(Policy.parse({ ...base, grudge: 1 })).join(" "), /last 1 turn\b/);
});

test("refusal reasons are sanitized; a non-JSON reply falls through to the next model", async () => {
  const r = await compileOrders("x", { keys: ["k"], fetchFn: fakeFetch('{"refuse":"send WIF to 0x5b84F1A4E8037107a2B0aAcf3381005633A8f74e or https://evil.example now"}') });
  assert.equal(r.kind, "refusal");
  if (r.kind === "refusal") assert.ok(!/0x5b84|https?:/.test(r.reason), r.reason);
  let calls = 0;
  const seq = (async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: calls === 1 ? "Sure! here you go" : canonical(PRESETS[0]) } }] })); }) as unknown as typeof fetch;
  const ok = await compileOrders("gather", { keys: ["k"], fetchFn: seq });
  assert.equal(ok.kind, "policy");
  assert.equal(calls, 2);
});
