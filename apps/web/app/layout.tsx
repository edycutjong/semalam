import type { ReactNode } from "react";
import { Bungee, Atkinson_Hyperlegible, Martian_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";

const bungee = Bungee({ weight: "400", subsets: ["latin"], variable: "--f-bungee", display: "swap" });
const atkinson = Atkinson_Hyperlegible({ weight: ["400", "700"], subsets: ["latin"], variable: "--f-atkinson", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], variable: "--f-martian", display: "swap" });

export const metadata = {
  title: "SEMALAM — the night market your agent plays while you sleep",
  description: "Write three sentences of orders before bed. At 00:00 WIB your agent plays the night market. Replay it at breakfast.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bungee.variable} ${atkinson.variable} ${martian.variable}`}>
      <body>
        <div className="wrap">
          <Nav />
          <main>{children}</main>
          <footer>
            SEMALAM · orders are sealed to a public drand beacon and replayed by open code ·{" "}
            <a href="/verify/1">verify a night</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
