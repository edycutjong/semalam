import type { ReactNode } from "react";
import { Bungee, Atkinson_Hyperlegible, Martian_Mono } from "next/font/google";
import "./globals.css";

const bungee = Bungee({ weight: "400", subsets: ["latin"], variable: "--f-bungee", display: "swap" });
const atkinson = Atkinson_Hyperlegible({ weight: ["400", "700"], subsets: ["latin"], variable: "--f-atkinson", display: "swap" });
const martian = Martian_Mono({ subsets: ["latin"], variable: "--f-martian", display: "swap" });

export const metadata = {
  metadataBase: new URL("https://semalam.edycu.dev"),
  title: "SEMALAM — the night market your agent plays while you sleep",
  description: "Write three sentences of orders before bed. At 00:00 WIB your agent plays the night market. Replay it at breakfast.",
  openGraph: { siteName: "SEMALAM", type: "website" },
  twitter: { card: "summary_large_image" },
};

// Fonts + metadata only. The game pages get the nav and footer from app/(game)/layout.tsx; the landing (/) and the deck
// (/pitch) draw their own full-bleed chrome.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bungee.variable} ${atkinson.variable} ${martian.variable}`}>
      <body>{children}</body>
    </html>
  );
}
