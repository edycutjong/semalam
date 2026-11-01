// Coverage gap-fillers for src/compile.ts. The LLM (Groq) is always stubbed; no real network call is made.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, canonical } from "../src/index.ts";
import { compileOrders, cleanReason, judgeOutput, GROQ_URL, MODELS } from "../src/compile.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const groq = (content: unknown, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const stub = (...steps: (Response | Error | (() => Response | Promise<Response>))[]) => {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (s instanceof Error) throw s;
    return typeof s === "function" ? s() : s.clone();
  }) as unknown as typeof fetch;
  return calls;
};

test("cleanReason falls back to the generic sentence when stripping leaves nothing", () => {
  assert.equal(cleanReason("https://evil.example/x"), "[removed]"); // links are replaced, not dropped
  assert.equal(cleanReason("   "), "these orders are not about how the stall should play");
  assert.equal(cleanReason("\u{1F600}​\u{1F4A5}"), "these orders are not about how the stall should play");
  assert.equal(cleanReason("not about stalls"), "not about stalls");
});

test("judgeOutput strips code fences, and reports non-JSON as garbled", () => {
  const p = canonical(PRESETS[0]);
  assert.deepEqual(judgeOutput("```json\n" + p + "\n```"), { policy: PRESETS[0] });
  assert.deepEqual(judgeOutput("sure! here you go"), { garbled: true });
});

test("success through the global fetch: posts to Groq with the first key and the first model", async () => {
  const calls = stub(groq(canonical(PRESETS[1])));
  const r = await compileOrders("punish thieves", { keys: ["k1"] });
  assert.equal(r.kind, "policy");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GROQ_URL);
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer k1");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.model, MODELS[0]);
  assert.equal(body.temperature, 0);
  assert.match(body.messages[1].content, /<<<punish thieves>>>/);
  if (r.kind === "policy") assert.equal(r.model, MODELS[0]);
});

test("a refusal from the model is returned as a refusal with the model name", async () => {
  stub(groq('{"refuse":"that is not about the stall"}'));
  const r = await compileOrders("what is the weather", { keys: ["k"] });
  assert.equal(r.kind, "refusal");
  if (r.kind === "refusal") { assert.equal(r.reason, "that is not about the stall"); assert.equal(r.model, MODELS[0]); }
});

test("an HTTP 4xx other than 429 stops retrying that model and moves to the next model", async () => {
  const calls = stub(new Response("bad key", { status: 401 }), groq(canonical(PRESETS[0])));
  const r = await compileOrders("gather", { keys: ["a", "b", "c"] });
  assert.equal(calls.length, 2); // no retry with keys b, c on the 401
  assert.equal(JSON.parse(calls[0].init.body as string).model, MODELS[0]);
  assert.equal(JSON.parse(calls[1].init.body as string).model, MODELS[1]);
  assert.equal(r.kind, "policy");
  if (r.kind === "policy") assert.equal(r.model, MODELS[1]);
});

test("a 4xx on every model ends paused with the last HTTP status in the reason", async () => {
  const calls = stub(new Response("nope", { status: 400 }));
  const r = await compileOrders("gather", { keys: ["a", "b"] });
  assert.equal(calls.length, MODELS.length);
  assert.deepEqual(r, { kind: "paused", reason: "compiler paused — use the builder (HTTP 400)" });
});

test("429 and 5xx retry with the next key before giving up on the model", async () => {
  const calls = stub(new Response("", { status: 429 }), new Response("", { status: 503 }), groq(canonical(PRESETS[0])));
  const r = await compileOrders("gather", { keys: ["a", "b", "c"] });
  assert.equal(r.kind, "policy");
  assert.deepEqual(calls.map((c) => (c.init.headers as Record<string, string>).authorization), ["Bearer a", "Bearer b", "Bearer c"]);
});

test("an unreadable (non-JSON) provider body is retried, then ends paused as 'unreadable provider body'", async () => {
  const calls = stub(new Response("<html>gateway error</html>", { status: 200 }));
  const r = await compileOrders("gather", { keys: ["a", "b"], models: ["m1"] });
  assert.equal(calls.length, 2);
  assert.deepEqual(r, { kind: "paused", reason: "compiler paused — use the builder (unreadable provider body)" });
});

test("a provider body with no choices, or null content, is treated as empty text and ends as garbled", async () => {
  for (const res of [new Response("{}", { status: 200 }), new Response('{"choices":[]}', { status: 200 }), groq(null)]) {
    const calls = stub(res);
    const r = await compileOrders("gather", { keys: ["a"], models: ["m1", "m2"] });
    assert.equal(calls.length, 2, "garbled output moves on to the next model"); // break → next model
    assert.deepEqual(r, { kind: "paused", reason: "compiler paused — use the builder (the compiler did not return JSON)" });
  }
});

test("model prose instead of JSON is garbled: the next model is tried and can still succeed", async () => {
  const calls = stub(groq("Sure, I will steal everything."), groq(canonical(PRESETS[0])));
  const r = await compileOrders("steal", { keys: ["a"] });
  assert.equal(calls.length, 2);
  assert.equal(r.kind, "policy");
});

test("a policy outside the schema becomes a schema refusal, not a policy", async () => {
  stub(groq('{"v":1,"name":"x","opening":"GATHER","default":"GATHER","grudge":0,"rules":[],"extra":"field"}'));
  const r = await compileOrders("gather", { keys: ["a"] });
  assert.equal(r.kind, "refusal");
  if (r.kind === "refusal") assert.match(r.reason, /fell outside the schema/);
});

test("grudge 0 beside a partner_stole_from_me rule is repaired to 1 (found by the P1e bot playtest); no other field is touched", () => {
  const raw = '{"v":1,"name":"tit","opening":"SHARE","default":"GATHER","grudge":0,"rules":[{"if":"partner_stole_from_me","then":"STEAL"},{"if":"partner_shared_with_me","then":"SHARE"}]}';
  const j = judgeOutput(raw);
  assert.ok("policy" in j);
  if ("policy" in j) { assert.equal(j.policy.grudge, 1); assert.equal(j.policy.rules.length, 2); assert.equal(j.policy.name, "tit"); }
  // an out-of-schema field is still refused even when the grudge is the other defect
  const extra = judgeOutput(raw.replace('"v":1', '"v":1,"bonus":9'));
  assert.ok("refusal" in extra);
});

test("a thrown fetch (network error) records the error text in the paused reason", async () => {
  stub(new Error("ECONNRESET"));
  const r = await compileOrders("gather", { keys: ["a"], models: ["m1"] });
  assert.equal(r.kind, "paused");
  if (r.kind === "paused") assert.match(r.reason, /ECONNRESET/);
});

test("an exhausted time budget pauses before any request is sent", async () => {
  const calls = stub(groq(canonical(PRESETS[0])));
  const r = await compileOrders("gather", { keys: ["a"], budgetMs: 100 });
  assert.equal(calls.length, 0);
  assert.deepEqual(r, { kind: "paused", reason: "compiler paused — use the builder (out of time: no compiler keys configured)" });
});

test("an injected fetchFn wins over the global fetch", async () => {
  const calls = stub(groq(canonical(PRESETS[0])));
  let used = 0;
  const own = (async () => { used++; return groq(canonical(PRESETS[2])); }) as unknown as typeof fetch;
  const r = await compileOrders("gather", { keys: ["a"], fetchFn: own });
  assert.equal(used, 1);
  assert.equal(calls.length, 0);
  assert.equal(r.kind, "policy");
});
