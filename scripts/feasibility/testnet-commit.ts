// Feasibility check: one real sealed commit on testnet 46630 (direct) + one self-relayed commitBySig (local signer with
// zero ETH signs EIP-712, the relayer pays). Reads the Committed events back and checks them.
// Keys come from ~/.config/semalam/*.env via the environment, never from the tree.
import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, parseAbi, parseEventLogs, defineChain, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { timelockEncrypt, mainnetClient, Buffer } from "tlock-js";

const testnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
});

const ORDERS = process.env.ORDERS as Hex;
const RESULTS = process.env.RESULTS as Hex;
const abi = parseAbi([
  "function commit(uint256 round, bytes32 policyHash, bytes sealedBlob)",
  "function commitBySig(address account, uint256 round, bytes32 policyHash, bytes sealedBlob, uint256 deadline, bytes signature)",
  "function currentRound() view returns (uint256)",
  "function closeTime(uint256) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function seedRound(uint256) view returns (uint64)",
  "event Committed(uint256 indexed round, address indexed account, bytes32 policyHash, bytes sealedBlob)",
]);

const canonical = (p: object) => JSON.stringify(p, Object.keys(p).sort());

async function seal(policy: object, round: number) {
  const plaintext = canonical(policy);
  const armored = await timelockEncrypt(round, Buffer.from(plaintext, "utf8"), mainnetClient());
  const sealed = Buffer.from(armored.split("\n").filter((l) => l && !l.startsWith("-----")).join(""), "base64");
  return { policyHash: keccak256(toBytes(plaintext)), sealed: ("0x" + sealed.toString("hex")) as Hex, bytes: sealed.length };
}

async function main() {
  const pub = createPublicClient({ chain: testnet, transport: http() });
  const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
  const relayer = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex);
  const round = await pub.readContract({ address: ORDERS, abi, functionName: "currentRound" });
  const seedRound = Number(await pub.readContract({ address: RESULTS, abi, functionName: "seedRound", args: [round] }));
  const out: Record<string, unknown> = { chainId: 46630, orders: ORDERS, round: Number(round), seedRound };

  // 1) direct commit (deployer pays)
  const a = await seal({ v: 1, name: "feasibility-direct", opening: "GATHER", default: "GATHER", grudge: 5, rules: [] }, seedRound);
  const w1 = createWalletClient({ account: deployer, chain: testnet, transport: http() });
  const tx1 = await w1.writeContract({ address: ORDERS, abi, functionName: "commit", args: [round, a.policyHash, a.sealed] });
  const r1 = await pub.waitForTransactionReceipt({ hash: tx1 });

  // 2) self-relay: a fresh local signer with 0 ETH signs; the relayer pays
  const player = privateKeyToAccount(generatePrivateKey());
  const b = await seal({ v: 1, name: "feasibility-relay", opening: "GUARD", default: "SHARE", grudge: 3, rules: [] }, seedRound);
  const nonce = await pub.readContract({ address: ORDERS, abi, functionName: "nonces", args: [player.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await player.signTypedData({
    domain: { name: "SEMALAM Orders", version: "1", chainId: 46630, verifyingContract: ORDERS },
    types: {
      Commit: [
        { name: "account", type: "address" },
        { name: "round", type: "uint256" },
        { name: "policyHash", type: "bytes32" },
        { name: "sealedHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Commit",
    message: { account: player.address, round, policyHash: b.policyHash, sealedHash: keccak256(b.sealed), nonce, deadline },
  });
  const w2 = createWalletClient({ account: relayer, chain: testnet, transport: http() });
  const tx2 = await w2.writeContract({
    address: ORDERS, abi, functionName: "commitBySig",
    args: [player.address, round, b.policyHash, b.sealed, deadline, signature],
  });
  const r2 = await pub.waitForTransactionReceipt({ hash: tx2 });

  // read back both Committed events and check them
  const ev = parseEventLogs({ abi, logs: [...r1.logs, ...r2.logs], eventName: "Committed" });
  const okDirect = ev[0].args.account === deployer.address && ev[0].args.policyHash === a.policyHash && ev[0].args.sealedBlob === a.sealed;
  const okRelay = ev[1].args.account === player.address && ev[1].args.policyHash === b.policyHash && ev[1].args.sealedBlob === b.sealed;
  out.direct = { tx: tx1, status: r1.status, gasUsed: Number(r1.gasUsed), effectiveGasPrice: Number(r1.effectiveGasPrice), sealedBytes: a.bytes, readbackOk: okDirect };
  out.relay = { tx: tx2, status: r2.status, gasUsed: Number(r2.gasUsed), effectiveGasPrice: Number(r2.effectiveGasPrice), sealedBytes: b.bytes, account: player.address, playerEthBalance: Number(await pub.getBalance({ address: player.address })), readbackOk: okRelay };
  if (!okDirect || !okRelay) throw new Error("readback mismatch");

  mkdirSync("../evidence/feasibility", { recursive: true });
  writeFileSync("../evidence/feasibility/testnet-commit.json", JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
