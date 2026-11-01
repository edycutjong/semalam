// "Rewrite from here": the decisive turn's matchup read against the frozen payoff table, and last night's orders as
// editable words. Breakfast writes it; Tonight reads it once to pre-fill the box.
import { ALONE, PAYOFF } from "@semalam/sim";
import { readback, type Policy } from "@semalam/policy";

export const REWRITE_KEY = "semalam.rewrite";
export type Rewrite = { round: number; t: number; why: string; hint: string; policy: Policy; text: string; at: number };
const ACTS = ["GATHER", "GUARD", "SHARE", "STEAL"];
const WORD: Record<string, string> = { GATHER: "gather", GUARD: "guard", SHARE: "share", STEAL: "steal" };
const VERB: Record<string, string> = { GATHER: "gather", GUARD: "guard", SHARE: "share", STEAL: "steal", COPY_LEADER: "copy the leader" };
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");

/** What that turn paid and the best single-turn reply to the partner's move — numbers straight from PAYOFF / ALONE. */
export function hintOf(action: string, partnerAction: string | null): string {
  if (!partnerAction) return `Your stall had no partner that turn: an unpaired stall always gathers alone for ${signed(ALONE)}.`;
  const me = ACTS.indexOf(action), them = ACTS.indexOf(partnerAction);
  if (me < 0 || them < 0) return "";
  const best = [0, 1, 2, 3].reduce((b, a) => (PAYOFF[a][them] > PAYOFF[b][them] ? a : b), 0), mine = PAYOFF[me][them];
  if (PAYOFF[best][them] === mine) return `On that turn your ${WORD[action]} was already the best reply to their ${WORD[partnerAction]} (${signed(mine)} on the payoff table).`;
  return `On that turn, against their ${WORD[partnerAction]}: ${WORD[ACTS[best]]} pays ${signed(PAYOFF[best][them])} on the payoff table, your ${WORD[action]} paid ${signed(mine)}.`;
}

/** Last night's orders in the words its readback already used (the player confirmed them before sealing), with the rule
 * lines tightened ("1) if …, steal;") so three rules still fit the order box. Tonight checks the length before filling. */
export function ordersText(p: Policy): string {
  const out = readback(p).slice(1).map((l) => {
    const rule = /^\s*(\d+)\.\s*If\s+(.*?)\s*→\s*(.*?)\.?$/.exec(l);
    if (rule) return `${rule[1]}) if ${rule[2]}, ${rule[3]};`;
    return /first matching rule wins/.test(l) ? "From turn 11, first match wins:" : l.replace(/^\s*-\s*/, "").trim();
  });
  return out.join(" ").replace(/\b(GATHER|GUARD|SHARE|STEAL|COPY_LEADER) \([^)]*\)/g, (_, a: string) => VERB[a] ?? a.toLowerCase())
    .replace(/;(\s+(?:Otherwise|Remembers))/g, ".$1").replace(/;$/, ".");
}
