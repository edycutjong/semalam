"use client";
// Seal → sign → relay → read back. "Entered" is shown only after the Committed event matches (spec step 4).
import { bytesToHex, createWalletClient, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { canonical, Policy } from "@semalam/policy";
import { MAX_SEALED } from "@semalam/sim/round";
import { COMMIT_TYPES, ORDERS_ABI } from "./abi";
import { CHAIN, DEP, ORDERS } from "./config";
import { closeTime } from "./clock";
import type { Signer } from "./wallet";

export type Sealed = { policy: Policy; plaintext: string; policyHash: Hex; sealedBlob: Hex; bytes: number; drandRound: number };

/** Re-derives everything the chain will check, so a bad blob never leaves the browser. */
export async function sealPolicy(policy: Policy, round: number): Promise<Sealed> {
  // tlock + the BLS curve are ~600 KB: load them when the player seals, not on every page view.
  const { seal, stanzaOf, seedRoundAt, QUICKNET } = await import("@semalam/beacon");
  const p = Policy.parse(policy);
  const plaintext = canonical(p);
  const drandRound = seedRoundAt(closeTime(round));
  const blob = await seal(toBytes(plaintext), drandRound);
  const st = stanzaOf(blob);
  if (!st || st.round !== drandRound || st.chain !== QUICKNET.hash) throw new Error(`sealed orders target drand round ${st?.round}, expected ${drandRound} — not sent`);
  if (blob.length > MAX_SEALED) throw new Error(`sealed orders are ${blob.length} bytes; the limit is ${MAX_SEALED}`);
  return { policy: p, plaintext, policyHash: keccak256(toBytes(plaintext)), sealedBlob: bytesToHex(blob), bytes: blob.length, drandRound };
}

export type Entered = { tx: string; url: string; mode: "relay" | "wallet"; blockOk: boolean };

export async function commitSealed(signer: Signer, round: number, s: Sealed, nonce: bigint, chainNow: number, relayOk = true): Promise<Entered> {
  const deadline = BigInt(chainNow + 900); // chain clock, not the visitor's
  const direct = async (why: string): Promise<Entered> => {
    const args = [BigInt(round), s.policyHash, s.sealedBlob] as const;
    const hash = signer.mode === "wallet"
      ? await signer.client.writeContract({ account: signer.address, chain: CHAIN, address: ORDERS, abi: ORDERS_ABI, functionName: "commit", args })
      : await createWalletClient({ account: signer.account, chain: CHAIN, transport: http(DEP.rpcs[0]) }).writeContract({ chain: CHAIN, address: ORDERS, abi: ORDERS_ABI, functionName: "commit", args }).catch((e: Error) => { throw new Error(/insufficient|exceeds the balance|funds/i.test(e.message) ? `${why} — this browser key has no ETH to commit by itself; send a little to ${signer.address} and press Seal again` : e.message.split("\n")[0]); });
    return { tx: hash, url: "", mode: "wallet", blockOk: true };
  };
  if (!relayOk) return direct("the relay is empty");
  const message = { account: signer.address, round: BigInt(round), policyHash: s.policyHash, sealedHash: keccak256(s.sealedBlob), nonce, deadline };
  const domain = { name: "SEMALAM Orders", version: "1", chainId: CHAIN.id, verifyingContract: ORDERS } as const;
  const signature = signer.mode === "local"
    ? await signer.account.signTypedData({ domain, types: COMMIT_TYPES, primaryType: "Commit", message })
    : await signer.client.signTypedData({ account: signer.address, domain, types: COMMIT_TYPES, primaryType: "Commit", message });
  const res = await fetch("/api/relay/commit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: signer.address, round, policyHash: s.policyHash, sealedBlob: s.sealedBlob, deadline: deadline.toString(), signature }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.ok && j.ok) return { tx: j.tx, url: j.url, mode: "relay", blockOk: true };
  // The relay says it is out of gas or at its cap (relay:false) -> the player's own account sends the commit. A plain rate-limit
  // (429 without relay:false) is NOT that: say so and let them retry.
  if (j.relay === false) return direct(j.state ?? "relay unavailable");
  throw new Error(j.state ?? `commit failed (${res.status})`);
}

export type StatusJson = {
  chainId: number; testnet: boolean; wifLabel: string; chainNow: number; serverNow: number; round: number; closeTime: number;
  relay: boolean; relayState?: "ok" | "empty" | "spent-tonight"; genesisOk?: boolean; compiler: boolean; nonce?: string; commits: { tx: string; block: number; policyHash: string; sealedBytes: number }[]; error?: string;
};
export async function status(account?: Address): Promise<StatusJson> {
  const r = await fetch(`/api/status${account ? `?account=${account}` : ""}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "chain unreachable");
  return j;
}
/** Polls until the account's latest Committed event carries this policy hash. */
/** `before` = how many commits the chain showed before sending, so an identical earlier commit is never mistaken for this one. */
export async function readBack(account: Address, policyHash: string, before = 0, tries = 12): Promise<StatusJson["commits"][number] | null> {
  for (let i = 0; i < tries; i++) {
    const s = await status(account);
    const hit = s.commits.slice(before).reverse().find((c) => c.policyHash.toLowerCase() === policyHash.toLowerCase());
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}
export type { Address };
