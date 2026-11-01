import type { Night } from "@/lib/landing";
import { ordinal } from "@/lib/rank";

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
/** The latest posted night's 4th-ranked ticket, stamped when it was sealed, then re-stamped with its rank. */
export default function FrozenTicket({ n, className = "" }: { n: Night; className?: string }) {
  const f = n.featured;
  const [head, ...rest] = f.lines;
  return (
    <article className={`ticket s-ticket ${className}`} aria-label={`Stall ticket: ${f.who}, night ${n.round}, ${ordinal(f.rank)} of ${n.agents}`}>
      <p className="who">Night {n.round} · {ordinal(f.rank)} place of {n.agents}</p>
      <p className="who sub">{f.who}</p>
      <p className="t-title">{f.name}</p>
      {head && <p className="rb">{head}</p>}
      <ul>{rest.map((l, i) => <li key={i} className={l.startsWith("  ") ? "in" : ""}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
      <div className="stub">
        <div className="stamps" aria-hidden>
          <span className={`stamp ${f.first.startsWith("HOUSE") ? "house" : "sealed"} st1`}>{f.first}</span>
          <span className="stamp settled st2">{f.second}</span>
        </div>
        <p className="sr">Stamped {f.first}, then re-stamped {f.second}.</p>
        <p className="stub-data data">
          <span><span className="lbl">result hash</span> {short(n.resultHash)}</span>
          {n.txUrl && <a href={n.txUrl}>posted tx {short(n.tx!)}</a>}
        </p>
      </div>
    </article>
  );
}
