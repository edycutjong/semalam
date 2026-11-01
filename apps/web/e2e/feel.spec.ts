import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Game feel (P4c): sound waits for a gesture and is remembered; the replay moves (or steps calmly with reduced motion);
// a sealed night leads to the breakfast reveal and "rewrite from here". Round 2 is a settled testnet night whose policies
// are public; its first committed account stands in for "you".
type Art = { settled: { players: number; replays: { id: string; decisive: { t: number } }[] }; policies: { id: string; policy: unknown }[] };
const art = JSON.parse(readFileSync(new URL("../data/rounds/2.json", import.meta.url), "utf8")) as Art;
const you = art.policies[0];
const decisive = art.settled.replays.find((r) => r.id.toLowerCase() === you.id.toLowerCase())!.decisive;
const sealedRound2 = (page: Page) =>
  page.addInitScript(([id, policy]) => {
    localStorage.setItem("semalam.committed.2", JSON.stringify({ policy, policyHash: "0x00", tx: "0x00", account: id, at: Date.now() }));
  }, [you.id, you.policy] as const);
const turnLabel = (page: Page) => page.locator("section[aria-label='Replay'] .row .data");

test("no audio before a gesture; music off and effects on by default; both choices remembered", async ({ page }) => {
  await page.addInitScript(() => {
    const A = window.AudioContext; let made = 0;
    (window as unknown as { __made: () => number }).__made = () => made;
    window.AudioContext = class extends A { constructor(o?: AudioContextOptions) { super(o); made++; } } as typeof AudioContext;
  });
  const made = () => page.evaluate(() => (window as unknown as { __made: () => number }).__made());
  await page.goto("/play");
  const music = page.getByRole("button", { name: "Music" }), fx = page.getByRole("button", { name: "Sound" });
  await expect(music).toHaveAttribute("aria-pressed", "false");
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  expect(await made()).toBe(0);
  await music.click();
  await expect(music).toHaveAttribute("aria-pressed", "true");
  expect(await made()).toBe(1);
  await fx.click();
  await expect(fx).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.getByRole("button", { name: "Music" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Sound" })).toHaveAttribute("aria-pressed", "false");
  expect(await made()).toBe(0); // a remembered "music on" still waits for the next gesture
});

test("the replay plays by itself and moves continuously", async ({ page }) => {
  await page.goto("/round/2");
  const canvas = page.locator("canvas.lamps");
  await canvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(turnLabel(page)).not.toHaveText("turn 0/300", { timeout: 8000 });
  const a = await canvas.screenshot();
  await page.waitForTimeout(300);
  expect(a.equals(await canvas.screenshot())).toBe(false);
});

test("reduced motion: no autoplay; the night steps in fifths with a cross-fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/round/2");
  await page.locator("canvas.lamps").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await expect(turnLabel(page)).toHaveText("turn 0/300");
  await page.getByRole("button", { name: "Step through the night" }).click();
  await expect(turnLabel(page)).toHaveText("turn 60/300");
});

test("a sealed night: breakfast reveals the rank, and rewrite-from-here pre-fills tonight", async ({ page }) => {
  await sealedRound2(page);
  await page.goto("/round/2");
  await expect(page.getByRole("heading", { name: "Your night" })).toBeVisible();
  await expect(page.locator(".reveal .sr")).toContainText(`of ${art.settled.players} players`);
  await expect(page.getByLabel("Your decisive turn")).toContainText(`turn ${decisive.t}`);
  await page.getByRole("button", { name: `Rewrite from turn ${decisive.t}` }).click();
  await expect(page).toHaveURL(/\/play$/);
  const banner = page.getByRole("note", { name: "Rewriting from last night" });
  await expect(banner).toContainText(`Rewriting from round 2 · turn ${decisive.t}`);
  await expect(page.locator("textarea#orders")).toHaveValue(/^Turns 1–10: /);
  await banner.getByRole("button", { name: "Open last night's orders in the builder" }).click();
  await expect(page.getByText("Rules — first match wins")).toBeVisible();
});

test("the morning card draws your night", async ({ page }) => {
  await sealedRound2(page);
  await page.goto("/round/2");
  await page.getByRole("button", { name: "Share my night" }).click();
  await expect(page.getByRole("img", { name: /Your morning card for round 2/ })).toBeVisible();
});

test("ritual data comes from the public artifacts", async ({ request }) => {
  const j = await (await request.get(`/api/me?account=${you.id}`)).json();
  const n2 = j.nights.find((n: { round: number }) => n.round === 2);
  expect(n2.committed).toBe(true);
  expect(n2.playerRank).toBeGreaterThanOrEqual(1);
  expect((await request.get("/api/me?account=nope")).status()).toBe(400);
});
