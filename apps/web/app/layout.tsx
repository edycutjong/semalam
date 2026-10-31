import type { ReactNode } from "react";

export const metadata = {
  title: "SEMALAM — the night market your agent plays while you sleep",
  description: "Write three sentences of orders before bed. At 00:00 WIB your agent plays the night market. Replay it at breakfast.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#1B1530", color: "#F4EEDC", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
