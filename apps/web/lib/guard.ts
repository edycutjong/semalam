// Best-effort per-instance limits (no DB). The real hard stops are the provider's own quota and the relayer balance.
const hits = new Map<string, number[]>();
export function throttle(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
export const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();

/** Tiny per-instance memo (no DB): the chain stays the source of truth, this only spares the RPC. */
const memo = new Map<string, { at: number; v: unknown }>();
export async function memoized<T>(key: string, ttlMs: number, f: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await f();
  memo.set(key, { at: Date.now(), v });
  return v;
}
/** Serialises async work per key (one relayer key = one nonce stream per instance). */
const tails = new Map<string, Promise<unknown>>();
export function serial<T>(key: string, f: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(f, f);
  tails.set(key, run.catch(() => undefined));
  return run;
}
