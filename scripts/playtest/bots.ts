// Bot playtest runner (internal QA — persona bots are never players, testers or traction).
//   tsx playtest/bots.ts compile [--night 1|2] [--only p05,p12] [--tag -after-fix] [--base URL]    orders -> live /api/compile -> evidence/playtest/compiled-n<night>.json
//   tsx playtest/bots.ts commit  [--night 1|2] [--local] [--base URL]    seal -> EIP-712 sign -> relay commitBySig -> read back
// Bot keys live in ~/.config/semalam/playtest-bots.json (600), never in the tree. Each bot's address is listed in
// evidence/qa-accounts-46630.json before its night settles, so the pages label it as QA.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex, createPublicClient, createWalletClient, defineChain, getAddress, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonical, Policy, readback } from "@semalam/policy";
import { compileOrders } from "@semalam/policy/compile";
import { seal, stanzaOf, seedRoundAt, QUICKNET } from "@semalam/beacon";
import { closeTime, MAX_SEALED } from "@semalam/sim/round";
import personas from "./personas.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const night = Number(arg("--night", "1"));
const base = arg("--base", "https://semalam.edycu.dev");
// --local: the same compileOrders() and the same Orders.commitBySig relay call as the API routes, run from this machine (used when the production host answers this IP with Vercel's bot challenge)
const local = argv.includes("--local");
const envOf = (f: string, k: string) => readFileSync(path.join(homedir(), ".config/semalam", f), "utf8").match(new RegExp(`${k}=(.+)`))![1].trim().replace(/^"|"$/g, "");
const outDir = path.join(root, "evidence/playtest");
const tag = arg("--tag", "");
const compiledFile = path.join(outDir, `compiled-n${night}${tag}.json`);
const keyFile = path.join(homedir(), ".config/semalam/playtest-bots.json");
const GENESIS = JSON.parse(readFileSync(path.join(root, "evidence/deployments-46630.json"), "utf8")).genesis as number;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

