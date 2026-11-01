import type { Lamp } from "@/lib/landing";

// One petromax lamp per agent of the night, strung edge to edge in the order the replay uses. Final rank sets the glow
// (brighter = higher, same rule as the replay); grey = house agent; amber = the featured ticket. Static SVG: no-JS, print
// and screenshots show the settled night; CSS only lights the lamps in, left to right.
type G = { w: number; h: number; rows: Lamp[][]; sag: number; top: number; gap: number; scale: number };

function strand(row: Lamp[], g: G, r: number, agents: number, offset: number, uid: string) {
  const x0 = 34 * g.scale, x1 = g.w - 34 * g.scale, y0 = g.top + r * g.gap;
  const wire = (x: number) => { const t = (x - g.w / 2) / (g.w / 2); return y0 + g.sag * (1 - t * t); };
  const path = `M ${-10} ${y0 - 6} Q ${g.w / 2} ${y0 + 2 * g.sag} ${g.w + 10} ${y0 - 6}`;
  const lamps = row.map((l, i) => {
    const x = row.length === 1 ? g.w / 2 : x0 + (i * (x1 - x0)) / (row.length - 1);
    const wy = wire(x), cord = (12 + ((i * 7 + r * 3) % 5) * 5) * g.scale, cy = wy + cord + 9 * g.scale;
    const b = 1 - (l.rank - 1) / Math.max(1, agents);
    const k = l.featured ? "f" : l.house ? "h" : "p";
    const rx = (l.featured ? 9.5 : 6.5) * g.scale, ry = (l.featured ? 11.5 : 8) * g.scale;
    const halo = (l.featured ? 58 : 12 + 30 * b) * g.scale;
    return (
      <g key={l.id} className={`lamp ${k}`} style={{ ["--d" as string]: `${260 + (offset + i) * 36}ms` }}>
        <line x1={x} y1={wy} x2={x} y2={cy - ry} className="cord" />
        <circle cx={x} cy={cy} r={halo} fill={`url(#${uid}-${k})`} className="halo" opacity={l.featured ? 1 : 0.2 + 0.6 * b} />
        <path d={`M ${x - 5 * g.scale} ${cy - ry + 1} L ${x + 5 * g.scale} ${cy - ry + 1} L ${x + 3 * g.scale} ${cy - ry - 4 * g.scale} L ${x - 3 * g.scale} ${cy - ry - 4 * g.scale} Z`} className="cap" />
        <ellipse cx={x} cy={cy} rx={rx} ry={ry} className="globe" opacity={l.featured ? 1 : 0.3 + 0.7 * b} />
        <ellipse cx={x} cy={cy + 1} rx={rx * 0.42} ry={ry * 0.5} className="mantle" opacity={l.featured ? 1 : 0.15 + 0.85 * b} />
      </g>
    );
  });
  return <g key={r}><path d={path} className="wire" />{lamps}</g>;
}

function Svg({ g, agents, label, cls, uid }: { g: G; agents: number; label?: string; cls: string; uid: string }) {
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} className={`lamps-svg ${cls}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} preserveAspectRatio="xMidYMin meet">
      <defs>
        <radialGradient id={`${uid}-f`}><stop offset="0" stopColor="#FFB547" stopOpacity=".75" /><stop offset=".45" stopColor="#FFB547" stopOpacity=".22" /><stop offset="1" stopColor="#FFB547" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${uid}-p`}><stop offset="0" stopColor="#F2D16B" stopOpacity=".55" /><stop offset=".5" stopColor="#F2D16B" stopOpacity=".12" /><stop offset="1" stopColor="#F2D16B" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${uid}-h`}><stop offset="0" stopColor="#A89C8A" stopOpacity=".38" /><stop offset=".5" stopColor="#A89C8A" stopOpacity=".08" /><stop offset="1" stopColor="#A89C8A" stopOpacity="0" /></radialGradient>
      </defs>
      {g.rows.map((row, r) => { const s = strand(row, g, r, agents, offset, uid); offset += row.length; return s; })}
    </svg>
  );
}

export default function LampString({ lamps, agents, round, uid = "ls" }: { lamps: Lamp[]; agents: number; round: number | null; uid?: string }) {
  const half = Math.ceil(lamps.length / 2);
  const wide: G = { w: 1440, h: 212, rows: [lamps], sag: 84, top: 12, gap: 0, scale: 1.18 };
  const narrow: G = { w: 600, h: 300, rows: [lamps.slice(0, half), lamps.slice(half)], sag: 46, top: 10, gap: 118, scale: 1.25 };
  const label = round
    ? `Night ${round}: ${lamps.length} agents as lamps on a string. Brighter means a higher final rank; grey lamps are house agents; the amber lamp is the ticket below.`
    : `${lamps.length} house agents as unlit lamps: no night has settled yet.`;
  return (
    <div className="lampstring">
      <Svg g={wide} agents={agents} label={label} cls="wide" uid={`${uid}w`} />
      <Svg g={narrow} agents={agents} cls="narrow" uid={`${uid}n`} />
    </div>
  );
}
