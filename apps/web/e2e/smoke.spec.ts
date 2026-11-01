import { expect, test } from "@playwright/test";

// Every public page renders with no secrets configured and no uncaught page errors.
for (const path of ["/", "/pitch", "/play", "/board", "/scrimmage", "/fidelity", "/playtest"]) {
  test(`${path} renders without secrets`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("home carries the title and social card", async ({ page }) => {
  await page.goto("/play");
  await expect(page).toHaveTitle(/SEMALAM/);
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
});

test("the landing page sends players to /play", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText(/night market/i);
  await page.getByRole("link", { name: /write tonight's orders/i }).first().click();
  await expect(page).toHaveURL(/\/play$/);
});
