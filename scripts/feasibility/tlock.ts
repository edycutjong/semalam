// Feasibility check: drand quicknet timelock — seal a max-size policy as BINARY age (<= 1,536 B), wait for the round,
// decrypt, check keccak; confirm seedRound() against drand /info + roundAt. Writes evidence/feasibility/tlock.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { timelockEncrypt, timelockDecrypt, mainnetClient, roundAt, roundTime, Buffer } from "tlock-js";
import { keccak256, toBytes } from "viem";

const QUICKNET = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const DRAND_GENESIS = 1692803367;
const DRAND_PERIOD = 3;

/** Same integer formula as Results.seedRound: first quicknet round at or after close + 300 s. */
export function seedRoundAt(closeTime: number): number {
  const t = closeTime + 300;
  return Math.floor((t - DRAND_GENESIS + DRAND_PERIOD - 1) / DRAND_PERIOD) + 1;
}

const MAX_POLICY = {
  v: 1,
  name: "night-nurse-24-chars-max",
  opening: "COPY_LEADER",
  default: "COPY_LEADER",
  grudge: 20,
  rules: [
    { if: "partner_stole_from_me", not: true, n: 300, then: "COPY_LEADER" },
    { if: "partner_is_leader", not: true, n: 300, then: "COPY_LEADER" },
    { if: "turn_after", not: true, n: 300, then: "COPY_LEADER" },
  ],
};

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** Reads the target round out of the binary age header: "-> tlock <round> <chainhash>". */
export function stanzaRound(sealed: Uint8Array): { round: number; chain: string } | null {
  const head = Buffer.from(sealed.slice(0, 200)).toString("latin1");
  const m = head.match(/-> tlock (\d+) ([0-9a-f]{64})/);
  return m ? { round: Number(m[1]), chain: m[2] } : null;
}

async function main() {
  const client = mainnetClient();
  const info = await client.chain().info();
  const out: Record<string, unknown> = { at: new Date().toISOString(), chainHash: info.hash, period: info.period, genesis: info.genesis_time };
  if (info.hash !== QUICKNET || info.period !== DRAND_PERIOD || info.genesis_time !== DRAND_GENESIS)
    throw new Error(`quicknet info mismatch ${JSON.stringify(info)}`);

  // seedRound formula vs drand roundAt/roundTime over many 17:00 UTC closes (and odd offsets)
  let checked = 0;
  for (let i = 0; i < 2000; i++) {
    const close = 1793293200 + i * 86400 + (i % 7); // 17:00 UTC instants, plus offsets 0..6 s to hit every residue
    const s = seedRoundAt(close);
    const t = close + 300;
    const ra = roundAt(t * 1000, info);
    const firstAtOrAfter = roundTime(info, ra) >= t * 1000 ? ra : ra + 1;
    if (s !== firstAtOrAfter) throw new Error(`seedRound mismatch at close=${close}: ${s} vs ${firstAtOrAfter}`);
    checked++;
  }
  out.seedRoundChecked = checked;
  out.seedRoundExample = { close: 1793984400, seedRound: seedRoundAt(1793984400) };

  // seal → wait → decrypt
  const plaintext = canonical(MAX_POLICY);
  const policyHash = keccak256(toBytes(plaintext));
  const now = Date.now();
  const target = roundAt(now, info) + 4; // ~12 s ahead
  const armored = await timelockEncrypt(target, Buffer.from(plaintext, "utf8"), client);
  const sealed = Buffer.from(armored.split("\n").filter((l) => l && !l.startsWith("-----")).join(""), "base64");
  const stanza = stanzaRound(sealed);
  if (!stanza || stanza.round !== target || stanza.chain !== QUICKNET) throw new Error(`bad stanza ${JSON.stringify(stanza)}`);
  out.seal = { plaintextBytes: plaintext.length, sealedBytes: sealed.length, armoredBytes: armored.length, targetRound: target, stanza };
  if (sealed.length > 1536) throw new Error(`sealed ${sealed.length} > 1536`);

  // early decrypt must fail (beacon not yet published)
  try {
    await timelockDecrypt(sealed.toString("binary"), client);
    out.earlyDecrypt = "UNEXPECTED_SUCCESS";
  } catch (e) {
    out.earlyDecrypt = `refused: ${(e as Error).message.slice(0, 80)}`;
  }

  const waitMs = roundTime(info, target) - Date.now() + 1500;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  const t0 = performance.now();
  const opened = await timelockDecrypt(sealed.toString("binary"), client);
  const decryptMs = Math.round(performance.now() - t0);
  const ok = opened.toString("utf8") === plaintext && keccak256(toBytes(opened.toString("utf8"))) === policyHash;
  out.decrypt = { ok, decryptMs, policyHash };
  if (!ok) throw new Error("decrypt mismatch");

  mkdirSync("../evidence/feasibility", { recursive: true });
  writeFileSync("../evidence/feasibility/tlock.json", JSON.stringify(out, null, 2) + "\n");
  writeFileSync("/tmp/semalam-feasibility-sealed.hex", "0x" + sealed.toString("hex"));
  writeFileSync("/tmp/semalam-feasibility-policyHash", policyHash);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
