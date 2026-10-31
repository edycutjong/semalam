import { currentRound } from "@/lib/clock";
import { namedState, readArtifact } from "@/lib/artifact";
import { chainNow, postedOf } from "@/lib/chain";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ n: string }> }) {
  const n = Number((await ctx.params).n);
  if (!Number.isInteger(n) || n < 1) return Response.json({ error: "round must be a positive integer" }, { status: 400 });
  const art = await readArtifact(n);
  if (art) return Response.json({ state: { code: art.status, label: art.status }, artifact: art });
  try {
    const now = await chainNow();
    const posted = await postedOf(n);
    return Response.json({ state: namedState(n, now, currentRound(now), Boolean(posted)), posted, artifact: null });
  } catch (e) {
    return Response.json({ state: { code: "rpc", label: "chain unreachable — try again in a moment" }, error: (e as Error).message.split("\n")[0] }, { status: 503 });
  }
}
