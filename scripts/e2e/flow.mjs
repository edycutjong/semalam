// Browser e2e of the core flow on a running app: write → compile → readback → seal (local key, relay) → SEALED stamp.
// usage: node e2e/flow.mjs <baseUrl> [screenshotDir]
import { createRequire } from "node:module";
const require = createRequire("/Users/edycu/Hackathon/_tools/DemoStudio/package.json");
const puppeteer = require("puppeteer");
const base = process.argv[2] ?? "http://localhost:3101";
const shots = process.argv[3];
const orders = "Share with anyone who shares with me. If a neighbour robs me, rob them back for a while, but never from the top ten.";
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME ?? undefined, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
const clickText = async (txt) => {
  await page.waitForFunction((t) => [...document.querySelectorAll("button,a.btn")].some((b) => b.textContent.includes(t) && !b.disabled), { timeout: 30000 }, txt);
  await page.evaluate((t) => [...document.querySelectorAll("button,a.btn")].find((b) => b.textContent.includes(t) && !b.disabled).click(), txt);
};
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });
await page.goto(base, { waitUntil: "networkidle0" });
await page.type("#orders", orders);
await shot("1-write");
await clickText("Compile");
await page.waitForSelector(".ticket", { timeout: 40000 });
await page.waitForFunction(() => document.body.innerText.includes("first matching rule wins"), { timeout: 40000 });
await shot("2-readback");
await clickText("Seal");
await clickText("Play without a wallet");
await page.waitForFunction(() => document.querySelector(".stamp.sealed"), { timeout: 90000 });
const stamp = await page.$eval(".stamp.sealed", (e) => e.textContent);
const tx = await page.$eval(".ticket .stub a", (e) => e.getAttribute("href"));
await shot("3-sealed");
console.log(JSON.stringify({ stamp, tx, errors }));
await browser.close();
process.exit(errors.length || !/SEALED/.test(stamp) ? 1 : 0);
