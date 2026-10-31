// drand quicknet: pinned chain, BLS beacon verification, and tlock seal/open of policy blobs (binary age, no armor).
// The CLI, the settler and the browser all go through this file, so "verified" means the same thing everywhere.
import { bls12_381 } from "@noble/curves/bls12-381";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { timelockEncrypt, timelockDecrypt, Buffer, type ChainClient } from "tlock-js";

export const QUICKNET = {
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesis_time: 1692803367,
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
} as const;
export const DRAND_URLS = [
  "https://api.drand.sh",
  "https://api2.drand.sh",
  "https://api3.drand.sh",
  "https://drand.cloudflare.com",
];
const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";

export type Beacon = { round: number; randomness: string; signature: string };

/** First quicknet round at or after closeTime + 300 s — same integer formula as Results.seedRound. */
export function seedRoundAt(closeTime: number): number {
  const t = closeTime + 300;
  return Math.floor((t - QUICKNET.genesis_time + QUICKNET.period - 1) / QUICKNET.period) + 1;
}
export const roundTimeOf = (round: number) => QUICKNET.genesis_time + (round - 1) * QUICKNET.period;

/** BLS verify against the pinned quicknet key; randomness must equal sha256(signature). Throws on any mismatch. */
export function verifyBeacon(b: Beacon, expectRound?: number): Beacon {
  if (expectRound !== undefined && b.round !== expectRound) throw new Error(`drand: got round ${b.round}, need ${expectRound}`);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(b.round));
  let ok = false;
  try {
    ok = bls12_381.shortSignatures.verify(
      hexToBytes(b.signature),
      bls12_381.shortSignatures.hash(sha256(msg), DST),
      hexToBytes(QUICKNET.public_key),
    );
  } catch {
    ok = false; // not a curve point
  }
  if (!ok) throw new Error(`drand: BAD SIGNATURE for round ${b.round}`);
  if (bytesToHex(sha256(hexToBytes(b.signature))) !== b.randomness.toLowerCase())
    throw new Error(`drand: randomness != sha256(signature) for round ${b.round}`);
  return b;
}

/** Fetches a beacon from the failover list and verifies it. */
export async function fetchBeacon(round: number, urls = DRAND_URLS, fetchFn: typeof fetch = fetch): Promise<Beacon> {
  let last: unknown;
  for (const u of urls) {
    try {
      const r = await fetchFn(`${u}/${QUICKNET.hash}/public/${round}`, { signal: AbortSignal.timeout(10_000) });
      if (r.status === 425 || r.status === 404) throw new Error(`drand: round ${round} not published yet (${u})`);
      if (!r.ok) throw new Error(`drand: HTTP ${r.status} from ${u}`);
      const j = (await r.json()) as Beacon;
      return verifyBeacon({ round: j.round, randomness: j.randomness, signature: j.signature }, round);
    } catch (e) {
      // a mirror that serves a bad beacon is skipped; refuse only when no mirror gives one that verifies
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** A tlock ChainClient that never touches the network: serves pinned chain info and already-verified beacons. */
export function offlineClient(beacons: Beacon[]): ChainClient {
  const byRound = new Map(beacons.map((b) => [b.round, b]));
  const info = { ...QUICKNET, metadata: { ...QUICKNET.metadata } };
  const chain = { baseUrl: "offline://quicknet", info: async () => info };
  return {
    options: { disableBeaconVerification: true, noCache: true, chainVerificationParams: { chainHash: QUICKNET.hash, publicKey: QUICKNET.public_key } },
    chain: () => chain,
    latest: async () => { throw new Error("offline client: latest() not available"); },
    get: async (round: number) => {
      const b = byRound.get(round);
      if (!b) throw new Error(`offline client: no verified beacon for round ${round}`);
      return { round: b.round, randomness: b.randomness, signature: b.signature };
    },
  } as unknown as ChainClient;
}

/** Reads the target round + chain out of the binary age header ("-> tlock <round> <chainhash>"). */
export function stanzaOf(sealed: Uint8Array): { round: number; chain: string } | null {
  let head = "";
  for (const c of sealed.slice(0, 1536)) head += String.fromCharCode(c);
  // An age header with EXACTLY ONE recipient stanza, and that stanza is tlock. Anything else (an extra or a costly
  // scrypt stanza, no header) is void before decryption — a structural rule, so every machine classifies it the same
  // way; a decrypt timeout would not be (a slow machine would void what a fast one opens).
  const end = head.indexOf("\n---");
  if (!head.startsWith("age-encryption.org/v1\n") || end < 0) return null;
  const stanzas = head.slice(0, end).split("\n").filter((l) => l.startsWith("->"));
  if (stanzas.length !== 1) return null;
  const m = stanzas[0].match(/^-> tlock (\d+) ([0-9a-f]{64})$/);
  return m ? { round: Number(m[1]), chain: m[2] } : null;
}

/** Seals plaintext to a quicknet round; returns binary age (armor stripped). Encryption needs no beacon. */
export async function seal(plaintext: Uint8Array, round: number): Promise<Uint8Array> {
  const armored = await timelockEncrypt(round, Buffer.from(plaintext), offlineClient([]));
  return new Uint8Array(Buffer.from(armored.split("\n").filter((l) => l && !l.startsWith("-----")).join(""), "base64"));
}

/** Opens a sealed blob with an already-verified beacon. tlock-js logs every beacon it reads; silenced here. */
export async function open(sealed: Uint8Array, beacon: Beacon): Promise<Uint8Array> {
  const log = console.log;
  console.log = () => {};
  try {
    return new Uint8Array(await timelockDecrypt(Buffer.from(sealed).toString("binary"), offlineClient([beacon])));
  } finally {
    console.log = log;
  }
}
