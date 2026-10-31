// Gas table input: worst-case relayed commit — commitBySig with a 1,536-byte blob (random bytes, gas only) on 46630.
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, defineChain, toHex, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { randomBytes } from "node:crypto";
const chain = defineChain({ id: 46630, name: "rh-testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } });
const ORDERS = process.env.ORDERS as Hex;
const abi = parseAbi(["function commitBySig(address,uint256,bytes32,bytes,uint256,bytes)", "function currentRound() view returns (uint256)"]);
const pub = createPublicClient({ chain, transport: http() });
const relayer = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex);
const player = privateKeyToAccount(generatePrivateKey());
const round = await pub.readContract({ address: ORDERS, abi, functionName: "currentRound" });
const sealed = toHex(randomBytes(1536));
const policyHash = keccak256("0x01");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
const signature = await player.signTypedData({
  domain: { name: "SEMALAM Orders", version: "1", chainId: 46630, verifyingContract: ORDERS },
  types: { Commit: [{ name: "account", type: "address" }, { name: "round", type: "uint256" }, { name: "policyHash", type: "bytes32" }, { name: "sealedHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
  primaryType: "Commit",
  message: { account: player.address, round, policyHash, sealedHash: keccak256(sealed), nonce: 0n, deadline },
});
const w = createWalletClient({ account: relayer, chain, transport: http() });
const hash = await w.writeContract({ address: ORDERS, abi, functionName: "commitBySig", args: [player.address, round, policyHash, sealed, deadline, signature] });
const r = await pub.waitForTransactionReceipt({ hash });
console.log(JSON.stringify({ tx: hash, status: r.status, gasUsed: Number(r.gasUsed), gasUsedForL1: (r as any).gasUsedForL1 ? Number((r as any).gasUsedForL1) : null, sealedBytes: 1536 }));
