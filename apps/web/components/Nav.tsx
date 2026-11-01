"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import SoundToggles from "./SoundToggles";

const LINKS = [
  { href: "/play", label: "Tonight" },
  { href: "/board", label: "Board" },
  { href: "/scrimmage", label: "Scrimmage" },
  { href: "/fidelity", label: "Check my orders" },
  { href: "/playtest", label: "Playtest" },
];
export default function Nav() {
  const path = usePathname();
  const cur = (h: string) => path.startsWith(h) ? "page" : undefined;
  return (
    <header className="top">
      <Link href="/" className="brand"><i aria-hidden /> Semalam</Link>
      <nav className="main" aria-label="Main">
        {LINKS.map((l) => <Link key={l.href} href={l.href} aria-current={cur(l.href)}>{l.label}</Link>)}
      </nav>
      <SoundToggles />
    </header>
  );
}
