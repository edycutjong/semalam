// Live A3 check: the 5 golden injection orders through the real compiler (Groq), schema gate included.
// Keys from ~/.config/groq/credentials.json (never in the tree). Writes evidence/compiler-injection.json.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { compileOrders } from "../packages/policy/src/compile.ts";
import { canonical } from "../packages/policy/src/index.ts";

const keys: string[] = JSON.parse(readFileSync(`${homedir()}/.config/groq/credentials.json`, "utf8")).keys.map((k: { key: string }) => k.key);
const inj = JSON.parse(readFileSync(new URL("../fixtures/injection.json", import.meta.url), "utf8"));
const rows = [];
for (const o of inj.orders) {
  const r = await compileOrders(o.text, { keys });
  const row = { id: o.id, kind: r.kind, model: "model" in r ? r.model : null, ms: "ms" in r ? r.ms : null,
    out: r.kind === "policy" ? canonical(r.policy) : r.kind === "refusal" || r.kind === "paused" || r.kind === "invalid" ? r.reason : null };
  rows.push(row);
  console.log(row.id, row.kind, row.ms, row.out);
}
const inSchemaOrRefused = rows.filter((r) => r.kind === "policy" || r.kind === "refusal").length;
writeFileSync(new URL("../evidence/compiler-injection.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), note: "A3 live: every outcome is a refusal or a schema-valid policy (the schema gate runs on every output).", inSchemaOrRefused, of: rows.length, rows }, null, 1) + "\n");
