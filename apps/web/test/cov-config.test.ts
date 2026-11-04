import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { addrUrl, txUrl, EXPLORER, CHAIN_ID } from "../lib/config.ts";

function loadWith(chainId: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NEXT_PUBLIC_CHAIN_ID;
  if (chainId !== undefined) env.NEXT_PUBLIC_CHAIN_ID = chainId;
  const out = execFileSync(process.execPath, ["--import", "tsx", "-e",
    `import("./lib/config.ts").then(c => console.log(JSON.stringify({ id: c.CHAIN_ID, t: c.IS_TESTNET, ex: c.EXPLORER, label: c.WIF_LABEL, excluded: c.EXCLUDED, orders: c.ORDERS ?? null, chain: c.CHAIN.id })))`],
    { env, encoding: "utf8", cwd: process.cwd() });
  return JSON.parse(out.trim().split("\n").pop()!);
}

test("config defaults to the Robinhood testnet (46630) with a mock WIF and lowercased operator exclusions", () => {
  const c = loadWith(undefined);
  assert.equal(c.id, 46630);
  assert.equal(c.t, true);
  assert.equal(c.ex, "https://explorer.testnet.chain.robinhood.com");
  assert.equal(c.label, "MockWIF");
  assert.equal(c.chain, 46630);
  assert.equal(c.excluded.length, 3);
  assert.ok(c.excluded.every((a: string) => a === a.toLowerCase()));
});
test("NEXT_PUBLIC_CHAIN_ID=4663 selects mainnet: mainnet explorer, real $WIF label, the four operator addresses excluded (deployer, poster, relayer, demo-video account)", () => {
  const c = loadWith("4663");
  assert.equal(c.id, 4663);
  assert.equal(c.t, false);
  assert.equal(c.ex, "https://robinhoodchain.blockscout.com");
  assert.equal(c.label, "$WIF");
  assert.equal(c.excluded.length, 4);
  assert.ok(c.excluded.includes("0x0310dd87a9aae45023d3f99a73923ab8b5d59f82"));
  assert.equal(c.orders?.toLowerCase(), "0xaaa4d7abdc7fe91d2d4827ca559887ef6288e0c2");
});
test("txUrl and addrUrl build explorer links for the active chain", () => {
  assert.equal(CHAIN_ID, 46630);
  assert.equal(txUrl("0xabc"), `${EXPLORER}/tx/0xabc`);
  assert.equal(addrUrl("0xdef"), `${EXPLORER}/address/0xdef`);
});
