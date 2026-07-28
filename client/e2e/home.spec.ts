import { test, expect } from "@playwright/test";

// Starter smoke test + mobile baseline. It runs on every project, so a single
// `npm run test:e2e` opens the home screen at desktop, iPhone, and Android
// sizes and attaches a screenshot of each to the HTML report — a "before"
// picture to work the mobile layout against. Grow the suite from here (e.g.
// pair two browser contexts to exercise a real room handshake).
test("home screen renders", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Start a chat" })).toBeVisible();
  await expect(page.getByText("Nobody sees this but the two of you.")).toBeVisible();
  await expect(page.getByPlaceholder("ROOM-CODE")).toBeVisible();

  const shot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`home-${testInfo.project.name}`, {
    body: shot,
    contentType: "image/png",
  });
});
