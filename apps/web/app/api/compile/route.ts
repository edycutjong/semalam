import { compileOrders, checkOrders, type CompileResult } from "@semalam/policy/compile";
import { ipOf, throttle } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// same-text cache for the day + a hard per-instance daily cap; the provider's free quota is the real stop
const cache = new Map<string, { day: string; result: CompileResult }>();
let used = { day: "", n: 0 };
const DAILY_CAP = Number(process.env.COMPILE_DAILY_CAP ?? 1500);

export async function POST(req: Request) {
  let body: { orders?: unknown };
  try { body = await req.json(); } catch { return Response.json({ kind: "invalid", reason: "request body is not JSON" }, { status: 400 }); }
  const bad = checkOrders(body.orders);
  if (bad) return Response.json({ kind: "invalid", reason: bad }, { status: 400 });
  const orders = (body.orders as string).trim();
  const day = new Date().toISOString().slice(0, 10);
  const hit = cache.get(orders);
  if (hit && hit.day === day) return Response.json(hit.result);
  if (!throttle(`compile-day:${ipOf(req)}`, 60, 86_400_000)) return Response.json({ kind: "paused", reason: "daily compile limit for this address reached — use the builder" }, { status: 429 });
  if (!throttle(`compile:${ipOf(req)}`, 12, 60_000)) return Response.json({ kind: "paused", reason: "too many compiles from this address — use the builder, or wait a minute" }, { status: 429 });
  if (used.day !== day) used = { day, n: 0 };
  const keys = (process.env.GROQ_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (used.n >= DAILY_CAP || !keys.length) return Response.json({ kind: "paused", reason: "compiler paused — use the builder" });
  used.n++;
  const result = await compileOrders(orders, { keys });
  if (result.kind === "policy" || result.kind === "refusal") {
    cache.set(orders, { day, result });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  }
  return Response.json(result);
}
