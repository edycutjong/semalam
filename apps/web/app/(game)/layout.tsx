import type { ReactNode } from "react";
import Nav from "@/components/Nav";

export default function GameLayout({ children }: { children: ReactNode }) {
  return (
    <div className="wrap">
      <Nav />
      <main>{children}</main>
      <footer>
        SEMALAM · orders are sealed to a public drand beacon and replayed by open code ·{" "}
        <a href="/verify/1">verify a night</a>
      </footer>
    </div>
  );
}
