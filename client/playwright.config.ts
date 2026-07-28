import { defineConfig, devices } from "@playwright/test";

// Visual / end-to-end layer. Unit tests stay in Vitest (src/**/*.test.ts); this
// drives the real Vite dev server in real browser engines — chiefly to eyeball
// the app at phone sizes (iOS Safari via WebKit + Android Chrome via Chromium)
// without hand-driving a browser. Because it hits the running dev server, it
// inherits the app's own Vite build, including the libsodium-wrappers alias.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Both halves of the app, so `npx playwright test` works on a clean checkout
  // with nothing started by hand. The relay is not optional: handshake.spec.ts
  // pairs two browsers through it, and without it that spec just times out after
  // 30s instead of saying anything useful.
  //
  // `reuseExistingServer` is on for both so this doesn't fight a `npm run dev`
  // you already have open in another terminal — but note that it also means a
  // manually-started relay will mask a broken config here. Verify changes to this
  // block with nothing listening on :5173 or :8080.
  webServer: [
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Relay lives in the sibling package; it has no HTTP route to poll, so
      // readiness is the TCP port opening.
      command: "npm --prefix ../server run dev",
      port: 8080,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-safari", use: { ...devices["iPhone 13"] } },
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
