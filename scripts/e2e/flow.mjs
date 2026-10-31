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
process.on("uncaughtException", async (e) => { console.log("FAIL", e.message.split("\n")[0], JSON.stringify(errors).slice(0, 800)); process.exit(1); });
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
// --- scrimmage: free run, then a paid run with the same browser key (funded from the deployer for the test)
let scrim = {};
if (process.env.SCRIM) {
  const { privateKeyToAccount } = require("/Users/edycu/Hackathon/others/worldisflat-build/semalam/build/scripts/node_modules/viem/accounts");
  const key = await page.evaluate(() => localStorage.getItem("semalam.localKey.v1"));
  const addr = privateKeyToAccount(key).address;
  const { execFileSync } = await import("node:child_process");
  execFileSync("npx", ["tsx", "e2e/fund.ts", addr], { cwd: new URL("..", import.meta.url).pathname, stdio: "inherit" });
  await page.goto(base + "/scrimmage", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Run my first commit") && !b.disabled), { timeout: 40000 });
  await clickText("Run my first commit");
  await page.waitForFunction(() => /your first commit:/i.test(document.body.innerText), { timeout: 20000 });
  scrim.free = await page.$eval("h2", (e) => e.textContent);
  await shot("4-scrimmage-free");
  await clickText("Mint 1,000");
  await page.waitForFunction(() => /1000 MockWIF/.test(document.body.innerText), { timeout: 60000 });
  await clickText("Pay 200 MockWIF");
  await page.waitForFunction(() => /your draft:/i.test(document.body.innerText) || document.querySelector("[role=alert]"), { timeout: 120000 });
  scrim.paid = await page.evaluate(() => document.querySelector("h2")?.textContent + " | " + (document.querySelector("[role=alert]")?.textContent ?? ""));
  await shot("5-scrimmage-paid");
}
console.log(JSON.stringify({ stamp, tx, scrim, errors }));
await browser.close();
process.exit(errors.length || !/SEALED/.test(stamp) || (process.env.SCRIM && !/your draft:/i.test(scrim.paid ?? "")) ? 1 : 0);
