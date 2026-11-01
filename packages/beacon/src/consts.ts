// Dependency-free half of @semalam/beacon: pinned quicknet constants, round arithmetic and the age-header reader.
// Kept apart from the BLS + tlock code so pages that only need these never ship the ~600 KB crypto bundle.
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
export type Beacon = { round: number; randomness: string; signature: string };

/** First quicknet round at or after closeTime + 300 s — same integer formula as Results.seedRound. */
export function seedRoundAt(closeTime: number): number {
  const t = closeTime + 300;
  return Math.floor((t - QUICKNET.genesis_time + QUICKNET.period - 1) / QUICKNET.period) + 1;
}
export const roundTimeOf = (round: number) => QUICKNET.genesis_time + (round - 1) * QUICKNET.period;

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
