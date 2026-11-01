"use client";
import { useEffect, useState } from "react";
import type { AgentRep } from "./ReplayPlayer";
import { IS_TESTNET } from "@/lib/config";

type Props = { round: number; line: string; coins: number; agents: number; replays: AgentRep[]; mineId: string; houseIds: Set<string>; why: string; resultHash: string; streak: number };
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Your morning as a 1200×630 card: the real rank, the night's last lamp row, your decisive turn, the hash to replay it. */
async function drawCard(p: Props): Promise<Blob | null> {
  await document.fonts?.ready;
  const css = getComputedStyle(document.documentElement);
  const disp = css.getPropertyValue("--f-bungee").trim() || "Arial Black", mono = css.getPropertyValue("--f-martian").trim() || "monospace", body = css.getPropertyValue("--f-atkinson").trim() || "sans-serif";
  const W = 1200, H = 630, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"); if (!g) return null;
  g.fillStyle = "#1B1530"; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(247,233,204,.025)";
  for (let x = 0; x < W; x += 7) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 7) g.fillRect(0, y, W, 1);
  g.textBaseline = "alphabetic"; g.fillStyle = "#F7E9CC"; g.font = `400 44px ${disp}`; g.fillText("SEMALAM", 64, 96);
  const bx = 64 + g.measureText("SEMALAM").width + 26;
  const halo = g.createRadialGradient(bx, 80, 0, bx, 80, 26); halo.addColorStop(0, "rgba(255,181,71,.7)"); halo.addColorStop(1, "rgba(255,181,71,0)");
  g.fillStyle = halo; g.fillRect(bx - 26, 54, 52, 52); g.fillStyle = "#FFB547"; g.beginPath(); g.arc(bx, 80, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#A89C8A"; g.font = `400 20px ${mono}`;
  g.fillText(`BREAKFAST · ROUND ${p.round}${IS_TESTNET ? " · TESTNET" : ""}${p.streak >= 2 ? ` · ${p.streak} NIGHTS IN A ROW` : ""}`, 64, 136);
  const [head, tail] = p.line.split(" · ");
  let size = 96; g.font = `400 ${size}px ${disp}`;
  while (g.measureText(head.toUpperCase()).width > W - 128 && size > 40) { size -= 4; g.font = `400 ${size}px ${disp}`; }
  g.fillStyle = "#FFB547"; g.fillText(head.toUpperCase(), 64, 250);
  g.fillStyle = "#F7E9CC"; g.font = `400 26px ${mono}`; g.fillText(`${tail ?? ""}${tail ? " · " : ""}${p.coins} coins`, 64, 300);
  // the night's last frame: one lamp per agent in seat order, brightness by final rank, yours amber
  const rows = [...p.replays].sort((a, b) => (a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1));
  const n = rows.length, cols = Math.min(n, Math.max(12, Math.ceil(n / 2))), lines = Math.ceil(n / cols), cw = (W - 128) / cols, top = 350, rh = 110 / lines;
  g.strokeStyle = "#3A2F55"; g.lineWidth = 1.5;
  for (let l = 0; l < lines; l++) { const y = top + l * rh; g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(W / 2, y + 18, W - 64, y); g.stroke(); }
  rows.forEach((r, i) => {
    const f = r.keyframes.at(-1); if (!f) return;
    const l = Math.floor(i / cols), x = 64 + ((i % cols) + 0.5) * cw, u = (2 * (x - 64)) / (W - 128) - 1, y = top + l * rh + 9 * (1 - u * u) + rh * 0.55;
    const me = r.id.toLowerCase() === p.mineId.toLowerCase(), bright = 1 - (f.rank - 1) / Math.max(1, p.agents - 1), rad = Math.max(3, Math.min(12, cw * 0.3)) * (me ? 1.5 : 0.55 + 0.45 * bright);
    if (me) { const h2 = g.createRadialGradient(x, y, 0, x, y, rad * 5); h2.addColorStop(0, "rgba(255,181,71,.65)"); h2.addColorStop(1, "rgba(255,181,71,0)"); g.fillStyle = h2; g.fillRect(x - rad * 5, y - rad * 5, rad * 10, rad * 10); }
    g.globalAlpha = me ? 1 : 0.25 + 0.75 * bright; g.fillStyle = me ? "#FFB547" : p.houseIds.has(r.id.toLowerCase()) ? "#8a7fa0" : "#F2D16B";
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  });
  g.fillStyle = "#F7E9CC"; g.font = `400 26px ${body}`;
  const words = p.why.split(" "); let ln = "", y = 524;
  for (const w of words) { if (g.measureText(`${ln} ${w}`).width > W - 128 && ln) { g.fillText(ln, 64, y); ln = w; y += 34; } else ln = ln ? `${ln} ${w}` : w; }
  if (ln && y < 580) g.fillText(ln, 64, y);
  g.fillStyle = "#A89C8A"; g.font = `400 17px ${mono}`;
  g.fillText(`result hash ${short(p.resultHash)} · npx semalam replay ${p.round}${IS_TESTNET ? " --chain 46630" : ""}`, 64, 600);
  g.textAlign = "right"; g.fillText(`${location.host}/round/${p.round}`, W - 64, 600);
  return new Promise((res) => c.toBlob(res, "image/png"));
}

export default function MorningCard(p: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function make() {
    setBusy(true); setNote("");
    try {
      const blob = await drawCard(p);
      if (!blob) throw new Error("this browser cannot draw the card");
      const name = `semalam-round-${p.round}.png`, file = new File([blob], name, { type: "image/png" });
      const u = URL.createObjectURL(blob); setUrl(u);
      const text = `${p.line.split(" · ")[0]} in SEMALAM round ${p.round}. Replay it yourself: ${location.origin}/round/${p.round}`;
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: `SEMALAM · round ${p.round}`, text }); } catch { /* the viewer closed the share sheet */ }
      } else {
        const a = document.createElement("a"); a.href = u; a.download = name; a.click();
        setNote("Saved as an image — post it anywhere.");
      }
    } catch (e) { setNote((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="morning">
      <button type="button" onClick={make} disabled={busy}>{busy ? "Drawing…" : "Share my night"}</button>
      {note && <p className="muted" role="status" style={{ margin: "8px 0 0", fontSize: 15 }}>{note}</p>}
      {url && <img className="card-preview" src={url} alt={`Your morning card for round ${p.round}: ${p.line}`} width={600} height={315} />}
    </div>
  );
}
