// localStorage that never throws: corrupt JSON or a blocked store reads as "nothing saved".
export function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
export function lsSet(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } }
export const copyText = (t: string) => navigator.clipboard?.writeText(t).then(() => true, () => false) ?? Promise.resolve(false);
