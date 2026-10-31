// PolicySchema v1 — the ONE shape an order can compile to (<= 6 top-level fields, <= 3 rules, first match wins).
// Shared by the compiler route, the no-LLM builder, the runner and the CLI.
import { z } from "zod";
import { keccak256, toBytes } from "viem";

export const ACTIONS = ["GATHER", "GUARD", "SHARE", "STEAL", "COPY_LEADER"] as const;
export const CONDITIONS = [
  "partner_stole_from_me",
  "partner_is_thief",
  "partner_shared_with_me",
  "partner_richer",
  "partner_poorer",
  "partner_is_leader",
  "i_am_leading",
  "i_am_behind",
  "turn_after",
] as const;

export const Action = z.enum(ACTIONS);
export const Rule = z
  .object({
    if: z.enum(CONDITIONS),
    not: z.boolean().optional(),
    n: z.number().int().min(1).max(300).optional(),
    then: Action,
  })
  .strict()
  .refine((r) => (r.if === "turn_after") === (r.n !== undefined), { message: "n is required for turn_after only" });

export const Policy = z
  .object({
    v: z.literal(1),
    name: z.string().regex(/^[a-z0-9-]{1,24}$/),
    opening: Action,
    default: Action,
    grudge: z.number().int().min(0).max(20),
    rules: z.array(Rule).max(3),
  })
  .strict();
export type Policy = z.infer<typeof Policy>;

export const Refusal = z.object({ refuse: z.string().min(1).max(200) }).strict();

/** Sorted keys, no whitespace — the bytes that are hashed and sealed. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export const policyHash = (p: Policy) => keccak256(toBytes(canonical(p)));
