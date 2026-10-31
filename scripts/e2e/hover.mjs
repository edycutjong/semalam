// Interaction QA: byte-diff hover/focus check per element class + link status. usage: node e2e/hover.mjs <base>
import { createRequire } from "node:module";
const require = createRequire("/Users/edycu/Hackathon/_tools/DemoStudio/package.json");
const puppeteer = require("puppeteer");
const base = process.argv[2] ?? "http://localhost:3101";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME ?? undefined, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
let fail = 0;
async function check(name, handle, mode = "hover") {
  if (!handle) { console.log(`FAIL ${name}: element not found`); fail++; return; }
  await handle.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await sleep(500); await page.mouse.move(0, 0); await sleep(350);
  const before = await handle.screenshot();
  if (mode === "hover") await handle.hover(); else await handle.focus();
  await sleep(450);
  const after = await handle.screenshot();
  const changed = Buffer.compare(before, after) !== 0;
  console.log(`${changed ? "ok  " : "FAIL"} ${name} (${mode})`); if (!changed) fail++;
  await page.mouse.move(0, 0);
}
const sel = (s) => page.$(s);
const byText = async (tag, t) => (await page.evaluateHandle((tag, t) => [...document.querySelectorAll(tag)].find((e) => e.textContent.includes(t) && !e.disabled), tag, t)).asElement();

await page.goto(base, { waitUntil: "networkidle0" });
await check("header nav link", await sel("nav.main a:not([aria-current])"));
await check("brand", await sel("a.brand"));
await check("Use the builder (quiet button)", await byText("button", "Use the builder"));
await page.type("#orders", "Be kind to kind neighbours.");
await check("Compile (primary button)", await byText("button", "Compile"));
await check("orders textarea", await sel("#orders"), "focus");
await check("footer link", await sel("footer a"));
await page.click("button.quiet"); // builder
await page.waitForSelector("#preset");
await check("builder select", await sel("#preset"), "focus");
await check("Read it back (primary)", await byText("button", "Read it back"));
await check("add a rule (quiet)", await byText("button", "add a rule"));
await page.goto(base + "/round/1", { waitUntil: "networkidle0" });
await check("Play 15 s (primary)", await byText("button", "play 15"));
await check(".btn link (Rewrite)", await byText("a", "Rewrite for tonight"));
await check(".btn.quiet link (Verify)", await byText("a", "Verify this night"));
await check("address input", await sel("#who"), "focus");
await page.goto(base + "/board", { waitUntil: "networkidle0" });
await check("board row", await sel("tbody tr"));
{ const l = await sel("tbody a"); if (l) await check("board player link", l); else console.log("skip board player link (house-only night: no player rows)"); }
await page.goto(base + "/verify/1", { waitUntil: "networkidle0" });
await check("copy button", await sel(".hash button"));
await check("verify link", await sel("dl a, .data a"));
await page.goto(base + "/fidelity", { waitUntil: "networkidle0" });
await check("fidelity textarea", await sel("#fo"), "focus");
await page.goto(base + "/scrimmage", { waitUntil: "networkidle0" });
await check("scrimmage Edit draft (quiet)", await byText("button", "Edit this draft"));
await check("scrimmage use browser key", await byText("button", "Use my browser key"));
await page.goto(base + "/playtest", { waitUntil: "networkidle0" });
await check("playtest inline link", await sel("main li a"));

// link status: every internal href reachable from each page
const pages = ["/", "/board", "/scrimmage", "/fidelity", "/playtest", "/round/1", "/verify/1"];
const hrefs = new Set();
for (const p of pages) { await page.goto(base + p, { waitUntil: "networkidle0" }); for (const h of await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")))) hrefs.add(h); }
for (const h of [...hrefs].sort()) {
  if (h.startsWith("#") || h === "") { console.log(`FAIL placeholder href "${h}"`); fail++; continue; }
  const url = h.startsWith("http") ? h : base + h;
  const r = await fetch(url, { method: "HEAD", redirect: "manual" }).catch(() => null);
  const ext = h.startsWith("http");
  const ok = r && (r.status === 200 || (ext && [403, 405, 429].includes(r.status)) || (!ext && r.status < 400));
  console.log(`${ok ? "ok  " : "FAIL"} ${r?.status ?? "ERR"} ${h}`); if (!ok) fail++;
}
await browser.close();
process.exit(fail ? 1 : 0);
