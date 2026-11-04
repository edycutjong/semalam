import { HOUSE } from "@semalam/sim/house";
import { readArtifact, settledRounds } from "@/lib/artifact";
import { CHAIN_ID, EXCLUDED } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Public data only: the previous settled night's top 30 (policies are public once the night is settled) + the house set. */
export async function GET(req: Request, ctx: { params: Promise<{ round: string }> }) {
  const round = Number((await ctx.params).round);
  if (!Number.isInteger(round) || round < 1) return Response.json({ error: "round must be a positive integer" }, { status: 400 });
  // ?source=<n> pins the opponents to that settled night (a run saved earlier re-runs against the SAME field); source=house = the 30 house agents
  const src = new URL(req.url).searchParams.get("source");
  // only a verified night (posted on chain AND equal to the CLI's fresh-process hash) can be a field
  const verified = async (r: number) => { const a = await readArtifact(r); return a && a.chainId === CHAIN_ID && a.status === "posted" && a.cli.match ? a : null; };
  let prev: number | undefined;
  if (src && src !== "house") prev = Number(src);
  else if (!src) for (const r of (await settledRounds()).filter((x) => x < round).reverse()) if (await verified(r)) { prev = r; break; }
  if (src && src !== "house" && !(Number.isInteger(prev) && (prev as number) >= 1 && (prev as number) < round)) return Response.json({ error: "source must be an earlier round or 'house'" }, { status: 400 });
  const art = prev ? await verified(prev) : null;
  if (src && src !== "house" && !art) return Response.json({ error: `the field from round ${src} is not available as a verified night` }, { status: 404 }); // a pinned run must never silently fall back to another field
  const house = HOUSE.agents.map((h, i) => ({ id: h.id, label: h.label, house: true, policy: h.policy, rank: i + 1, coins: 0 }));
  const opponents = art?.opponents ?? house;
  return Response.json({
    source: art ? { round: art.round, resultHash: art.settled.resultHash } : null,
    opponents,
    // operator addresses (our own smoke/demo commits) are named as what they are, never counted as players
    mix: {
      house: opponents.filter((o) => o.house).length,
      players: opponents.filter((o) => !o.house && !EXCLUDED.includes(o.id.toLowerCase())).length,
      operators: opponents.filter((o) => !o.house && EXCLUDED.includes(o.id.toLowerCase())).length,
    },
    note: art ? undefined : "no settled night yet — the field is the 30 house agents",
  });
}
