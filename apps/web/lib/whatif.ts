// A19: the breakfast "what if" only turns the player's EXISTING rules off — it can never add or change one.
import type { Policy } from "@semalam/policy";
export const MAX_VARIANTS = 3;
export function editedPolicy(p: Policy, off: ReadonlySet<number>): Policy {
  return { ...p, rules: p.rules.filter((_, i) => !off.has(i)) };
}
