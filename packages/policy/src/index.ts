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
  .strict()
  // a theft is first seen one turn later, so grudge 0 would make partner_stole_from_me a rule that never fires
  .refine((p) => p.grudge >= 1 || !p.rules.some((r) => r.if === "partner_stole_from_me"), {
    message: "grudge must be ≥ 1 when a rule uses partner_stole_from_me",
  });
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

// ---------- plain-English readback (A4) ----------
const ACTION_WORDS: Record<(typeof ACTIONS)[number], string> = {
  GATHER: "GATHER (work your own stall)",
  GUARD: "GUARD (protect your coins)",
  SHARE: "SHARE (trade generously)",
  STEAL: "STEAL (rob your neighbour)",
  COPY_LEADER: "COPY_LEADER (do what the top agent did last turn)",
};
function conditionWords(r: z.infer<typeof Rule>, grudge: number): string {
  const w: Record<(typeof CONDITIONS)[number], [string, string]> = {
    partner_stole_from_me: [`my neighbour stole from me in the last ${grudge} turn${grudge === 1 ? "" : "s"}`, `my neighbour has not stolen from me in the last ${grudge} turn${grudge === 1 ? "" : "s"}`],
    partner_is_thief: ["my neighbour stole from anyone in the last 10 turns", "my neighbour has not stolen from anyone in the last 10 turns"],
    partner_shared_with_me: ["my neighbour shared with me in the last 10 turns", "my neighbour has not shared with me in the last 10 turns"],
    partner_richer: ["my neighbour has more coins than me", "my neighbour does not have more coins than me"],
    partner_poorer: ["my neighbour has fewer coins than me", "my neighbour does not have fewer coins than me"],
    partner_is_leader: ["my neighbour is in the top 10", "my neighbour is not in the top 10"],
    i_am_leading: ["I am in the top 10", "I am not in the top 10"],
    i_am_behind: ["I am in the bottom half", "I am not in the bottom half"],
    turn_after: [`it is after turn ${r.n}`, `it is turn ${r.n} or earlier`],
  };
  return w[r.if][r.not ? 1 : 0];
}
/** [later, earlier] pairs where the later rule can never fire: same condition, or a later "after turn n" that an earlier "after turn m ≤ n" already covers. */
export function shadowed(p: Policy): [number, number][] {
  const out: [number, number][] = [];
  p.rules.forEach((r, j) => {
    const i = p.rules.slice(0, j).findIndex((e) => e.if === r.if && !!e.not === !!r.not && (r.if !== "turn_after" || (!r.not && (e.n as number) <= (r.n as number)) || e.n === r.n));
    if (i >= 0) out.push([j, i]);
  });
  return out;
}
/** A turn ladder ("after 100 steal, after 200 guard") only works latest-first: put the plain "after turn n" rules in descending n inside the slots they already occupy. */
export function tidy(p: Policy): Policy {
  const slots = p.rules.flatMap((r, i) => (r.if === "turn_after" && !r.not ? [i] : []));
  if (slots.length < 2) return p;
  const sorted = slots.map((i) => p.rules[i]).sort((a, b) => (b.n as number) - (a.n as number));
  const rules = [...p.rules];
  slots.forEach((i, k) => (rules[i] = sorted[k]));
  return { ...p, rules };
}
/** Plain words, in order, every rule; the UI and the CLI print exactly this. */
export function readback(p: Policy): string[] {
  const lines = [`Your agent "${p.name}" will:`, `- Turns 1–10: ${ACTION_WORDS[p.opening]}.`];
  if (p.rules.length) lines.push("- From turn 11, first matching rule wins:");
  p.rules.forEach((r, i) => lines.push(`  ${i + 1}. If ${conditionWords(r, p.grudge)} → ${ACTION_WORDS[r.then]}.`));
  lines.push(`- ${p.rules.length ? "Otherwise" : "From turn 11"}: ${ACTION_WORDS[p.default]}.`);
  shadowed(p).forEach(([j, i]) => lines.push(`- Note: rule ${j + 1} can never fire — rule ${i + 1} already matches whenever it would.`));
  if (!p.rules.some((r) => r.if === "partner_stole_from_me") && p.grudge > 0) lines.push(`- Remembers a theft against it for ${p.grudge} turns.`);
  return lines;
}

// ---------- no-LLM builder presets ----------
const preset = (name: string, opening: Policy["opening"], dflt: Policy["default"], grudge: number, rules: Policy["rules"]): Policy =>
  Policy.parse({ v: 1, name, opening, default: dflt, grudge, rules });
/** 8 client-side presets — the fallback when the compiler is down and the private path. */
export const PRESETS: Policy[] = [
  preset("steady-gatherer", "GATHER", "GATHER", 0, []),
  preset("tit-for-tat", "SHARE", "SHARE", 1, [{ if: "partner_stole_from_me", then: "STEAL" }]),
  preset("night-nurse", "GATHER", "GATHER", 5, [
    { if: "partner_is_leader", then: "GATHER" },
    { if: "partner_stole_from_me", then: "STEAL" },
    { if: "i_am_leading", then: "GUARD" },
  ]),
  preset("copy-the-winner", "GATHER", "COPY_LEADER", 0, []),
  preset("thief-hunter", "GATHER", "SHARE", 3, [{ if: "partner_is_thief", then: "GUARD" }, { if: "partner_stole_from_me", then: "STEAL" }]),
  preset("generous-neighbour", "SHARE", "GATHER", 3, [{ if: "partner_shared_with_me", then: "SHARE" }, { if: "partner_is_thief", then: "GUARD" }]),
  preset("late-bloomer", "GUARD", "GATHER", 0, [{ if: "turn_after", n: 240, then: "STEAL" }, { if: "partner_poorer", then: "SHARE" }]),
  preset("rob-the-rich", "GATHER", "GATHER", 4, [{ if: "partner_richer", then: "STEAL" }, { if: "partner_stole_from_me", then: "GUARD" }]),
];
