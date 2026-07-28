import { test, expect } from "@playwright/test";
import { TAGLINE_LANGS } from "../src/components/taglineLangs";

// Starter smoke test + mobile baseline. It runs on every project, so a single
// `npm run test:e2e` opens the home screen at desktop, iPhone, and Android
// sizes and attaches a screenshot of each to the HTML report — a "before"
// picture to work the mobile layout against. Grow the suite from here (e.g.
// pair two browser contexts to exercise a real room handshake).
test("home screen renders", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Start a chat" })).toBeVisible();
  await expect(page.getByPlaceholder("ROOM-CODE")).toBeVisible();

  // The tagline rotates through languages every few seconds, so assert the
  // stable screen-reader anchor (always the English entry) rather than whatever
  // happens to be on screen — and take the expected text from the same constant
  // the component renders, so changing the copy can't rot this test again.
  await expect(page.locator(".rotating-tagline__sr-only")).toHaveText(TAGLINE_LANGS[0].text);

  const shot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`home-${testInfo.project.name}`, {
    body: shot,
    contentType: "image/png",
  });
});