function keys(): Record<string, Hex> {
  if (existsSync(keyFile)) return JSON.parse(readFileSync(keyFile, "utf8"));
  const k: Record<string, Hex> = {};
  for (const p of personas.personas) k[p.id] = generatePrivateKey();
  writeFileSync(keyFile, JSON.stringify(k, null, 1), { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  return k;
}
const ordersOf = (p: { orders: string; night2?: string }) => (night >= 2 && p.night2 ? p.night2 : p.orders);

async function compile() {
  const only = arg("--only", "").split(",").filter(Boolean);
  const prev: any[] = only.length && existsSync(compiledFile) ? JSON.parse(readFileSync(compiledFile, "utf8")).results : [];
  const out: any[] = [];
  const todo = [
    ...personas.personas.map((p) => ({ id: p.id, style: p.style, orders: ordersOf(p), injection: false })),
    ...(night === 1 ? personas.injections.map((i) => ({ id: i.id, style: "injection", orders: i.orders, injection: true })) : []),
  ];
  for (const t of todo) {
    if (only.length && !only.includes(t.id)) { out.push(prev.find((x) => x.id === t.id) ?? t); continue; }
    const t0 = Date.now();
    let r: any;
    for (let a = 0; a < 3 && local; a++) {
      r = await compileOrders(t.orders, { keys: envOf("web.env.local", "GROQ_API_KEYS").split(",").map((k) => k.trim()) });
      if (r.kind !== "paused") break;
      await sleep(15_000);
    }
    for (let a = 0; a < 3 && !local; a++) {
      const res = await fetch(`${base}/api/compile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orders: t.orders }) });
      r = await res.json().catch(() => ({ kind: "invalid", reason: `HTTP ${res.status}` }));
      if (r.kind !== "paused") break;
      await sleep(15_000);
    }
    out.push({ ...t, kind: r.kind, reason: r.reason, model: r.model, ms: r.ms, readback: r.readback, policy: r.policy });
    console.log(`${t.id} ${r.kind}${r.reason ? " — " + r.reason : ""} ${r.model ?? ""} ${r.ms ?? ""}ms (${Date.now() - t0}ms)`);
    await sleep(local ? 1_000 : 5_500); // live: stay under the 12/min per-address compile throttle
  }
  writeFileSync(compiledFile, JSON.stringify({ what: "persona-bot orders compiled by the live compiler (internal QA, not users)", night, via: local ? "local compileOrders() (same code and keys as /api/compile)" : base, at: new Date().toISOString(), results: out }, null, 1));
  console.log("wrote", compiledFile);
}

const DEP = JSON.parse(readFileSync(path.join(root, "evidence/deployments-46630.json"), "utf8"));
const CHAIN = defineChain({ id: 46630, name: "chain 46630 (testnet)", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } });
const pub = createPublicClient({ chain: CHAIN, transport: http() });
const OA = DEP.contracts.Orders.address as Address;
async function statusOf(account: Address): Promise<any> {
  if (!local) return (await fetch(`${base}/api/status?account=${account}`, { cache: "no-store" })).json();
  const { ORDERS_ABI, COMMITTED_EVENT } = await import("../../apps/web/lib/abi.ts");
  const now = Number((await pub.getBlock()).timestamp);
  const round = Math.floor((now - GENESIS) / 86400) + 1;
  const nonce = String(await pub.readContract({ address: OA, abi: ORDERS_ABI, functionName: "nonces", args: [account] }));
  const logs = await pub.getLogs({ address: OA, event: COMMITTED_EVENT, args: { round: BigInt(round), account }, fromBlock: BigInt(DEP.contracts.Orders.block) });
  return { chainId: 46630, chainNow: now, round, nonce, commits: logs.map((l: any) => ({ tx: l.transactionHash, policyHash: l.args.policyHash })) };
}
async function relayLocal(args: readonly [Address, bigint, Hex, Hex, bigint, Hex]): Promise<any> {
  const { ORDERS_ABI } = await import("../../apps/web/lib/abi.ts");
  const { privateKeyToAccount: pk } = await import("viem/accounts");
  const acct = pk(envOf("relayer-testnet.env", "RELAYER_PRIVATE_KEY") as Hex);
  const wallet = createWalletClient({ account: acct, chain: CHAIN, transport: http() });
  try {
    const { request } = await pub.simulateContract({ address: OA, abi: ORDERS_ABI, functionName: "commitBySig", args, account: acct });
    const hash = await wallet.writeContract({ ...request, gas: 300_000n });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
    return rc.status === "success" ? { ok: true, tx: hash, mode: "relay (local relayer key)" } : { ok: false, state: "reverted", tx: hash };
  } catch (e) { return { ok: false, state: (e as Error).message.split("\n")[0] }; }
}

async function commit() {
  const { COMMIT_TYPES } = await import("../../apps/web/lib/abi.ts");
  const ks = keys();
  const comp = JSON.parse(readFileSync(compiledFile, "utf8"));
  const out: any[] = [];
  for (const r of comp.results) {
    if (r.injection || r.kind !== "policy") { out.push({ id: r.id, entered: false, why: r.kind === "policy" ? "injection" : `${r.kind}: ${r.reason ?? ""}` }); continue; }
    const acct = privateKeyToAccount(ks[r.id]);
    const st0 = await statusOf(acct.address);
    const round: number = st0.round, deadline = BigInt(st0.chainNow + 900);
    const policy = Policy.parse(r.policy), plaintext = canonical(policy), drandRound = seedRoundAt(closeTime(GENESIS, round));
    const blob = await seal(toBytes(plaintext), drandRound);
    const sp = stanzaOf(blob);
    if (!sp || sp.round !== drandRound || sp.chain !== QUICKNET.hash || blob.length > MAX_SEALED) throw new Error(`${r.id}: bad blob`);
    const sealedBlob = bytesToHex(blob), policyHash = keccak256(toBytes(plaintext));
    const message = { account: acct.address, round: BigInt(round), policyHash, sealedHash: keccak256(sealedBlob), nonce: BigInt(st0.nonce ?? "0"), deadline };
    const signature = await acct.signTypedData({ domain: { name: "SEMALAM Orders", version: "1", chainId: st0.chainId, verifyingContract: OA }, types: COMMIT_TYPES, primaryType: "Commit", message });
    const j: any = local
      ? await relayLocal([acct.address, BigInt(round), policyHash, sealedBlob, deadline, signature])
      : await fetch(`${base}/api/relay/commit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: acct.address, round, policyHash, sealedBlob, deadline: deadline.toString(), signature }) }).then((x) => x.json().catch(() => ({})));
    let seen = false;
    for (let i = 0; i < 10 && j.ok && !seen; i++) {
      const s2 = await statusOf(acct.address);
      seen = s2.commits.some((c: any) => c.policyHash.toLowerCase() === policyHash.toLowerCase());
      if (!seen) await sleep(1500);
    }
    const res = { status: local ? 0 : 200 };
    out.push({ id: r.id, account: acct.address, round, entered: Boolean(j.ok && seen), tx: j.tx, policyHash, sealedBytes: blob.length, relayState: j.state, status: res.status });
    console.log(r.id, acct.address, j.ok ? (seen ? "SEALED ✓" : "sent, not read back") : `FAILED ${j.state}`, j.tx ?? "");
    await sleep(1500);
  }
  const rounds = [...new Set(out.filter((o) => o.round).map((o) => o.round))];
  writeFileSync(path.join(outDir, `commits-n${night}.json`), JSON.stringify({ what: "persona-bot commits on chain 46630 (internal QA, not users)", night, via: local ? "local relayer key calling Orders.commitBySig (same call as /api/relay/commit)" : base, rounds, at: new Date().toISOString(), commits: out }, null, 1));
  console.log("entered", out.filter((o) => o.entered).length, "of", out.length);
}
if (cmd === "compile") await compile();
else if (cmd === "commit") await commit();
else if (cmd === "addresses") console.log(JSON.stringify(Object.fromEntries(Object.entries(keys()).map(([id, k]) => [id, privateKeyToAccount(k).address])), null, 1));
else { console.error("usage: bots.ts compile|commit|addresses [--night N] [--base URL]"); process.exit(64); }
