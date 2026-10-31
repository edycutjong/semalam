import { HOUSE } from "@semalam/sim/house";
import { readArtifact, settledRounds } from "@/lib/artifact";

export const dynamic = "force-dynamic";

/** Public data only: the previous settled night's top 30 (policies are public once the night is settled) + the house set. */
export async function GET(_: Request, ctx: { params: Promise<{ round: string }> }) {
  const round = Number((await ctx.params).round);
  if (!Number.isInteger(round) || round < 1) return Response.json({ error: "round must be a positive integer" }, { status: 400 });
  const prev = (await settledRounds()).filter((r) => r < round).pop();
  const art = prev ? await readArtifact(prev) : null;
  const house = HOUSE.agents.map((h, i) => ({ id: h.id, label: h.label, house: true, policy: h.policy, rank: i + 1, coins: 0 }));
  const opponents = art?.opponents ?? house;
  return Response.json({
    source: art ? { round: art.round, resultHash: art.settled.resultHash } : null,
    opponents,
    mix: { house: opponents.filter((o) => o.house).length, players: opponents.filter((o) => !o.house).length },
    note: art ? undefined : "no settled night yet — the field is the 30 house agents",
  });
}
