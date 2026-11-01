import type { ReactNode } from "react";
import HashLine from "./HashLine";

export type TicketState = "draft" | "refused" | "sealed" | "settled";
export function Stamp({ kind, fresh, children }: { kind: "sealed" | "settled" | "refused" | "house" | "draft"; fresh?: boolean; children: ReactNode }) {
  return <span className={`stamp ${kind}${fresh ? " fresh" : ""}`}>{children}</span>;
}
/** The stall ticket: readback in body type, hash in data type, a rubber stamp. `fresh` = the stamp is coming down right
 * now: it presses (squash), the ink spreads and the paper settles under it. */
export default function Ticket({ state, title, lines, stamp, hash, hashLabel, tx, txUrl, fresh, children }: {
  state: TicketState; title: string; lines: string[]; stamp?: string; hash?: string; hashLabel?: string; tx?: string; txUrl?: string; fresh?: boolean; children?: ReactNode;
}) {
  const [head, ...rest] = lines;
  return (
    <article className={`ticket ${state === "refused" ? "refused" : ""}${fresh ? " pressed" : ""}`} aria-label={`Stall ticket: ${title}`}>
      <h3>{title}</h3>
      {head && <p style={{ margin: "0 0 4px" }}>{head}</p>}
      <ul>{rest.map((l, i) => <li key={i} style={{ paddingLeft: l.startsWith("  ") ? 18 : 0 }}>{l.replace(/^\s*-\s*/, "").trim()}</li>)}</ul>
      {children}
      <div className="stub">
        <div>
          {hash && <><div className="data" style={{ fontSize: 12 }}>{hashLabel ?? "policy hash"}</div><HashLine value={hash} short /></>}
          {tx && txUrl && <div className="data" style={{ fontSize: 12, marginTop: 4 }}><a href={txUrl}>tx {tx.slice(0, 10)}…{tx.slice(-6)}</a></div>}
        </div>
        {stamp && <Stamp kind={state === "draft" ? "draft" : state} fresh={fresh}>{stamp}</Stamp>}
      </div>
    </article>
  );
}
