// Test helper: send 0.0005 testnet ETH from the deployer to a throwaway browser key.
import { createWalletClient, createPublicClient, http, parseEther, defineChain, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
const to = process.argv[2] as Address;
const chain = defineChain({ id: 46630, name: "t", nativeCurrency: { name: "E", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } });
const dep = readFileSync(`${homedir()}/.config/semalam/deployer.env`, "utf8").match(/DEPLOYER_PRIVATE_KEY=(.+)/)![1].trim() as Hex;
const w = createWalletClient({ account: privateKeyToAccount(dep), chain, transport: http() });
const pub = createPublicClient({ chain, transport: http() });
const h = await w.sendTransaction({ to, value: parseEther("0.0001") });
await pub.waitForTransactionReceipt({ hash: h });
console.log("funded", to, h);
