import { expect, test } from "@playwright/test";

// The core journey up to the compiler: pick a starter order, read it in the box, edit it, watch the counter.
test("an example order fills the orders box and can be edited", async ({ page }) => {
  await page.goto("/play");
  const box = page.locator("textarea#orders");
  await expect(box).toBeVisible();
  const chip = page.getByRole("button", { name: "Grudge keeper" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(box).toHaveValue(/steal back/);
  const text = await box.inputValue();
  await expect(page.getByText(`${text.length}/280`)).toBeVisible();
  await box.fill(text + " Guard at dawn.");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
});

test("every example chip loads a different order", async ({ page }) => {
  await page.goto("/play");
  const seen = new Set<string>();
  for (const name of ["Good neighbour", "Quiet hoarder", "Night raider", "Copycat", "Grudge keeper"]) {
    await page.getByRole("button", { name }).click();
    seen.add(await page.locator("textarea#orders").inputValue());
  }
  expect(seen.size).toBe(5);
});
