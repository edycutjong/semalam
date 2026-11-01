// Screenshots + console-error check of every product page at 1280 and 375 px; fails on page errors or horizontal scroll.
import { createRequire } from "node:module";
// puppeteer from this workspace, or from any install named by PUPPETEER_FROM=<path to its package.json>
const require = createRequire(process.env.PUPPETEER_FROM ?? import.meta.url);
const puppeteer = require("puppeteer");
const [base = "http://localhost:3101", dir] = process.argv.slice(2);
const paths = ["/", "/board", "/scrimmage", "/fidelity", "/playtest", "/round/1", "/verify/1"];
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME ?? undefined, args: ["--no-sandbox"] });
let bad = 0;
for (const [w, h] of [[1280, 900], [375, 800]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: "networkidle0" });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (dir) await page.screenshot({ path: `${dir}/${p.replace(/\W+/g, "_") || "home"}-${w}.png` });
    const e = errors.splice(0);
    if (e.length || over > 0) { bad++; console.log(`FAIL ${w}px ${p} overflow=${over} errors=${JSON.stringify(e)}`); } else console.log(`ok   ${w}px ${p}`);
  }
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
