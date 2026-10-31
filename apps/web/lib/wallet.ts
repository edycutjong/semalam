"use client";
// Tier 1 identity: ONE account that commits and pays. Either a key made in this browser ("local", gasless via the
// relay) or the wallet the player already has ("wallet"). AA / passkey is not built (the spec's kill date applies).
import { createPublicClient, createWalletClient, custom, http, type Address, type Hex, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { CHAIN, DEP } from "./config";

const LS_NAME = "semalam.localKey.v1";
export type Signer =
  | { mode: "local"; address: Address; account: PrivateKeyAccount }
  | { mode: "wallet"; address: Address; client: WalletClient };

export const publicRpc = () => createPublicClient({ chain: CHAIN, transport: http(DEP.rpcs[0]) });

export function localSigner(create = true): Signer | null {
  let k = localStorage.getItem(LS_NAME) as Hex | null;
  if (!k) { if (!create) return null; k = generatePrivateKey(); localStorage.setItem(LS_NAME, k); }
  const account = privateKeyToAccount(k);
  return { mode: "local", address: account.address, account };
}
export function exportLocalKey(): string | null { return localStorage.getItem(LS_NAME); }
export function forgetLocalKey() { localStorage.removeItem(LS_NAME); }

type Eth = { request(a: { method: string; params?: unknown[] }): Promise<unknown> };
export const injected = (): Eth | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: Eth }).ethereum);

export async function walletSigner(): Promise<Signer> {
  const eth = injected();
  if (!eth) throw new Error("no browser wallet found — use “Play without a wallet”");
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const idHex = `0x${CHAIN.id.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: idHex }] });
  } catch {
    await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: idHex, chainName: CHAIN.name, nativeCurrency: CHAIN.nativeCurrency, rpcUrls: DEP.rpcs }] });
  }
  const now = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
  if (now !== idHex) throw new Error(`your wallet is on chain ${parseInt(now, 16)}, not ${CHAIN.id} — switch it and try again`);
  const [active] = (await eth.request({ method: "eth_accounts" })) as Address[]; // some wallets change the account on a switch
  if (active && active.toLowerCase() !== address.toLowerCase()) throw new Error("your wallet changed account while switching chains — connect again");
  return { mode: "wallet", address, client: createWalletClient({ account: address, chain: CHAIN, transport: custom(eth) }) };
}

/** Returns the signer the player used last (local key only; a wallet needs a click to reconnect). */
export function restoreSigner(): Signer | null { return localSigner(false); }
