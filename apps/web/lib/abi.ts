import { getAbiItem, parseAbi } from "viem";

export const ORDERS_ABI = parseAbi([
  "function commit(uint256 round, bytes32 policyHash, bytes sealedBlob)",
  "function commitBySig(address account, uint256 round, bytes32 policyHash, bytes sealedBlob, uint256 deadline, bytes signature)",
  "function nonces(address) view returns (uint256)",
  "function GENESIS() view returns (uint256)",
  "event Committed(uint256 indexed round, address indexed account, bytes32 policyHash, bytes sealedBlob)",
]);
export const RESULTS_ABI = parseAbi([
  "function resultOf(uint256) view returns (bytes32)",
  "function drandRoundOf(uint256) view returns (uint64)",
  "function HOUSE_SET_HASH() view returns (bytes32)",
  "function SIM_VERSION() view returns (bytes32)",
  "function post(uint256 round, bytes32 resultHash, uint64 drandRound)",
  "event Posted(uint256 indexed round, bytes32 resultHash, uint64 drandRound)",
]);
export const SCRIMMAGE_ABI = parseAbi([
  "function pay(uint256 round, uint256 amount, bytes32 draftHash)",
  "function paidInSeason(address, uint256) view returns (bool)",
  "event Paid(address indexed payer, uint256 indexed round, bytes32 draftHash, uint256 amount, uint256 burned, uint256 toCompute)",
]);
export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
]);
export const COMMIT_TYPES = {
  Commit: [
    { name: "account", type: "address" },
    { name: "round", type: "uint256" },
    { name: "policyHash", type: "bytes32" },
    { name: "sealedHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Events by name, never by array index (an inserted ABI entry would silently point the log reads at a function). */
export const COMMITTED_EVENT = getAbiItem({ abi: ORDERS_ABI, name: "Committed" });
export const PAID_EVENT = getAbiItem({ abi: SCRIMMAGE_ABI, name: "Paid" });
