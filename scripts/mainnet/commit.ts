// One operator smoke commit on chain 4663: the deployer signs an EIP-712 Commit for the open round, the relayer key pays
// Orders.commitBySig (the same call /api/relay/commit makes). The deployer is an excluded operator address, so it is
// never counted as a player. Keys come from ~/.config/semalam/, never from the tree.
//   tsx mainnet/commit.ts <compile-response.json>   (default: evidence/compile-hook.json -> response.policy)
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex, createPublicClient, createWalletClient, defineChain, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonical, Policy } from "@semalam/policy";
import { seal, stanzaOf, seedRoundAt, QUICKNET } from "@semalam/beacon";
import { closeTime, MAX_SEALED } from "@semalam/sim/round";
import { ORDERS_ABI, COMMITTED_EVENT, COMMIT_TYPES } from "../../apps/web/lib/abi.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEP = JSON.parse(readFileSync(path.join(root, "evidence/deployments-4663.json"), "utf8"));
const envOf = (f: string, k: string) => readFileSync(path.join(homedir(), ".config/semalam", f), "utf8").match(new RegExp(`^${k}=(.+)`, "m"))![1].trim().replace(/^"|"$/g, "");
const CHAIN = defineChain({ id: 4663, name: "chain 4663", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } } });
const pub = createPublicClient({ chain: CHAIN, transport: http() });
const OA = DEP.contracts.Orders.address as Address;

const src = JSON.parse(readFileSync(process.argv[2] ?? path.join(root, "evidence/compile-hook.json"), "utf8"));
const policy = Policy.parse((src.response ?? src).policy);
const player = privateKeyToAccount(envOf("deployer.env", "DEPLOYER_PRIVATE_KEY") as Hex);
const relayer = privateKeyToAccount(envOf("relayer.env", "RELAYER_PRIVATE_KEY") as Hex);

const now = Number((await pub.getBlock()).timestamp);
const round = Math.floor((now - DEP.genesis) / 86400) + 1;
const plaintext = canonical(policy), policyHash = keccak256(toBytes(plaintext));
const drandRound = seedRoundAt(closeTime(DEP.genesis, round));
const blob = await seal(toBytes(plaintext), drandRound);
const sp = stanzaOf(blob);
if (!sp || sp.round !== drandRound || sp.chain !== QUICKNET.hash || blob.length > MAX_SEALED) throw new Error("bad blob");
const sealedBlob = bytesToHex(blob);
const nonce = (await pub.readContract({ address: OA, abi: ORDERS_ABI, functionName: "nonces", args: [player.address] })) as bigint;
const deadline = BigInt(now + 900);
const message = { account: player.address, round: BigInt(round), policyHash, sealedHash: keccak256(sealedBlob), nonce, deadline };
const signature = await player.signTypedData({ domain: { name: "SEMALAM Orders", version: "1", chainId: 4663, verifyingContract: OA }, types: COMMIT_TYPES, primaryType: "Commit", message });
const args = [player.address, BigInt(round), policyHash, sealedBlob, deadline, signature] as const;
const wallet = createWalletClient({ account: relayer, chain: CHAIN, transport: http() });
const { request } = await pub.simulateContract({ address: OA, abi: ORDERS_ABI, functionName: "commitBySig", args, account: relayer });
const tx = await wallet.writeContract({ ...request, gas: 300_000n });
const rc = await pub.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
const logs = await pub.getLogs({ address: OA, event: COMMITTED_EVENT, args: { round: BigInt(round), account: player.address }, fromBlock: rc.blockNumber, toBlock: rc.blockNumber });
const out = {
  what: "operator smoke commit on chain 4663 (deployer = excluded operator address, not a player): sealed in the browser-grade tlock path, signed EIP-712, relayed by the relayer key via Orders.commitBySig",
  chainId: 4663, round, account: player.address, relayer: relayer.address, policyHash, sealedBytes: blob.length, drandRound, tx, block: Number(rc.blockNumber),
  status: rc.status, gasUsed: Number(rc.gasUsed), committedEventSeen: logs.length === 1 && logs[0].args.policyHash === policyHash,
};
writeFileSync(path.join(root, "evidence/mainnet-commit-round1.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out);
