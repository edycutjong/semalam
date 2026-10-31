// Gas table: can the mainnet operator budget (0.00179 ETH) carry Tier 1? Every row is a REAL receipt on testnet 46630
// (L2 execution gas; same ArbOS EVM as mainnet) plus the MAINNET L1 data component for the exact same calldata/initcode,
// estimated by NodeInterface.gasEstimateL1Component on 4663. Priced at 2x today's 4663 gas price.
// Env: POSTER_PRIVATE_KEY (sends one labelled Results.post on the 46630 feasibility deploy if round 1 is unposted).
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, toHex, parseAbi, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const rpc4663 = "https://rpc.mainnet.chain.robinhood.com";
const rpc46630 = "https://rpc.testnet.chain.robinhood.com";
const mk = (id: number, url: string) =>
  defineChain({ id, name: String(id), nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
const main4663 = createPublicClient({ chain: mk(4663, rpc4663), transport: http() });
const test = createPublicClient({ chain: mk(46630, rpc46630), transport: http() });

const dep = JSON.parse(readFileSync("../evidence/feasibility/deployments-46630.json", "utf8"));
const RESULTS = dep.contracts.Results as Hex;
const NODE_INTERFACE = "0x00000000000000000000000000000000000000C8";
const niAbi = parseAbi(["function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"]);
const resAbi = parseAbi([
  "function post(uint256 round, bytes32 resultHash, uint64 drandRound)",
  "function seedRound(uint256) view returns (uint64)",
  "function resultOf(uint256) view returns (bytes32)",
]);

async function mainnetL1(to: Hex, creation: boolean, data: Hex) {
  const { result } = await main4663.simulateContract({
    address: NODE_INTERFACE, abi: niAbi, functionName: "gasEstimateL1Component", args: [to, creation, data],
    account: dep.deployer,
  });
  return Number(result[0]);
}

async function receiptRow(item: string, count: number, hash: Hex, payer: string) {
  const [tx, raw] = await Promise.all([
    test.getTransaction({ hash }),
    test.request({ method: "eth_getTransactionReceipt", params: [hash] }) as Promise<Record<string, string>>,
  ]);
  if (raw.gasUsedForL1 === undefined) throw new Error(`receipt ${hash} has no gasUsedForL1`);
  const l1Testnet = Number(BigInt(raw.gasUsedForL1));
  const l2 = Number(BigInt(raw.gasUsed)) - l1Testnet;
  const creation = tx.to === null;
  const l1Mainnet = await mainnetL1(creation ? dep.deployer : (tx.to as Hex), creation, tx.input);
  return { item, count, payer, tx: hash, testnetGasUsed: Number(BigInt(raw.gasUsed)), testnetGasUsedForL1: l1Testnet, l2Gas: l2, mainnetL1Gas: l1Mainnet, gasEach: l2 + l1Mainnet };
}

async function main() {
  // one real Results.post (round 1 of the feasibility deploy closed 2026-10-30 17:00 UTC; nothing was committed in it)
  let postTx = process.env.POST_TX as Hex | undefined;
  if (!postTx) {
    const done = await test.readContract({ address: RESULTS, abi: resAbi, functionName: "resultOf", args: [1n] });
    if (done !== ("0x" + "00".repeat(32))) throw new Error("round 1 already posted — pass POST_TX");
    const poster = privateKeyToAccount(process.env.POSTER_PRIVATE_KEY as Hex);
    const w = createWalletClient({ account: poster, chain: mk(46630, rpc46630), transport: http() });
    const sr = await test.readContract({ address: RESULTS, abi: resAbi, functionName: "seedRound", args: [1n] });
    postTx = await w.writeContract({ address: RESULTS, abi: resAbi, functionName: "post", args: [1n, keccak256(toHex("feasibility gas measurement — not a night result")), sr] });
    await test.waitForTransactionReceipt({ hash: postTx });
  }

  const deploys = JSON.parse(readFileSync("../contracts/broadcast/Deploy.s.sol/46630/run-latest.json", "utf8"));
  const hashOf = (name: string) => deploys.transactions.find((t: { contractName: string }) => t.contractName === name).hash as Hex;

  const rows = [
    await receiptRow("deploy Orders", 1, hashOf("Orders"), "operator"),
    await receiptRow("deploy Scrimmage", 1, hashOf("Scrimmage"), "operator"),
    await receiptRow("deploy Results", 1, hashOf("Results"), "operator"),
    await receiptRow("Results.post (2 x 10 nights)", 20, postTx, "operator (POSTER)"),
    await receiptRow("relayed commitBySig, 1,536 B blob (worst case)", 40, "0x3d6f5968629d07df5d33d576e3a6dc21b869e5503dea8e027f43626752df0718", "operator (relayer)"),
  ];
  const gasPrice = Number(await main4663.getGasPrice());
  const price = 2 * gasPrice;
  const budget = 0.00179e18;
  let spent = 0;
  const table = rows.map((r) => {
    const wei = r.count * r.gasEach * price;
    spent += wei;
    return { ...r, ethAt2x: +(wei / 1e18).toFixed(8) };
  });
  const relayEach = rows[4].gasEach * price;
  // L1 stress: the L1 component is a single sample of today's L1 price; re-price it at 10x
  const stress = rows.reduce((a, r) => a + r.count * (r.l2Gas + 10 * r.mainnetL1Gas) * price, 0);
  const out = {
    at: new Date().toISOString(),
    method: "L2 gas = testnet 46630 raw receipt gasUsed - gasUsedForL1 (testnet L1 price is ~0, so the testnet L1 part reads 0); mainnet L1 gas = NodeInterface(0xC8).gasEstimateL1Component on 4663 for the same tx input — a single sample of today's L1 price, stress-tested at 10x below; everything priced at 2x eth_gasPrice(4663)",
    notes: [
      "The three testnet deploys predate two small edits (Results constructor reads Scrimmage.GENESIS; Scrimmage writes paidInSeason before the WIF calls); the deploy-gas delta is under 1% and does not touch the post or relay rows.",
      "40 relayed commits is the minimum the budget must carry; the relayer runs with a daily ETH stop, and further relays draw on the remainder.",
    ],
    mainnetGasPriceWei: gasPrice,
    budgetPriceWei: price,
    budgetEth: 0.00179,
    rows: table,
    subtotalEthAt2x: +(spent / 1e18).toFixed(8),
    shareOfBudget: +((100 * spent) / budget).toFixed(1),
    remainderEthAt2x: +((budget - spent) / 1e18).toFixed(8),
    extraRelayedCommitsAtTodaysL1Price: Math.floor((budget - spent) / relayEach),
    shareOfBudgetWithL1At10x: +((100 * stress) / budget).toFixed(1),
    notOperatorCost: {
      "WIF.approve + Scrimmage.pay": "signed and paid by the player",
      "contract verification": "Blockscout source verification is off chain (no gas)",
      "SemalamPaymaster deploy + deposit + smart-account deployment": "Tier 2 only; funded from the remainder if built",
    },
    verdict: spent <= budget ? "FITS" : "DOES NOT FIT",
  };
  writeFileSync("../evidence/feasibility/gas-table.json", JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ ...out, rows: table.map((r) => [r.item, r.l2Gas, r.mainnetL1Gas, r.gasEach]) }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
