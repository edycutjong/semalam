// Measures L2 block.timestamp against UTC (the seed delay on Results.post is a 300 s buffer; this checks it is not eaten by drift).
// usage: tsx feasibility/clock-drift.ts [46630|4663]
import { writeFileSync } from "node:fs";
import { createPublicClient, http, defineChain } from "viem";
const id = Number(process.argv[2] ?? 46630);
const rpc = id === 46630 ? "https://rpc.testnet.chain.robinhood.com" : "https://rpc.mainnet.chain.robinhood.com";
const pub = createPublicClient({ chain: defineChain({ id, name: String(id), nativeCurrency: { name: "E", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }), transport: http() });
const samples: { block: number; driftSeconds: number }[] = [];
for (let i = 0; i < 12; i++) {
  const t0 = Date.now() / 1000;
  const b = await pub.getBlock({ blockTag: "latest" });
  const t1 = Date.now() / 1000;
  samples.push({ block: Number(b.number), driftSeconds: +(Number(b.timestamp) - (t0 + t1) / 2).toFixed(2) });
  await new Promise((r) => setTimeout(r, 1500));
}
const max = Math.max(...samples.map((s) => Math.abs(s.driftSeconds)));
const out = { chainId: id, measuredAt: new Date().toISOString(), method: "block.timestamp(latest) minus the local UTC clock at the RPC round-trip midpoint; 12 samples 1.5 s apart", samples, maxAbsDriftSeconds: max, seedDelaySeconds: 300, verdict: max < 30 ? "PASS — drift is far inside the 300 s seed buffer" : "FAIL" };
writeFileSync(new URL(`../../evidence/clock-drift-${id}.json`, import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(out.verdict, "max", max);
