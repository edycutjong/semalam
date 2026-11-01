// Small drawn marks for the mechanism cards — each a different object from the market, never a circled icon set.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export function Glyph({ k }: { k: "pen" | "seal" | "beacon" | "lamp" | "stamp" }) {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden className="glyph-mark">
      {k === "pen" && <><path {...P} d="M5 25h11M21 5l6 6-13 13-7 1 1-7z" /><path {...P} d="M18 8l6 6" /></>}
      {k === "seal" && <><rect {...P} x="7" y="14" width="18" height="13" rx="2" /><path {...P} d="M11 14v-4a5 5 0 0 1 10 0v4M16 19v3" /></>}
      {k === "beacon" && <><path {...P} d="M16 27V15M11 27h10M16 15l-4-4h8z" /><path {...P} d="M7 8a12 12 0 0 1 18 0M10 11a8 8 0 0 1 12 0" /></>}
      {k === "lamp" && <><path {...P} d="M16 3v4M11 7h10l-1 3H12zM10 10h12l-2 12h-8z" /><path {...P} d="M13 26h6M16 14v4" /></>}
      {k === "stamp" && <><path {...P} d="M12 4h8v8l3 5H9l3-5zM7 17h18v4H7zM6 27h20" /></>}
    </svg>
  );
}
