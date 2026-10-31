// A9: offline golden replay exits 0; a bad beacon signature, a wrong drand round, a tampered blob set or a house /
// SIM_VERSION mismatch exits non-zero. Runs the BUNDLED dist (what npx runs) in a fresh process from a temp dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes, toHex } from "viem";
import { checkPins, Exit } from "../src/cli.ts";
import { SIM_VERSION } from "@semalam/sim";
import { HOUSE_SET_HASH } from "@semalam/sim/house";

const pkg = fileURLToPath(new URL("..", import.meta.url));
execFileSync("node", ["build.mjs"], { cwd: pkg, stdio: "ignore" });
const bin = join(pkg, "dist/semalam.mjs");
const tmp = mkdtempSync(join(tmpdir(), "semalam-cli-"));
const cli = (...args: string[]) => spawnSync("node", [bin, ...args], { cwd: tmp, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
const golden = (n: string) => JSON.parse(readFileSync(join(pkg, "../../fixtures/golden", `${n}.json`), "utf8"));
const writeFx = (name: string, f: unknown) => { const p = join(tmp, name); writeFileSync(p, JSON.stringify(f)); return p; };

test("bundled CLI replays all golden rounds offline from a clean directory → exit 0, 3× MATCH (A9)", () => {
  const r = cli("replay", "--fixture", "golden");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.match(/✓ MATCH/g)?.length, 3);
  assert.match(r.stdout, /1000 over capacity/);
});

test("a tampered beacon signature → exit 2 (refused) (A9)", () => {
  const f = golden("round-b");
  f.beacon.signature = f.beacon.signature.slice(0, 10) + (f.beacon.signature[10] === "a" ? "b" : "a") + f.beacon.signature.slice(11);
  const r = cli("replay", "--fixture", writeFx("bad-sig.json", f));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /REFUSED/);
});

test("a beacon for any drand round but seedRound(round) → exit 2 (A9)", () => {
  const f = golden("round-b");
  f.round = f.round + 1; // the shipped beacon is now the wrong round for this round
  const r = cli("replay", "--fixture", writeFx("wrong-round.json", f));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /need/);
});

test("a changed commit set → MISMATCH, exit 1 (A9)", () => {
  const f = golden("round-b");
  f.logs = f.logs.slice(1);
  const r = cli("replay", "--fixture", writeFx("mismatch.json", f));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ MISMATCH/);
});

test("house-set or SIM_VERSION pin mismatch → refused (exit 2) (A9)", () => {
  const sim = keccak256(toBytes(SIM_VERSION));
  assert.doesNotThrow(() => checkPins(sim, HOUSE_SET_HASH));
  for (const [s, h] of [[sim, keccak256(toHex("an-older-house-set"))], [keccak256(toHex("semalam-sim/0")), HOUSE_SET_HASH]] as const) {
    assert.throws(() => checkPins(s, h), (e: unknown) => e instanceof Exit && e.code === 2);
  }
});

test("--agent prints the night as ASCII with the decisive turn; usage errors exit 64", () => {
  const f = golden("round-b");
  const who = f.logs[0].account;
  const r = cli("replay", "--fixture", writeFx("agent.json", f), "--agent", who);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /decisive turn \d+: /);
  assert.match(r.stdout, /coins [▁▂▃▄▅▆▇█]{30}/);
  assert.equal(cli("replay").status, 64);
  assert.equal(cli("frobnicate").status, 64);
  assert.equal(cli("--version").stdout.trim(), "0.1.0");
});
