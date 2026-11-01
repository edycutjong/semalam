import { expect, test } from "@playwright/test";

// The landing page (/) and the pitch deck (/pitch) read live numbers, so these check structure and behaviour, not values.
test("landing: the board, the replay pair, the FAQ and no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".plank-grid dt")).toHaveCount(4);
  for (const dt of await page.locator(".plank-grid dt").all()) await expect(dt).not.toHaveText("");
  await expect(page.locator(".s-ticket .stamp")).toHaveCount(2);
  await expect(page.locator("#last-night .term-body")).toContainText("MATCH");
  const faq = page.locator("#faq details").first();
  await faq.locator("summary").click();
  await expect(faq).toHaveAttribute("open", "");
  expect(errors).toEqual([]);
});

test("landing: every link on the page resolves", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split("#")[0]))]);
  for (const h of hrefs) expect((await request.get(h)).status(), h).toBe(200);
});

test("deck: keys move, overview and notes toggle, nine slides with notes and a QR", async ({ page }) => {
  await page.goto("/pitch");
  await expect(page.locator(".deck .slide")).toHaveCount(9);
  await expect(page.locator(".deck .speaker-notes")).toHaveCount(9);
  await expect(page.locator(".deck-ui .count")).toHaveText("01 / 09");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".deck-ui .count")).toHaveText("02 / 09");
  await page.keyboard.press("End");
  await expect(page.locator(".deck-ui .count")).toHaveText("09 / 09");
  await expect(page.locator(".deck .qr svg path")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".deck")).toHaveClass(/overview/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("p");
  await expect(page.locator(".notes-panel")).toBeVisible();
});

test("deck: the night slide steps through the re-run night before the next slide", async ({ page }) => {
  await page.goto("/pitch#5");
  await expect(page.locator(".deck-ui .count")).toHaveText("05 / 09");
  const ns = page.locator(".frame.on .ns");
  await expect(ns).toHaveCount(1); // only shown when the re-run gives the posted hash
  await expect(ns.locator(".ns-proof")).toContainText("= the posted hash");
  const chips = ns.locator(".ns-chips button");
  const k = await chips.count();
  expect(k).toBeGreaterThanOrEqual(2);
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".deck-ui .count")).toHaveText("05 / 09");
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
  await page.keyboard.press("ArrowLeft");
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  for (let s = 0; s < k; s++) await page.keyboard.press("ArrowRight");
  await expect(page.locator(".deck-ui .count")).toHaveText("06 / 09");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".deck-ui .count")).toHaveText("05 / 09");
  await expect(chips.last()).toHaveAttribute("aria-pressed", "true");
});

test("deck: the stage fits the window", async ({ page }) => {
  await page.goto("/pitch");
  const fit = await page.evaluate(() => { const r = document.querySelector(".deck .stage")!.getBoundingClientRect(); return { w: r.width, h: r.height, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight }; });
  expect(fit.w).toBeLessThanOrEqual(fit.vw + 1);
  expect(fit.h).toBeLessThanOrEqual(fit.vh + 1);
});
