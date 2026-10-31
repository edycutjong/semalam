// One place that knows which chain and which contracts the app talks to.
import deployments from "semalam/src/deployments.json";
import { defineChain, type Address } from "viem";

type Dep = {
  name: string; rpcs: string[]; orders: Address | null; results: Address | null; scrimmage: Address | null;
  fromBlock: number; excluded: Address[]; wif?: Address | null; wifIsMock?: boolean; genesis?: number;
};

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 46630);
export const DEP = (deployments as unknown as Record<string, Dep>)[String(CHAIN_ID)];
export const IS_TESTNET = CHAIN_ID === 46630;
export const EXPLORER = IS_TESTNET ? "https://explorer.testnet.chain.robinhood.com" : "https://explorer.mainnet.chain.robinhood.com";
export const CHAIN = defineChain({
  id: CHAIN_ID,
  name: DEP.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: DEP.rpcs } },
});
export const ORDERS = DEP.orders as Address;
export const RESULTS = DEP.results as Address;
export const SCRIMMAGE = DEP.scrimmage as Address;
export const WIF = DEP.wif as Address;
export const WIF_LABEL = DEP.wifIsMock ? "MockWIF" : "$WIF";
export const GENESIS = DEP.genesis as number;
/** Operator addresses never count as players (also listed in the CLI package). */
export const EXCLUDED: string[] = (DEP.excluded ?? []).map((a) => a.toLowerCase());
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
